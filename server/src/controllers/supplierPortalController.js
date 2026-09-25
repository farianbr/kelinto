import { randomBytes } from 'node:crypto';
import { asyncHandler } from '../utils/ApiError.js';
import * as supplierPortalService from '../services/supplierPortalService.js';
import * as purchaseBidService from '../services/purchaseBidService.js';

/**
 * The supplier portal (supplier process flow, §6.8a).
 *
 * Every handler below reads `req.supplier`, which only
 * `middleware/supplierAuth.js` sets - never `req.user`. That is what keeps a
 * signed-in buyer or admin from reaching a supplier's requests by holding the
 * wrong cookie, and a supplier from reaching anything else.
 */

// ---- session ----------------------------------------------------------------

const login = asyncHandler(async (req, res) => {
  res.json(await supplierPortalService.login(req.body, res));
});

const logout = asyncHandler(async (req, res) => {
  res.json(supplierPortalService.logout(res));
});

/**
 * Who am I, and whose portal is this. `null` rather than a 401: the portal
 * shell asks on every load.
 *
 * **Whose portal** comes from the host (`req.businessScope`), the same signed in
 * or out, so the sign-in page can greet the supplier in the business's name and
 * colour before anybody has typed anything. A supplier record has no
 * `business` field: suppliers are separated by which database they live in.
 */
const me = asyncHandler(async (req, res) => {
  res.json(await supplierPortalService.portalState(req.supplier, req.businessScope));
});

const forgotPassword = asyncHandler(async (req, res) => {
  res.json(await supplierPortalService.requestReset(req.body.email));
});

const resetPassword = asyncHandler(async (req, res) => {
  res.json(await supplierPortalService.resetPassword(req.body));
});

const changePassword = asyncHandler(async (req, res) => {
  // This business's portal password; the supplier's login at any other business is separate.
  res.json(await supplierPortalService.changePassword(req.supplier._id, req.body));
});

// ---- purchase orders this supplier was asked to price ----------------------

const listOrders = asyncHandler(async (req, res) => {
  res.json(await purchaseBidService.listForSupplier(req.supplier._id));
});

const getOrder = asyncHandler(async (req, res) => {
  res.json(await purchaseBidService.getForSupplier(req.params.id, req.supplier._id));
});

const submitQuote = asyncHandler(async (req, res) => {
  res.json(await purchaseBidService.submitBid(req.params.id, req.supplier._id, req.body));
});

const declineQuote = asyncHandler(async (req, res) => {
  res.json(await purchaseBidService.declineBid(req.params.id, req.supplier._id, req.body));
});

const submitProforma = asyncHandler(async (req, res) => {
  res.json(await purchaseBidService.submitProforma(req.params.id, req.supplier._id, req.body));
});

const setDeliveryStatus = asyncHandler(async (req, res) => {
  res.json(await purchaseBidService.setDeliveryStatus(req.params.id, req.supplier._id, req.body));
});

/**
 * The supplier's own proforma invoice, as a printable sheet.
 *
 * `req.supplier._id` is the session's, never a parameter, so a supplier can
 * only ever render their own - the same guarantee the JSON serializer gives.
 */
const proformaDocument = asyncHandler(async (req, res) => {
  const nonce = randomBytes(16).toString('base64');
  const html = await purchaseBidService.proformaDocument(req.params.id, req.supplier._id, {
    nonce,
  });

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      'img-src data:',
      `script-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  );
  res.type('html').send(html);
});

export {
  changePassword,
  declineQuote,
  forgotPassword,
  getOrder,
  listOrders,
  login,
  logout,
  me,
  proformaDocument,
  resetPassword,
  setDeliveryStatus,
  submitProforma,
  submitQuote,
};
