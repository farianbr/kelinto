import jwt from 'jsonwebtoken';

import SuperAdmin from '../models/SuperAdmin.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { SUPERADMIN_COOKIE, clearSuperAdminSession } from '../services/superAdminService.js';

/**
 * The super-admin console's guard (SAAS_PLATFORM §4.5).
 *
 * The mirror of `middleware/supplierAuth.js`, reading a **third cookie into a
 * third collection**, and the security argument is the same one a level up.
 * A token minted for the console cannot satisfy `requireAuth` - not because
 * every tenant route was audited, but because `authenticate` reads
 * `env.COOKIE_NAME` and resolves its subject in `User`, where no super admin
 * exists. The reverse holds: an admin's token carries a `User` id, and this
 * refuses a subject that is not a live super admin.
 *
 * `kind: 'superadmin'` is checked on the payload as well as the collection. All
 * three cookies are signed with the same `JWT_SECRET`, so without it a buyer's
 * token pasted into this cookie would resolve to whatever `SuperAdmin` document
 * happened to share that id - vanishingly unlikely, and still not a thing to
 * leave to chance.
 *
 * **`isActive` is re-checked on every request**, not only at sign-in. A
 * deactivated account keeps a validly signed token until it expires, and
 * revoking platform-level access has to bite immediately rather than in seven
 * days.
 */
async function authenticateSuperAdmin(req, res, next) {
  const token = req.cookies?.[SUPERADMIN_COOKIE];
  req.superAdmin = null;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload.kind !== 'superadmin') {
      clearSuperAdminSession(res);
      return next();
    }

    const admin = await SuperAdmin.findById(payload.sub);
    // A token older than the last password reset is dead, whatever its expiry.
    const revoked = admin?.sessionsValidFrom && payload.iat * 1000 < admin.sessionsValidFrom.getTime();
    if (!admin?.isActive || revoked) {
      clearSuperAdminSession(res);
      return next();
    }

    req.superAdmin = admin;
    return next();
  } catch {
    // An expired or tampered token is a signed-out visitor, not an error: the
    // console asks who is signed in on every load, exactly as `/auth/me` does.
    clearSuperAdminSession(res);
    return next();
  }
}

/** Refuses anybody who is not a signed-in super admin. */
function requireSuperAdmin(req, _res, next) {
  if (!req.superAdmin) {
    return next(
      ApiError.unauthorized('Sign in to the console to do that.', 'SUPERADMIN_REQUIRED'),
    );
  }
  return next();
}

export { authenticateSuperAdmin, requireSuperAdmin };
export default requireSuperAdmin;
