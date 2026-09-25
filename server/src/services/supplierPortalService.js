import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { controlModels, db } from '../db/models.js';
import { dbFor } from '../db/connections.js';
import { currentBusinessId, runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Supplier.js';
import '../models/SupplierAccount.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { sendSupplierPortalInvite, sendSupplierResetEmail } from './supplierMail.js';
import { DEFAULT_BUSINESS_COLOR, migrateColorToken } from '../../../shared/businessPalette.js';
import { storefrontOrigin } from './linkOrigins.js';

/**
 * The supplier portal's logins and sessions: **one business, one portal**
 * (client ruling 2026-09-25).
 *
 * A supplier signs in at the business's own address, `<website>/supplier`
 * (`cellshoppe.kelinto.com/supplier`, or the business's custom domain), and
 * the login lives on that business's own `Supplier` record, in that business's
 * own database. A company supplying three businesses has three logins, one at
 * each business's address, and nothing connects them.
 *
 * **Why not one login across businesses**, which is what this replaced: a
 * shared portal was a free multi-business workspace, which is the product
 * Kelinto sells; it was the one record crossing the database-per-business
 * boundary; and it let the control plane know which companies supply which
 * businesses across tenants, which is no tenant's business but their own.
 *
 * **Invite only.** A business adds the supplier in the ERP and sends portal
 * access. The email carries a single-use link to set a password, never the
 * password itself; there is no sign-up.
 *
 * **The host decides the business**, as it does for the website: the
 * request's database is the one `resolveBusiness` opened from the host, and
 * every lookup here reads `db()`. The session names the business too, and a
 * session presented at another business's address is simply not a session
 * there.
 */

const SUPPLIER_COOKIE = `${env.COOKIE_NAME}_supplier`;
const SESSION_DAYS = 30;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_TTL_DAYS = Math.round(TOKEN_TTL_MS / (24 * 60 * 60 * 1000));

const SIGN_IN_FAILED = ['That email and password do not match a supplier login here.', 'SUPPLIER_CREDENTIALS_INVALID'];

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normaliseEmail(email) {
  return String(email ?? '').toLowerCase().trim();
}

/** The business's own address, where its supplier portal lives. */
function portalOrigin(businessId = currentBusinessId()) {
  return storefrontOrigin(businessId);
}

function issueSession(res, supplier, businessId) {
  const token = jwt.sign(
    { sub: supplier._id.toString(), kind: 'supplier', biz: String(businessId) },
    env.JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` },
  );

  // Host-only (no `domain`), so the cookie belongs to this business's address
  // and is never sent to another business's.
  res.cookie(SUPPLIER_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSupplierSession(res) {
  res.clearCookie(SUPPLIER_COOKIE, { path: '/' });
}

/** The business's record of this supplier - what the portal screens show. */
function shapePortalSupplier(supplier) {
  return {
    id: supplier._id.toString(),
    name: supplier.name,
    code: supplier.code ?? null,
    email: supplier.email ?? null,
    contactName: supplier.contactName ?? null,
    phone: supplier.phone ?? null,
    componentTypes: supplier.componentTypes ?? [],
    paymentTerms: supplier.paymentTerms,
    lastLoginAt: supplier.portalLastLoginAt ?? null,
  };
}

/**
 * A fresh single-use token on the record: returns the plaintext for the email,
 * stores only its hash. Used for the invitation and for a reset alike.
 */
function mintToken(supplier) {
  const token = crypto.randomBytes(32).toString('base64url');
  supplier.portalTokenHash = hashToken(token);
  supplier.portalTokenAt = new Date(Date.now() + TOKEN_TTL_MS);
  return token;
}

// ---- the business's side ------------------------------------------------------

/**
 * Give a supplier access to this business's portal.
 *
 * Emails a link to set a password, valid for a week and good once. Sending it
 * again (the ERP's **Resend portal link**) replaces the previous link. An
 * existing password keeps working until the supplier uses the new link, so a
 * resend never locks anybody out. Called when a supplier is created and from
 * that button.
 */
async function invitePortal(supplierId) {
  const supplier = await db().Supplier.findById(supplierId).select('+portalTokenHash +portalTokenAt');
  if (!supplier) throw ApiError.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');

  if (!supplier.email) {
    throw ApiError.badRequest(
      `${supplier.name} has no email address, so there is nowhere to send the portal link.`,
      'SUPPLIER_NO_EMAIL',
    );
  }
  if (!supplier.isActive) {
    throw ApiError.badRequest(
      `${supplier.name} is inactive. Activate them before sending portal access.`,
      'SUPPLIER_INACTIVE',
    );
  }

  const origin = await portalOrigin();
  const token = mintToken(supplier);
  supplier.portalInviteAt = new Date();
  await supplier.save();

  const mail = await sendSupplierPortalInvite({
    supplier,
    portal: `${origin}/supplier`,
    link: `${origin}/supplier/reset?token=${encodeURIComponent(token)}&invite=1`,
    expiresDays: TOKEN_TTL_DAYS,
  });

  return {
    supplier: shapePortalSupplier(supplier),
    invitedAt: supplier.portalInviteAt,
    portal: `${origin}/supplier`,
    delivered: mail.delivered,
    error: mail.error ?? null,
  };
}

// ---- the supplier's side ------------------------------------------------------

/**
 * Sign in to THIS business's portal.
 *
 * Suppliers are looked up by email in the business's own database. Two
 * supplier records can share an address (a parent company and its outlet), so
 * every record with a password is tried; the first whose password matches is
 * the one signed in.
 */
async function login({ email, password }, res) {
  const businessId = currentBusinessId();
  const candidates = businessId
    ? await db()
        .Supplier.find({ email: normaliseEmail(email), passwordHash: { $exists: true, $ne: null } })
        .select('+passwordHash')
    : [];

  let match = null;
  for (const supplier of candidates) {
    if (await bcrypt.compare(String(password ?? ''), supplier.passwordHash)) {
      match = supplier;
      break;
    }
  }
  // A missing address and a wrong password take the same time to answer.
  if (!candidates.length) {
    await bcrypt.compare(String(password ?? ''), '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  }

  if (!match || !match.isActive) throw ApiError.unauthorized(...SIGN_IN_FAILED);

  match.portalLastLoginAt = new Date();
  await match.save();

  issueSession(res, match, businessId);
  return { ok: true };
}

function logout(res) {
  clearSupplierSession(res);
  return { ok: true };
}

/**
 * Everything the portal shell needs: whose portal this is (from the host, so
 * the sign-in page can greet the supplier in the business's name and colour),
 * and who is signed in, if anybody.
 */
async function portalState(supplier, businessId) {
  const business = businessId
    ? await controlModels().Business.findById(businessId).select('name colorToken').lean()
    : null;
  return {
    supplier: supplier ? shapePortalSupplier(supplier) : null,
    business: {
      id: business ? String(business._id) : null,
      name: business?.name ?? null,
      colorToken: business ? migrateColorToken(business.colorToken) : DEFAULT_BUSINESS_COLOR,
    },
  };
}

async function changePassword(supplierId, { currentPassword, password }) {
  const supplier = await db().Supplier.findById(supplierId).select('+passwordHash');
  if (!supplier?.passwordHash) throw ApiError.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');

  if (!(await bcrypt.compare(String(currentPassword ?? ''), supplier.passwordHash))) {
    throw ApiError.badRequest('That is not your current password.', 'PASSWORD_INCORRECT');
  }

  supplier.passwordHash = await bcrypt.hash(password, 10);
  await supplier.save();
  return { ok: true };
}

/**
 * Email a reset link for this business's portal. Always answers the same,
 * known address or not, so the endpoint cannot be used to ask who supplies
 * this business.
 */
async function requestReset(email) {
  if (!currentBusinessId()) return { ok: true };
  const supplier = await db()
    .Supplier.findOne({ email: normaliseEmail(email), isActive: true, passwordHash: { $exists: true, $ne: null } })
    .select('+portalTokenHash +portalTokenAt');
  if (!supplier) return { ok: true };

  const token = mintToken(supplier);
  await supplier.save();

  await sendSupplierResetEmail({
    supplier,
    link: `${await portalOrigin()}/supplier/reset?token=${encodeURIComponent(token)}`,
    expiresDays: TOKEN_TTL_DAYS,
  });
  return { ok: true };
}

/**
 * Set a password from an emailed link: the invitation's first password or a
 * reset. Either way the link works once.
 */
async function resetPassword({ token, password }) {
  const supplier = await db()
    .Supplier.findOne({ portalTokenHash: hashToken(String(token ?? '')) })
    .select('+portalTokenHash +portalTokenAt +passwordHash');

  if (!supplier || !supplier.portalTokenAt || supplier.portalTokenAt.getTime() < Date.now()) {
    throw ApiError.badRequest('That link has expired or was already used. Ask for a new one.', 'RESET_TOKEN_INVALID');
  }
  if (!supplier.isActive) {
    throw ApiError.badRequest('This supplier login is paused. Contact the business directly.', 'SUPPLIER_INACTIVE');
  }

  supplier.passwordHash = await bcrypt.hash(password, 10);
  supplier.portalTokenHash = undefined;
  supplier.portalTokenAt = undefined;
  await supplier.save();
  return { ok: true };
}

// ---- migration ------------------------------------------------------------------

/** Run `fn` inside one business's database. */
function inBusiness(business, fn) {
  return runInBusiness(
    { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
    fn,
  );
}

/**
 * Move every supplier login back onto the business's own record.
 *
 * The retired design kept one `SupplierAccount` per email in the control
 * database, with a link per business. For every ACTIVE link, the account's
 * password hash is copied onto that business's `Supplier` record, so nobody
 * has to reset: the same password works at each business's own address. A
 * link still at `invited` or `declined` is not copied; the business sends a
 * fresh invitation from the ERP. A record that already has its own password is
 * left alone.
 *
 * Idempotent. The `SupplierAccount` collection is not touched and can be
 * dropped once this has run on every installation.
 *
 *   npm run backfill -- supplier-logins
 */
async function backfillSupplierLogins({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const { Business, SupplierAccount } = controlModels();
  const accounts = await SupplierAccount.find({ 'links.status': 'active' }).select('+passwordHash').lean();
  const businesses = new Map(
    (await Business.find({ deletedAt: null }).select('name code').lean()).map((row) => [String(row._id), row]),
  );

  let copied = 0;
  let kept = 0;
  let skipped = 0;

  for (const account of accounts) {
    if (!account.passwordHash) {
      skipped += 1;
      continue;
    }
    for (const link of account.links.filter((row) => row.status === 'active')) {
      const business = businesses.get(String(link.business));
      if (!business) {
        skipped += 1;
        continue;
      }
      const result = await inBusiness(business, () =>
        db().Supplier.updateOne(
          { _id: link.supplier, $or: [{ passwordHash: { $exists: false } }, { passwordHash: null }] },
          { $set: { passwordHash: account.passwordHash } },
        ),
      );
      if (result.modifiedCount) copied += 1;
      else kept += 1;
    }
  }

  log(`    ${copied} login(s) moved onto their business, ${kept} already had one, ${skipped} skipped`);
  return { copied, kept, skipped };
}

export {
  SUPPLIER_COOKIE,
  backfillSupplierLogins,
  changePassword,
  clearSupplierSession,
  invitePortal,
  login,
  logout,
  portalOrigin,
  portalState,
  requestReset,
  resetPassword,
  shapePortalSupplier,
};
