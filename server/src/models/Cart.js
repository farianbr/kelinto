import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    qty: { type: Number, required: true, min: 1 },
    // Snapshotted so a mid-session price change is visible rather than silent.
    priceAtAdd: { type: Number, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * A combo sitting in the cart.
 *
 * Held as one line referencing the offer, NOT as loose products: a bundle is
 * priced as a unit, and letting a buyer change one part's quantity would leave
 * a "bundle" that no longer matches the bundle being charged for. The member
 * products are expanded at read time from the live offer, so an admin editing a
 * combo cannot leave a stale copy of it sitting in someone's cart.
 */
const cartBundleSchema = new mongoose.Schema(
  {
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', required: true },
    qty: { type: Number, required: true, min: 1 },
    priceAtAdd: { type: Number, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * A pre-owned phone sitting in the cart.
 *
 * Its own line, not a product line: it is one physical handset with no
 * quantity (`models/PreownedDevice.js`). It is not reserved by being here; the
 * order that reaches checkout first takes it, and the cart says so to the other.
 */
const cartPreownedSchema = new mongoose.Schema(
  {
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'PreownedDevice', required: true },
    priceAtAdd: { type: Number, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * A repair service sitting in the cart (2026-10-01).
 *
 * Its own line, like a phone: labour has no stock, no grade and no shipping,
 * and the price comes from the business's own service list at read time
 * (`pricingService.expandServices`).
 */
const cartServiceSchema = new mongoose.Schema(
  {
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    qty: { type: Number, required: true, min: 1, max: 20 },
    priceAtAdd: { type: Number, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * A membership plan in the cart (client ruling, 2026-10-02).
 *
 * "Subscribe" is bought like anything else on the website: it goes in the
 * cart, through checkout, becomes an order and raises an invoice. One plan at
 * most, so it is a single sub-document rather than a list; choosing another
 * plan replaces it. Priced from Settings at read time
 * (`pricingService.expandMembership`), never from `priceAtAdd`.
 */
const cartMembershipSchema = new mongoose.Schema(
  {
    tier: { type: String, enum: ['silver', 'gold', 'platinum'], required: true },
    priceAtAdd: { type: Number, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: [cartItemSchema],
    bundles: [cartBundleSchema],
    preowned: [cartPreownedSchema],
    services: [cartServiceSchema],
    membership: { type: cartMembershipSchema, default: undefined },

    // At most one. Offers do not stack (PROJECT_INSTRUCTIONS.md §5.9), so this
    // is a single string rather than a list, and applying a new code replaces
    // whatever was here.
    promoCode: { type: String, default: '' },

    // "Save cart for later" from the flyout parks a named copy.
    savedForLater: { type: Boolean, default: false },
    name: String,
  },
  { timestamps: true },
);

// A user has exactly one active cart, plus any number of saved ones.
cartSchema.index({ user: 1, savedForLater: 1 });

const Cart = mongoose.model('Cart', cartSchema);

export { Cart };
export default Cart;
