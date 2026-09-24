import crypto from 'node:crypto';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import SuperAdmin from '../models/SuperAdmin.js';
import Tenant from '../models/Tenant.js';
import Plan from '../models/Plan.js';
import Business from '../models/Business.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { forgetBusinessConfig } from '../middleware/businessConfigCache.js';
import { resetBusinessResolution } from '../middleware/resolveBusiness.js';
import {
  businessSlugProblem,
  customDomainProblem,
  normaliseDomain,
  suggestSlug,
} from '../../../shared/hosts.js';
import { hashResetToken } from './authService.js';
import { sendPasswordResetEmail } from './welcomeMail.js';
import { panelOrigin } from './linkOrigins.js';

/**
 * Where a tenant owner's invitation link lands.
 *
 * The operator's request origin was used as-is, and once the super admin has a
 * host of its own (`SUPERADMIN_HOST`) that origin is `admin.<platform>` -
 * which serves the super admin panel and nothing else, so the owner's
 * "set your password" link opened an operator sign-in they cannot use. The owner
 * signs in on the panel host, so that is where the link goes once there is
 * one; with the super admin split but no panel host, the public origin; with
 * no split at all, the request's own origin as before.
 */
function inviteOrigin(origin) {
  if (env.PANEL_HOST) return panelOrigin();
  if (env.SUPERADMIN_HOST) return env.publicOrigin;
  return origin || env.publicOrigin;
}
import { FEATURES, resolveFeatures } from '../../../shared/schemas/features.js';
import { DEFAULT_BUSINESS_COLOR } from '../../../shared/businessPalette.js';

/**
 * The super-admin console (SAAS_PLATFORM §4.5, §6).
 *
 * **A third session, on a third cookie.** `middleware/auth.js` reads
 * `env.COOKIE_NAME` into `User`; `supplierAuth.js` reads its own cookie into
 * `Supplier`; this reads a third into `SuperAdmin`. None can produce another,
 * so "an admin cannot reach the console" and "a super admin cannot reach a
 * tenant's records" are both properties of the wiring rather than rules
 * somebody has to remember when adding the next route.
 *
 * ## What a super admin may and may not do (§4.5)
 *
 * **May:** create tenants, grant slots, set plans, create businesses, and
 * toggle features per business.
 *
 * **May not:** read a tenant's business records. Nothing in this file returns a
 * customer, an invoice, an order or a ticket - the console lists *businesses*
 * and their configuration, never what is inside them. That is a deliberate
 * limit and not an oversight: an operator who can read every tenant's books is
 * a breach waiting for one stolen laptop.
 */

const SUPERADMIN_COOKIE = `${env.COOKIE_NAME}_superadmin`;
/** Deliberately shorter than the 30-day supplier session: this account can
 *  reconfigure every tenant, so a forgotten browser is a bigger problem. */
const SESSION_DAYS = 7;

/**
 * How long an owner's invitation stays usable.
 *
 * Seven days rather than the hour a password reset gets. A reset is somebody
 * standing at the screen having just clicked the link; an invitation is sent to
 * a person who may not be at work today, and one that expires over a weekend
 * turns every new tenant into a support request.
 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SIGN_IN_FAILED = [
  'That email and password do not match a super-admin account.',
  'SUPERADMIN_CREDENTIALS_INVALID',
];

function issueSession(res, admin) {
  const token = jwt.sign(
    { sub: admin._id.toString(), kind: 'superadmin' },
    env.JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` },
  );

  res.cookie(SUPERADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSuperAdminSession(res) {
  res.clearCookie(SUPERADMIN_COOKIE, { path: '/' });
}

// ---- session ----------------------------------------------------------------

async function login({ email, password }, res) {
  const admin = await SuperAdmin.findOne({ email: String(email).toLowerCase().trim() }).select(
    '+passwordHash',
  );

  // One message for "no such account" and "wrong password", as every other
  // sign-in here does: telling them apart is an account-enumeration oracle.
  if (!admin) throw ApiError.unauthorized(...SIGN_IN_FAILED);
  if (!admin.isActive) throw ApiError.unauthorized(...SIGN_IN_FAILED);

  const ok = await bcrypt.compare(String(password), admin.passwordHash);
  if (!ok) throw ApiError.unauthorized(...SIGN_IN_FAILED);

  admin.lastLoginAt = new Date();
  await admin.save();

  issueSession(res, admin);
  return { admin: admin.toPublic() };
}

function logout(res) {
  clearSuperAdminSession(res);
  return { ok: true };
}

// ---- tenants ----------------------------------------------------------------

/** URL-safe, lowercase, collapsed - the same shaping `taxonomyAdminService` uses. */
function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Every tenant, with the businesses each one owns.
 *
 * The business rows carry configuration only - name, type, status - never a
 * count of customers or a figure of revenue. See the note at the top of this
 * file.
 */
async function listTenants() {
  const [tenants, businesses, plans] = await Promise.all([
    Tenant.find({}).sort({ name: 1 }).lean(),
    Business.find({})
      .select('name code slug domain addressRequest businessType status tenant isDefault deletedAt purgeAfter')
      .lean(),
    Plan.find({}).select('name slug').lean(),
  ]);

  /**
   * Each business's administrators - names and addresses only.
   *
   * **This is the one place the console reads a `User`, and the limit is
   * deliberate.** It answers "can anybody actually sign in to this tenant",
   * which is a question about provisioning rather than about their records: an
   * account nobody can reach is a support call waiting to happen, and the
   * console is where it gets fixed. It returns no customer, no order and no
   * figure - `role: 'admin'` is the whole filter, so a tenant's *customers*
   * remain as invisible here as they were before.
   */
  /**
   * Owners belong to the **tenant**, not to a business.
   *
   * This used to filter `business: { $in: … }` and read from each business's
   * own database - which was right while an admin lived beside the shop's
   * records, and became wrong the moment admins moved to the control plane so
   * one login could reach every business a tenant owns. The console then showed
   * "No owner - nobody can sign in" on a tenant whose owner was signed in at the
   * time, because it was looking in the database the account had left.
   */
  const admins = await User.find({
    role: 'admin',
    tenant: { $in: tenants.map((row) => row._id) },
  })
    .select('contactName email tenant lastLoginAt')
    .lean();

  const adminsByTenant = new Map();
  for (const admin of admins) {
    const key = String(admin.tenant);
    if (!adminsByTenant.has(key)) adminsByTenant.set(key, []);
    adminsByTenant.get(key).push({
      id: admin._id.toString(),
      contactName: admin.contactName ?? '',
      email: admin.email,
      // Whether they have ever actually got in. An invitation that was never
      // opened looks exactly like a working account until somebody asks.
      lastLoginAt: admin.lastLoginAt ?? null,
    });
  }

  const planName = new Map(plans.map((plan) => [String(plan._id), plan.name]));
  const byTenant = new Map();
  for (const business of businesses) {
    const key = String(business.tenant ?? 'unassigned');
    if (!byTenant.has(key)) byTenant.set(key, []);
    byTenant.get(key).push({
      id: business._id.toString(),
      name: business.name,
      code: business.code,
      // Where it answers. Null slug means no subdomain at all - a business made
      // before the console could set one, reachable only by the switcher.
      slug: business.slug ?? null,
      domain: business.domain ?? null,
      addressRequest: business.addressRequest ?? null,
      businessType: business.businessType,
      status: business.status,
      isDefault: Boolean(business.isDefault),
      deletedAt: business.deletedAt ?? null,
      purgeAfter: business.purgeAfter ?? null,
      // Whether it can still be brought back, rather than making the console
      // re-derive that from two dates and reach a different answer.
      restorable: Boolean(
        business.deletedAt && business.purgeAfter && business.purgeAfter > new Date(),
      ),
    });
  }

  return {
    tenants: tenants.map((tenant) => {
      const owned = byTenant.get(String(tenant._id)) ?? [];
      // Businesses still holding a slot: live ones, plus deleted ones whose
      // retention window has not closed.
      const holding = owned.filter((business) => !business.deletedAt || business.restorable);
      return {
        id: tenant._id.toString(),
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        contactName: tenant.contactName ?? null,
        contactEmail: tenant.contactEmail ?? null,
        slots: tenant.slots ?? 0,
        /**
         * What is left to spend. A tenant with no free slot cannot create a
         * business, and the console should say so before the button is pressed.
         *
         * **Counted the same way `slotFilter` counts**, which is not simply
         * `owned.length`: a business deleted inside its retention window still
         * holds its slot, and one past that window no longer does. Deriving it
         * differently here would let the console offer a button the server then
         * refuses.
         */
        // The tenant's owner accounts. One login reaches every business it owns.
        admins: adminsByTenant.get(String(tenant._id)) ?? [],
        slotsUsed: holding.length,
        slotsFree: Math.max(0, (tenant.slots ?? 0) - holding.length),
        plan: tenant.plan ? { id: String(tenant.plan), name: planName.get(String(tenant.plan)) ?? '-' } : null,
        businesses: owned,
        createdAt: tenant.createdAt,
      };
    }),
    /**
     * Businesses belonging to no tenant.
     *
     * Cellvix and CellShoppe are both here until somebody assigns them, because
     * they predate tenants entirely. Surfacing them rather than hiding them is
     * the point: a business owned by nobody is a real state that somebody has
     * to resolve, and a console that omitted it would make the slot arithmetic
     * disagree with the database.
     */
    unassigned: byTenant.get('unassigned') ?? [],
    // What a slug becomes, so the console can show `cellshoppe.kelinto.com`
    // rather than a bare label. Null when no wildcard domain is configured.
    storefrontDomain: env.storefrontDomain,
    // Every domain the platform answers on as itself, so the address editor can
    // refuse `app.<platform>` as a custom domain while it is typed, not only
    // after it is sent. The server re-checks either way.
    platformDomains: env.platformDomains,
  };
}

async function createTenant(body) {
  const slug = slugify(body.slug || body.name);
  if (!slug) throw ApiError.badRequest('Give the tenant a name.', 'TENANT_NAME_REQUIRED');

  const clash = await Tenant.findOne({ slug }).lean();
  if (clash) {
    throw ApiError.badRequest(`A tenant already uses "${slug}".`, 'TENANT_SLUG_TAKEN');
  }

  const tenant = await Tenant.create({
    name: body.name,
    slug,
    status: body.status ?? 'active',
    contactName: body.contactName,
    contactEmail: body.contactEmail,
    phone: body.phone,
    slots: body.slots ?? 1,
    plan: body.plan || undefined,
    notes: body.notes,
  });

  return { tenant: tenant.toPublic() };
}

async function updateTenant(id, body) {
  const tenant = await Tenant.findById(id);
  if (!tenant) throw ApiError.notFound('Tenant not found.', 'TENANT_NOT_FOUND');

  if (body.slug && slugify(body.slug) !== tenant.slug) {
    const slug = slugify(body.slug);
    const clash = await Tenant.findOne({ slug, _id: { $ne: tenant._id } }).lean();
    if (clash) throw ApiError.badRequest(`A tenant already uses "${slug}".`, 'TENANT_SLUG_TAKEN');
    tenant.slug = slug;
  }

  for (const field of ['name', 'status', 'contactName', 'contactEmail', 'phone', 'notes']) {
    if (body[field] !== undefined) tenant[field] = body[field];
  }
  if (body.slots !== undefined) tenant.slots = body.slots;
  if (body.plan !== undefined) tenant.plan = body.plan || undefined;

  await tenant.save();
  /**
   * Cleared in full, not per business.
   *
   * A tenant's status is cached against each of its **businesses**, and a tenant
   * owns any number of them - so there is no single key to drop here. Suspending
   * an account is exactly the moment the cache must not be trusted, and clearing
   * everything costs one re-read per active business.
   */
  forgetBusinessConfig();
  return { tenant: tenant.toPublic() };
}

/**
 * Grant or revoke slots.
 *
 * **Never below what is already used.** Taking a tenant to fewer slots than it
 * has businesses would leave it over its own limit with no way to act on that
 * the console cannot delete somebody's business to make the arithmetic work,
 * and silently allowing it would make `slotsFree` negative everywhere it is
 * read.
 */
async function setSlots(id, { slots }) {
  const tenant = await Tenant.findById(id);
  if (!tenant) throw ApiError.notFound('Tenant not found.', 'TENANT_NOT_FOUND');

  const used = await Business.countDocuments(slotFilter(tenant._id));
  if (slots < used) {
    throw ApiError.badRequest(
      `${tenant.name} already runs ${used} business(es) - grant at least that many slots, or remove a business first.`,
      'SLOTS_BELOW_USED',
    );
  }

  tenant.slots = slots;
  await tenant.save();
  return { tenant: tenant.toPublic(), slotsUsed: used };
}

// ---- businesses -------------------------------------------------------------

/**
 * Create a business for a tenant, spending a slot.
 *
 * The slot check is here rather than on the model because it is a *policy*
 * about what a tenant has paid for, and policy belongs where it can produce a
 * message somebody can act on.
 */
async function createBusiness(tenantId, body) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw ApiError.notFound('Tenant not found.', 'TENANT_NOT_FOUND');

  const used = await Business.countDocuments(slotFilter(tenant._id));
  if (used >= (tenant.slots ?? 0)) {
    throw ApiError.badRequest(
      `${tenant.name} has used all ${tenant.slots ?? 0} of its slots. Grant another before adding a business.`,
      'NO_SLOTS_LEFT',
    );
  }

  /**
   * Every business gets an address at creation. Before this the console made
   * businesses with no slug and nothing could set one afterwards, so only the
   * two seeded businesses were reachable on a subdomain at all.
   *
   * Derived from the name when the form leaves it blank - but a derived slug is
   * still checked, and a name like "App" or one another business already
   * answers on is refused with a message asking for one, never silently
   * suffixed into `app-2`: a storefront address is printed on receipts, and
   * the business should choose it, not discover it.
   */
  const slug = await availableSlug(body.slug || suggestSlug(body.name), { derived: !body.slug });

  const { nextBusinessCode } = await import('./accessService.js');

  const business = await Business.create({
    name: body.name,
    code: await nextBusinessCode(),
    slug,
    businessType: body.businessType ?? 'product',
    status: 'active',
    colorToken: body.colorToken ?? DEFAULT_BUSINESS_COLOR,
    tenant: tenant._id,
    plan: tenant.plan,
    slotGrantedAt: new Date(),
    // Never the default. Exactly one business is the default and it is the one
    // an unattributed record lands in - a new tenant's business must not
    // quietly become that for everybody.
    isDefault: false,
  });

  // The count behind the single-business shortcut, and every cached host miss,
  // are stale the moment a business exists that did not before.
  resetBusinessResolution();

  return { business: business.toPublic() };
}

/**
 * A slug that is well formed, not reserved and not already somebody's.
 *
 * `derived` changes only the wording: a slug the console made up from the name
 * should not be reported as though the operator typed it.
 */
async function availableSlug(slug, { derived = false, exceptId = null } = {}) {
  const problem = businessSlugProblem(slug);
  if (problem) {
    throw ApiError.badRequest(
      derived ? `This name does not make a usable web address. Choose one: ${problem}` : problem,
      'BUSINESS_SLUG_INVALID',
      { slug: problem },
    );
  }

  const clash = await Business.findOne({
    slug,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  })
    .select('name deletedAt')
    .lean();

  if (clash) {
    /**
     * A soft-deleted business still holds its address. Releasing it on delete
     * would let a new business take the address a customer still has
     * bookmarked for the old one - inside the window in which the old one can
     * be restored, and would then have nowhere to go.
     */
    const message = clash.deletedAt
      ? `"${slug}" belongs to a deleted business that can still be restored. Choose another.`
      : `"${slug}" is already the address of ${clash.name}.`;
    throw ApiError.conflict(message, 'BUSINESS_SLUG_TAKEN');
  }

  return slug;
}

/**
 * Approve the web address a tenant asked for - and with it, make it live.
 *
 * **Approval is the whole of the automation.** DNS and the certificate are a
 * wildcard over the platform's domain (see docs/SUBDOMAIN_SETUP.md),
 * so there is nothing to provision per business: the moment the slug is on the
 * record, `resolveBusiness` sends `<slug>.<platform>` to this business's
 * database, which is its catalogue. The host caches are cleared here so that
 * happens on the next request rather than after a restart.
 *
 * Re-checked at approval time, not trusted from the request: the address may
 * have been taken, or the reserved list grown, while it waited.
 */
async function approveAddressRequest(businessId) {
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');

  const request = business.addressRequest;
  if (!request || request.status !== 'pending') {
    throw ApiError.badRequest('There is no pending address request for this business.', 'NO_ADDRESS_REQUEST');
  }

  const slug = await availableSlug(request.slug, { exceptId: business._id });
  const previous = business.slug ?? null;

  await Business.updateOne({ _id: business._id }, { $set: { slug, addressRequest: null } });
  resetBusinessResolution();
  forgetBusinessConfig(business._id);

  const fresh = await Business.findById(business._id);
  return {
    business: fresh.toPublic(),
    previous,
    liveUrl: env.storefrontDomain ? env.originFor(`${slug}.${env.storefrontDomain}`) : null,
  };
}

/** Turn a request down, with the reason the tenant will read. */
async function rejectAddressRequest(businessId, { note }) {
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');
  if (!business.addressRequest || business.addressRequest.status !== 'pending') {
    throw ApiError.badRequest('There is no pending address request for this business.', 'NO_ADDRESS_REQUEST');
  }

  await Business.updateOne(
    { _id: business._id },
    {
      $set: {
        'addressRequest.status': 'rejected',
        'addressRequest.decidedAt': new Date(),
        'addressRequest.note': String(note ?? '').trim(),
      },
    },
  );
  const fresh = await Business.findById(business._id);
  return { business: fresh.toPublic() };
}

/**
 * Set where a business answers: its slug, and optionally a domain it owns.
 *
 * Super-admin only, deliberately. A web address is printed on receipts and
 * shared in links, and a custom domain additionally needs an origin entry on
 * the server to work at all - so changing either is an operation on the
 * platform, not a preference in the business's own settings.
 *
 * **Changing a slug breaks every link to the old one.** The console says so
 * before it sends this; nothing here redirects the old address.
 */
async function setBusinessAddress(businessId, body) {
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');

  const slug = await availableSlug(body.slug, { exceptId: business._id });

  const domain = normaliseDomain(body.domain) || null;
  const panelDomain = normaliseDomain(body.panelDomain) || null;

  if (domain && panelDomain && domain === panelDomain) {
    const message = 'One address cannot be the storefront and the panel.';
    throw ApiError.badRequest(message, 'BUSINESS_DOMAIN_INVALID', { panelDomain: message });
  }

  // Both fields are checked against BOTH fields of every other business: a
  // host is one business's storefront or one business's panel, never two.
  for (const [field, value] of [['domain', domain], ['panelDomain', panelDomain]]) {
    if (!value) continue;
    const problem = customDomainProblem(value, env.platformDomains);
    if (problem) throw ApiError.badRequest(problem, 'BUSINESS_DOMAIN_INVALID', { [field]: problem });

    const clash = await Business.findOne({
      _id: { $ne: business._id },
      $or: [{ domain: value }, { panelDomain: value }],
    })
      .select('name')
      .lean();
    if (clash) {
      throw ApiError.conflict(`${value} already points at ${clash.name}.`, 'BUSINESS_DOMAIN_TAKEN');
    }
  }

  const previous = {
    slug: business.slug ?? null,
    domain: business.domain ?? null,
    panelDomain: business.panelDomain ?? null,
  };

  // `updateOne`, not `save()`: the same reason `ensureDefaultBusiness` gives.
  // A stale field elsewhere on an old document must not refuse an edit that
  // does not touch it.
  await Business.updateOne({ _id: business._id }, { $set: { slug, domain, panelDomain } });

  // `resolveBusiness` caches host -> business, including misses. Without this
  // the old address keeps answering and the new one keeps failing until the
  // process restarts.
  resetBusinessResolution();
  forgetBusinessConfig(business._id);

  const fresh = await Business.findById(business._id);
  /**
   * No server step follows any more. CORS reads saved domains from the
   * database (`hostDirectory.isBusinessOrigin`) and the web server asks the
   * TLS gate before issuing a certificate, so a domain works as soon as the
   * business's DNS points here. What the console still has to say is the one
   * step only the business can take: the DNS record itself.
   */
  return {
    business: fresh.toPublic(),
    previous,
    dnsTarget: env.storefrontDomain ?? null,
  };
}

/** Assign an existing business to a tenant, or move it between tenants. */
async function assignBusiness(businessId, { tenant: tenantId }) {
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');

  if (!tenantId) {
    business.tenant = undefined;
    await business.save();
    return { business: business.toPublic() };
  }

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw ApiError.notFound('Tenant not found.', 'TENANT_NOT_FOUND');

  // Moving between tenants does not spend a slot on the way out, so the check
  // is only against the destination.
  const used = await Business.countDocuments({
    tenant: tenant._id,
    _id: { $ne: business._id },
  });
  if (used >= (tenant.slots ?? 0)) {
    throw ApiError.badRequest(
      `${tenant.name} has used all ${tenant.slots ?? 0} of its slots.`,
      'NO_SLOTS_LEFT',
    );
  }

  business.tenant = tenant._id;
  if (!business.plan && tenant.plan) business.plan = tenant.plan;
  await business.save();

  return { business: business.toPublic() };
}

// ---- business lifecycle -----------------------------------------------------

/**
 * How long a deleted business holds its slot and keeps its records.
 *
 * Thirty days. Long enough that "we deleted the wrong one" is recoverable, short
 * enough that a tenant is not paying for a slot they will never use again.
 */
const RETENTION_DAYS = 30;

/**
 * What counts against a tenant's slots.
 *
 * **A deleted business inside its retention window still counts.** That is the
 * whole point of the window: the slot does not come back the moment somebody
 * presses delete, or delete-and-recreate would be a way to run more businesses
 * than were paid for. Everything that spends a slot counts through this one
 * function so the arithmetic cannot disagree between the places that ask.
 */
function slotFilter(tenantId) {
  return {
    tenant: tenantId,
    $or: [{ deletedAt: null }, { purgeAfter: { $gt: new Date() } }],
  };
}

/**
 * Suspend, reactivate, or put a business into maintenance.
 *
 * Distinct from the tenant's subscription status, which is about the *account*.
 * This is about one shop - a tenant in good standing may still have a business
 * that has stopped trading.
 */
async function setBusinessStatus(businessId, { status }) {
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');

  if (business.deletedAt) {
    throw ApiError.badRequest(
      'That business is deleted. Restore it before changing its status.',
      'BUSINESS_DELETED',
    );
  }

  business.status = status;
  await business.save();
  return { business: business.toPublic() };
}

/**
 * Delete a business - soft, with a retention window.
 *
 * **The default business is refused**, for the reason `accessService` already
 * gives: it is where an unattributed record lands, so the field cannot go empty.
 */
async function deleteBusiness(businessId) {
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');

  if (business.isDefault) {
    throw ApiError.badRequest(
      'The default business cannot be deleted. Make another business the default first.',
      'BUSINESS_IS_DEFAULT',
    );
  }

  if (business.deletedAt) return { business: business.toPublic(), alreadyDeleted: true };

  business.deletedAt = new Date();
  business.purgeAfter = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  // Deleted implies not trading. Set explicitly rather than inferred, so a
  // restore has a status to come back to that is not a guess.
  business.status = 'inactive';
  await business.save();

  return { business: business.toPublic(), retentionDays: RETENTION_DAYS };
}

/**
 * Undo a deletion, while the window is still open.
 *
 * Refused once the window has closed rather than silently succeeding: past that
 * point the slot has gone back and the records are purgeable, so "restored"
 * would be a claim nothing can stand behind.
 */
async function restoreBusiness(businessId) {
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');
  if (!business.deletedAt) return { business: business.toPublic() };

  if (business.purgeAfter && business.purgeAfter.getTime() < Date.now()) {
    throw ApiError.badRequest(
      'That business is past its retention window and can no longer be restored.',
      'RETENTION_EXPIRED',
    );
  }

  // The tenant must still have room for it - the slot was held, but a slot
  // count can be lowered while a business sits deleted.
  if (business.tenant) {
    const tenant = await Tenant.findById(business.tenant).lean();
    const used = await Business.countDocuments({
      ...slotFilter(business.tenant),
      _id: { $ne: business._id },
    });
    if (tenant && used >= (tenant.slots ?? 0)) {
      throw ApiError.badRequest(
        `${tenant.name} has no free slot to restore this into. Grant another first.`,
        'NO_SLOTS_LEFT',
      );
    }
  }

  business.deletedAt = null;
  business.purgeAfter = null;
  await business.save();

  return { business: business.toPublic() };
}

// ---- owner provisioning -----------------------------------------------------

/**
 * Create the tenant's own administrator (SAAS_PLATFORM §4.5, §6 phase 16).
 *
 * **Creating a tenant used to leave no way in.** The console could set up an
 * account, grant it slots and configure its features, and then nobody could
 * sign in to the thing that had been built - an owner had to be inserted by
 * hand. This is that missing step.
 *
 * **No password is ever set here, and none is sent.** The operator supplies a
 * name and an address; the owner receives a reset link and chooses their own
 * secret. A console that minted passwords would mean every tenant's first
 * credential existed in an operator's sent mail, and "the platform team knows
 * how to get into your account" is not a thing a customer should have to take
 * on trust.
 *
 * **An owner is a `User` with `role: 'admin'`, scoped to one business.** Not a
 * new population: they are the tenant's administrator inside their own business
 * exactly as Cellvix's admin is inside Cellvix, which is what makes the whole
 * panel work for them without a second permission model.
 */
async function createOwner(tenantId, body, { origin } = {}) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw ApiError.notFound('Tenant not found.', 'TENANT_NOT_FOUND');

  const email = String(body.email ?? '').toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.badRequest('That email already has an account.', 'EMAIL_IN_USE');
  }

  /**
   * Which business the owner administers.
   *
   * The one named, or the tenant's only business when it has exactly one.
   * **Refused when the tenant has several and none was named** rather than
   * guessing: picking the first would scope somebody to a business nobody
   * chose, and under per-business databases that is the difference between an
   * owner who can see their records and one who cannot.
   */
  const owned = await Business.find({ tenant: tenant._id }).select('name').lean();
  if (!owned.length) {
    throw ApiError.badRequest(
      `${tenant.name} has no business yet. Add one before creating its owner.`,
      'TENANT_HAS_NO_BUSINESS',
    );
  }

  const businessId = body.business || (owned.length === 1 ? String(owned[0]._id) : null);
  if (!businessId) {
    throw ApiError.badRequest(
      `${tenant.name} runs ${owned.length} businesses - say which one this owner administers.`,
      'BUSINESS_REQUIRED',
    );
  }

  const business = owned.find((row) => String(row._id) === String(businessId));
  if (!business) {
    throw ApiError.badRequest(
      'That business does not belong to this tenant.',
      'BUSINESS_NOT_IN_TENANT',
    );
  }

  const user = new User({
    // The model requires it, and the tenant's name is the truthful answer:
    // this person administers that account's business.
    businessName: tenant.name,
    contactName: body.contactName,
    email,
    phone: body.phone,
    role: 'admin',
    /**
     * Scoped to the **tenant**, not to one of its businesses.
     *
     * An owner administers the account, so one login reaches every business the
     * account owns and the header switcher moves between them. Pinning them to
     * a single business - which this did - meant a tenant with two shops needed
     * two owner accounts and could not switch at all.
     */
    tenant: tenant._id,
    business: null,
    // An owner does not enter the buyer approval queue, exactly as staff do not.
    status: 'approved',
  });

  /**
   * A random password nobody is told, immediately superseded by the reset link.
   *
   * `passwordHash` is required, so the account needs *something* - and a known
   * placeholder would be a working credential on every tenant the platform ever
   * creates. Random bytes that are never printed mean the reset link is the
   * only way in, which is the intent.
   */
  await user.setPassword(crypto.randomBytes(32).toString('base64url'));

  const token = crypto.randomBytes(32).toString('base64url');
  user.resetTokenHash = hashResetToken(token);
  // Deliberately longer than a normal reset: this is an invitation that may sit
  // in an inbox over a weekend, not somebody who just clicked "forgot".
  user.resetTokenAt = new Date(Date.now() + INVITE_TTL_MS);
  await user.save();

  await Business.updateOne({ _id: businessId }, { $addToSet: { staff: user._id } });

  /**
   * Mail failure does not fail the account.
   *
   * The owner exists either way, and an operator who sees an error after the
   * user was created cannot tell whether to try again - which is how duplicate
   * accounts get made. The response says whether the invitation went out, so
   * the console can offer to resend rather than to re-create.
   */
  let invited = true;
  try {
    await sendPasswordResetEmail({
      user,
      token,
      origin: inviteOrigin(origin),
      expiresMinutes: Math.round(INVITE_TTL_MS / 60000),
    });
  } catch (error) {
    invited = false;
    console.error(`  Owner invite: could not email ${email} - ${error.message}`);
  }

  return {
    owner: {
      id: user._id.toString(),
      contactName: user.contactName,
      email: user.email,
      business: { id: businessId, name: business.name },
    },
    invited,
  };
}

/** Send a fresh invitation, for one that expired or never arrived. */
async function resendOwnerInvite(userId, { origin } = {}) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('No such account.', 'USER_NOT_FOUND');

  const token = crypto.randomBytes(32).toString('base64url');
  user.resetTokenHash = hashResetToken(token);
  user.resetTokenAt = new Date(Date.now() + INVITE_TTL_MS);
  await user.save();

  await sendPasswordResetEmail({
    user,
    token,
    origin: inviteOrigin(origin),
    expiresMinutes: Math.round(INVITE_TTL_MS / 60000),
  });

  return { ok: true };
}

// ---- features ---------------------------------------------------------------

/**
 * One business's feature grid: every key, where its answer came from, and
 * whether it can be changed at all.
 *
 * `source` is what makes the screen honest. A key that is on because the
 * business type says so reads differently from one somebody switched on, and a
 * grid that showed only the effective value would make an override
 * indistinguishable from a default.
 */
async function getBusinessFeatures(businessId) {
  const business = await Business.findById(businessId).lean();
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');

  const plan = business.plan ? await Plan.findById(business.plan).lean() : null;
  const planDefaults = plan?.featureDefaults ?? null;
  const overrides = business.featureOverrides ?? {};

  const effective = resolveFeatures({
    businessType: business.businessType,
    planDefaults,
    overrides,
  });

  const typeOnly = resolveFeatures({ businessType: business.businessType });

  return {
    business: {
      id: business._id.toString(),
      name: business.name,
      code: business.code,
      businessType: business.businessType,
      plan: plan ? { id: plan._id.toString(), name: plan.name } : null,
    },
    features: FEATURES.map((feature) => {
      const has = Object.prototype.hasOwnProperty.call(overrides, feature.key);
      const planHas = planDefaults
        ? Object.prototype.hasOwnProperty.call(planDefaults, feature.key)
        : false;

      return {
        key: feature.key,
        label: feature.label,
        description: feature.description,
        area: feature.area,
        locked: Boolean(feature.locked),
        enabled: effective[feature.key],
        // Where the answer came from, most specific first.
        source: feature.locked ? 'locked' : has ? 'override' : planHas ? 'plan' : 'type',
        typeDefault: typeOnly[feature.key],
      };
    }),
  };
}

/**
 * Switch one feature on or off for one business.
 *
 * **A locked key is refused rather than silently ignored.** `resolveFeatures`
 * would force it back on anyway (§3.2 rule 4), so accepting the write would
 * store a setting that does nothing - and a console that appears to accept a
 * change it did not make is worse than one that says no.
 *
 * Passing `null` clears the override and returns the key to its plan or type
 * default, which is a different act from switching it off and has to stay
 * expressible.
 */
async function setBusinessFeature(businessId, { key, enabled }) {
  const business = await Business.findById(businessId);
  if (!business) throw ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND');

  const feature = FEATURES.find((row) => row.key === key);
  if (!feature) throw ApiError.badRequest('No such feature.', 'FEATURE_UNKNOWN');

  if (feature.locked) {
    throw ApiError.badRequest(
      `${feature.label} runs for every business and cannot be switched off.`,
      'FEATURE_LOCKED',
    );
  }

  /**
   * A plain object, replaced wholesale rather than mutated.
   *
   * `featureOverrides` is `Mixed`, and Mongoose cannot see a mutation inside a
   * `Mixed` value - `overrides[key] = true` on the existing object would save
   * nothing and the console would appear to accept a change it never made.
   * Assigning a new object is what marks the path dirty; `markModified` below
   * says so explicitly rather than relying on that being remembered.
   */
  const next = { ...(business.featureOverrides ?? {}) };
  if (enabled === null) delete next[key];
  else next[key] = Boolean(enabled);

  business.featureOverrides = next;
  business.markModified('featureOverrides');

  await business.save();
  // The middleware chain caches this business's type and overrides; without
  // this the toggle would appear to do nothing for up to a minute, which reads
  // as a broken switch rather than as a stale cache.
  forgetBusinessConfig(businessId);
  return getBusinessFeatures(businessId);
}

// ---- plans ------------------------------------------------------------------

async function listPlans() {
  const plans = await Plan.find({}).sort({ priceCents: 1, name: 1 });
  return { plans: plans.map((plan) => plan.toPublic()) };
}

async function createPlan(body) {
  const slug = slugify(body.slug || body.name);
  if (!slug) throw ApiError.badRequest('Give the plan a name.', 'PLAN_NAME_REQUIRED');

  const clash = await Plan.findOne({ slug }).lean();
  if (clash) throw ApiError.badRequest(`A plan already uses "${slug}".`, 'PLAN_SLUG_TAKEN');

  const plan = await Plan.create({
    name: body.name,
    slug,
    description: body.description,
    priceCents: body.priceCents ?? 0,
    includedSlots: body.includedSlots ?? 1,
  });

  return { plan: plan.toPublic() };
}

/**
 * Edit a plan.
 *
 * **Changing a plan changes what its subscribers get**, immediately and without
 * a migration - `resolveFeatures` reads `featureDefaults` on every request. That
 * is the intended behaviour and the reason the console shows a subscriber count
 * before the save: raising a price is a billing conversation, but switching a
 * feature default off is something several tenants notice at once.
 */
async function updatePlan(id, body) {
  const plan = await Plan.findById(id);
  if (!plan) throw ApiError.notFound('Plan not found.', 'PLAN_NOT_FOUND');

  if (body.slug && slugify(body.slug) !== plan.slug) {
    const slug = slugify(body.slug);
    const clash = await Plan.findOne({ slug, _id: { $ne: plan._id } }).lean();
    if (clash) throw ApiError.badRequest(`A plan already uses "${slug}".`, 'PLAN_SLUG_TAKEN');
    plan.slug = slug;
  }

  for (const field of ['name', 'description']) {
    if (body[field] !== undefined) plan[field] = body[field];
  }
  if (body.priceCents !== undefined) plan.priceCents = body.priceCents;
  if (body.includedSlots !== undefined) plan.includedSlots = body.includedSlots;
  if (body.isActive !== undefined) plan.isActive = body.isActive;

  await plan.save();
  return { plan: plan.toPublic() };
}

/**
 * Set or clear one of a plan's feature defaults.
 *
 * `null` clears the key so it falls back to the business type's default - a
 * different act from switching it off, exactly as it is on a business override.
 *
 * A `locked` key is refused rather than ignored: `resolveFeatures` forces those
 * on whatever any layer says (§3.2 rule 4), so storing one would be a setting
 * that does nothing, and a console appearing to accept a change it did not make
 * is worse than one that says no.
 */
async function setPlanFeature(id, { key, enabled }) {
  const plan = await Plan.findById(id);
  if (!plan) throw ApiError.notFound('Plan not found.', 'PLAN_NOT_FOUND');

  const feature = FEATURES.find((row) => row.key === key);
  if (!feature) throw ApiError.badRequest('No such feature.', 'FEATURE_UNKNOWN');
  if (feature.locked) {
    throw ApiError.badRequest(
      `${feature.label} runs for every business and cannot be switched off.`,
      'FEATURE_LOCKED',
    );
  }

  // Replaced wholesale and marked modified, for the reason `featureOverrides`
  // is: Mongoose cannot see a mutation inside a `Mixed` value.
  const next = { ...(plan.featureDefaults ?? {}) };
  if (enabled === null) delete next[key];
  else next[key] = Boolean(enabled);

  plan.featureDefaults = next;
  plan.markModified('featureDefaults');
  await plan.save();

  return { plan: plan.toPublic() };
}

/** Plans with what each one costs the platform to honour - its subscriber count. */
async function listPlansWithUsage() {
  const plans = await Plan.find({}).sort({ priceCents: 1, name: 1 });
  const tenants = await Tenant.find({ plan: { $ne: null } }).select('plan').lean();

  const counts = new Map();
  for (const tenant of tenants) {
    const key = String(tenant.plan);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    plans: plans.map((plan) => ({
      ...plan.toPublic(),
      // Shown before an edit is saved: a feature default switched off is
      // something this many tenants notice at once.
      tenantCount: counts.get(plan._id.toString()) ?? 0,
    })),
    features: FEATURES.map((feature) => ({
      key: feature.key,
      label: feature.label,
      description: feature.description,
      area: feature.area,
      locked: Boolean(feature.locked),
    })),
  };
}

export {
  SUPERADMIN_COOKIE,
  assignBusiness,
  clearSuperAdminSession,
  createBusiness,
  RETENTION_DAYS,
  createOwner,
  createPlan,
  createTenant,
  getBusinessFeatures,
  deleteBusiness,
  listPlans,
  listPlansWithUsage,
  listTenants,
  login,
  logout,
  resendOwnerInvite,
  restoreBusiness,
  approveAddressRequest,
  rejectAddressRequest,
  setBusinessAddress,
  setBusinessStatus,
  setPlanFeature,
  updatePlan,
  setBusinessFeature,
  setSlots,
  updateTenant,
};
