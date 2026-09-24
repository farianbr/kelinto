import { asyncHandler } from '../utils/ApiError.js';
import * as authService from '../services/authService.js';
import auditService from '../services/auditService.js';
import { PERMISSION_AREAS } from '../models/Role.js';
import { db } from '../db/models.js';
import { currentBusinessId } from '../db/context.js';
import { inBusinessDb } from '../services/loginDirectory.js';
import { businessConfig } from '../middleware/businessConfigCache.js';
import env from '../config/env.js';

/**
 * The session shape, plus the resolved permission map for Cellvix staff.
 *
 * The map is sent so the panel can hide what a role cannot reach - a courtesy,
 * never the control (§7.6). `requirePermission` decides for real on every
 * request, so a client that ignores this learns nothing and gains nothing.
 *
 * An admin gets every area at full rather than a null: the sidebar then has one
 * shape to read instead of two, and "admin bypasses the map" stays a server
 * concern.
 */
async function sessionUser(user) {
  if (!user) return null;
  const shape = user.toPublic();

  if (user.role === 'admin') {
    shape.permissions = PERMISSION_AREAS.reduce((out, a) => ({ ...out, [a]: 'full' }), {});
    return shape;
  }

  if (user.role === 'staff' && user.staffRole) {
    const role = await db().Role.findById(user.staffRole).lean();
    shape.permissions = role
      ? PERMISSION_AREAS.reduce((out, a) => ({ ...out, [a]: role.areas?.[a] ?? 'none' }), {})
      : null;
    shape.staffRoleName = role?.name ?? null;
  }

  return shape;
}

/**
 * The business's feature set, for the panel's shell.
 *
 * **Sent beside the user, not inside it** - a feature is a property of the
 * business, and a permission is a property of the account. Nesting one in the
 * other would be the first step towards a per-user feature, which is a thing
 * this design does not have (§4.4).
 *
 * **Staff only.** A buyer's client has no nav to filter and no use for the set,
 * and shipping it would tell every storefront visitor which sections the ERP
 * runs. `null` for a guest or a customer.
 *
 * A courtesy, exactly as `permissions` is: `requireFeature` answers for real on
 * every request, so a client that ignores this gets 404s rather than access.
 */
function staffFeatures(req) {
  if (!req.user || !['admin', 'staff'].includes(req.user.role)) return null;
  return req.features ?? null;
}

const register = asyncHandler(async (req, res) => {
  // The IP is recorded with the CASL consent, so it is read here - only the
  // request knows it, and the service must not reach for `req` (§6.13).
  const user = await authService.register(req.body, { ip: req.ip });
  // Deliberately no session: sign-up does not grant access until an admin
  // approves the business (brief §8.2).
  res.status(201).json({
    user: user.toPublic(),
    message:
      'Thanks for signing up - your account is pending admin approval. We will email you once it is verified.',
  });
});

/**
 * Sign in, and record the attempt either way (§6.15, Security Log).
 *
 * **Both outcomes are logged.** A security log that only records successes
 * answers the least interesting question - the failures are what show somebody
 * working through a password list, and a lockout with no failures before it
 * reads as a system fault rather than an attack.
 *
 * The failure row is written and the original error is then re-thrown
 * unchanged: the caller must still get `INVALID_CREDENTIALS`, and the response
 * must not reveal whether the address exists.
 */
const login = asyncHandler(async (req, res) => {
  let user;
  let business;
  try {
    ({ user, business } = await authService.login(req.body, {
      // A business's own panel domain signs in that business's accounts only.
      pinned: req.hostPinned ? req.businessScope : null,
    }));
  } catch (error) {
    await auditService.recordSecurity({
      req,
      action: `auth.login_${error.code === 'STAFF_LOCKED' ? 'locked' : 'failed'}`,
      entity: { kind: 'session', id: '', label: req.body?.email ?? '' },
      description:
        error.code === 'STAFF_LOCKED'
          ? `Sign-in refused for ${req.body?.email} - account is locked.`
          : `Failed sign-in for ${req.body?.email}.`,
      // Resolved without leaking anything: the row names the account when it
      // exists, while the response stays identical either way.
      subject: await authService.findForAudit(req.body?.email),
    });
    throw error;
  }

  authService.issueSession(res, user, req.body.remember, business?._id ?? null);

  /**
   * Everything after this reads and writes the account's OWN business.
   *
   * On the shared admin host the request resolved to the default business,
   * but a staff member found through the login directory lives in another
   * one. Their role is read from there (`sessionUser`), and the sign-in is
   * audited there - the business whose security log should show it. A tenant
   * admin has no business, and a storefront sign-in is already in the right
   * one, so both run as they always did.
   */
  const finish = async () => {
    await auditService.recordSecurity({
      req,
      action: 'auth.login',
      entity: { kind: 'session', id: user._id.toString(), label: user.email },
      description: `${user.email} signed in.`,
      subject: user,
    });
    return sessionUser(user);
  };

  const elsewhere = business && String(business._id) !== String(currentBusinessId());
  const shape = elsewhere ? await inBusinessDb(business, finish) : await finish();

  res.json({ user: shape, features: staffFeatures(req) });
});

const logout = asyncHandler(async (req, res) => {
  if (req.user) {
    await auditService.recordSecurity({
      req,
      action: 'auth.logout',
      entity: { kind: 'session', id: req.user._id.toString(), label: req.user.email },
      description: `${req.user.email} signed out.`,
    });
  }

  authService.clearSession(res);
  res.status(204).end();
});

/**
 * Who is signed in, if anyone.
 *
 * A guest gets 200 with `user: null`, not 401. "Nobody is signed in" is a valid
 * answer to this question rather than a failure, and every visitor asks it on
 * first paint - answering with an error meant a red entry in the browser console
 * on every anonymous page load, which no client-side catch can suppress.
 */
/**
 * The origin the active business's storefront answers on, or null.
 *
 * The panel host (`app.<platform>`) serves no storefront, so a panel link to a
 * product page, a blog post or the kiosk has to leave the host - and only the
 * server knows the address. A custom domain wins over the platform subdomain,
 * as it does in `resolveBusiness`. Null when neither exists, and the client
 * then keeps the link on its own host, which is right whenever no split is on.
 */
async function storefrontOrigin(req) {
  if (!req.user || !req.businessScope) return null;
  const business = await businessConfig(req.businessScope);
  if (!business || business.deletedAt) return null;
  if (business.domain) return env.originFor(business.domain);
  if (business.slug && env.storefrontDomain) return env.originFor(`${business.slug}.${env.storefrontDomain}`);
  return null;
}

const me = asyncHandler(async (req, res) => {
  res.json({
    user: await sessionUser(req.user),
    features: staffFeatures(req),
    storefrontOrigin: await storefrontOrigin(req),
    /**
     * An active support session, when there is one (SAAS_PLATFORM §4.5).
     *
     * Reported here rather than on a route of its own because every screen
     * already asks this question on first paint, and the banner has to be able
     * to appear on **any** of them - a platform operator who navigates deep into a
     * panel must not lose the one control that gets them out. `null` for
     * everybody else, which is the overwhelming majority of requests.
     */
    impersonation: req.impersonation
      ? {
          business: req.impersonation.business,
          businessName: req.impersonation.grant.businessName,
          operator: req.impersonation.superAdmin.name,
          reason: req.impersonation.grant.reason,
          expiresAt: req.impersonation.grant.expiresAt,
        }
      : null,
  });
});

/**
 * A business applying to supply Cellvix. Creates no account and no session.
 *
 * Always 202, whatever the service found. A public form that answered
 * differently for an address already on file would report which businesses
 * Cellvix buys from to anyone who cared to ask.
 */
const applyAsSupplier = asyncHandler(async (req, res) => {
  await authService.applyAsSupplier(req.body);
  res.status(202).json({ recorded: true });
});

/**
 * Always 204, whether or not the address is registered.
 *
 * The reply cannot depend on whether an account exists: one that did would be
 * a way to ask "does this business buy from Cellvix", which is the same reason
 * the supplier application answers the same way to everyone. The service does
 * the work and stays silent about what it found.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body);
  res.status(204).end();
});

/**
 * Completes a reset and signs the user in.
 *
 * Signing in here is deliberate: they have just proven control of the mailbox
 * and chosen a password, so asking them to type it again immediately is a step
 * that protects nothing. `remember` is false - a reset is often done on a
 * machine that is not theirs.
 */
const resetPassword = asyncHandler(async (req, res) => {
  const user = await authService.resetPassword(req.body);
  // Reset reads this business's accounts only, so this business holds it.
  authService.issueSession(res, user, false, currentBusinessId());
  res.json({ user: user.toPublic() });
});

export { register, login, logout, me, forgotPassword, resetPassword, applyAsSupplier };
