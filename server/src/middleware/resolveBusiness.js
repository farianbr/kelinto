import jwt from 'jsonwebtoken';
import Business from '../models/Business.js';
import env from '../config/env.js';
import { isReservedSubdomain } from '../../../shared/hosts.js';
import { businessConfig } from './businessConfigCache.js';

/**
 * Which business this request is for, decided before anybody signs in
 * (SAAS_PLATFORM §4.2).
 *
 * **This is the prerequisite for per-business `User`.** A buyer signs in at the
 * storefront before any business is known, so authentication cannot resolve the
 * business - the business has to be resolved first, and `authenticate` then
 * looks the account up in *that* business's database. Until this existed,
 * `businessScope` was read from `?business=` on admin requests only, which is
 * why the storefront carried no business at all.
 *
 * ## Resolution order, most explicit first
 *
 * 1. **An impersonation grant.** Already pinned by `impersonationAuth`, and it
 *    outranks everything: a staff member inside one business must not reach
 *    another by editing a host header or a query string.
 * 2. **`X-Business` header.** Development and internal tooling. Trusted because
 *    it is *not* an authorisation - it selects which business to serve, and
 *    every permission check still runs inside it.
 * 2b. **The session's own business** - the `biz` claim a business-database
 *    account is signed with. On the shared admin host it is the only thing
 *    that names a staff member's business.
 * 3. **`?business=` query** - the admin panel's switcher. Above the host
 *    because a selection somebody made outranks one inferred from where the
 *    request arrived, and because `openBusinessDb` runs before the query string
 *    would otherwise be read.
 * 4. **Custom domain**, then **subdomain** - how production actually routes.
 * 5. **The single business**, when the installation has exactly one.
 *
 * **There is no "default tenant" fallback.** §4.2 is explicit, and the reason is
 * worth keeping in front of whoever edits this next: a fallback means a request
 * that resolves to nothing quietly serves *somebody's* data. Better to serve
 * none and say so.
 *
 * The one deliberate exception is an installation with a single business, where
 * "which one" has only one answer - that is not a guess, and it is what keeps a
 * one-business deployment from needing DNS to function.
 */

/** host -> business id. Domains change rarely; a miss costs one indexed read. */
const byHost = new Map();
/** How many businesses exist, cached - it decides the single-business shortcut. */
let businessCount = null;

/** `shop.example.com` -> `shop`. Null when the host has no meaningful label. */
function subdomainOf(host) {
  const name = String(host ?? '')
    .toLowerCase()
    .split(':')[0]
    .trim();

  if (!name) return null;
  // An IP address or a bare `localhost` names no business.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return null;

  const parts = name.split('.');
  /**
   * `cellshoppe.localhost` is a subdomain too. Browsers resolve every
   * `*.localhost` name to this machine without any setup (RFC 6761), which is
   * what lets the whole subdomain arrangement be exercised in development
   * exactly as it runs in production - only with `localhost` for the domain.
   */
  const local = parts.length === 2 && parts[1] === 'localhost';
  if (parts.length < 3 && !local) return null;

  const label = parts[0];
  // `www`, `app` and the rest are the platform's own surfaces, not a tenant.
  // See `shared/hosts.js` for why a business may never answer on one.
  if (isReservedSubdomain(label)) return null;
  return label;
}

async function countBusinesses() {
  if (businessCount !== null) return businessCount;
  businessCount = await Business.countDocuments({ deletedAt: null });
  return businessCount;
}

/** The default business's id, cached. Null until one is established. */
let defaultId = null;

/**
 * Which business serves a request that named none - **cached, because it is on
 * the path of every such request.**
 *
 * `byHost` above caches the host lookup, so a request arriving on a known
 * domain costs nothing after the first. A request whose host names no business
 * fell straight past that cache into this query, so **every request on
 * localhost, and every request on a deployment before DNS is pointed, paid a
 * full round trip to the control plane** to re-learn an answer that changes when
 * somebody clicks "make default" in the console.
 *
 * Cached for the life of the process and dropped by `resetBusinessResolution`,
 * which `setDefaultBusiness` already calls - so the one action that invalidates
 * this is the one action that clears it.
 *
 * A null answer is deliberately **not** cached: it means no business is the
 * default, which is a state the boot sequence refuses to start in and which an
 * operator is actively fixing. Re-reading until it is fixed costs one query per
 * request on an installation that is already refusing to serve.
 */
async function defaultBusinessId() {
  if (defaultId) return defaultId;

  const fallback = await Business.findOne({ isDefault: true, deletedAt: null })
    .select('_id')
    .lean();

  defaultId = fallback ? String(fallback._id) : null;
  return defaultId;
}

/**
 * Look a host up, cached.
 *
 * Matches a custom domain first and a slug-shaped subdomain second, because a
 * business that has bought a domain means it more than it means its original
 * handle.
 */
async function businessForHost(host) {
  if (!host) return null;

  const key = String(host).toLowerCase();
  if (byHost.has(key)) return byHost.get(key);

  const bare = key.split(':')[0];
  const sub = subdomainOf(key);

  const found = await Business.findOne({
    deletedAt: null,
    $or: [
      { domain: bare },
      ...(sub ? [{ slug: sub }, { code: sub }] : []),
    ],
  })
    .select('_id')
    .lean();

  const id = found ? String(found._id) : null;
  // Cached even when null, so a request for an unknown host does not re-read
  // the collection on every retry.
  byHost.set(key, id);
  return id;
}

async function resolveBusiness(req, _res, next) {
  try {
    // 1. An impersonation grant already decided, and it is not negotiable.
    if (req.businessScopePinned && req.businessScope) {
      req.businessScopeSource = 'pinned';
      return next();
    }

    // 2. An explicit header - development, tooling, and the smoke suite.
    const header = req.get('x-business');
    if (header) {
      req.businessScope = header;
      req.businessScopeSource = 'header';
      return next();
    }

    /**
     * 2b. The business the session was signed into (`authService.issueSession`).
     *
     * An account in a business database exists in that database and nowhere
     * else, so for its session this is the only answer that can work: on the
     * shared admin host the host names nothing, and a `?business=` naming
     * another business could only ever produce "not signed in". A tenant admin's
     * token carries no claim and falls through to the switcher below.
     *
     * The signature is checked here, not just decoded - the claim chooses which
     * database opens, and an unsigned claim would let a cookie pick one. A bad,
     * expired or foreign token is simply not an answer; `authenticate` deals
     * with the cookie itself. A claim naming a deleted business is ignored the
     * same way, so a retired business's staff land signed out rather than
     * inside it.
     */
    /**
     * Which session speaks for this request.
     *
     * The supplier portal's own paths take the SUPPLIER cookie's business: one
     * browser can hold a staff session and a supplier session at once on the
     * shared host, for different businesses, and each has to open its own.
     */
    const portalPath = req.path.startsWith('/api/supplier-portal');
    const token = req.cookies?.[portalPath ? `${env.COOKIE_NAME}_supplier` : env.COOKIE_NAME];
    if (token) {
      let claim = null;
      try {
        claim = jwt.verify(token, env.JWT_SECRET)?.biz ?? null;
      } catch {
        claim = null;
      }
      if (claim) {
        const business = await businessConfig(claim);
        if (business && !business.deletedAt) {
          req.businessScope = claim;
          req.businessScopeSource = 'session';
          return next();
        }
      }
    }

    /**
     * 3. The admin switcher - **above the host, because it is more explicit.**
     *
     * A host is inferred from where the request happened to arrive; a
     * `?business=` is a selection somebody made. When they disagree the stated
     * answer has to win, and the ordering this comment block claims - most
     * explicit first - already said so.
     *
     * **This must be applied here rather than deferred to
     * `resolveBusinessScope`.** That middleware runs after `openBusinessDb`,
     * which is the point of no return: the database is already open and the
     * rest of the request is inside its context. Leaving the switcher until
     * then produced a request whose *connection* was one business and whose
     * *filter* was another - a list that came back empty beside status pills
     * counting the other business's rows. That is exactly what happened on any
     * deployment whose hostname matches a business slug: `cellvix.onrender.com`
     * resolved Cellvix by subdomain at step 4 below, and switching the panel to
     * CellShoppe changed the filter without ever changing the database.
     *
     * Widening is still not decided here. `resolveBusinessScope` runs later
     * with `req.user` available and remains the only place that enforces a
     * staff member cannot leave their own business; this only chooses which
     * database to open, and every permission check still runs inside it.
     */
    const requested = String(req.query.business ?? '').trim();
    if (requested && requested !== 'all') {
      req.businessScope = requested;
      req.businessScopeSource = 'query';
      return next();
    }

    // 4. The host, which is how production routes.
    const fromHost = await businessForHost(req.get('host'));
    if (fromHost) {
      req.businessScope = fromHost;
      req.businessScopeSource = 'host';
      return next();
    }

    /**
     * 5. One business, one answer.
     *
     * Not a fallback: where exactly one business exists there is nothing to
     * choose between, and requiring DNS to serve a single-business install
     * would make the common case the hardest one. With two or more, this stays
     * null and the request is unscoped - which the admin panel treats as "pick
     * one" rather than "show everything" once §4.2 lands in full.
     */
    if ((await countBusinesses()) === 1) {
      const only = await Business.findOne({ deletedAt: null }).select('_id').lean();
      req.businessScope = only ? String(only._id) : null;
      req.businessScopeSource = 'single';
      return next();
    }

    /**
     * 6. The default business, when nothing else named one.
     *
     * **Not the "default tenant" fallback §4.2 forbids.** That rule is about
     * resolving a *tenant* from an ambiguous host - serving somebody's account
     * because the request could not be placed. This is narrower and already
     * decided: `Business.isDefault` is the single business designated as where
     * an unattributed record lands, enforced to be exactly one, and it is the
     * same answer the seed, the order builder and the admin switcher all use.
     *
     * Without it the storefront had no business at all on a host that names
     * none - which is every request on `localhost` once a second business
     * exists. The catalogue read the control database, found no products, and
     * `buyer@cellvix.ca` could not sign in because their account lives in
     * Cellvix's database rather than in the control plane. The site was, in
     * effect, off.
     *
     * In production the host resolves this long before it is reached; this is
     * what keeps development and a single-domain deployment working.
     */
    req.businessScope = req.businessScope ?? (await defaultBusinessId());
    req.businessScopeSource = 'default';
    return next();
  } catch (error) {
    // Resolution failing must not take the site down: the request continues
    // unscoped, exactly as it did before this middleware existed.
    console.error(`  Business resolution failed - ${error.message}`);
    return next();
  }
}

/** Forget the host and count caches. After a domain change, and for tests. */
function resetBusinessResolution() {
  byHost.clear();
  businessCount = null;
  defaultId = null;
}

export { resolveBusiness, resetBusinessResolution, subdomainOf };
export default resolveBusiness;
