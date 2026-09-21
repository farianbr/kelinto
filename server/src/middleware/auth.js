import jwt from 'jsonwebtoken';
/**
 * `User` and `Role` are **per-business** collections, so both are read off the
 * request's own connection rather than imported (SAAS_PLATFORM §4.1).
 *
 * This middleware is why `openBusinessDb` mounts before authentication: a
 * module-level import binds these to the default connection, and with the
 * context opened later every sign-in failed with `INVALID_CREDENTIALS` against
 * an account that existed - in another database.
 *
 * The side-effect imports keep the schemas registered, which mongoose needs to
 * resolve a `ref` by name at populate time.
 */
import '../models/User.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { clearSession } from '../services/authService.js';
import '../models/Role.js';
import { controlModels, db } from '../db/models.js';
import { isImpersonating } from './impersonationAuth.js';

const STATUS_ERRORS = {
  pending: [
    'ACCOUNT_PENDING',
    'Your account is still under review. We will email you as soon as it is approved.',
  ],
  rejected: [
    'ACCOUNT_REJECTED',
    'This account was not approved. Contact sales@cellvix.ca if you think that is a mistake.',
  ],
  suspended: [
    'ACCOUNT_SUSPENDED',
    'This account is suspended. Contact your account representative.',
  ],
};

/**
 * Reads the session cookie and attaches `req.user` when it resolves.
 * Never throws - an anonymous visitor is a valid state everywhere.
 *
 * A cookie that cannot resolve to a user is actively cleared. Otherwise the
 * browser keeps presenting a dead token on every request for the rest of its
 * 7-day life, and the UI reads as "signed out" while the cookie says otherwise.
 */
async function authenticate(req, res, next) {
  const token = req.cookies?.[env.COOKIE_NAME];
  req.user = null;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);

    /**
     * The control plane first, then this business.
     *
     * A tenant's **admin** lives in the control plane so one login reaches every
     * business the tenant owns; **staff and buyers** live in the business's own
     * database. A session token names an id and not which of those it is, so
     * both are tried - control plane first because it is the smaller collection
     * and because an admin is the account most likely to be switching business
     * when this runs.
     *
     * Two lookups rather than one, on a request that already makes several. The
     * alternative - putting the population in the token - would mean a token
     * minted before a role changed kept looking in the wrong place.
     */
    /**
     * **Both lookups at once, not one after the other.**
     *
     * These were chained with `??`, which makes the second wait for the first to
     * come back before it is even issued - so every buyer and every staff member
     * (the accounts that are *not* in the control plane, which is most of them)
     * paid two full round trips to the database on every request. The admin case
     * was fast and the common case was not.
     *
     * The precedence the `??` expressed is preserved exactly: the control-plane
     * admin still wins when both resolve. What changes is that the two queries
     * are in flight together, so the cost is one round trip rather than two.
     *
     * Issuing a lookup whose result may be discarded is the deliberate trade: a
     * second indexed read by `_id` is cheap, and it is already being made in the
     * common path. Nothing is written here, so there is no interaction between
     * the two.
     */
    const [controlAdmin, businessUser] = await Promise.all([
      controlModels().User.findOne({ _id: payload.sub, role: 'admin' }),
      db().User.findById(payload.sub),
    ]);

    const user = controlAdmin ?? businessUser;

    if (user) {
      req.user = user;
    } else {
      // Signature is valid but the subject is gone: a deleted account, or a dev
      // database reseeded underneath a live session.
      clearSession(res);
    }
  } catch {
    // Expired or tampered cookie: treat as anonymous, and stop it coming back.
    clearSession(res);
  }

  return next();
}

/**
 * Somebody is signed in.
 *
 * **Admits an impersonating platform operator**, because every guard below funnels
 * through the idea of "a request that is allowed to be here", and a support
 * session is. What it deliberately does not do is give that operator a
 * `req.user` - the routes beneath still have to cope with there being no buyer
 * account, which is why `denyAdmin` refuses them outright.
 */
function requireAuth(req, _res, next) {
  if (req.user || isImpersonating(req)) return next();
  return next(ApiError.unauthorized());
}

/**
 * The B2B approval gate. Wholesale pricing and ordering stay locked until an admin
 * approves the business (brief §8.2).
 */
function requireApproved(req, _res, next) {
  // Buyer-side, so a support session is refused here as it is by `denyAdmin`
  // and explicitly, because `requireAuth` now admits one and this would
  // otherwise read `status` off nothing.
  if (isImpersonating(req)) {
    return next(
      ApiError.forbidden(
        'A support session cannot use the buyer side. Leave the business first.',
        'IMPERSONATION_NOT_A_BUYER',
      ),
    );
  }

  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.status === 'approved') return next();

  const [code, message] = STATUS_ERRORS[req.user.status] ?? [
    'ACCOUNT_NOT_APPROVED',
    'Your account is not approved yet.',
  ];
  return next(ApiError.forbidden(message, code));
}

/**
 * The mirror of `requireStaff`: keeps Cellvix people out of the buyer side.
 *
 * A staff login is not a business. It has no cart, no orders, no invoices and
 * no credit, so every route beneath this one would either read an empty shape
 * or write buyer data against an account that should never own any. The client
 * redirects staff away from the storefront (`RootLayout`); this is the half
 * that holds when the request does not come from our UI.
 *
 * Its own code rather than `requireApproved`'s: an admin is not `approved` and
 * would otherwise be told their account is under review, which is nonsense and
 * would send them looking for an approval that is never coming.
 */
function denyAdmin(req, _res, next) {
  /**
   * A support session has no buyer side either, and for a stronger reason than
   * staff do: there is no `User` at all, so a cart, an order or a credit
   * balance created here would belong to nobody. Refused rather than allowed to
   * write orphaned records.
   */
  if (isImpersonating(req)) {
    return next(
      ApiError.forbidden(
        'A support session cannot use the buyer side. Leave the business first.',
        'IMPERSONATION_NOT_A_BUYER',
      ),
    );
  }

  if (isStaffAccount(req.user)) {
    return next(
      ApiError.forbidden(
        'Staff accounts do not have a buyer side. Use the admin console.',
        'ADMIN_NOT_A_BUYER',
      ),
    );
  }
  return next();
}

/**
 * Full admin. Deliberately NOT satisfied by a `staff` account, however
 * permissive its role: the things behind this guard are the ones §7.6 keeps
 * admin-only regardless of role - editing roles, creating users, API keys and
 * the security log - because a role that can grant itself power is not a
 * permission system.
 */
function requireAdmin(req, _res, next) {
  // A platform operator inside a support session passes. They are not an
  // `admin` of this business and never will be - the grant is what authorises
  // them, and it is time-boxed, revocable and written into the business's own
  // audit trail, which is a stronger claim than a role flag.
  if (isImpersonating(req)) return next();
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role !== 'admin') return next(ApiError.forbidden());
  return next();
}

/**
 * Admin panel access: an admin, or a staff member holding a role.
 *
 * A staff account with no `staffRole` is refused here - access is granted,
 * never inherited, so an employee nobody has assigned is a locked door rather
 * than a door standing open.
 */
function requireStaff(req, _res, next) {
  // As `requireAdmin`: the grant is the authorisation, not a role.
  if (isImpersonating(req)) return next();
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role === 'admin') return next();
  if (req.user.role !== 'staff') return next(ApiError.forbidden());
  if (req.user.lockedAt) {
    return next(ApiError.forbidden('This staff account is locked.', 'STAFF_LOCKED'));
  }
  if (!req.user.staffRole) {
    return next(
      ApiError.forbidden(
        'This staff account has no role assigned yet. An administrator must grant access.',
        'NO_STAFF_ROLE',
      ),
    );
  }
  return next();
}

/**
 * The real control (§7.6). The nav filter, hidden `+ Create` entries and
 * disabled buttons are a courtesy; this is what actually decides.
 *
 * `admin` bypasses the role system entirely. Everyone else must hold `level`
 * or better on `area`, where `view` is genuinely read-only - it must not reach
 * a mutating route, including an export that writes an audit row.
 */
function requirePermission(area, level = 'view') {
  return async function permissionGuard(req, _res, next) {
    // A support session holds every area. It has no `Role` to consult and
    // inventing one would be a second permission system to keep in step; the
    // grant already bounds what this actor may do, in time rather than in area.
    if (isImpersonating(req)) return next();
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === 'admin') return next();
    if (req.user.role !== 'staff') return next(ApiError.forbidden());
    if (req.user.lockedAt) {
      return next(ApiError.forbidden('This staff account is locked.', 'STAFF_LOCKED'));
    }

    try {
      // Populated per request rather than cached on the user: a role edited in
      // one tab has to bite on the next request in another, and a cached map is
      // how somebody keeps access they were just denied.
      const role = await db().Role.findById(req.user.staffRole);
      if (!role?.allows(area, level)) {
        return next(
          ApiError.forbidden(
            `Your role does not have ${level} access to ${area}.`,
            'PERMISSION_DENIED',
          ),
        );
      }
      req.staffPermissions = role;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** True when this account belongs to Cellvix rather than to a customer. */
function isStaffAccount(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'staff'));
}

/** True when this requester may see wholesale pricing. Used by the product serializer. */
function canSeePricing(user) {
  return Boolean(user && user.status === 'approved');
}

export { authenticate, requireAuth, requireApproved, denyAdmin, requireAdmin, requireStaff, requirePermission, isStaffAccount, canSeePricing };
