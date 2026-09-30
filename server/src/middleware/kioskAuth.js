import jwt from 'jsonwebtoken';

import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { KIOSK_COOKIE } from '../services/kioskService.js';

/**
 * The kiosk session gate.
 *
 * The mirror of `middleware/supplierAuth.js`, reading a **different cookie into
 * a different kind of subject**, and for the same reason: every cookie in this
 * system is signed with one `JWT_SECRET`, so without the `kind` check a buyer's
 * token would be accepted here. A tablet in a shop window must not be able to
 * act with somebody's session.
 *
 * **It carries no user.** Nobody is signed in at a kiosk - the token says only
 * that a member of staff entered the shop's PIN on this tablet today. So this
 * sets no `req.user`, and everything behind it is limited to what a customer
 * standing at a counter may write.
 */
export function readKioskSession(req) {
  const token = req.cookies?.[KIOSK_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    // A valid token of the wrong kind is no session at all.
    return payload.kind === 'kiosk' ? payload : null;
  } catch {
    return null;
  }
}

export function requireKiosk(req, res, next) {
  const payload = readKioskSession(req);
  if (!payload) {
    // Refused as locked rather than as forbidden, whatever was wrong with the
    // token: the tablet's only remedy is the PIN screen either way.
    return next(ApiError.unauthorized('This kiosk is locked.', 'KIOSK_LOCKED'));
  }

  req.kiosk = { businessId: payload.sub };
  return next();
}

export default requireKiosk;
