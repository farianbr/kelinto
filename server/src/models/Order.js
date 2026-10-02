import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    // Denormalised so an order stays readable even if the catalogue changes later.
    sku: String,
    name: String,
    slug: String,
    image: String,
    grade: String,
    // Kept so the order history can render the same part illustration as the grid.
    partType: String,
    partTypeLabel: String,
    // Snapshotted alongside them for the same reason: the storefront picks a
    // part's stock photo from brand + part type, and an order placed today
    // should keep showing the picture it showed when it was placed.
    brandSlug: String,
    qty: { type: Number, required: true },
    // Always the LIST price. Savings live in `bundleDiscount` / `promoDiscount`
    // rather than being folded in here, so an invoice can show what a part costs
    // and what came off it - which is what a business buyer reconciles against.
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },

    // What the part cost Cellvix, snapshotted at order time from `Product.cost`
    // (ERP rework §9.4). Margin has to survive a later cost change: joining to
    // the product at report time would let a price negotiated in June silently
    // rewrite the margin on a sale that happened in March.
    //
    // **Undefined, not zero, when unknown.** Orders placed before cost was
    // tracked have no honest value here, and a zero would read as "this part
    // was free" - a 100% margin. Every report distinguishes the two and says
    // how many lines it could not cost.
    unitCost: Number,
    // Set on lines that arrived as part of a combo, so the order page can group
    // them the way the cart did.
    bundle: {
      offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
      title: String,
    },
    // Set on a pre-owned phone's line instead of `product`: one handset, sold
    // once, with its stock number as the SKU.
    preowned: { type: mongoose.Schema.Types.ObjectId, ref: 'PreownedDevice' },
    // Set on a repair service's line instead of `product` (2026-10-01): labour
    // bought on the website, carried out at the counter. No stock moves.
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    // Set on a membership plan's line (2026-10-02): the tier bought. Placing
    // the order moves the account onto it (`orderService.activateMembership`).
    membership: { type: String, enum: ['silver', 'gold', 'platinum'] },
  },
  { _id: false },
);

const addressSnapshot = new mongoose.Schema(
  {
    contactName: String,
    company: String,
    line1: String,
    line2: String,
    city: String,
    region: String,
    postal: String,
    country: String,
    phone: String,
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true }, // CVX-2026-00042
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /**
     * Which shop this order belongs to.
     *
     * Set at checkout from the business the staff member is working in, or chosen
     * explicitly when a customer wants to collect from - or be delivered by
     * a particular shop. Null on an order placed before businesses were scoped,
     * which reads as the default business rather than as missing data.
     */
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },

    items: [orderItemSchema],

    subtotal: { type: Number, required: true }, // list value of every line
    bundleDiscount: { type: Number, default: 0 },
    promoDiscount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 }, // bundleDiscount + promoDiscount
    tax: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    total: { type: Number, required: true },

    // The ONE offer that applied. Indexed because single-use redemption is
    // checked against order history rather than a counter (pricingService).
    promo: {
      offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', index: true },
      code: String,
      title: String,
      label: String,
      discountType: String,
      automatic: Boolean,
      amount: Number,
    },

    // What the buyer bought as bundles, kept for the order page and the invoice.
    bundles: [
      {
        offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
        title: String,
        qty: Number,
        bundlePrice: Number,
        listTotal: Number,
        _id: false,
      },
    ],

    status: {
      type: String,
      enum: ['placed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'],
      default: 'placed',
      index: true,
    },
    // Drives the visual stepper AND the full text breakdown on the account page.
    timeline: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        note: String,
        _id: false,
      },
    ],

    shippingAddress: addressSnapshot,
    billingAddress: addressSnapshot,
    deliveryMethod: {
      code: String,
      label: String,
      cost: Number,
      etaDays: Number,
    },
    deliveryNotes: String,
    poNumber: String,

    // Store credit spent on this order, and credit refunded back out of it.
    // Both are integer cents and both are written by storeCreditService.
    storeCreditApplied: { type: Number, default: 0 },
    refundedTotal: { type: Number, default: 0 },

    payment: {
      // 'store-credit' is the method when held credit covered the whole total
      // and the gateway was never called.
      // `counter`: placed on the kiosk, picked up and paid for in the shop.
      method: { type: String, enum: ['card', 'terms', 'ach', 'store-credit', 'counter'], default: 'card' },
      status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
      // Reference from the mock gateway. Swap for a real charge id later.
      mockRef: String,
      paidAt: Date,
    },

    tracking: {
      carrier: String,
      number: String,
      url: String,
    },
  },
  { timestamps: true },
);

orderSchema.index({ user: 1, createdAt: -1 });

const Order = mongoose.model('Order', orderSchema);

export { Order };
export default Order;
