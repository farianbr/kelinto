import mongoose from 'mongoose';

import { PERMISSION_AREAS, PERMISSION_LEVELS, SETTINGS_SUBAREAS } from '../models/Role.js';
/**
 * `Role` is a PER-BUSINESS collection, so it is read off the request's own
 * connection rather than imported - each business holds its own roles, and a
 * module-level import would bind them all to the default database.
 *
 * `Business` keeps its direct import on purpose: it is control-plane, and the
 * registry routes it to the control database whatever connection is ambient.
 *
 * **`User` does NOT, and used to.** It is a per-business collection - CLAUDE.md
 * says so and `CONTROL_MODELS` does not list it - so a module-level import bound
 * every staff read and write in this file to the default database. A staff
 * account created here was written somewhere `authService` never looks, so it
 * could not sign in at all; the staff list, the member counts and the lock
 * controls were reading the same wrong place. Fixed 2026-09-21: every `User`
 * access goes through `db()`, like `Role` one paragraph up and for the same
 * reason.
 */
import { db } from '../db/models.js';
import Business from '../models/Business.js';
import ApiError from '../utils/ApiError.js';
import { likeRegex } from '../utils/regex.js';
/**
 * Read straight from the shared palette rather than through `toPublic`: the
 * reads below are `.lean()`, so no document method runs on them and a business
 * written before the identity palette existed would reach the panel carrying a
 * token it cannot paint.
 */
import {
  BUSINESS_COLOR_TOKENS,
  DEFAULT_BUSINESS_COLOR,
  migrateColorToken,
} from '../../../shared/businessPalette.js';
import { forgetBusinessConfig } from '../middleware/businessConfigCache.js';
import { resetBusinessResolution } from '../middleware/resolveBusiness.js';
import { forgetAccount, recordAccount } from './loginDirectory.js';
import env from '../config/env.js';
import { businessSlugProblem } from '../../../shared/hosts.js';

/**
 * Businesses, roles and staff accounts (ERP rework §6.14, §6.15/3, §7.6 - phase 8).
 *
 * Three rules hold this file together:
 *
 *   1. **Power is never self-granted.** Only an admin reaches role editing and
 *      user creation, and no operation here can raise the caller's own access.
 *      A permission system whose subjects can edit it is decoration.
 *   2. **A role in use is never destroyed.** Deleting one would silently
 *      re-grant or revoke access for everyone holding it, so deletion is
 *      refused while a member remains - the same reasoning that makes a used
 *      `ExpenseCategory` deactivate rather than delete.
 *   3. **Exactly one default business exists, always.** It is where a stock
 *      movement lands when nothing names an business, so the field cannot be
 *      allowed to go empty or to hold two winners.
 */

const BUILT_IN_ROLES = [
  {
    name: 'Admin',
    slug: 'admin',
    isBuiltIn: true,
    isSystem: true,
    areas: PERMISSION_AREAS.reduce((out, area) => ({ ...out, [area]: 'full' }), {}),
  },
  {
    name: 'Account Manager',
    slug: 'account-manager',
    isBuiltIn: true,
    areas: {
      clients: 'full',
      sales: 'full',
      purchase: 'view',
      reports: 'full',
      marketing: 'full',
      business: 'view',
      settings: 'none',
    },
  },
  {
    name: 'Warehouse',
    slug: 'warehouse',
    isBuiltIn: true,
    areas: {
      clients: 'view',
      sales: 'view',
      purchase: 'full',
      reports: 'view',
      marketing: 'none',
      business: 'view',
      settings: 'none',
    },
  },
  {
    name: 'Front Desk',
    slug: 'front-desk',
    isBuiltIn: true,
    areas: {
      clients: 'full',
      sales: 'full',
      purchase: 'view',
      reports: 'none',
      marketing: 'none',
      business: 'view',
      settings: 'none',
    },
  },
];

// ---- setup ------------------------------------------------------------------

/**
 * Idempotent. Safe on a database with real accounts: built-ins are upserted by
 * slug and a staff member's edits to a non-system role are left alone, because
 * re-running setup must never quietly reset permissions somebody tuned.
 */
async function ensureBuiltInRoles() {
  const created = [];
  for (const role of BUILT_IN_ROLES) {
    const existing = await db().Role.findOne({ slug: role.slug });
    if (existing) {
      // The system role is the one exception: its map is not the staff member's to
      // drift, so it is held at full access on every boot.
      if (existing.isSystem) {
        existing.areas = role.areas;
        await existing.save();
      }
      continue;
    }
    created.push(await db().Role.create(role));
  }
  return created;
}

/**
 * One location today (§0.9), but the switcher and every `business` field need a
 * row to point at from day one.
 */
/**
 * Repair `colorToken` values that predate the identity palette.
 *
 * **A schema setter never runs on stored data.** `Business.colorToken` has had
 * `migrateColorToken` on it since the palette split, which covers every value
 * arriving through a form or a seed - and covers nothing already in the
 * database, because a setter fires on assignment and a document read back is
 * not an assignment. So every business written before that change kept a value
 * the enum no longer accepts, and stayed one `save()` away from refusing to
 * write for reasons unrelated to what was being written.
 *
 * Idempotent, targeted and additive: only documents holding a value outside the
 * current list are touched, so this costs one indexed count on a healthy
 * installation and never rewrites a business that is already correct.
 */
async function migrateBusinessColors() {
  const stale = await Business.find({ colorToken: { $nin: BUSINESS_COLOR_TOKENS } })
    .select('_id colorToken')
    .lean();

  for (const business of stale) {
    await Business.updateOne(
      { _id: business._id },
      { $set: { colorToken: migrateColorToken(business.colorToken) } },
    );
  }

  return stale.length;
}

async function ensureDefaultBusiness() {
  // Before anything else: a stale colour is what turns an ordinary write on
  // this collection into a validation failure, so it is repaired first rather
  // than worked around at each call site.
  await migrateBusinessColors();

  const existing = await Business.findOne({ isDefault: true, deletedAt: null });
  if (existing) return existing;

  const any = await Business.findOne({ deletedAt: null }).sort({ code: 1 });
  if (any) {
    /**
     * `updateOne`, not `save()` - **the whole platform once hung on this.**
     *
     * `save()` validates the entire document, so ONE stale field anywhere on it
     * refuses a write that touches a different field entirely. That is not
     * hypothetical: `colorToken` left the enum when the identity palette
     * replaced the status palette, every business stored before that kept the
     * old value, and promoting one to default threw
     * `colorToken: 'brand' is not a valid enum value`. `index.js` caught it,
     * logged "Access bootstrap skipped" and booted - so no business was the
     * default, `resolveBusiness` fell through its last step, `businessDb`
     * opened the control database, and the storefront served an empty
     * catalogue with a 200. Four safeguards degraded gracefully and together
     * hid a total outage.
     *
     * A targeted update writes the one field this function is responsible for
     * and leaves the rest of the document alone, which is the honest scope: a
     * bootstrap that establishes a default must not also be a referendum on
     * every other field's validity.
     *
     * The stale value is repaired rather than ignored - `migrateColorToken` is
     * the same mapping the schema setter applies, and a setter only fires on
     * assignment, never on a document loaded from the database. That is why the
     * migration existed and had still never run on stored data.
     */
    await Business.updateOne(
      { _id: any._id },
      { $set: { isDefault: true, colorToken: migrateColorToken(any.colorToken) } },
    );
    // Anything else claiming the flag loses it, so exactly one wins - the same
    // guarantee `setDefaultBusiness` gives.
    await Business.updateMany({ _id: { $ne: any._id } }, { $set: { isDefault: false } });
    // This runs at boot, before any request, so the caches are almost certainly
    // empty - but this function is also called from scripts and tests inside a
    // live process, and a promotion nobody told the resolver about is exactly
    // the silent staleness the rest of this file now guards against.
    resetBusinessResolution();
    return Business.findById(any._id);
  }

  return Business.create({
    name: 'Cellvix',
    code: await nextBusinessCode(),
    // The subdomain this business answers on (SAAS_PLATFORM §4.2). Tenant #1's
    // product business; the platform itself has no name yet (§0.1), so this
    // names the business rather than the installation.
    slug: 'cellvix',
    // Tenant #1's product business - the parts wholesaler. The type is what
    // decides which sections its panel renders (SAAS_PLATFORM §1.1), so it is
    // set explicitly here rather than left to the schema default.
    businessType: 'product',
    status: 'active',
    colorToken: DEFAULT_BUSINESS_COLOR,
    address: { city: 'Toronto', region: 'ON', country: 'Canada' },
    isDefault: true,
  });
}

// ---- businesses ----------------------------------------------------------------

/**
 * The zero-padded `#000001` form (§6.14). Assigned here rather than accepted
 * from the client: a code the form proposes is a code two staff can pick in
 * the same moment.
 */
async function nextBusinessCode() {
  const last = await Business.findOne().sort({ code: -1 }).select('code').lean();
  const current = Number(String(last?.code ?? '#000000').replace(/\D/g, '')) || 0;
  return `#${String(current + 1).padStart(6, '0')}`;
}

/**
 * The businesses one account may see.
 *
 * **Scoped to the caller's tenant**, which is the same boundary
 * `middleware/businessScope.js` enforces on `?business=`. The two have to
 * agree: a switcher offering a business that the scope gate then refuses with a
 * 404 is a control that produces an error, which reads as a broken panel rather
 * than as a permission.
 *
 * `tenant` is `null` for an account that predates the control plane, and
 * every business with no tenant is tenant #1's by the same history - so the
 * pairing is exact rather than permissive, and an existing single-tenant
 * installation lists exactly what it always did.
 */
async function listBusinesses({ search, status } = {}, { tenant = null } = {}) {
  /**
   * A deleted business is gone from the tenant's point of view.
   *
   * Soft deletion keeps the records and the slot (SAAS_PLATFORM §4.3.1), but
   * that is the platform's concern - the business's own staff should not find
   * it still sitting in their switcher, and a header that offers a business
   * nobody can trade in is worse than one that simply no longer lists it. The
   * super-admin console reads `Business` directly and still sees it, which is
   * where a restore is performed.
   */
  const filter = { deletedAt: null, tenant: tenant ? tenant : null };
  if (status && status !== 'all') filter.status = status;
  if (search) {
    const rx = likeRegex(search);
    filter.$or = [{ name: rx }, { code: rx }, { manager: rx }, { 'address.city': rx }];
  }

  const businesses = await Business.find(filter).sort({ isDefault: -1, name: 1 }).lean();

  /**
   * The summary strip.
   *
   * Counted across the tenant's businesses rather than the filtered set - a
   * total that moves when you type in the search box is not a total - but
   * within the tenant, because a count including businesses the account cannot
   * open does not describe anything it can act on.
   *
   * `deletedAt: null` matches the list for the same reason the list carries
   * it: a soft-deleted business is gone from the tenant's point of view, so
   * counting it would make the strip disagree with the rows beneath it.
   */
  const all = await Business.find({ deletedAt: null, tenant: tenant ? tenant : null })
    .select('status')
    .lean();
  const summary = {
    total: all.length,
    active: all.filter((o) => o.status === 'active').length,
    inactive: all.filter((o) => o.status === 'inactive').length,
    maintenance: all.filter((o) => o.status === 'maintenance').length,
  };

  const staffCounts = await db().User.aggregate([
    { $match: { role: 'staff', business: { $ne: null } } },
    { $group: { _id: '$business', count: { $sum: 1 } } },
  ]);
  const byBusiness = new Map(staffCounts.map((row) => [String(row._id), row.count]));

  return {
    businesses: businesses.map((o) => ({
      ...o,
      id: String(o._id),
      colorToken: migrateColorToken(o.colorToken),
      staffCount: byBusiness.get(String(o._id)) ?? 0,
    })),
    summary,
  };
}

/**
 * One business, if the caller's tenant owns it.
 *
 * **The same 404 for "no such business" and "not yours."** Distinguishing them
 * would confirm that another tenant's business exists, which is the oracle
 * `businessScope` refuses to be for exactly the same reason.
 */
async function getBusiness(id, { tenant = null } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Business not found.');
  const business = await Business.findById(id).lean();
  if (!business) throw ApiError.notFound('Business not found.');

  const owner = business.tenant ? String(business.tenant) : null;
  if (owner !== (tenant ? String(tenant) : null)) throw ApiError.notFound('Business not found.');

  const staff = await db().User.find({ business: id, role: 'staff' })
    .select('contactName email staffRole lockedAt')
    .populate('staffRole', 'name slug')
    .lean();

  return {
    ...business,
    id: String(business._id),
    colorToken: migrateColorToken(business.colorToken),
    staff,
    // What a slug becomes, for showing `cellshoppe.kelinto.com` rather than a
    // bare label. Null when the server has no wildcard domain configured.
    storefrontDomain: env.storefrontDomain,
  };
}

/**
 * Ask for a web address. The platform approves it (`superAdminService`).
 *
 * **A request, never the address itself.** Where a business answers is printed
 * on receipts and decides which catalogue a stranger's browser opens, so it is
 * the platform's to grant - the tenant proposes, a super admin decides.
 *
 * Refused up front for everything the approval would refuse anyway: a reserved
 * or malformed label, one that is already some business's live address, and
 * one another business is already waiting on. First to ask is first in line;
 * a second business asking for the same word would only ever be rejected.
 */
async function requestAddress(id, { slug }, { tenant = null, actor = '' } = {}) {
  const business = await ownedBusiness(id, tenant);
  const wanted = String(slug ?? '').trim().toLowerCase();

  const problem = businessSlugProblem(wanted);
  if (problem) throw ApiError.badRequest(problem, 'BUSINESS_SLUG_INVALID', { slug: problem });

  if (business.slug === wanted) {
    throw ApiError.badRequest(`${wanted} is already this business's address.`, 'BUSINESS_SLUG_CURRENT');
  }

  const clash = await Business.findOne({
    _id: { $ne: business._id },
    $or: [{ slug: wanted }, { 'addressRequest.slug': wanted, 'addressRequest.status': 'pending' }],
  })
    .select('_id')
    .lean();
  if (clash) {
    // Deliberately not naming the other business: it may belong to another
    // tenant, and this is a tenant's screen.
    throw ApiError.conflict(`"${wanted}" is taken. Choose another.`, 'BUSINESS_SLUG_TAKEN');
  }

  await Business.updateOne(
    { _id: business._id },
    {
      $set: {
        addressRequest: {
          slug: wanted,
          status: 'pending',
          requestedAt: new Date(),
          requestedBy: actor,
          decidedAt: null,
          note: '',
        },
      },
    },
  );
  return getBusiness(business._id, { tenant });
}

/** Withdraw a request, pending or rejected. The live address is untouched. */
async function cancelAddressRequest(id, { tenant = null } = {}) {
  const business = await ownedBusiness(id, tenant);
  await Business.updateOne({ _id: business._id }, { $set: { addressRequest: null } });
  return getBusiness(business._id, { tenant });
}

/** The business, if the caller's tenant owns it; the same 404 as `getBusiness` otherwise. */
async function ownedBusiness(id, tenant) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Business not found.');
  const business = await Business.findById(id).select('slug tenant deletedAt').lean();
  const owner = business?.tenant ? String(business.tenant) : null;
  if (!business || business.deletedAt || owner !== (tenant ? String(tenant) : null)) {
    throw ApiError.notFound('Business not found.');
  }
  return business;
}

async function createBusiness(payload) {
  const business = await Business.create({
    ...payload,
    code: await nextBusinessCode(),
    // The first business ever created is the default by necessity - there is
    // nothing else for an unattributed movement to point at.
    isDefault: (await Business.countDocuments()) === 0,
  });
  // The resolver caches how many businesses exist - that count decides the
  // single-business shortcut, so adding the second one has to drop it or every
  // request keeps resolving the first by a rule that no longer applies.
  resetBusinessResolution();
  return business.toPublic();
}

async function updateBusiness(id, payload) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Business not found.');
  const business = await Business.findById(id);
  if (!business) throw ApiError.notFound('Business not found.');

  // `code` and `isDefault` are not the form's to set: one is server-assigned,
  // the other has its own endpoint so the "exactly one" rule stays in one place.
  const { code, isDefault, ...editable } = payload;
  Object.assign(business, editable);
  await business.save();
  // `businessType` and the tenant link are cached by the middleware chain, and
  // both are editable here - so the edit has to drop the entry or the panel
  // keeps rendering the old business type for up to a minute.
  forgetBusinessConfig(id);
  return business.toPublic();
}

/** Moves the default flag, keeping exactly one winner. */
async function setDefaultBusiness(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Business not found.');
  const business = await Business.findById(id);
  if (!business) throw ApiError.notFound('Business not found.');
  if (business.status !== 'active') {
    throw ApiError.badRequest('Only an active business can be the default.', 'BUSINESS_NOT_ACTIVE');
  }

  await Business.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } });
  business.isDefault = true;
  await business.save();
  /**
   * **The resolver caches which business is the default**, because it answers
   * that question on every request whose host names no business. Without this
   * call the console would move the flag in the database and every request would
   * keep resolving the old business until the process restarted - a setting that
   * appears to save and changes nothing.
   */
  resetBusinessResolution();
  return business.toPublic();
}

/**
 * Refused while the business is the default or still has staff - the same
 * reasoning as a role in use. Reassign, then delete.
 */
async function deleteBusiness(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Business not found.');
  const business = await Business.findById(id);
  if (!business) throw ApiError.notFound('Business not found.');

  if (business.isDefault) {
    throw ApiError.badRequest(
      'The default business cannot be deleted. Make another business the default first.',
      'BUSINESS_IS_DEFAULT',
    );
  }

  const staffCount = await db().User.countDocuments({ business: id });
  if (staffCount > 0) {
    throw ApiError.badRequest(
      `${staffCount} staff ${staffCount === 1 ? 'member is' : 'members are'} assigned to this business. Reassign them first.`,
      'BUSINESS_HAS_STAFF',
    );
  }

  await business.deleteOne();
  // Same reasoning as creating one: the count and any cached host mapping for
  // this business are now wrong.
  resetBusinessResolution();
  forgetBusinessConfig(id);
  return { deleted: true };
}

// ---- roles ------------------------------------------------------------------

async function listRoles() {
  const roles = await db().Role.find().sort({ isSystem: -1, isBuiltIn: -1, name: 1 });

  const counts = await db().User.aggregate([
    { $match: { role: 'staff', staffRole: { $ne: null } } },
    { $group: { _id: '$staffRole', count: { $sum: 1 } } },
  ]);
  const byRole = new Map(counts.map((row) => [String(row._id), row.count]));

  // Admins hold no Role row - they bypass the system - so the system role's
  // member count is the admin headcount, which is what the screen means by it.
  const adminCount = await db().User.countDocuments({ role: 'admin' });

  return roles.map((role) => ({
    ...role.toPublic(),
    memberCount: role.isSystem ? adminCount : (byRole.get(String(role._id)) ?? 0),
  }));
}

/**
 * A flat `areas` payload, split into the two shapes the model stores.
 *
 * The client sends one map keyed by area - `settings`, `settings.financial` -
 * because that is the address the whole permission system uses. The model keeps
 * the seven top-level areas in `areas` and the settings categories in
 * `settingsAreas`, for the Mongoose path reason documented there. This is the
 * one place that knows about the split on the way in; `toPublic` is the one
 * place that knows about it on the way out.
 */
function normaliseAreas(input = {}) {
  const areas = {};
  for (const area of PERMISSION_AREAS) {
    const level = input[area];
    // An unrecognised level closes the area rather than opening it. A typo in a
    // payload must never be the reason somebody gains access.
    areas[area] = PERMISSION_LEVELS.includes(level) ? level : 'none';
  }

  const settingsAreas = {};
  for (const area of SETTINGS_SUBAREAS) {
    const level = input[`settings.${area}`];
    /**
     * Unrecognised falls back to `inherit`, not `none`.
     *
     * The top-level default above is `none` because an unnamed area is one
     * nobody granted. A sub-area is different: unnamed means *not pinned*, and
     * the safe reading of that is "whatever Settings says" - which is how every
     * role written before these existed has to keep behaving. Defaulting to
     * `none` here would silently revoke settings access from every one of them
     * the first time somebody saved a role.
     */
    settingsAreas[area] = ['inherit', ...PERMISSION_LEVELS].includes(level) ? level : 'inherit';
  }

  return { areas, settingsAreas };
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function createRole({ name, areas }) {
  const slug = slugify(name);
  if (!slug) throw ApiError.badRequest('Enter a role name.');

  const clash = await db().Role.findOne({ slug });
  if (clash) throw ApiError.badRequest('A role with that name already exists.', 'ROLE_EXISTS');

  const normalised = normaliseAreas(areas);
  const role = await db().Role.create({
    name: name.trim(),
    slug,
    areas: normalised.areas,
    settingsAreas: normalised.settingsAreas,
  });
  return role.toPublic();
}

async function updateRole(id, { name, areas }) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Role not found.');
  const role = await db().Role.findById(id);
  if (!role) throw ApiError.notFound('Role not found.');

  // The Admin role always wins and is never editable (§7.6). Enforced here and
  // not only in the UI, because "not editable" that only hides a button is a
  // suggestion.
  if (role.isSystem) {
    throw ApiError.badRequest('The Admin role cannot be edited.', 'ROLE_IS_SYSTEM');
  }

  if (name && name.trim() !== role.name) {
    const slug = slugify(name);
    const clash = await db().Role.findOne({ slug, _id: { $ne: id } });
    if (clash) throw ApiError.badRequest('A role with that name already exists.', 'ROLE_EXISTS');
    role.name = name.trim();
    role.slug = slug;
  }

  if (areas) {
    const normalised = normaliseAreas(areas);
    role.areas = normalised.areas;
    role.settingsAreas = normalised.settingsAreas;
  }

  await role.save();
  return role.toPublic();
}

async function deleteRole(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Role not found.');
  const role = await db().Role.findById(id);
  if (!role) throw ApiError.notFound('Role not found.');

  if (role.isSystem) {
    throw ApiError.badRequest('The Admin role cannot be deleted.', 'ROLE_IS_SYSTEM');
  }
  if (role.isBuiltIn) {
    throw ApiError.badRequest(
      'Built-in roles cannot be deleted. Edit its access instead.',
      'ROLE_IS_BUILT_IN',
    );
  }

  const members = await db().User.countDocuments({ staffRole: id });
  if (members > 0) {
    throw ApiError.badRequest(
      `${members} staff ${members === 1 ? 'member holds' : 'members hold'} this role. Reassign them first.`,
      'ROLE_IN_USE',
    );
  }

  await role.deleteOne();
  return { deleted: true };
}

// ---- staff users ------------------------------------------------------------

function staffRow(user) {
  return {
    id: String(user._id),
    name: user.contactName || user.businessName,
    email: user.email,
    phone: user.phone,
    accountType: user.role,
    role: user.staffRole ? { id: String(user.staffRole._id), name: user.staffRole.name } : null,
    business: user.business ? { id: String(user.business._id), name: user.business.name } : null,
    locked: Boolean(user.lockedAt),
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

/**
 * The Users screen (§6.15/3). Cellvix people only - buyers have their own
 * screen under Clients, and mixing the two populations in one table is how a
 * staff member ends up granting a customer a staff role.
 */
async function listStaff({ search, role, status } = {}) {
  const filter = { role: { $in: ['admin', 'staff'] } };

  if (role && role !== 'all') {
    if (role === 'admin') filter.role = 'admin';
    else if (mongoose.isValidObjectId(role)) filter.staffRole = role;
  }
  if (status === 'locked') filter.lockedAt = { $ne: null };
  if (status === 'active') filter.lockedAt = null;

  if (search) {
    const rx = likeRegex(search);
    filter.$or = [{ contactName: rx }, { businessName: rx }, { email: rx }];
  }

  const users = await db().User.find(filter)
    .select('contactName businessName email phone role staffRole business lockedAt lastLoginAt createdAt')
    .populate('staffRole', 'name slug')
    .populate('business', 'name code')
    .sort({ createdAt: -1 })
    .lean();

  const all = await db().User.find({ role: { $in: ['admin', 'staff'] } })
    .select('role lockedAt')
    .lean();

  return {
    users: users.map(staffRow),
    summary: {
      total: all.length,
      active: all.filter((u) => !u.lockedAt).length,
      inactive: all.filter((u) => u.lockedAt).length,
      admins: all.filter((u) => u.role === 'admin').length,
      staff: all.filter((u) => u.role === 'staff').length,
      locked: all.filter((u) => u.lockedAt).length,
    },
  };
}

async function assertRoleAndBusiness({ accountType, staffRole, business }) {
  if (accountType === 'staff') {
    if (!staffRole || !mongoose.isValidObjectId(staffRole)) {
      throw ApiError.badRequest('Choose a role for this staff member.', 'STAFF_ROLE_REQUIRED');
    }
    const role = await db().Role.findById(staffRole);
    if (!role) throw ApiError.notFound('Role not found.');
    if (role.isSystem) {
      // Handing out the system role would be a second admin by the back door,
      // bypassing the deliberate `accountType: 'admin'` decision.
      throw ApiError.badRequest(
        'The Admin role cannot be assigned. Create an administrator account instead.',
        'ROLE_IS_SYSTEM',
      );
    }
  }

  if (business) {
    if (!mongoose.isValidObjectId(business)) throw ApiError.notFound('Business not found.');
    const found = await Business.findById(business);
    if (!found) throw ApiError.notFound('Business not found.');
  }
}

async function createStaff(payload) {
  const { name, email, password, phone, accountType = 'staff', staffRole, business } = payload;

  const existing = await db().User.findOne({ email: String(email).toLowerCase() });
  if (existing) throw ApiError.badRequest('That email already has an account.', 'EMAIL_IN_USE');

  await assertRoleAndBusiness({ accountType, staffRole, business });

  const user = new (db().User)({
    // A staff account is a person, not a business, but `businessName` is
    // required on the model - Cellvix is the business they belong to.
    businessName: 'Cellvix',
    contactName: name,
    email,
    phone,
    role: accountType,
    staffRole: accountType === 'staff' ? staffRole : null,
    business: business ?? null,
    // Staff bypass the buyer approval ladder entirely; `approved` here only
    // means "not sitting in the pending queue", which staff never enter.
    status: 'approved',
  });
  await user.setPassword(password);
  await user.save();

  if (business) await Business.updateOne({ _id: business }, { $addToSet: { staff: user._id } });

  // So the shared admin login can find them - see `services/loginDirectory.js`.
  await recordAccount(user);

  return staffRow(
    await db().User.findById(user._id)
      .populate('staffRole', 'name slug')
      .populate('business', 'name code')
      .lean(),
  );
}

async function updateStaff(id, payload, actorId) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('User not found.');
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('User not found.');
  if (user.role === 'buyer') {
    throw ApiError.badRequest('That is a customer account, not a staff account.', 'NOT_STAFF');
  }

  const { name, phone, accountType, staffRole, business, locked } = payload;

  // Nobody demotes or locks themselves. Both are how a staff member removes their
  // own last admin account and locks everyone out of the panel.
  if (String(id) === String(actorId)) {
    if (accountType && accountType !== user.role) {
      throw ApiError.badRequest('You cannot change your own account type.', 'SELF_DEMOTION');
    }
    if (locked === true) {
      throw ApiError.badRequest('You cannot lock your own account.', 'SELF_LOCK');
    }
  }

  const nextType = accountType ?? user.role;

  // The last admin is load-bearing: demoting or locking it would leave a panel
  // nobody can administer and a role system nobody can edit.
  const losingAdmin =
    user.role === 'admin' && (nextType !== 'admin' || locked === true);
  if (losingAdmin) {
    const admins = await db().User.countDocuments({ role: 'admin', lockedAt: null });
    if (admins <= 1) {
      throw ApiError.badRequest(
        'This is the last active administrator. Promote another account first.',
        'LAST_ADMIN',
      );
    }
  }

  await assertRoleAndBusiness({ accountType: nextType, staffRole, business });

  const previousBusiness = user.business ? String(user.business) : null;

  if (name !== undefined) user.contactName = name;
  if (phone !== undefined) user.phone = phone;
  if (accountType !== undefined) user.role = accountType;
  if (staffRole !== undefined) user.staffRole = nextType === 'staff' ? staffRole : null;
  if (business !== undefined) user.business = business || null;
  if (locked !== undefined) user.lockedAt = locked ? new Date() : null;

  await user.save();

  // The account type may have changed, which decides whether it signs in to the
  // panel at all. Locking does not remove the entry: a locked account is still
  // found, and refused at the door with the message that says why.
  await recordAccount(user);

  // Keep `Business.staff` - the reverse index the business card reads - honest.
  const nextBusiness = user.business ? String(user.business) : null;
  if (previousBusiness !== nextBusiness) {
    if (previousBusiness) {
      await Business.updateOne({ _id: previousBusiness }, { $pull: { staff: user._id } });
    }
    if (nextBusiness) {
      await Business.updateOne({ _id: nextBusiness }, { $addToSet: { staff: user._id } });
    }
  }

  return staffRow(
    await db().User.findById(id)
      .populate('staffRole', 'name slug')
      .populate('business', 'name code')
      .lean(),
  );
}

async function deleteStaff(id, actorId) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('User not found.');
  if (String(id) === String(actorId)) {
    throw ApiError.badRequest('You cannot delete your own account.', 'SELF_DELETE');
  }

  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('User not found.');
  if (user.role === 'buyer') {
    throw ApiError.badRequest('That is a customer account, not a staff account.', 'NOT_STAFF');
  }

  if (user.role === 'admin') {
    const admins = await db().User.countDocuments({ role: 'admin', lockedAt: null });
    if (admins <= 1) {
      throw ApiError.badRequest(
        'This is the last active administrator. Promote another account first.',
        'LAST_ADMIN',
      );
    }
  }

  if (user.business) await Business.updateOne({ _id: user.business }, { $pull: { staff: user._id } });
  await user.deleteOne();
  await forgetAccount(user);
  return { deleted: true };
}

// ---- audit snapshots (phase 11b) --------------------------------------------

/**
 * The state of a role before it is changed, for the audit trail (§7.5).
 *
 * Read here rather than in the controller so the audit hook does not have to
 * import `Role` and reimplement `toPublic()` - the shape a log row records and
 * the shape the API returns must not be allowed to drift apart.
 *
 * Returns null for a missing or malformed id: this runs *before* the mutation
 * that would reject it, and it must not throw its own error ahead of the real
 * one the caller is about to produce.
 */
async function getRoleSnapshot(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const role = await db().Role.findById(id);
  return role ? role.toPublic() : null;
}

/** The same, for a staff account. Uses `staffRow` so it matches what the API returns. */
async function getStaffSnapshot(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const user = await db().User.findById(id)
    .populate('staffRole', 'name slug')
    .populate('business', 'name code')
    .lean();
  if (!user) return null;

  const row = staffRow(user);
  return {
    email: row.email,
    accountType: row.accountType,
    role: row.role?.name ?? null,
    business: row.business?.name ?? null,
    locked: row.locked,
  };
}

export default {
  ensureBuiltInRoles,
  ensureDefaultBusiness,
  getRoleSnapshot,
  getStaffSnapshot,
  nextBusinessCode,
  listBusinesses,
  requestAddress,
  cancelAddressRequest,
  getBusiness,
  createBusiness,
  updateBusiness,
  setDefaultBusiness,
  deleteBusiness,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff,
};

export { ensureBuiltInRoles, ensureDefaultBusiness, nextBusinessCode, listBusinesses, getBusiness, requestAddress, cancelAddressRequest, createBusiness, updateBusiness, setDefaultBusiness, deleteBusiness, listRoles, createRole, updateRole, deleteRole, listStaff, createStaff, updateStaff, deleteStaff, getRoleSnapshot, getStaffSnapshot };
