import Business from '../models/Business.js';
import { dbFor } from '../db/connections.js';
import { runInBusiness } from '../db/context.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Open the business's database for the rest of this request (SAAS_PLATFORM §4.1).
 *
 * **Everything downstream runs inside `runInBusiness`**, so every service the
 * request reaches - however many `await`s deep - reads the same connection from
 * async-local context without being handed one. That is the whole point of the
 * seam: 586 service functions keep their signatures.
 *
 * **Mounted after business scope and before the routes.** It needs
 * `req.businessScope` to know which business, and it must wrap the route
 * handlers rather than run beside them, because `next()` called inside
 * `runInBusiness` is what puts the rest of the stack inside the context.
 *
 * The business's **code** is what names a database, so this reads one document
 * to turn an id into a code. Cached on the request; while the split is off
 * `dbFor` ignores the code anyway and answers with the default connection.
 */

/** id -> code. Codes do not change, so this never needs invalidating. */
const codes = new Map();

async function codeFor(businessId) {
  if (!businessId) return null;

  const key = String(businessId);
  if (codes.has(key)) return codes.get(key);

  const business = await Business.findById(key).select('code').lean();
  const code = business?.code ?? null;
  // Cached even when null: a request naming a business that does not exist
  // should not re-read the collection on every retry.
  codes.set(key, code);
  return code;
}

/**
 * Requests that legitimately run with no business.
 *
 * **The control plane describes businesses, so it cannot be inside one.** The
 * super-admin console is where a first business gets created and where a broken
 * one gets repaired, so gating it behind a resolved business would lock the only
 * door that fixes the problem. `/health` is what a load balancer polls, and a
 * health check that fails because DNS has not been pointed yet reports the wrong
 * thing entirely.
 *
 * Everything else - storefront, admin panel, supplier portal, kiosk - reads
 * business records and has no meaning without one.
 */
const CONTROL_PLANE = [/^\/superadmin(\/|$)/, /^\/health(\/|$)/];

function isControlPlane(path) {
  return CONTROL_PLANE.some((pattern) => pattern.test(path));
}

async function openBusinessDb(req, _res, next) {
  try {
    const code = await codeFor(req.businessScope);

    /**
     * No business resolved: **refuse, rather than read the control database.**
     *
     * `dbFor(null)` answers with the control connection, which since the split
     * holds tenants, plans and super admins - no products, no customers, no
     * orders. A storefront request served from it returns an empty catalogue
     * with a 200, and a sign-in rejects an account that plainly exists in a
     * business database beside it. Both look like application bugs and neither
     * mentions the actual cause, which is how this cost a week of debugging: the
     * site was, in effect, off, and every response said it was fine.
     *
     * A 503 that names the cause is the useful answer. The condition is a
     * configuration state, not a crash - an unknown host, or an installation
     * with no default business - so it reads as "not configured for you" rather
     * than as a server fault.
     */
    if (!code && !isControlPlane(req.path)) {
      console.error(
        `  Business DB: no business for ${req.method} ${req.originalUrl}` +
          ` (host ${req.get('host') ?? 'unknown'})`,
      );
      return next(
        ApiError.serviceUnavailable(
          'This site is not matched to a business yet.',
          'BUSINESS_UNRESOLVED',
        ),
      );
    }

    /**
     * `next()` inside the context, not after it.
     *
     * Calling `next()` outside and then opening the context would put the
     * context around nothing - Express would have already moved on. Wrapping it
     * is what makes every downstream handler and service inherit the
     * connection.
     */
    return runInBusiness(
      { businessId: req.businessScope ?? null, code, connection: dbFor(code) },
      () => next(),
    );
  } catch (error) {
    /**
     * **This refuses now, and the comment it replaces said it would have to.**
     *
     * While the split was off, `dbFor(null)` was the default connection and
     * carrying on was strictly better than a 500: the request behaved exactly
     * as it had before this middleware existed. The flip landed and that stopped
     * being true. `dbFor(null)` is now the CONTROL database - tenants, plans and
     * super admins - which holds no products, no customers and no orders. So
     * carrying on no longer means "as before"; it means answering a storefront
     * request from the wrong database with a 200 and an empty page.
     *
     * That is precisely how a total outage stayed invisible: an unresolvable
     * business logged one line and served empty results that looked like a
     * catalogue with no matches. A 503 naming the cause is worth far more than a
     * 200 that is quietly wrong, because only one of the two gets investigated.
     */
    console.error(`  Business DB: could not resolve - ${error.message}`);
    return next(
      ApiError.serviceUnavailable(
        'This request could not be matched to a business.',
        'BUSINESS_UNRESOLVED',
      ),
    );
  }
}

/** Forget the id→code cache. For tests, and after a business is renamed. */
function resetCodeCache() {
  codes.clear();
}

export { openBusinessDb, resetCodeCache };
export default openBusinessDb;
