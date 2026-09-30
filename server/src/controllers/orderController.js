import ApiError, { asyncHandler } from '../utils/ApiError.js';
import { readKioskSession } from '../middleware/kioskAuth.js';
import * as orderService from '../services/orderService.js';

/**
 * The binding price of the current cart.
 *
 * Every figure the checkout page shows comes from here - including the discount
 * breakdown, because a total the buyer cannot reconcile line by line is a total
 * they will query.
 */
const quote = asyncHandler(async (req, res) => {
  const priced = await orderService.quote(req.user._id, req.query.deliveryMethod);
  res.json({
    subtotal: priced.subtotal,
    bundleDiscount: priced.bundleDiscount,
    promoDiscount: priced.promoDiscount,
    discount: priced.discount,
    promo: priced.promo,
    promoNotice: priced.promoNotice,
    bundles: priced.bundles.map((bundle) => ({
      offerId: bundle.offerId,
      title: bundle.title,
      qty: bundle.qty,
      lineTotal: bundle.lineTotal,
      listTotal: bundle.listTotal,
      available: bundle.available,
      reason: bundle.reason,
    })),
    shipping: priced.shipping,
    tax: priced.tax,
    total: priced.total,
    // What held store credit could put against this total. A preview: the
    // amount that actually applies is recomputed when the order is placed.
    storeCredit: priced.storeCredit,
    deliveryMethod: priced.deliveryMethod,
    // The bands this quote priced against, so the checkout picker shows the
    // same rates that produced the total rather than the shared constant's
    // copy, which a staff member can now edit out from under it (§6.15).
    deliveryOptions: priced.deliveryOptions,
    itemCount: priced.itemCount,
  });
});

const create = asyncHandler(async (req, res) => {
  /**
   * "Pay at the counter" is the kiosk's, and only the kiosk's.
   *
   * Checked here against the tablet's own session cookie, not against anything
   * in the body: a customer at home could otherwise send `counter` and walk
   * away with stock reserved and nothing charged. The tablet's cookie is set
   * only by staff entering the shop PIN.
   */
  if (req.body.paymentMethod === 'counter' && !readKioskSession(req)) {
    throw ApiError.forbidden(
      'Paying at the counter is only available on the in-store kiosk.',
      'PAYMENT_METHOD_UNAVAILABLE',
    );
  }

  const order = await orderService.createOrder(req.user, req.body);
  res.status(201).json({ order: orderService.serializeOrder(order) });
});

const list = asyncHandler(async (req, res) => {
  res.json({ orders: await orderService.listOrders(req.user._id) });
});

const detail = asyncHandler(async (req, res) => {
  res.json({ order: await orderService.getOrder(req.user._id, req.params.orderNumber) });
});

export { quote, create, list, detail };
