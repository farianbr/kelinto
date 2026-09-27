import { urlOf } from './storageService.js';
import { db } from '../db/models.js';
import '../models/Cart.js';
import '../models/Product.js';
import ApiError from '../utils/ApiError.js';
import { canSeePricing } from '../middleware/auth.js';
import '../models/Offer.js';
import { offerStatus } from './offerService.js';
import { OfferRejection, priceCart, resolveCode } from './pricingService.js';
import { formatDate } from '../../../shared/dates.js';

/** A user has exactly one active cart. Saved carts are separate documents. */
async function getOrCreateCart(userId) {
  let cart = await db().Cart.findOne({ user: userId, savedForLater: false });
  if (!cart) cart = await db().Cart.create({ user: userId, items: [] });
  return cart;
}

/**
 * Shapes a cart for the wire.
 *
 * Every number here comes from `pricingService.priceCart`, which is also what
 * the checkout quote and the placed order run through - so the subtotal in the
 * mini-cart, the total at checkout and the amount charged are the same
 * arithmetic on the same live documents, not three implementations that agree
 * until one of them does not.
 *
 * Price gating still applies: a pending user gets their lines with no money at
 * all, and never reaches the pricing engine.
 */
async function serialize(cart, user) {
  const showPricing = canSeePricing(user);

  if (!showPricing) return serializeUnpriced(cart);

  const priced = await priceCart(cart, user);

  const items = priced.items.map((line) => ({
    productId: line.product.toString(),
    sku: line.sku,
    name: line.name,
    slug: line.slug,
    image: urlOf(line.image),
    partType: line.partType,
    partTypeLabel: line.partTypeLabel,
    brandSlug: line.brandSlug ?? null,
    grade: line.grade,
    modelName: line.modelName,
    qty: line.qty,
    stock: line.stock,
    inStock: line.inStock,
    exceedsStock: line.exceedsStock,
    priceVisible: true,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    priceAtAdd: line.priceAtAdd,
    priceChanged: line.priceChanged,
  }));

  const bundleUnits = priced.bundles.reduce(
    (sum, bundle) => sum + bundle.products.reduce((n, line) => n + line.qty, 0),
    0,
  );

  return {
    id: cart._id.toString(),
    items,
    bundles: priced.bundles,
    // The badge counts parts, so a bundle contributes the parts inside it
    // "3 items" that turns into six things in a box is a bad surprise.
    count: items.reduce((sum, item) => sum + item.qty, 0) + bundleUnits,
    subtotal: priced.subtotal,
    bundleDiscount: priced.bundleDiscount,
    promoDiscount: priced.promoDiscount,
    discount: priced.discount,
    payable: priced.subtotal - priced.discount,
    promo: priced.promo,
    promoNotice: priced.promoNotice,
    promoCode: priced.promoCode,
    priceVisible: true,
    /**
     * The default shipping band, so the cart's preview arithmetic reads the
     * live rate rather than a hard-coded one.
     *
     * The cart's shipping and tax lines are explicitly a preview - the binding
     * numbers come from `/orders/quote` - but a preview built on a constant
     * stops matching the moment a staff member edits the rate in Settings
     * (§6.15), and "free shipping over $500" is exactly the kind of promise a
     * page must not make out of a stale number.
     */
    shippingPreview: (() => {
      // Ground by name, not by position: the bands are an editable list and
      // reordering them must not silently change which one the cart previews.
      const band =
        priced.deliveryOptions.find((option) => option.code === 'ground') ??
        priced.deliveryOptions[0];
      return band ? { cost: band.cost, freeOver: band.freeOver } : null;
    })(),
    updatedAt: cart.updatedAt,
  };
}

/** The pending / unapproved shape: lines and quantities, no money anywhere. */
async function serializeUnpriced(cart) {
  const products = await db().Product.find({
    _id: { $in: cart.items.map((item) => item.product) },
  }).lean();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  const items = [];
  for (const item of cart.items) {
    const product = byId.get(item.product.toString());
    if (!product || !product.isActive) continue;

    items.push({
      productId: product._id.toString(),
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      image: product.image ?? null,
      partType: product.partType,
      partTypeLabel: product.partTypeLabel,
      brandSlug: product.brandSlug ?? null,
      grade: product.grade,
      modelName: product.modelName,
      qty: item.qty,
      stock: product.stock,
      inStock: product.stock > 0,
      exceedsStock: item.qty > product.stock,
      priceVisible: false,
    });
  }

  return {
    id: cart._id.toString(),
    items,
    bundles: [],
    count: items.reduce((sum, item) => sum + item.qty, 0),
    subtotal: null,
    bundleDiscount: null,
    promoDiscount: null,
    discount: null,
    payable: null,
    promo: null,
    promoNotice: null,
    promoCode: '',
    priceVisible: false,
    updatedAt: cart.updatedAt,
  };
}

async function requireProduct(productId) {
  const product = await db().Product.findById(productId);
  if (!product || !product.isActive) {
    throw ApiError.notFound('That part is no longer listed.', 'PRODUCT_NOT_FOUND');
  }
  return product;
}

async function addItem(userId, productId, qty) {
  const product = await requireProduct(productId);
  const cart = await getOrCreateCart(userId);

  const existing = cart.items.find((item) => item.product.toString() === productId);
  if (existing) {
    existing.qty = Math.min(9999, existing.qty + qty);
  } else {
    cart.items.push({ product: product._id, qty, priceAtAdd: product.price });
  }

  await cart.save();
  return cart;
}

async function setQty(userId, productId, qty) {
  const cart = await getOrCreateCart(userId);

  if (qty === 0) {
    cart.items = cart.items.filter((item) => item.product.toString() !== productId);
  } else {
    const existing = cart.items.find((item) => item.product.toString() === productId);
    if (!existing) {
      const product = await requireProduct(productId);
      cart.items.push({ product: product._id, qty, priceAtAdd: product.price });
    } else {
      existing.qty = qty;
    }
  }

  await cart.save();
  return cart;
}

async function removeItem(userId, productId) {
  const cart = await getOrCreateCart(userId);
  cart.items = cart.items.filter((item) => item.product.toString() !== productId);
  await cart.save();
  return cart;
}

async function clearCart(userId) {
  const cart = await getOrCreateCart(userId);
  cart.items = [];
  cart.bundles = [];
  // A code attached to a cart that no longer exists would silently re-apply to
  // whatever is added next.
  cart.promoCode = '';
  await cart.save();
  return cart;
}

/**
 * Folds a guest's localStorage cart into the account's cart on sign-in.
 * Quantities are summed, not replaced - a buyer who added two screens as a
 * guest and one on their phone should end up with three.
 */
async function mergeGuestCart(userId, guestItems) {
  if (!guestItems?.length) return getOrCreateCart(userId);

  const cart = await getOrCreateCart(userId);
  const products = await db().Product.find({
    _id: { $in: guestItems.map((item) => item.productId) },
    isActive: true,
  });
  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  for (const guestItem of guestItems) {
    const product = byId.get(guestItem.productId);
    if (!product) continue;

    const existing = cart.items.find((item) => item.product.toString() === guestItem.productId);
    if (existing) {
      existing.qty = Math.min(9999, existing.qty + guestItem.qty);
    } else {
      cart.items.push({ product: product._id, qty: guestItem.qty, priceAtAdd: product.price });
    }
  }

  await cart.save();
  return cart;
}

/** Parks a copy of the active cart and empties the live one. */
async function saveForLater(userId, name) {
  const cart = await getOrCreateCart(userId);
  if (cart.items.length === 0 && cart.bundles.length === 0) {
    throw ApiError.badRequest('There is nothing in your cart to save.', 'CART_EMPTY');
  }

  await db().Cart.create({
    user: userId,
    items: cart.items,
    bundles: cart.bundles,
    savedForLater: true,
    name: name || `Saved ${formatDate(new Date())}`,
  });

  cart.items = [];
  cart.bundles = [];
  cart.promoCode = '';
  await cart.save();
  return cart;
}

async function listSaved(userId) {
  const carts = await db().Cart.find({ user: userId, savedForLater: true }).sort({ createdAt: -1 }).lean();
  return carts.map((cart) => ({
    id: cart._id.toString(),
    name: cart.name,
    lineCount: cart.items.length + (cart.bundles?.length ?? 0),
    itemCount: cart.items.reduce((sum, item) => sum + item.qty, 0),
    bundleCount: cart.bundles?.length ?? 0,
    createdAt: cart.createdAt,
  }));
}

/** Merges a saved cart back into the active one. The saved copy is consumed. */
async function restoreSaved(userId, savedCartId) {
  const saved = await db().Cart.findOne({ _id: savedCartId, user: userId, savedForLater: true });
  if (!saved) throw ApiError.notFound('Saved cart not found.', 'SAVED_CART_NOT_FOUND');

  const cart = await getOrCreateCart(userId);
  for (const savedItem of saved.items) {
    const existing = cart.items.find(
      (item) => item.product.toString() === savedItem.product.toString(),
    );
    if (existing) {
      existing.qty = Math.min(9999, existing.qty + savedItem.qty);
    } else {
      cart.items.push({
        product: savedItem.product,
        qty: savedItem.qty,
        priceAtAdd: savedItem.priceAtAdd,
      });
    }
  }

  for (const savedBundle of saved.bundles ?? []) {
    const existing = cart.bundles.find(
      (bundle) => bundle.offer.toString() === savedBundle.offer.toString(),
    );
    if (existing) existing.qty = Math.min(999, existing.qty + savedBundle.qty);
    else cart.bundles.push(savedBundle);
  }

  await cart.save();
  await saved.deleteOne();
  return cart;
}

async function deleteSaved(userId, savedCartId) {
  const result = await db().Cart.deleteOne({ _id: savedCartId, user: userId, savedForLater: true });
  if (result.deletedCount === 0) {
    throw ApiError.notFound('Saved cart not found.', 'SAVED_CART_NOT_FOUND');
  }
}

/**
 * Quick order pad (brief §8.3): resolve a list of SKUs and quantities in one go.
 *
 * Unmatched SKUs are reported back rather than silently dropped - a buyer
 * pasting 40 lines from a spreadsheet needs to know which three did not land.
 * SKU matching is case-insensitive and exact; partial matches would be guessing.
 */
async function bulkAdd(userId, lines) {
  const skus = lines.map((line) => line.sku.trim().toUpperCase());

  const products = await db().Product.find({
    sku: { $in: skus },
    isActive: true,
  });
  const bySku = new Map(products.map((product) => [product.sku.toUpperCase(), product]));

  const cart = await getOrCreateCart(userId);
  const added = [];
  const notFound = [];
  const outOfStock = [];

  for (const line of lines) {
    const key = line.sku.trim().toUpperCase();
    const product = bySku.get(key);

    if (!product) {
      notFound.push(line.sku);
      continue;
    }
    if (product.stock <= 0) {
      outOfStock.push({ sku: product.sku, name: product.name });
      continue;
    }

    const existing = cart.items.find((item) => item.product.toString() === product._id.toString());
    if (existing) {
      existing.qty = Math.min(9999, existing.qty + line.qty);
    } else {
      cart.items.push({ product: product._id, qty: line.qty, priceAtAdd: product.price });
    }

    added.push({ sku: product.sku, name: product.name, qty: line.qty });
  }

  await cart.save();
  return { cart, added, notFound, outOfStock };
}

// ---- combo bundles ----------------------------------------------------------

/**
 * Adds a combo to the cart as ONE line.
 *
 * The member products are deliberately not pushed into `items`: a bundle is
 * priced as a unit, and loose lines could be edited into something that no
 * longer matches what is being charged. Everything the bundle contains is
 * expanded from the live offer at read time (`pricingService.expandBundles`),
 * so editing the combo in the admin updates every cart holding it.
 */
async function addBundle(userId, slugOrId, qty = 1) {
  const offer = await findLiveCombo(slugOrId);
  const cart = await getOrCreateCart(userId);

  const existing = cart.bundles.find((bundle) => bundle.offer.toString() === offer._id.toString());
  if (existing) existing.qty = Math.min(999, existing.qty + qty);
  else cart.bundles.push({ offer: offer._id, qty, priceAtAdd: offer.bundlePrice });

  await cart.save();
  return cart;
}

async function setBundleQty(userId, offerId, qty) {
  const cart = await getOrCreateCart(userId);

  if (qty === 0) {
    cart.bundles = cart.bundles.filter((bundle) => bundle.offer.toString() !== offerId);
  } else {
    const existing = cart.bundles.find((bundle) => bundle.offer.toString() === offerId);
    if (!existing) throw ApiError.notFound('That bundle is not in your cart.', 'BUNDLE_NOT_IN_CART');
    existing.qty = qty;
  }

  await cart.save();
  return cart;
}

async function removeBundle(userId, offerId) {
  return setBundleQty(userId, offerId, 0);
}

async function findLiveCombo(slugOrId) {
  const query = /^[0-9a-fA-F]{24}$/.test(slugOrId) ? { _id: slugOrId } : { slug: slugOrId };
  const offer = await db().Offer.findOne(query).lean();

  if (!offer || offer.kind !== 'combo') {
    throw ApiError.notFound('That bundle does not exist.', 'OFFER_NOT_FOUND');
  }
  if (offerStatus(offer) !== 'live') {
    throw ApiError.badRequest('That bundle is not running right now.', 'OFFER_NOT_LIVE');
  }
  return offer;
}

// ---- promo code -------------------------------------------------------------

/**
 * Attaches a promo code to the cart.
 *
 * Validated here so a bad code fails at the moment it is typed rather than at
 * checkout, and stored on the cart so it survives a refresh and a device
 * change. Offers do not stack, so this REPLACES whatever code was there.
 *
 * A code that is real but does not currently bite is still accepted and
 * attached - `priceCart` returns a `promoNotice` explaining what the cart is
 * missing, and the discount starts applying the moment it qualifies.
 */
async function applyPromoCode(userId, code, user) {
  let offer;
  try {
    offer = await resolveCode(code, user);
  } catch (error) {
    if (!(error instanceof OfferRejection)) throw error;
    // The rejection already carries a named code and buyer-facing copy; this
    // just lifts it into the API's error envelope (§5.1).
    throw ApiError.badRequest(error.message, error.code);
  }

  const cart = await getOrCreateCart(userId);
  cart.promoCode = offer.code;
  await cart.save();
  return cart;
}

async function clearPromoCode(userId) {
  const cart = await getOrCreateCart(userId);
  cart.promoCode = '';
  await cart.save();
  return cart;
}

export { getOrCreateCart, serialize, addItem, setQty, removeItem, clearCart, mergeGuestCart, saveForLater, listSaved, restoreSaved, deleteSaved, bulkAdd, addBundle, setBundleQty, removeBundle, applyPromoCode, clearPromoCode };
