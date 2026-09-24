import Business from '../models/Business.js';
import Tenant from '../models/Tenant.js';

/**
 * One cached read of a business's configuration, for the middleware chain.
 *
 * ## What this is for
 *
 * Three middlewares ran on every request and each opened its own round trip to
 * the control plane for facts that change perhaps monthly: `tenantStatus` read
 * `Business` and then `Tenant` (**sequentially**, so two full trips before any
 * route began), and `feature` read `Business` again for the same document
 * `tenantStatus` had just fetched. A request to `/api/health` - which runs no
 * query of its own - therefore cost four round trips before answering.
 *
 * On a deployment sharing a region with its database that is a few milliseconds
 * and nobody notices. It is still four connections held per request instead of
 * one, which is what decides how many concurrent requests the pool can serve;
 * and on any deployment where the application and the database are not
 * neighbours it is the difference between a fast panel and a slow one.
 *
 * So: one lookup, cached, shared. `businessDb` already caches id→code this way
 * and has since it was written - this is the same idea applied to the rest of
 * what the chain needs.
 *
 * ## Why a TTL rather than explicit invalidation
 *
 * The cached facts are all edited from the super-admin console, which runs in
 * the same process - so an explicit `forget()` on write is exact and is wired up
 * below. But a platform can run more than one Node process (Passenger does), and
 * an in-process cache in one of them cannot be invalidated by a write in
 * another. A short TTL is what bounds that staleness without coordination.
 *
 * **60 seconds is chosen against the consequence of being stale**, not for a
 * round number. A suspended tenant keeps writing for up to a minute; a feature
 * toggled on appears within a minute. Both are recoverable and neither is a
 * security boundary - permissions and ownership are checked per request against
 * live data, and this caches only *configuration*. A tenant suspension that must
 * bite immediately is a `forget()` call, which the console already makes.
 */

/** businessId -> { at, value }. Small: one entry per business, not per request. */
const cache = new Map();

/** How long a cached entry is trusted. See the note above on why 60s. */
const TTL_MS = 60_000;

/**
 * Everything the middleware chain needs about one business, in one round trip.
 *
 * The tenant is fetched only when the business names one, and the two reads
 * stay sequential because the second genuinely depends on the first - there is
 * no id to look a tenant up by until the business has been read. What changes is
 * that this pair now happens once a minute per business rather than twice per
 * request.
 */
async function loadConfig(businessId) {
  const business = await Business.findById(businessId)
    .select('code businessType featureOverrides tenant deletedAt slug domain')
    .lean();

  if (!business) return null;

  const tenant = business.tenant
    ? await Tenant.findById(business.tenant).select('status name').lean()
    : null;

  return {
    code: business.code ?? null,
    businessType: business.businessType ?? 'product',
    featureOverrides: business.featureOverrides ?? null,
    /**
     * Which tenant owns this business, as a plain string, and whether it is
     * still live.
     *
     * Both are what `businessScope` checks a `?business=` claim against, and
     * they are carried here rather than re-read because that check runs on
     * every panel request. `tenant` below is the tenant's own *record*; this
     * is the edge from the business to it, which survives a tenant that could
     * not be loaded.
     */
    tenantId: business.tenant ? String(business.tenant) : null,
    deletedAt: business.deletedAt ?? null,
    // Where the business's storefront answers, for links the panel host has to
    // send off-host (`storefrontOrigin` in authController). Cleared with the
    // rest of the entry when the super admin changes an address.
    slug: business.slug ?? null,
    domain: business.domain ?? null,
    tenant: tenant ? { id: String(tenant._id), status: tenant.status, name: tenant.name } : null,
  };
}

/**
 * The cached configuration for one business, or null when there is no such
 * business.
 *
 * **A null is cached too.** A request naming a business that does not exist
 * would otherwise re-read the collection on every retry, which is the cheapest
 * way to turn a typo in a bookmark into load.
 */
async function businessConfig(businessId) {
  if (!businessId) return null;

  const key = String(businessId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const value = await loadConfig(key);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Drop one business's entry, or all of them.
 *
 * Called by the console when a business or its tenant is edited, so a change
 * made in this process takes effect on the next request rather than at the end
 * of the TTL.
 */
function forgetBusinessConfig(businessId = null) {
  if (businessId) cache.delete(String(businessId));
  else cache.clear();
}

export { businessConfig, forgetBusinessConfig };
