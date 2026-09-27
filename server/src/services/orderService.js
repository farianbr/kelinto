import { urlOf } from './storageService.js';
import mongoose from 'mongoose';
import creditService from './creditService.js';
import { db } from '../db/models.js';
import '../models/Order.js';
import '../models/Invoice.js';
import '../models/Product.js';
import '../models/Cart.js';
import '../models/User.js';
import ApiError from '../utils/ApiError.js';
import payment from './payment.js';
import '../models/Offer.js';
import { priceCart, assertBundlesOrderable } from './pricingService.js';
import storeCredit from './storeCreditService.js';
import { sendInvoiceEmail } from './notifications.js';
import notificationService from './notificationService.js';
import '../models/Settings.js';
import Business from '../models/Business.js';

const TERMS_DAYS = { prepaid: 0, net15: 15, net30: 30, net60: 60 };

/** CVX-2026-00043 - sequential per year, readable on a packing slip. */
async function nextOrderNumber() {
  const year = new Date().getFullYear();
  const prefix = `CVX-${year}-`;
  const last = await db().Order.findOne({ orderNumber: new RegExp(`^${prefix}`) })
    .sort({ orderNumber: -1 })
    .select('orderNumber')
    .lean();

  const sequence = last ? Number(last.orderNumber.slice(prefix.length)) + 1 : 10_001;
  return `${prefix}${String(sequence).padStart(5, '0')}`;
}

// The invoice numbering lives in `orderBuilder` - it was written three times
// before that file existed, and a series that two files can advance
// independently is a series that collides.
import { nextInvoiceNumber } from './orderBuilder.js';
import { displayNameOf } from '../utils/displayName.js';

/**
 * Prices the cart.
 *
 * Delegates to `pricingService.priceCart`, which is also what the cart endpoint
 * and the placed order use - so the mini-cart subtotal, the checkout total and
 * the amount charged are one implementation, not three that agree until one of
 * them does not.
 *
 * Always recomputed from live documents. Never from anything the client sent:
 * the checkout page's running total is a preview, this is the number that binds.
 */
async function quote(userId, deliveryCode = 'ground') {
  const cart = await db().Cart.findOne({ user: userId, savedForLater: false });
  if (!cart || (cart.items.length === 0 && (cart.bundles?.length ?? 0) === 0)) {
    throw ApiError.badRequest('Your cart is empty.', 'CART_EMPTY');
  }

  const user = await db().User.findById(userId).lean();
  const priced = await priceCart(cart, user, { deliveryCode });

  if (priced.items.length === 0 && priced.bundles.length === 0) {
    throw ApiError.badRequest('Nothing in your cart is still available.', 'CART_EMPTY');
  }

  // What held credit could cover, so the payment step can offer it. The amount
  // that actually applies is recomputed at order time from the live balance.
  const credit = await storeCredit.previewForTotal(userId, priced.total);

  return {
    ...priced,
    // `unitCost` rides along on a priced line so a placed order can snapshot it
    // (§9.4), but this response is the BUYER's checkout preview - stripping it
    // here keeps our margin off the customer's screen. `cartService` builds its
    // payload from an explicit allowlist and never had the problem.
    items: priced.items.map(({ unitCost, ...line }) => line),
    bundles: priced.bundles.map((bundle) => ({
      ...bundle,
      products: (bundle.products ?? []).map(({ unitCost, ...line }) => line),
    })),
    storeCredit: credit,
    itemCount:
      priced.items.reduce((sum, item) => sum + item.qty, 0) +
      priced.bundles.reduce(
        (sum, bundle) => sum + bundle.products.reduce((n, line) => n + line.qty, 0),
        0,
      ),
  };
}

/**
 * Flattens bundles into order lines.
 *
 * An order and its invoice list SKUs, not abstractions - a warehouse picks
 * parts. Each line keeps its LIST price and carries a `bundle` marker; the
 * difference between list and bundle price is reported once, as
 * `bundleDiscount`, rather than being smeared across lines as fractional cents.
 */
function flattenBundles(bundles) {
  return bundles.flatMap((bundle) =>
    bundle.products.map((line) => ({
      product: line.product,
      sku: line.sku,
      name: line.name,
      slug: line.slug,
      image: urlOf(line.image),
      grade: line.grade,
      partType: line.partType,
      partTypeLabel: line.partTypeLabel,
      brandSlug: line.brandSlug ?? undefined,
      qty: line.qty,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      // Snapshotted the same way a loose line is (§9.4).
      unitCost: line.unitCost,
      bundle: { offer: bundle.offerId, title: bundle.title },
    })),
  );
}

/**
 * Places an order.
 *
 * Order: validate stock -> price -> charge -> decrement stock -> write order and
 * invoice -> empty the cart. The charge happens before stock moves so a decline
 * cannot leave the catalogue short.
 */
async function createOrder(user, input) {
  const priced = await quote(user._id, input.deliveryMethod);

  // A bundle whose offer stopped running, or lost a part, cannot be honoured at
  // the price the buyer was quoted. Refuse with the reason rather than quietly
  // charging list.
  assertBundlesOrderable(priced.bundles);

  // Bundles are flattened here, not in `quote`: a warehouse picks SKUs, so the
  // order and its invoice list parts. The bundle grouping rides along per line.
  const lines = [...priced.items, ...flattenBundles(priced.bundles)];

  // Re-check availability at the moment of purchase, not at add-to-cart.
  const products = await db().Product.find({
    _id: { $in: lines.map((item) => item.product) },
  }).lean();
  const stockById = new Map(products.map((product) => [product._id.toString(), product.stock]));

  // Two bundle lines can reference the same SKU, so demand is summed before it
  // is compared - checking line by line would let a shortfall through.
  const demand = new Map();
  for (const line of lines) {
    const key = line.product.toString();
    demand.set(key, (demand.get(key) ?? 0) + line.qty);
  }

  const short = [...demand.entries()]
    .filter(([id, qty]) => qty > (stockById.get(id) ?? 0))
    .map(([id]) => lines.find((line) => line.product.toString() === id));
  if (short.length > 0) {
    throw ApiError.conflict(
      `Not enough stock for ${short.map((item) => item.sku).join(', ')}. Adjust the quantities and try again.`,
      'INSUFFICIENT_STOCK',
    );
  }

  const orderNumber = await nextOrderNumber();

  // Store credit is spent before the gateway is asked for anything, and how
  // much of it applies is decided here from the live balance - the client sends
  // a flag, never a number (PROJECT_INSTRUCTIONS.md §5.3).
  //
  // Held credit outranks the line of credit: money the business already has with
  // us settles the order before Cellvix lends it any. So on a terms order the
  // flag cannot decline it - the two instruments stay apart, but the order in
  // which they are drawn on is ours, not the buyer's. A card is different: it is
  // the buyer's own money either way, so declining credit against a card is a
  // real choice and the flag is honoured.
  const spendCredit = input.paymentMethod === 'terms' || input.useStoreCredit;
  const creditApplied = spendCredit
    ? Math.min(await storeCredit.balanceOf(user._id), priced.total)
    : 0;
  const dueNow = priced.total - creditApplied;

  // Throws ApiError 402 PAYMENT_DECLINED on a refusal. Nothing has been written
  // and no stock has moved at this point, so the buyer's cart survives intact
  // and the failure page can offer a straight retry.
  //
  // A total covered entirely by store credit never reaches the gateway: there is
  // nothing left to charge, and `payment.charge` rightly refuses a zero amount.
  const result =
    dueNow > 0
      ? await payment.charge({
          amount: dueNow,
          method: input.paymentMethod,
          orderNumber,
          poNumber: input.poNumber,
          // Carries the DECLINE marker on the customer checkout, which no
          // longer collects a PO number. See services/payment.js.
          deliveryNotes: input.deliveryNotes,
        })
      : { status: 'paid', reference: `store_credit_${orderNumber}`, processedAt: new Date() };

  // Decrement in one bulk write so a partial failure does not half-apply.
  await db().Product.bulkWrite(
    [...demand.entries()].map(([id, qty]) => ({
      updateOne: { filter: { _id: id }, update: { $inc: { stock: -qty } } },
    })),
  );

  const billing = input.billingSameAsShipping
    ? input.shippingAddress
    : (input.billingAddress ?? input.shippingAddress);

  /**
   * Which business the sale belongs to.
   *
   * **A storefront order carried no business at all**, which made it invisible
   * to an admin panel scoped to one - the order existed, the customer was
   * charged, and the staff member's list was empty. Every seeded order had one and
   * only checkout did not, so nothing surfaced it until the panel stopped
   * running in "all businesses" mode.
   *
   * The default business is the right answer *today*: the storefront serves one
   * business, and `Business.isDefault` is defined as where an unattributed
   * record lands. When a subdomain or custom domain names the business before
   * the request reaches here (SAAS_PLATFORM §4.2), this reads that instead
   * which is why it resolves through a variable rather than being hard-coded.
   */
  const storefrontBusiness = await Business.findOne({ isDefault: true, deletedAt: null })
    .select('_id')
    .lean();

  const order = await db().Order.create({
    orderNumber,
    business: storefrontBusiness?._id ?? null,
    user: user._id,
    items: lines,
    subtotal: priced.subtotal,
    bundleDiscount: priced.bundleDiscount,
    promoDiscount: priced.promoDiscount,
    discount: priced.discount,
    shipping: priced.shipping,
    tax: priced.tax,
    total: priced.total,
    storeCreditApplied: creditApplied,
    promo: priced.promo
      ? {
          offer: priced.promo.offerId,
          code: priced.promo.code,
          title: priced.promo.title,
          label: priced.promo.label,
          discountType: priced.promo.discountType,
          automatic: priced.promo.automatic,
          amount: priced.promo.amount,
        }
      : undefined,
    bundles: priced.bundles.map((bundle) => ({
      offer: bundle.offerId,
      title: bundle.title,
      qty: bundle.qty,
      bundlePrice: bundle.bundlePrice,
      listTotal: bundle.listTotal,
    })),
    status: 'placed',
    timeline: [{ status: 'placed', at: new Date(), note: 'Order received and confirmed.' }],
    shippingAddress: input.shippingAddress,
    billingAddress: billing,
    deliveryMethod: priced.deliveryMethod,
    deliveryNotes: input.deliveryNotes,
    poNumber: input.poNumber,
    payment: {
      method: dueNow > 0 ? input.paymentMethod : 'store-credit',
      status: result.status,
      mockRef: result.reference,
      paidAt: result.status === 'paid' ? result.processedAt : undefined,
    },
  });

  // The credit is spent against the order that was just written, so the ledger
  // row can name it. A concurrent spend that emptied the balance in between
  // throws INSUFFICIENT_STORE_CREDIT rather than quietly under-charging.
  if (creditApplied > 0) {
    await storeCredit.redeemForOrder({
      userId: user._id,
      total: creditApplied,
      orderId: order._id,
      orderNumber: order.orderNumber,
    });
  }

  const settled = creditApplied + (result.status === 'paid' ? dueNow : 0);
  const termsDays = TERMS_DAYS[user.terms] ?? 0;

  // A tax invoice is raised only against money that actually arrived. An order
  // paid at checkout - by card, by store credit, or by both - is invoiced
  // immediately; one placed on terms is an **amount due** in the `CVX-` series
  // until it is settled, and `invoicePaymentService` renumbers it into `INV-`
  // at that point. Partly settled counts as due: the rest is still owed.
  const fullySettled = settled >= priced.total;

  const invoice = await db().Invoice.create({
    number: await nextInvoiceNumber(fullySettled ? 'INV' : 'CVX'),
    kind: fullySettled ? 'invoice' : 'due',
    // From the order, as in `orderBuilder`: an unscoped invoice is missing from
    // the Invoices screen and present on the customer's profile.
    business: order.business ?? null,
    settledAt: fullySettled ? new Date() : undefined,
    order: order._id,
    user: user._id,
    amount: priced.total,
    // Store credit is a payment against the invoice, not a smaller invoice: the
    // statement should show what the order cost and what settled it.
    amountPaid: settled,
    issuedAt: new Date(),
    dueDate: new Date(Date.now() + termsDays * 86_400_000),
    terms: user.terms,
    // Credit can settle part of a terms order, which is exactly what 'partial'
    // is for - the rest still ages towards its due date.
    status: fullySettled ? 'paid' : settled > 0 ? 'partial' : 'unpaid',
    payments: [
      ...(creditApplied > 0
        ? [
            {
              amount: creditApplied,
              at: new Date(),
              method: 'store-credit',
              reference: `credit_${orderNumber}`,
            },
          ]
        : []),
      ...(result.status === 'paid' && dueNow > 0
        ? [
            {
              amount: dueNow,
              at: result.processedAt,
              method: input.paymentMethod,
              reference: result.reference,
            },
          ]
        : []),
    ],
  });

  // Redemption is counted here and only here. The single-use gate reads order
  // history rather than this counter - the counter exists for `usageLimit`,
  // which is a cap on how many times an offer may be given away in total.
  if (priced.promo) {
    await db().Offer.updateOne({ _id: priced.promo.offerId }, { $inc: { usageCount: 1 } });
  }

  // Buying on terms draws against the LINE OF CREDIT - and only for the part
  // store credit did not already settle.
  //
  // Re-derived from the account's invoices rather than incremented here: the
  // invoice this order just raised *is* what the customer owes, so the sum is
  // the draw. See `creditService` for why the stored counter was abandoned
  // six independent `$inc` sites had already drifted one account to $2,950.96
  // against $2.26 of real debt.
  if (result.status !== 'paid' && dueNow > 0) {
    await creditService.syncBalance(user._id);
  }

  // Remember the free-text fields so they can be offered back next time
  // (brief §7, "smart field memory").
  const memory = {};
  if (input.deliveryNotes) memory['fieldMemory.deliveryNotes'] = input.deliveryNotes;
  if (input.poNumber) memory['fieldMemory.poNumber'] = input.poNumber;
  if (Object.keys(memory).length) await db().User.updateOne({ _id: user._id }, { $set: memory });

  await db().Cart.updateOne(
    { user: user._id, savedForLater: false },
    { $set: { items: [], bundles: [], promoCode: '' } },
  );

  // The invoice goes out by email the moment the order is placed. Deliberately
  // not awaited: the order is already written, paid and stock-adjusted, so a
  // slow or dead mail host must not hold the checkout response open - and
  // `sendInvoiceEmail` never rejects, it logs the failure and returns.
  //
  // Gated by Settings since phase 11e, so the Email Settings toggle governs a
  // real path rather than a stored boolean. The read is inside the fire-and-
  // forget too: a settings lookup must not delay the response either.
  void (async () => {
    const settings = await db().Settings.load();
    if (settings?.communications?.invoiceOnOrder === false) return;
    await sendInvoiceEmail({ invoice, order, user });
  })().catch(() => {});

  // The bell (§7.3). Awaited rather than fired-and-forgotten like the mail
  // above: this is a local write with no network in it, and an order that
  // appeared on a screen before it appeared in the bell would have staff
  // working from two different pictures of the same minute.
  await notificationService.emit({
    type: 'new_order',
    severity: 'success',
    title: `Order ${orderNumber} placed`,
    detail: `${displayNameOf(user)} · ${formatCad(priced.total)}`,
    entity: { kind: 'order', id: orderNumber, label: orderNumber },
    href: `/admin/orders/${orderNumber}`,
  });

  return order;
}

/** Cents to `$1,234.56`, for notification copy. */
function formatCad(cents) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(
    (cents ?? 0) / 100,
  );
}

function serializeOrder(order) {
  const doc = order.toObject ? order.toObject() : order;
  return {
    id: doc._id.toString(),
    orderNumber: doc.orderNumber,
    // `unitCost` is stripped here, deliberately. It is what Cellvix pays the
    // supplier, and this serializer feeds the BUYER's order page - spreading
    // the line wholesale would put our margin on the customer's screen. The
    // reports read it from the documents directly, admin-side.
    items: doc.items.map(({ unitCost, ...item }) => ({
      ...item,
      product: item.product?.toString?.() ?? item.product,
    })),
    subtotal: doc.subtotal,
    bundleDiscount: doc.bundleDiscount ?? 0,
    promoDiscount: doc.promoDiscount ?? 0,
    discount: doc.discount ?? 0,
    promo: doc.promo?.code || doc.promo?.title ? doc.promo : null,
    bundles: (doc.bundles ?? []).map((bundle) => ({
      ...bundle,
      offer: bundle.offer?.toString?.() ?? bundle.offer,
    })),
    storeCreditApplied: doc.storeCreditApplied ?? 0,
    refundedTotal: doc.refundedTotal ?? 0,
    shipping: doc.shipping,
    tax: doc.tax,
    total: doc.total,
    status: doc.status,
    timeline: doc.timeline,
    shippingAddress: doc.shippingAddress,
    billingAddress: doc.billingAddress,
    deliveryMethod: doc.deliveryMethod,
    deliveryNotes: doc.deliveryNotes,
    poNumber: doc.poNumber,
    payment: { method: doc.payment?.method, status: doc.payment?.status, paidAt: doc.payment?.paidAt },
    tracking: doc.tracking,
    createdAt: doc.createdAt,
  };
}

async function listOrders(userId, { limit = 50 } = {}) {
  const orders = await db().Order.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean();
  return orders.map(serializeOrder);
}

async function getOrder(userId, orderNumber) {
  const order = await db().Order.findOne({ orderNumber, user: userId }).lean();
  if (!order) throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');
  return serializeOrder(order);
}

export { quote, createOrder, serializeOrder, listOrders, getOrder, mongoose };
