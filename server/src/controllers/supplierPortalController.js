import { randomBytes } from 'node:crypto';
import { asyncHandler } from '../utils/ApiError.js';
import * as supplierPortalService from '../services/supplierPortalService.js';
import * as purchaseBidService from '../services/purchaseBidService.js';
import Business from '../models/Business.js';
import { surfaceFor } from '../utils/surface.js';
import { DEFAULT_BUSINESS_COLOR, migrateColorToken } from '../../../shared/businessPalette.js';

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
 * Who am I. `null` rather than a 401 - the portal shell asks on every load.
 *
 * It also answers **whose portal this is**, which the shell needs for two
 * separate reasons: to paint itself in the buying business's colour, and to
 * name that business on a sign-in page that would otherwise ask a supplier for
 * credentials without saying who is asking.
 *
 * Resolved from `req.businessScope` - the host, or the `x-business` header in
 * development - rather than from the supplier, because a supplier record has
 * no `business` field: suppliers are separated by which database they live in,
 * not by a field on the document. The answer is therefore the same signed in
 * or out, which is what lets the sign-in page carry it.
 */
const me = asyncHandler(async (req, res) => {
  // Signed in: the account, the business it is working in, and the rest of
  // its businesses and invitations - everything the shell and its switcher show.
  if (req.supplierAccount) {
    res.json(
      await supplierPortalService.portalState(req.supplierAccount, req.supplier, req.businessScope),
    );
    return;
  }

  /**
   * Signed out. On a business's own host the sign-in page names that business,
   * as it always has. On the shared admin host there is no business to name -
   * every business's suppliers sign in there - and naming the default one would
   * be the wrong company asking for a password.
   */
  const named = surfaceFor(req.get('host')) !== 'panel' && req.businessScope;
  const business = named
    ? await Business.findById(req.businessScope).select('name colorToken').lean()
    : null;

  res.json({
    account: null,
    supplier: null,
    business: business
      ? { id: null, name: business.name, colorToken: migrateColorToken(business.colorToken) }
      : { id: null, name: null, colorToken: DEFAULT_BUSINESS_COLOR },
    businesses: [],
    invitations: [],
  });
});

/** Work inside another business the account is active with. */
const switchBusiness = asyncHandler(async (req, res) => {
  res.json(await supplierPortalService.switchBusiness(req.supplierAccount, req.body.business, res));
});

const acceptInvitation = asyncHandler(async (req, res) => {
  res.json(
    await supplierPortalService.respondToInvitation(req.supplierAccount, req.params.business, true, res),
  );
});

const declineInvitation = asyncHandler(async (req, res) => {
  res.json(
    await supplierPortalService.respondToInvitation(req.supplierAccount, req.params.business, false, res),
  );
});

const forgotPassword = asyncHandler(async (req, res) => {
  res.json(await supplierPortalService.requestReset(req.body.email));
});

const resetPassword = asyncHandler(async (req, res) => {
  res.json(await supplierPortalService.resetPassword(req.body));
});

const changePassword = asyncHandler(async (req, res) => {
  // The account's password - one login across every business it supplies.
  res.json(await supplierPortalService.changePassword(req.supplierAccount._id, req.body));
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
  acceptInvitation,
  changePassword,
  declineInvitation,
  switchBusiness,
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
