import mongoose from 'mongoose';
import Business from '../models/Business.js';
import ApiError from '../utils/ApiError.js';
import { dbFor } from '../db/connections.js';
import { currentBusinessId, runInBusiness } from '../db/context.js';
import { businessConfig } from './businessConfigCache.js';

/**
 * Which business this request is about.
 *
 * **This was `outletScope`.** Same two rules, one much larger consequence: an
 * outlet filter that was forgotten showed one shop's rows under another shop of
 * the same business. A business filter that is forgotten shows **another
 * business's records entirely** - its customers, its invoices, its margins.
 *
 * §4.1 specified database-per-business precisely so that could not happen, and
 * that ruling was reversed on 2026-09-11 in favour of shipping. So the
 * guarantee is no longer structural, and this file is where it now lives:
 *
 *   **Every query that reads records for a screen must spread
 *   `businessFilter(req)`.** Not most of them. A `Model.find({ status })`
 *   without it is a leak, and it will not announce itself - the rows simply
 *   look like more data than expected.
 *
 * Two inputs, and the order matters because one is a permission and the other
 * is only a view:
 *
 *   1. **A staff account's own business is binding.** `User.business` scopes
 *      what a staff member may see, so it wins outright. A staff member cannot
 *      widen their view by sending a different `?business=`, which is the whole
 *      point of scoping them.
 *
 *   2. **An admin's `?business=` is a filter they chose**, within their own
 *      tenant. Absent or `all` means no filter inside the open business.
 *
 * The result lands on `req.businessScope` as an id or null. `null` means "do
 * not filter" and is deliberately the same value as "no business chosen" - a
 * query builder can then spread the filter unconditionally.
 *
 * **It rejects only a tenant admin reaching outside their tenant.** A staff
 * member carrying a stale query string from a bookmark is not attacking
 * anything, and the right answer is to show them their own business rather
 * than an error page. See `scopeRequest` for the one account type that can
 * reach across databases, and what happens when it does.
 */

/**
 * Does this business belong to the account's tenant?
 *
 * **The entitlement is the tenant**, which `User.tenant` already states: a
 * tenant admin "reaches every business that tenant owns", and nothing beyond.
 *
 * An admin with no `tenant` predates the control plane, and every business
 * with no `tenant` is tenant #1's by the same history - so the two pair up
 * exactly. Reading "no tenant" as "every tenant" would make the check opt-in,
 * and a security check nobody has opted into is decoration.
 */
async function tenantOwns(user, businessId) {
  /**
   * Rejected before the cache, not by it: `businessConfig` caches its misses,
   * so a malformed id would otherwise take a permanent entry in a `Map` that is
   * only cleared by an edit to a real business.
   */
  if (!mongoose.isValidObjectId(businessId)) return false;

  // The cached read `tenantStatus` and `feature` already make, because this
  // runs on every panel request and a business's owner changes about never.
  const business = await businessConfig(businessId);

  // Missing and deleted answer the same, so a probe cannot tell a wrong id
  // from another tenant's id.
  if (!business || business.deletedAt) return false;

  const userTenant = user?.tenant ? String(user.tenant) : null;
  return userTenant === business.tenantId;
}

/** The business a tenant admin lands in when nothing chose one: theirs, never another's. */
async function homeBusinessFor(user) {
  const tenant = user?.tenant ?? null;
  return Business.findOne({ tenant, deletedAt: null })
    .sort({ isDefault: -1, name: 1 })
    .select('_id code')
    .lean();
}

/**
 * Which steps of `resolveBusiness` were somebody actually naming a business.
 *
 * `single` and `default` are fallbacks - the request named nothing and was
 * given an answer. The rest are statements: a host somebody typed, a switcher
 * somebody used, a header a tool set, a session signed into one database.
 */
const FALLBACK_SOURCES = new Set(['single', 'default']);

/**
 * ## Who needs checking, and why only them
 *
 * `resolveBusiness` has already opened a database by the time this runs, and
 * it did so before anybody was authenticated - from a header, a token, a query
 * string or a host, none of them checked. That is safe for every account that
 * lives INSIDE a business database: staff, buyers and the older
 * business-database admins exist in exactly one, and in any other they are
 * simply not signed in. Naming another business cannot widen what they see.
 *
 * **A tenant admin is the exception.** They live in the control plane, so
 * `authenticate` finds them in whatever database is open. On the shared admin
 * host that means one edited query string or header away from another tenant's
 * customers, invoices and margins. So for them - and only them - the business
 * that was opened is checked against their tenant:
 *
 * - **Named explicitly** and not theirs: refused, **404 not 403**, the same as
 *   `requireFeature`. A 403 on a real id beside a 404 on a made-up one is an
 *   oracle that maps the installation one request at a time.
 * - **Reached by fallback** and not theirs: moved to one of their own. That is
 *   an admin opening the panel before choosing anything, on a host whose
 *   default belongs to somebody else - not an attack, and an error page there
 *   would be every first page load of every tenant but one.
 *
 * Checked against the OPEN database, not the filter. The filter only narrows
 * rows; the connection decides whose rows exist at all.
 */
async function scopeRequest(req, next) {
  const user = req.user;

  /**
   * A support session is pinned to the business its grant names.
   *
   * **A containment boundary, not a convenience.** A platform operator who
   * could edit `?business=` would reach every business on the installation
   * from a grant issued for one, and the audit trail would record the actions
   * in the business they entered, not the one they touched. `impersonationAuth`
   * sets the pin; honouring it here is the half that makes it stick.
   */
  if (req.businessScopePinned) return next();

  if (req.accountInControlPlane) {
    const opened = currentBusinessId();

    if (opened && !(await tenantOwns(user, opened))) {
      if (!FALLBACK_SOURCES.has(req.businessScopeSource)) {
        return next(ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND'));
      }

      const home = await homeBusinessFor(user);
      if (!home) {
        // A tenant with no live business has nowhere to be, and the default
        // is somebody else's. Nothing is the honest answer.
        return next(ApiError.notFound('Business not found.', 'BUSINESS_NOT_FOUND'));
      }

      // Re-open the request inside their own business. Everything after this -
      // features, tenant status, the route - runs against it.
      req.businessScope = String(home._id);
      return runInBusiness(
        { businessId: String(home._id), code: home.code, connection: dbFor(home.code) },
        () => applyQuery(req, next),
      );
    }
  }

  // Staff are pinned to their own business, whatever the query says.
  if (user?.role === 'staff' && user.business) {
    req.businessScope = String(user.business);
    return next();
  }

  return applyQuery(req, next);
}

/**
 * The filter half: what `?business=` asks to narrow to.
 *
 * By here the database is settled and, for a tenant admin, checked. `all`
 * clears the filter because that is a deliberate request for the unscoped view;
 * absent keeps what `resolveBusiness` decided, which on the storefront is the
 * host's business on every request that carries no query string at all.
 */
function applyQuery(req, next) {
  // A business's own panel domain is that business, whatever the switcher in a
  // stale tab still has selected (`resolveBusiness` step 1b).
  if (req.hostPinned) return next();

  const requested = String(req.query.business ?? '').trim();

  if (requested === 'all') req.businessScope = null;
  else if (requested) req.businessScope = requested;
  else req.businessScope = req.businessScope ?? null;

  return next();
}

/**
 * The mounted middleware.
 *
 * **A thin synchronous shell around an async body, and it has to be.** Express
 * 4 does not await a middleware's return value, so a promise that rejects
 * inside one is an unhandled rejection rather than a 500 - the request hangs
 * until it times out and the error never reaches `errorHandler`. Catching here
 * and passing to `next` is what turns a refusal into the 404 it is meant to be.
 *
 * Express 5 handles this itself. This file does not assume it.
 */
function resolveBusinessScope(req, _res, next) {
  scopeRequest(req, next).catch(next);
}

/**
 * The Mongo filter for the current scope, as an object to spread into a query.
 *
 * Returns `{}` when nothing is scoped, so callers can write
 * `{ ...businessFilter(req), status: 'open' }` without branching.
 *
 * **An exact match, deliberately.** The tempting alternative is to also match
 * `business: null` so that anything unassigned stays visible - but that leaks:
 * every unassigned record would appear under *every* business, so switching to
 * one would show another's history and the figures would not add up.
 * `backfill:business` is what makes exactness safe; it stamps the pre-scoping
 * rows onto the default business, and it is idempotent so it can be re-run if
 * an old code path ever writes another null.
 */
function businessFilter(req) {
  const scope = req?.businessScope;
  if (!scope) return {};
  return { business: scope };
}

export { resolveBusinessScope, businessFilter };
export default resolveBusinessScope;
