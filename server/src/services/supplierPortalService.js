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
import { generatePassword } from './welcomeMail.js';
import { sendSupplierPortalInvite, sendSupplierResetEmail } from './supplierMail.js';
import { DEFAULT_BUSINESS_COLOR, migrateColorToken } from '../../../shared/businessPalette.js';
import { panelOrigin } from './linkOrigins.js';

/**
 * The supplier portal's accounts and sessions.
 *
 * ## One login, many businesses
 *
 * A supplier signs in as a `SupplierAccount` (control plane) and works inside
 * ONE business at a time - the `biz` claim in their session. For that business
 * the session resolves to the business's own `Supplier` record, which is what
 * every portal screen has always read as `req.supplier`: the orders, the bids,
 * the agreements are unchanged, and only who-is-this and which-business moved.
 *
 * ## The cookie
 *
 * Its own name, separate from the buyer/staff session, so one browser can hold
 * both and a token minted for one population cannot resolve in the other. The
 * `kind` changed from `supplier` to `supplier-account` with the move; a token of
 * the old kind is cleared on sight, and the supplier signs in once more.
 */

const SUPPLIER_COOKIE = `${env.COOKIE_NAME}_supplier`;
const SESSION_DAYS = 30;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SIGN_IN_FAILED = [
  'That email and password do not match a supplier account.',
  'SUPPLIER_CREDENTIALS_INVALID',
];

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Where a supplier's portal lives. The shared admin host when there is one -
 * every business's suppliers sign in at the same place - else the installation's
 * public origin, as before.
 */
function portalOrigin() {
  return panelOrigin();
}

function issueSession(res, account, businessId = null) {
  const token = jwt.sign(
    {
      sub: account._id.toString(),
      kind: 'supplier-account',
      ...(businessId ? { biz: String(businessId) } : {}),
    },
    env.JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` },
  );

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

function shapeAccount(account) {
  return {
    id: account._id.toString(),
    email: account.email,
    name: account.name || '',
    contactName: account.contactName || '',
    lastLoginAt: account.lastLoginAt ?? null,
  };
}

/** Run `fn` inside one business's database. */
function inBusiness(business, fn) {
  return runInBusiness(
    { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
    fn,
  );
}

/**
 * The businesses on an account's links, live ones only, split by status.
 *
 * A deleted or missing business drops out here rather than at every caller, so
 * a supplier is never offered a business that no longer trades.
 */
async function linkedBusinesses(account) {
  const ids = account.links.map((link) => link.business);
  if (!ids.length) return { active: [], invited: [] };

  const businesses = await controlModels()
    .Business.find({ _id: { $in: ids }, deletedAt: null })
    .select('name code colorToken')
    .sort({ name: 1 })
    .lean();

  const byId = new Map(businesses.map((business) => [String(business._id), business]));
  const pick = (status) =>
    account.links
      .filter((link) => link.status === status && byId.has(String(link.business)))
      .map((link) => ({ ...byId.get(String(link.business)), link }));

  return { active: pick('active'), invited: pick('invited') };
}

/** Stamp the business's own record, which is what its purchasing screens read. */
async function stampLogin(business, supplierId) {
  await inBusiness(business, () =>
    db().Supplier.updateOne({ _id: supplierId }, { $set: { portalLastLoginAt: new Date() } }),
  );
}

// ---- invitations (the business's side) --------------------------------------

/**
 * Give a supplier portal access to THIS business.
 *
 * - **A new address** gets an account with a generated password, emailed.
 * - **A known address** gets a link and an email saying who invited them - and
 *   **no new password**. That password opens every business they supply;
 *   resetting it from one business would lock them out of all the others. A
 *   supplier who has forgotten it resets it themselves.
 *
 * Either way the link starts `invited` and the supplier accepts it in the
 * portal. Called when a supplier is created and from **Resend portal link**.
 */
async function invitePortal(supplierId) {
  const supplier = await db().Supplier.findById(supplierId);
  if (!supplier) throw ApiError.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');

  if (!supplier.email) {
    throw ApiError.badRequest(
      `${supplier.name} has no email address, so there is nowhere to send the portal link.`,
      'SUPPLIER_NO_EMAIL',
    );
  }
  if (!supplier.isActive) {
    throw ApiError.badRequest(
      `${supplier.name} is inactive - activate them before sending portal access.`,
      'SUPPLIER_INACTIVE',
    );
  }

  const businessId = currentBusinessId();
  if (!businessId) {
    throw ApiError.badRequest('No business is selected to invite this supplier to.', 'BUSINESS_REQUIRED');
  }

  const { SupplierAccount } = controlModels();
  const email = String(supplier.email).toLowerCase().trim();
  let account = await SupplierAccount.findOne({ email }).select('+passwordHash');
  let password = null;

  if (!account) {
    account = new SupplierAccount({
      email,
      name: supplier.name,
      contactName: supplier.contactName ?? '',
      phone: supplier.phone ?? '',
    });
  }
  if (!account.passwordHash) {
    password = generatePassword();
    await account.setPassword(password);
  }

  const link = account.linkFor(businessId);
  if (!link) {
    account.links.push({ business: businessId, supplier: supplier._id, status: 'invited' });
  } else {
    // The record can have been recreated since; the link follows the current one.
    link.supplier = supplier._id;
    if (link.status === 'declined') {
      link.status = 'invited';
      link.invitedAt = new Date();
      link.respondedAt = null;
    }
  }
  await account.save();

  supplier.portalInviteAt = new Date();
  await supplier.save();

  const mail = await sendSupplierPortalInvite({
    supplier,
    password,
    portal: `${portalOrigin()}/supplier`,
    existingAccount: !password,
  });

  return {
    supplier: shapePortalSupplier(supplier),
    invitedAt: supplier.portalInviteAt,
    existingAccount: !password,
    delivered: mail.delivered,
    error: mail.error ?? null,
  };
}

// ---- the supplier's side ----------------------------------------------------

/**
 * Sign in, and land in a business when there is one to land in.
 *
 * The first active business by name - a supplier with one business, which is
 * most of them, is simply in it. One with only invitations signs in to the
 * account alone and is shown the invitations to answer.
 */
async function login({ email, password }, res) {
  const account = await controlModels()
    .SupplierAccount.findOne({ email: String(email ?? '').toLowerCase().trim() })
    .select('+passwordHash');

  // Compared even when there is no account, against a hash that cannot match,
  // so a missing account and a wrong password take the same time to answer.
  const ok = account
    ? await account.verifyPassword(password)
    : await bcrypt.compare(
        String(password ?? ''),
        '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
      );

  if (!account || !account.passwordHash || !ok || !account.isActive) {
    throw ApiError.unauthorized(...SIGN_IN_FAILED);
  }

  account.lastLoginAt = new Date();
  await account.save();

  const { active } = await linkedBusinesses(account);
  const landing = active[0] ?? null;
  if (landing) await stampLogin(landing, landing.link.supplier);

  issueSession(res, account, landing?._id ?? null);
  return { ok: true, business: landing ? { id: String(landing._id), name: landing.name } : null };
}

function logout(res) {
  clearSupplierSession(res);
  return { ok: true };
}

/**
 * Everything the portal shell needs: who, which business, and what else.
 *
 * `supplier` is the current business's record of them, or null when the
 * session names no business yet - an account holding only invitations.
 */
async function portalState(account, supplier, businessId) {
  if (!account) return { account: null, supplier: null, business: null, businesses: [], invitations: [] };

  const { active, invited } = await linkedBusinesses(account);
  const current = active.find((business) => String(business._id) === String(businessId)) ?? null;

  return {
    account: shapeAccount(account),
    supplier: supplier && current ? shapePortalSupplier(supplier) : null,
    business: current
      ? { id: String(current._id), name: current.name, colorToken: migrateColorToken(current.colorToken) }
      : { id: null, name: null, colorToken: DEFAULT_BUSINESS_COLOR },
    businesses: active.map((business) => ({ id: String(business._id), name: business.name })),
    invitations: invited.map((business) => ({
      id: String(business._id),
      name: business.name,
      invitedAt: business.link.invitedAt,
    })),
  };
}

/** Work inside another business the account is active with. */
async function switchBusiness(account, businessId, res) {
  const { active } = await linkedBusinesses(account);
  const target = active.find((business) => String(business._id) === String(businessId));
  if (!target) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');

  const supplier = await inBusiness(target, () =>
    db().Supplier.findById(target.link.supplier).select('isActive').lean(),
  );
  if (!supplier?.isActive) {
    throw ApiError.badRequest(
      `${target.name} has paused your supplier account. Contact them directly.`,
      'SUPPLIER_INACTIVE',
    );
  }

  await stampLogin(target, target.link.supplier);
  issueSession(res, account, target._id);
  return { ok: true, business: { id: String(target._id), name: target.name } };
}

/**
 * Accept or decline a business's invitation.
 *
 * Accepting moves the session into that business straight away - it is what
 * somebody accepting an invitation came to do next.
 */
async function respondToInvitation(account, businessId, accept, res) {
  const link = account.linkFor(businessId);
  if (!link || link.status !== 'invited') {
    throw ApiError.notFound('Invitation not found.', 'INVITATION_NOT_FOUND');
  }

  link.status = accept ? 'active' : 'declined';
  link.respondedAt = new Date();
  await account.save();

  if (accept) return switchBusiness(account, businessId, res);
  return { ok: true };
}

async function changePassword(accountId, { currentPassword, password }) {
  const account = await controlModels().SupplierAccount.findById(accountId).select('+passwordHash');
  if (!account) throw ApiError.notFound('Account not found.', 'SUPPLIER_NOT_FOUND');

  if (!(await account.verifyPassword(currentPassword))) {
    throw ApiError.badRequest('That is not your current password.', 'PASSWORD_INCORRECT');
  }

  await account.setPassword(password);
  await account.save();
  return { ok: true };
}

/**
 * Email a reset link. Always answers the same, whether or not the address is
 * known, so the endpoint cannot be used to ask which companies supply whom.
 */
async function requestReset(email) {
  const account = await controlModels().SupplierAccount.findOne({
    email: String(email ?? '').toLowerCase().trim(),
    isActive: true,
  });
  if (!account) return { ok: true };

  const token = crypto.randomBytes(32).toString('base64url');
  account.resetTokenHash = hashToken(token);
  account.resetTokenAt = new Date(Date.now() + TOKEN_TTL_MS);
  await account.save();

  await sendSupplierResetEmail({
    supplier: { email: account.email, name: account.name },
    link: `${portalOrigin()}/supplier/reset?token=${encodeURIComponent(token)}`,
    expiresDays: Math.round(TOKEN_TTL_MS / (24 * 60 * 60 * 1000)),
  });

  return { ok: true };
}

async function resetPassword({ token, password }) {
  const account = await controlModels()
    .SupplierAccount.findOne({ resetTokenHash: hashToken(String(token ?? '')) })
    .select('+resetTokenHash +resetTokenAt +passwordHash');

  if (!account || !account.resetTokenAt || account.resetTokenAt.getTime() < Date.now()) {
    throw ApiError.badRequest('That link has expired. Ask for a new one.', 'RESET_TOKEN_INVALID');
  }

  await account.setPassword(password);
  account.resetTokenHash = undefined;
  account.resetTokenAt = undefined;
  await account.save();
  return { ok: true };
}

// ---- migration --------------------------------------------------------------

/**
 * Lift every existing portal login into a platform-wide account.
 *
 * Before this, a supplier's password lived on the business's own `Supplier`
 * record. For each business, each supplier holding one gets an account (by
 * email) with an ACTIVE link - they already had access, so they are not asked
 * to accept it again. The first password found for an address is kept; a
 * supplier who had different passwords at two businesses uses the first
 * business's (by code) and can reset it. Counted and reported, not guessed at.
 *
 * Idempotent: an existing link is left as it is.
 *
 *   npm run backfill -- supplier-accounts
 */
async function backfillSupplierAccounts({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const { Business, SupplierAccount } = controlModels();
  const businesses = await Business.find({ deletedAt: null }).select('name code').sort({ code: 1 }).lean();

  let created = 0;
  let linked = 0;
  let conflicting = 0;

  for (const business of businesses) {
    const suppliers = await inBusiness(business, () =>
      db()
        .Supplier.find({ passwordHash: { $exists: true, $ne: null }, email: { $nin: [null, ''] } })
        .select('+passwordHash name email contactName phone isActive')
        .lean(),
    );

    for (const supplier of suppliers) {
      const email = String(supplier.email).toLowerCase().trim();
      let account = await SupplierAccount.findOne({ email }).select('+passwordHash');

      if (!account) {
        account = new SupplierAccount({
          email,
          passwordHash: supplier.passwordHash,
          name: supplier.name,
          contactName: supplier.contactName ?? '',
          phone: supplier.phone ?? '',
        });
        created += 1;
      } else if (account.passwordHash !== supplier.passwordHash) {
        conflicting += 1;
      }

      const existing = account.linkFor(business._id);
      if (!existing) {
        account.links.push({
          business: business._id,
          supplier: supplier._id,
          status: 'active',
          respondedAt: new Date(),
        });
        linked += 1;
      } else if (String(existing.supplier) !== String(supplier._id)) {
        // The business's database was re-seeded or the record recreated: the
        // link keeps its answer and follows the record that exists now, rather
        // than pointing at an id nothing resolves.
        existing.supplier = supplier._id;
        linked += 1;
      }
      await account.save();
    }
    log(`    ${business.name} (${business.code}): ${suppliers.length} portal login(s)`);
  }

  log(
    `    ${created} account(s) created, ${linked} link(s) added` +
      (conflicting ? `, ${conflicting} address(es) had different passwords - the first business's was kept` : ''),
  );
  return { created, linked, conflicting };
}

export {
  SUPPLIER_COOKIE,
  backfillSupplierAccounts,
  changePassword,
  clearSupplierSession,
  invitePortal,
  login,
  logout,
  portalOrigin,
  portalState,
  requestReset,
  resetPassword,
  respondToInvitation,
  shapePortalSupplier,
  switchBusiness,
};
