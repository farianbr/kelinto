import ApiError from '../utils/ApiError.js';
import { businessConfig } from './businessConfigCache.js';

/**
 * What a tenant's subscription state still permits (SAAS_PLATFORM §6 phase 19).
 *
 * **`Tenant.status` was written and never read.** The console could set a
 * tenant to `suspended` or `cancelled` and nothing anywhere changed - their
 * businesses kept trading exactly as an active tenant's did. This is the half
 * that makes the field mean something.
 *
 * ## What each state allows
 *
 * | status | reads | writes | storefront |
 * |---|---|---|---|
 * | `active` | yes | yes | yes |
 * | `past_due` | **yes, always** | no | no |
 * | `suspended` | yes | no | no |
 * | `cancelled` | no | no | no |
 *
 * **`past_due` keeps reads on deliberately.** Locking somebody out of their own
 * customer list over an unpaid invoice makes the invoice harder to pay, not
 * easier - they cannot call the customer whose payment would settle it. The
 * lever that actually works is stopping them taking *new* business, which is
 * what refusing writes does.
 *
 * **A method, not a path.** Whether a request is a read is decided by its HTTP
 * verb rather than by a list of allowed routes: a list is a thing to forget to
 * update, and the next write route added would silently be exempt.
 *
 * ## Why this is not the feature gate
 *
 * `requireFeature` answers "does this business have this capability" with a 404,
 * because a tenant should not learn what the product could do if they paid
 * more. This answers "is this account in good standing", and the answer must be
 * **legible** - somebody has to know to go and pay. So it is a 403 carrying a
 * code the client can render a real explanation for, which is the opposite
 * choice for the opposite reason.
 *
 * ## What this does NOT yet cover, and why
 *
 * **Only requests that name a business.** The client sends `?business=` on
 * `/admin` paths and `/auth/me` and nowhere else, so the storefront - the
 * catalogue, the cart, checkout - is *not* gated here: those requests carry no
 * scope, `businessScope` is null, and this returns early.
 *
 * That means the "storefront off" column of the table above is **not enforced
 * yet**. It cannot be until business resolution moves ahead of authentication
 * (the plan's phase 2, where a subdomain or custom domain names the business
 * before anybody signs in). Writing a second, path-sniffing way to guess the
 * business for storefront requests would be a duplicate of the resolution logic
 * that phase is about to introduce, and the two would drift.
 *
 * Until then a suspended tenant's admin panel is read-only, which is the half
 * that matters most - no new orders, invoices or records - while their public
 * catalogue stays up.
 */

/** Verbs that only read. Everything else is a write. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Paths that stay reachable whatever the tenant's state.
 *
 * Deliberately tiny, and every entry is here because refusing it would trap
 * somebody: signing in and out, asking who you are, and reading the billing
 * position you are being asked to fix. A cancelled tenant can still do these
 * four things and nothing else.
 */
const ALWAYS_ALLOWED = [
  '/auth/login',
  '/auth/logout',
  '/auth/me',
  '/superadmin',
  '/supplier',
  '/health',
];

const STATUS_MESSAGES = {
  past_due: [
    'This account is past due. You can still read everything, but new records cannot be created until the balance is settled.',
    'TENANT_PAST_DUE',
  ],
  suspended: [
    'This account is suspended. Records are readable but nothing can be changed. Contact your account manager.',
    'TENANT_SUSPENDED',
  ],
  cancelled: [
    'This account has been cancelled.',
    'TENANT_CANCELLED',
  ],
};

/**
 * Resolve the tenant behind this request's business, and refuse what its state
 * does not allow.
 *
 * **A business with no tenant is unaffected.** Cellvix and CellShoppe both
 * predate tenancy and belong to nobody; refusing them would take the running
 * product offline to enforce a billing rule about an account that does not
 * exist. Unassigned means "not billed through the platform", not "delinquent".
 */
async function enforceTenantStatus(req, _res, next) {
  try {
    // The console and the supplier portal are separate applications on separate
    // sessions; neither belongs to a tenant and neither is billed.
    if (ALWAYS_ALLOWED.some((path) => req.path.startsWith(path))) return next();

    /**
     * A platform operator is not bound by the tenant's billing state.
     *
     * Support is *most* needed on an account that has stopped paying - sorting
     * out the dispute, exporting their data, fixing whatever caused the lapse.
     * Refusing a staff member here would mean the only accounts we cannot help are
     * the ones asking for help, and the grant is already time-boxed, logged and
     * revocable, which is a tighter control than this one.
     */
    if (req.impersonation?.superAdmin) return next();

    const scope = req.businessScope;
    if (!scope) return next();

    /**
     * One cached read instead of two live ones.
     *
     * This was `Business.findById` and then `Tenant.findById` - sequential,
     * because the tenant's id comes out of the business - so **every request in
     * the application paid two full round trips** to decide a status that
     * changes when somebody's card fails. `businessConfigCache` makes that pair
     * happen once a minute per business, and `feature.js` reads the same entry
     * rather than fetching the same document a third time.
     */
    const config = await businessConfig(scope);
    const tenant = config?.tenant;
    if (!tenant || tenant.status === 'active') return next();

    req.tenantStatus = tenant.status;

    const isRead = READ_METHODS.has(req.method);

    // `cancelled` refuses reads too - the account is over. The retention window
    // exists so the data can be restored or exported by us, not browsed by them.
    if (tenant.status === 'cancelled') {
      const [message, code] = STATUS_MESSAGES.cancelled;
      return next(ApiError.forbidden(message, code));
    }

    // `past_due` and `suspended` both read freely and write nothing.
    if (isRead) return next();

    const [message, code] = STATUS_MESSAGES[tenant.status] ?? [
      'This account cannot make changes right now.',
      'TENANT_NOT_ACTIVE',
    ];
    return next(ApiError.forbidden(message, code));
  } catch (error) {
    /**
     * A lookup failure must not take the product down.
     *
     * This gate exists to enforce a *billing* position, and failing closed on a
     * database blip would lock every tenant out over a transient error - a far
     * worse outcome than one unpaid account writing a record it should not
     * have. Logged rather than swallowed silently.
     */
    console.error(`  Tenant status: could not resolve - ${error.message}`);
    return next();
  }
}

export { enforceTenantStatus, READ_METHODS, STATUS_MESSAGES };
export default enforceTenantStatus;
