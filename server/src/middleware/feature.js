import ApiError from '../utils/ApiError.js';
import { cellvixFeatures, featureEnabled, resolveFeatures } from '../../../shared/schemas/features.js';
import { businessConfig } from './businessConfigCache.js';

/**
 * The feature gate (SAAS_PLATFORM §3.2, §5.3).
 *
 * Sits alongside `requirePermission` and answers a different question.
 * A **permission** is what a role inside a business may do with a feature that
 * is already on; a **feature** is whether this business has it at all. A viewer
 * who cannot edit invoices gets a 403; a business that does not have invoicing
 * should not learn the route exists.
 *
 * **404, never 403** - that is the whole rule, and it is why this cannot reuse
 * the permission guard. A 403 says "this exists and you may not have it", which
 * tells a tenant what the product could do if they paid more. A 404 says
 * nothing, which is what a switched-off feature should say.
 *
 * **A flag is resolved once per request** and carried on `req`, so nothing
 * re-reads the set mid-request and two checks in one request can never
 * disagree.
 *
 * ## Where the answer comes from
 *
 * The **business the request is scoped to** - `req.businessScope`, set by
 * `businessScope.js` from a staff account's own business or an admin's
 * switcher. Its `businessType` picks the defaults and its `featureOverrides`
 * beat them, so switching business in the header genuinely changes which
 * sections exist rather than only which records are listed.
 *
 * Mount order matters: `resolveBusinessScope` must run **before**
 * `attachFeatures`, or the scope is not there to read and every request
 * resolves the union.
 */

/**
 * Resolve the feature set for this request, from the business it is scoped to.
 *
 * The single seam for tenancy, and it is now load-bearing: the business's
 * `businessType` decides the defaults (§1.1) and its `featureOverrides` beat
 * them (§3.3). A product business gets Orders and Returns; a service business
 * gets Tickets and Quotes; `both` gets the union.
 *
 * **No scope means every feature is on.** `req.businessScope` is null when an
 * admin has "All businesses" selected, and the honest answer there is the union
 * of what any business could do - narrowing to one type's defaults would hide
 * sections from an admin who has deliberately asked to see everything. Nothing
 * is exposed by that: every record query is still scoped, and every write still
 * names its business.
 *
 * Falls back to Cellvix's set when the business cannot be read - a database
 * blip should degrade to the running product's own configuration, not to an
 * empty panel that looks like a permissions failure.
 */
async function resolveFeaturesFor(req) {
  const scope = req?.businessScope;
  if (!scope) return resolveFeatures({ businessType: 'both' });

  try {
    /**
     * The same cached entry `tenantStatus` just read.
     *
     * This was its own `Business.findById`, so the two middlewares fetched one
     * document twice per request - and neither needed a fresh copy: a business's
     * type and its feature overrides are edited from the super-admin console and
     * change rarely. See `businessConfigCache` for the TTL and why it is bounded
     * the way it is.
     */
    const business = await businessConfig(scope);
    if (!business) return cellvixFeatures();

    return resolveFeatures({
      businessType: business.businessType ?? 'product',
      // `.lean()` gives a plain object for a Map field, which is what
      // `resolveFeatures` wants - but an older document may carry nothing.
      overrides: business.featureOverrides ?? null,
    });
  } catch (error) {
    console.error(`  Features: could not resolve for ${scope} - ${error.message}`);
    return cellvixFeatures();
  }
}

/**
 * Attach the resolved feature set to the request.
 *
 * Mounted once, ahead of the routes, so `req.features` is present whether or
 * not a given route gates on anything - a screen that wants to *read* the set
 * (the read-only list in Settings, §3.3) needs it without being gated by it.
 *
 * Resolved **once per request** and cached on `req` (§3.2 rule 5), so two
 * checks in one request can never disagree and one database read serves them
 * both.
 */
async function attachFeatures(req, _res, next) {
  try {
    req.features = await resolveFeaturesFor(req);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Refuse a route whose feature is switched off, as though it were not there.
 *
 * ```js
 * router.get('/admin/tickets', ...admin, requireFeature('sales.tickets'), …)
 * ```
 *
 * Applied as routes are touched rather than in one sweep (§5.3) - a gate on a
 * feature that is on changes nothing, so there is no value in racing to add
 * them all and some risk in doing it blind.
 */
function requireFeature(key) {
  return async function featureGuard(req, _res, next) {
    /**
     * `attachFeatures` normally runs first and leaves the set on `req`.
     *
     * The fallback is **awaited**, not assigned: `resolveFeaturesFor` reads a
     * document and therefore returns a promise, and a promise handed to
     * `featureEnabled` is a truthy object whose `[key]` is `undefined` - which
     * reads as "not disabled" and opens every gate it guards. Awaiting is the
     * difference between a fallback and a hole.
     */
    let features = req.features;
    if (!features) {
      try {
        features = await resolveFeaturesFor(req);
      } catch (error) {
        return next(error);
      }
    }

    if (!featureEnabled(features, key)) {
      // Deliberately the same shape as any other 404 - no `FEATURE_DISABLED`
      // code, no mention of the key. A body that named the feature would give
      // back exactly what the status code is withholding.
      return next(ApiError.notFound('Not found.', 'NOT_FOUND'));
    }

    return next();
  };
}

export { attachFeatures, requireFeature, resolveFeaturesFor };
export default requireFeature;
