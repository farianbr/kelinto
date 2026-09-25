import jwt from 'jsonwebtoken';

import { db } from '../db/models.js';
import { currentBusinessId } from '../db/context.js';
import '../models/Supplier.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { SUPPLIER_COOKIE, clearSupplierSession } from '../services/supplierPortalService.js';

/**
 * The supplier portal's guard (supplier process flow, §6.8a).
 *
 * The mirror of `middleware/auth.js`, reading a **different cookie into a
 * different collection**. A token minted for a supplier cannot satisfy
 * `requireAuth`, not because every buyer and admin route was audited, but
 * because `authenticate` reads another cookie and resolves the subject in
 * `User`, where no supplier exists. The guarantee is structural.
 *
 * **One business per session** (2026-09-25). `req.supplier` is set only when
 * the business the session names IS the business this request's host opened.
 * The cookie is host-only, so that is already true in practice; checking it
 * anyway means a session can never read one business's record through
 * another's database. A token of any older kind (the retired cross-business
 * `supplier-account` sessions included) is cleared, and the supplier signs in
 * again at the business's address.
 *
 * The record is re-read on every request, so a business pausing a supplier or
 * removing their portal access ends it now, not when the cookie expires.
 */
async function authenticateSupplier(req, res, next) {
  const token = req.cookies?.[SUPPLIER_COOKIE];
  req.supplier = null;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    const opened = currentBusinessId();
    if (payload.kind !== 'supplier' || !payload.biz || !opened || String(opened) !== String(payload.biz)) {
      clearSupplierSession(res);
      return next();
    }

    // `db()`, not the imported model: `Supplier` is per-business. "Has a
    // password" is asked in the query, so the hash is never loaded onto a
    // document a route might later save.
    const supplier = await db().Supplier.findOne({
      _id: payload.sub,
      isActive: true,
      passwordHash: { $exists: true, $ne: null },
    });
    if (supplier) {
      req.supplier = supplier;
    } else {
      clearSupplierSession(res);
    }
  } catch {
    clearSupplierSession(res);
  }

  return next();
}

/** A signed-in supplier - what every portal screen past sign-in needs. */
function requireSupplier(req, _res, next) {
  if (!req.supplier) {
    return next(ApiError.unauthorized('Sign in to the supplier portal to do that.', 'SUPPLIER_NOT_AUTHENTICATED'));
  }
  return next();
}

export { authenticateSupplier, requireSupplier };
