import jwt from 'jsonwebtoken';

import { controlModels, db } from '../db/models.js';
import { currentBusinessId } from '../db/context.js';
import '../models/Supplier.js';
import '../models/SupplierAccount.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { SUPPLIER_COOKIE, clearSupplierSession } from '../services/supplierPortalService.js';

/**
 * The supplier portal's guard (supplier process flow, §6.8a).
 *
 * The mirror of `middleware/auth.js`, reading a **different cookie into a
 * different collection**. A token minted for a supplier cannot satisfy
 * `requireAuth` - not because every buyer and admin route was audited, but
 * because `authenticate` reads another cookie and resolves the subject in
 * `User`, where no supplier exists. The guarantee is structural.
 *
 * ## Two things it sets
 *
 * - `req.supplierAccount` - the platform-wide login (`SupplierAccount`). Enough
 *   for the account's own screens: which businesses, which invitations.
 * - `req.supplier` - that business's `Supplier` record, for the business the
 *   session is working in. What every order, bid and agreement screen reads,
 *   exactly as before.
 *
 * `req.supplier` is set only when the database this request opened IS the
 * business the session names (`resolveBusiness` opens it from the supplier
 * cookie on portal paths) and the link is active and the business still has
 * them active. Any mismatch leaves it null - signed in to the account, not to a
 * business - rather than reading one business's record through another's
 * connection.
 *
 * `kind` is checked on the payload as well as the collection: every cookie is
 * signed with the same secret, so without it a buyer's token pasted here could
 * resolve to whatever account happened to share its id. A token of the old
 * `supplier` kind, from before accounts existed, is cleared and the supplier
 * signs in again.
 */
async function authenticateSupplier(req, res, next) {
  const token = req.cookies?.[SUPPLIER_COOKIE];
  req.supplier = null;
  req.supplierAccount = null;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload.kind !== 'supplier-account') {
      clearSupplierSession(res);
      return next();
    }

    const account = await controlModels().SupplierAccount.findById(payload.sub);
    if (!account?.isActive) {
      clearSupplierSession(res);
      return next();
    }
    req.supplierAccount = account;

    const link = account.linkFor(payload.biz);
    const opened = currentBusinessId();
    if (link?.status === 'active' && opened && String(opened) === String(payload.biz)) {
      // `db()`, not the imported model: `Supplier` is per-business, and the
      // imported model is bound to the control database, where none exists.
      const supplier = await db().Supplier.findById(link.supplier);
      // Re-checked every request, not only at sign-in: a business ending the
      // relationship must end the access now, not when the cookie expires.
      if (supplier?.isActive) req.supplier = supplier;
    }
  } catch {
    clearSupplierSession(res);
  }

  return next();
}

/** A supplier working inside a business - what the order and agreement screens need. */
function requireSupplier(req, _res, next) {
  if (!req.supplier) {
    return next(
      ApiError.unauthorized('Sign in to the supplier portal to do that.', 'SUPPLIER_NOT_AUTHENTICATED'),
    );
  }
  return next();
}

/** Signed in to the account, whether or not a business is chosen yet. */
function requireSupplierAccount(req, _res, next) {
  if (!req.supplierAccount) {
    return next(
      ApiError.unauthorized('Sign in to the supplier portal to do that.', 'SUPPLIER_NOT_AUTHENTICATED'),
    );
  }
  return next();
}

export { authenticateSupplier, requireSupplier, requireSupplierAccount };
