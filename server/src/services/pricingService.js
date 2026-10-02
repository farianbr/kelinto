import { urlOf } from './storageService.js';
import { db } from '../db/models.js';
import '../models/Offer.js';
import '../models/Order.js';
import '../models/Product.js';
import '../models/PreownedDevice.js';
import '../models/Service.js';
import { servicePhotoFor } from '../../../shared/catalog.js';
import ApiError from '../utils/ApiError.js';
import { DEFAULT_SHIPPING_METHODS } from '../models/Settings.js';
import { offerStatus } from './offerService.js';
import { effectivePrice } from './productService.js';
import { membershipPlan } from './settingsService.js';
import { TAX_RATE } from '../../../shared/schemas/checkout.js';

/**
 * THE ONE PLACE A DISCOUNT IS DECIDED.
 *
 * Cart totals, the checkout quote and the placed order all come through
 * `priceCart`, so the number a buyer is shown and the number they are charged
 * are produced by the same function from the same live documents. The client
 * never sends a price and never sends a discount.
 *
 * The rules, in the order they bite:
 *
 *   1. **Offers never stack.** A cart carries at most one promo code, and at
 *      most one offer is applied to it. A typed code always wins; only when
 *      there is none does an automatic (codeless) offer get a chance.
 *   2. **One offer per product.** Falls out of (1): with a single offer in play,
 *      no line can be discounted twice.
 *   3. **Bundles are sealed.** A combo is already a discount. Its member
 *      products are excluded from every promo code's base, so a code cannot be
 *      layered on top of bundle pricing.
 *   4. **Redemption is checked against order history, not a counter.** A
 *      single-use code is refused once the account has an order carrying it.
 *      A counter would drift the first time an order was cancelled.
 *   5. **Eligibility is a hard gate.** An account-restricted offer is invisible
 *      to everyone else - the code comes back "not recognised", not "not for
 *      you", because listing who an offer belongs to is not the buyer's
 *      business.
 */

// ---- offer resolution -------------------------------------------------------

/** Failures are named so the client can decide what to say, per §5.1. */
class OfferRejection extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function matchesTarget(product, target = {}) {
  if (target.deviceTypeSlug && product.deviceTypeSlug !== target.deviceTypeSlug) return false;
  if (target.brandSlug && product.brandSlug !== target.brandSlug) return false;
  if (target.partType && product.partType !== target.partType) return false;
  if (target.grade && product.grade !== target.grade) return false;
  return true;
}

function isEligible(offer, user) {
  if (offer.eligibility !== 'accounts') return true;
  return (offer.allowedUsers ?? []).some((id) => id.toString() === user._id.toString());
}

/**
 * Has this account already redeemed a single-use offer?
 *
 * Read from the order history rather than a stored counter: an order that was
 * cancelled never consumed anything, and a counter cannot know that.
 */
async function alreadyRedeemed(offer, user) {
  if (offer.redemption !== 'single') return false;
  const existing = await db().Order.exists({
    user: user._id,
    'promo.offer': offer._id,
    status: { $ne: 'cancelled' },
  });
  return Boolean(existing);
}

/**
 * Turns a typed code into an offer, or explains why not.
 *
 * Every rejection that would reveal something about another account's offers
 * answers with the same `OFFER_NOT_FOUND` - an account-restricted code must not
 * be distinguishable from a code that never existed.
 */
async function resolveCode(code, user) {
  const trimmed = String(code ?? '').trim().toUpperCase();
  if (!trimmed) throw new OfferRejection('OFFER_NOT_FOUND', 'Enter a promo code.');

  const offer = await db().Offer.findOne({ code: trimmed }).lean();

  if (!offer || offer.kind !== 'deal' || !isEligible(offer, user)) {
    throw new OfferRejection('OFFER_NOT_FOUND', `“${trimmed}” is not a valid promo code.`);
  }

  const status = offerStatus(offer);
  if (status === 'scheduled') {
    throw new OfferRejection('OFFER_NOT_STARTED', `“${trimmed}” has not started yet.`);
  }
  if (status !== 'live') {
    throw new OfferRejection('OFFER_EXPIRED', `“${trimmed}” is no longer running.`);
  }

  if (offer.usageLimit > 0 && offer.usageCount >= offer.usageLimit) {
    throw new OfferRejection('OFFER_EXHAUSTED', `“${trimmed}” has been fully redeemed.`);
  }

  if (await alreadyRedeemed(offer, user)) {
    throw new OfferRejection(
      'OFFER_ALREADY_USED',
      `“${trimmed}” is single-use and your account has already redeemed it.`,
    );
  }

  return offer;
}

/** Live, codeless deals this account qualifies for - the automatic candidates. */
async function automaticCandidates(user) {
  const now = new Date();
  const offers = await db().Offer.find({
    kind: 'deal',
    isActive: true,
    $or: [{ code: '' }, { code: null }, { code: { $exists: false } }],
  }).lean();

  return offers.filter(
    (offer) =>
      offerStatus(offer, now) === 'live' &&
      isEligible(offer, user) &&
      (offer.usageLimit === 0 || offer.usageCount < offer.usageLimit),
  );
}

// ---- discount arithmetic ----------------------------------------------------

/**
 * What one offer is worth against a set of lines.
 *
 * Returns `null` when the offer does not bite - nothing qualifies, the minimum
 * is not met, or the arithmetic comes out at zero. A caller getting `null` for a
 * typed code must tell the buyer why, which is what `explain` carries.
 */
function evaluate(offer, { lines, itemsSubtotal, orderSubtotal, shippingCost }) {
  const eligible = lines.filter((line) => matchesTarget(line.product, offer.target));
  const eligibleQty = eligible.reduce((sum, line) => sum + line.qty, 0);
  const eligibleSubtotal = eligible.reduce((sum, line) => sum + line.lineTotal, 0);

  if (eligible.length === 0) {
    return { discount: 0, freeShipping: false, explain: 'NOTHING_QUALIFIES' };
  }
  if (offer.minQty > 0 && eligibleQty < offer.minQty) {
    return { discount: 0, freeShipping: false, explain: 'MIN_QTY', need: offer.minQty, have: eligibleQty };
  }
  // Minimum spend is judged on the whole order, not just the qualifying slice:
  // "on orders over $750" is a statement about the order.
  if (offer.minSpend > 0 && orderSubtotal < offer.minSpend) {
    return { discount: 0, freeShipping: false, explain: 'MIN_SPEND', need: offer.minSpend, have: orderSubtotal };
  }

  if (offer.discountType === 'free-shipping') {
    if (shippingCost === 0) {
      return { discount: 0, freeShipping: true, explain: 'SHIPPING_ALREADY_FREE' };
    }
    return { discount: 0, freeShipping: true, explain: null, eligibleSubtotal };
  }

  const raw =
    offer.discountType === 'percent'
      ? Math.round((eligibleSubtotal * offer.discountPercent) / 100)
      : offer.discountAmount;

  // Never discount more than the qualifying lines are worth - a $40-off code on
  // a $12 line must not turn into a credit.
  const discount = Math.min(raw, eligibleSubtotal);

  if (discount <= 0) return { discount: 0, freeShipping: false, explain: 'NO_VALUE' };
  return { discount, freeShipping: false, explain: null, eligibleSubtotal };
}

/** Human copy for a rejection the buyer can act on. */
function explainRejection(offer, result) {
  switch (result.explain) {
    case 'MIN_QTY':
      return `“${offer.code}” needs ${result.need} qualifying units - your cart has ${result.have}.`;
    case 'MIN_SPEND':
      return `“${offer.code}” applies to orders over ${formatCents(result.need)}.`;
    case 'SHIPPING_ALREADY_FREE':
      return `“${offer.code}” is free shipping, and this order already ships free.`;
    case 'NOTHING_QUALIFIES':
    default:
      return `“${offer.code}” does not apply to anything in your cart.`;
  }
}

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function shapeApplied(offer, result, { automatic }) {
  return {
    offerId: offer._id.toString(),
    slug: offer.slug,
    code: offer.code || '',
    title: offer.title,
    label:
      offer.discountType === 'free-shipping'
        ? 'Free shipping'
        : offer.discountType === 'percent'
          ? `${offer.discountPercent}% off`
          : `${formatCents(offer.discountAmount)} off`,
    discountType: offer.discountType,
    amount: result.discount,
    freeShipping: result.freeShipping,
    // An automatic offer was not asked for, so the UI presents it differently:
    // there is nothing for the buyer to remove.
    automatic,
    terms: offer.terms || '',
  };
}

// ---- the entry point --------------------------------------------------------

/**
 * Prices a cart end to end: lines, bundles, the one applicable offer, shipping,
 * tax and total.
 *
 * `subtotal` is always the LIST value of everything in the cart. Savings are
 * reported separately as `bundleDiscount` and `promoDiscount` rather than folded
 * into line prices, so an order and its invoice can show what a part costs and
 * what was taken off it - which is what a business buyer reconciles against.
 */
async function priceCart(cart, user, { deliveryCode = 'ground' } = {}) {
  // ---- individual lines ---------------------------------------------------
  const productIds = cart.items.map((item) => item.product);
  const products = await db().Product.find({ _id: { $in: productIds } }).lean();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  const items = [];
  for (const cartItem of cart.items) {
    const product = byId.get(cartItem.product.toString());
    if (!product || !product.isActive) continue;

    items.push({
      product: product._id,
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      image: urlOf(product.image) ?? null,
      grade: product.grade,
      partType: product.partType,
      partTypeLabel: product.partTypeLabel,
      // Carried so the storefront can pick the brand's stock photo for this
      // part type - see client/src/lib/partPhoto.js.
      brandSlug: product.brandSlug ?? null,
      modelName: product.modelName,
      qty: cartItem.qty,
      // `effectivePrice`, never `product.price`: a cleared part shows its
      // clearance price on the card, and the cart has to charge the same
      // number or the two disagree about what the buyer just agreed to.
      unitPrice: effectivePrice(product),
      lineTotal: effectivePrice(product) * cartItem.qty,
      // Carried so a placed order can snapshot what the part cost at the time
      // (§9.4). Undefined rather than zero when the catalogue has no cost
      // a zero would report as a 100% margin.
      unitCost: product.cost > 0 ? product.cost : undefined,
      stock: product.stock,
      inStock: product.stock > 0,
      exceedsStock: cartItem.qty > product.stock,
      priceAtAdd: cartItem.priceAtAdd,
      priceChanged: cartItem.priceAtAdd !== effectivePrice(product),
      // Carried only so `evaluate` can match targeting without a second lookup.
      product_: product,
    });
  }

  // ---- bundles ------------------------------------------------------------
  const bundles = await expandBundles(cart, user);

  // ---- pre-owned phones ---------------------------------------------------
  const preowned = await expandPreowned(cart);
  const preownedTotal = preowned
    .filter((line) => line.available)
    .reduce((sum, line) => sum + line.lineTotal, 0);

  // ---- repair services (2026-10-01) ---------------------------------------
  const services = await expandServices(cart);
  const servicesTotal = services
    .filter((line) => line.available)
    .reduce((sum, line) => sum + line.lineTotal, 0);
  // Tax-exempt services leave the tax base; everything else in the cart pays.
  const untaxedServices = services
    .filter((line) => line.available && !line.taxable)
    .reduce((sum, line) => sum + line.lineTotal, 0);

  // ---- a membership plan (2026-10-02) ------------------------------------
  const membership = await expandMembership(cart);
  const membershipTotal = membership
    .filter((line) => line.available)
    .reduce((sum, line) => sum + line.lineTotal, 0);

  const itemsSubtotal = items.reduce((sum, line) => sum + line.lineTotal, 0);
  const bundlesListTotal = bundles.reduce((sum, bundle) => sum + bundle.listTotal, 0);
  const bundlesCharged = bundles.reduce((sum, bundle) => sum + bundle.lineTotal, 0);

  const subtotal = itemsSubtotal + bundlesListTotal + preownedTotal + servicesTotal + membershipTotal;
  const bundleDiscount = bundlesListTotal - bundlesCharged;

  // ---- shipping, before any offer touches it ------------------------------
  // The price comes from Settings, not from `DELIVERY_METHODS` (§10, phase 11):
  // the constant still defines which codes exist, because checkout validates
  // `deliveryMethod` against a fixed enum, but the money is a staff member's to
  // change without a deploy. `shippingFor` falls back to the seeded bands, so
  // this is a rate lookup rather than a new source of truth.
  const settings = await db().Settings.load();
  const shippingBands = settings.financial?.shippingMethods?.length
    ? settings.financial.shippingMethods
    : DEFAULT_SHIPPING_METHODS;
  const method = db().Settings.shippingFor(settings, deliveryCode);
  const afterBundles = subtotal - bundleDiscount;
  // Labour does not travel. A cart holding only services has no parcel, so it
  // pays no shipping; with parts in it, the parcel is priced as before.
  const shipsSomething = items.length > 0 || bundles.length > 0 || preowned.some((line) => line.available);
  const baseShipping = !shipsSomething
    ? 0
    : method.freeOver && afterBundles >= method.freeOver
      ? 0
      : method.cost;

  // ---- the one offer ------------------------------------------------------
  // Rule 3: only loose lines can carry a code. Bundle members are sealed, and
  // so is a pre-owned phone: it is priced one handset at a time by a person who
  // agreed a buying price for it, and a parts promotion was never written with
  // it in mind. It still counts toward free shipping, which is about the parcel.
  const evaluationInput = {
    lines: items.map((line) => ({ ...line, product: line.product_ })),
    itemsSubtotal,
    // Services are sealed like a phone: a parts promotion was not written for
    // labour. A membership is sealed too: it is a price list of its own.
    orderSubtotal: afterBundles - preownedTotal - servicesTotal - membershipTotal,
    shippingCost: baseShipping,
  };

  let promo = null;
  let promoNotice = null;

  if (cart.promoCode) {
    try {
      const offer = await resolveCode(cart.promoCode, user);
      const result = evaluate(offer, evaluationInput);

      if (result.discount > 0 || result.freeShipping) {
        promo = shapeApplied(offer, result, { automatic: false });
      } else {
        // The code is real and this account may use it - it just does not bite
        // on this cart. Say which, and leave it attached so it starts working
        // the moment the cart qualifies.
        promoNotice = { code: 'OFFER_NOT_APPLICABLE', message: explainRejection(offer, result) };
      }
    } catch (error) {
      if (!(error instanceof OfferRejection)) throw error;
      promoNotice = { code: error.code, message: error.message };
    }
  }

  // Rule 1: an automatic offer only gets a look when no code is in play.
  if (!promo) {
    const candidates = await automaticCandidates(user);
    let best = null;

    for (const offer of candidates) {
      const result = evaluate(offer, evaluationInput);
      if (result.discount <= 0 && !result.freeShipping) continue;

      // Free shipping is worth the shipping it removes, so the comparison is
      // like for like rather than "a dollar discount always wins".
      const worth = result.discount + (result.freeShipping ? baseShipping : 0);
      if (!best || worth > best.worth) best = { offer, result, worth };
    }

    if (best) promo = shapeApplied(best.offer, best.result, { automatic: true });
  }

  const promoDiscount = promo?.amount ?? 0;
  const shipping = promo?.freeShipping ? 0 : baseShipping;
  const discount = bundleDiscount + promoDiscount;

  // Tax follows the money actually changing hands.
  const taxable = subtotal - discount + shipping - untaxedServices;
  const tax = Math.round(taxable * TAX_RATE);
  const total = taxable + tax;

  return {
    // `product_` is an implementation detail of the offer matcher.
    items: items.map(({ product_, ...line }) => line),
    bundles,
    preowned,
    services,
    membership,
    subtotal,
    bundleDiscount,
    promoDiscount,
    discount,
    promo,
    promoNotice,
    promoCode: cart.promoCode || '',
    shipping,
    tax,
    total,
    deliveryMethod: {
      code: method.code,
      label: `${method.label} - ${method.detail}`,
      cost: shipping,
      etaDays: method.etaDays,
    },
    /**
     * Every band, priced against *this* cart's subtotal.
     *
     * The checkout picker used to render `DELIVERY_METHODS` from the shared
     * constant, which was fine while the costs lived there too. Now that a
     * staff member can edit them (§6.15), a picker reading the constant would show
     * a stale price beside a correct total - worse than either being wrong on
     * its own. Sending the bands the quote actually priced against means the
     * two cannot disagree.
     *
     * `cost` here is the band's price after its own free-over threshold, but
     * before any promo code: a free-shipping offer zeroes `shipping` above,
     * and the picker shows what each band costs rather than restating the
     * discount it already displays separately.
     */
    deliveryOptions: shippingBands.map((band) => ({
      code: band.code,
      label: band.label,
      detail: band.detail ?? '',
      etaDays: band.etaDays,
      cost: band.freeOver && afterBundles >= band.freeOver ? 0 : band.cost,
      freeOver: band.freeOver ?? null,
    })),
  };
}

/**
 * Turns a cart's bundle references into priced, expanded lines.
 *
 * A bundle whose offer has expired, been paused, or lost a SKU is returned with
 * `available: false` rather than dropped: silently removing something a buyer
 * put in their cart is worse than showing it and refusing to check out.
 */
async function expandPreowned(cart) {
  const refs = cart.preowned ?? [];
  if (refs.length === 0) return [];

  const devices = await db()
    .PreownedDevice.find({ _id: { $in: refs.map((ref) => ref.device) } })
    .lean();
  const byId = new Map(devices.map((device) => [String(device._id), device]));

  return refs
    .map((ref) => {
      const device = byId.get(String(ref.device));
      if (!device) return null;
      const title = [
        [device.brand, device.model].filter(Boolean).join(' '),
        device.storage,
        device.colour,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        device: device._id,
        stockNumber: device.stockNumber,
        name: `Pre-owned ${title}`,
        grade: device.grade,
        photo: urlOf(device.photos?.[0]) ?? null,
        qty: 1,
        unitPrice: device.priceCents,
        lineTotal: device.priceCents,
        // What we paid for it, so the order line snapshots its margin (§9.4).
        unitCost: device.costCents > 0 ? device.costCents : undefined,
        /**
         * Still for sale. A phone is not held by sitting in a cart, so the
         * first order to reach checkout takes it; the second cart shows it as
         * gone rather than silently charging for nothing.
         */
        available: device.status === 'listed',
        priceAtAdd: ref.priceAtAdd,
        priceChanged: ref.priceAtAdd !== device.priceCents,
      };
    })
    .filter(Boolean);
}

/**
 * A cart's repair services, priced from the business's live service list.
 *
 * A service switched off, or priced at nothing ("quoted on inspection"), is
 * returned with `available: false` rather than dropped, for the same reason a
 * sold phone is: the buyer put it there and should see why it cannot be bought.
 */
async function expandServices(cart) {
  const refs = cart.services ?? [];
  if (refs.length === 0) return [];

  const rows = await db()
    .Service.find({ _id: { $in: refs.map((ref) => ref.service) } })
    .lean();
  const byId = new Map(rows.map((row) => [String(row._id), row]));

  return refs
    .map((ref) => {
      const service = byId.get(String(ref.service));
      if (!service) return null;
      const unitPrice = service.priceCents ?? 0;
      return {
        service: service._id,
        // A labour line's SKU: stable, short, and never mistaken for a part's.
        sku: `SVC-${String(service._id).slice(-6).toUpperCase()}`,
        name: service.name,
        scopeLabel: service.scopeLabel ?? '',
        photo: servicePhotoFor(service.name),
        durationMinutes: service.durationMinutes ?? 0,
        warrantyDays: service.warrantyDays ?? 0,
        qty: ref.qty,
        unitPrice,
        lineTotal: unitPrice * ref.qty,
        unitCost: service.costCents > 0 ? service.costCents : undefined,
        taxable: service.taxable !== false,
        available: service.isActive !== false && unitPrice > 0,
        priceAtAdd: ref.priceAtAdd,
        priceChanged: ref.priceAtAdd !== unitPrice,
      };
    })
    .filter(Boolean);
}

async function expandBundles(cart, _user) {
  if (!cart.bundles?.length) return [];

  const offers = await db().Offer.find({ _id: { $in: cart.bundles.map((b) => b.offer) } }).lean();
  const byId = new Map(offers.map((offer) => [offer._id.toString(), offer]));

  const skus = offers.flatMap((offer) => (offer.items ?? []).map((item) => item.sku));
  const products = await db().Product.find({ sku: { $in: skus } }).lean();
  const bySku = new Map(products.map((product) => [product.sku, product]));

  const now = new Date();
  const out = [];

  for (const cartBundle of cart.bundles) {
    const offer = byId.get(cartBundle.offer.toString());
    if (!offer) continue; // the offer was deleted outright

    const status = offerStatus(offer, now);
    const lines = [];
    let listTotal = 0;
    let complete = true;

    for (const member of offer.items ?? []) {
      const product = bySku.get(member.sku);
      if (!product || !product.isActive) {
        complete = false;
        continue;
      }

      const qty = member.qty * cartBundle.qty;
      listTotal += effectivePrice(product) * qty;
      lines.push({
        product: product._id,
        sku: product.sku,
        name: product.name,
        slug: product.slug,
        image: urlOf(product.image) ?? null,
        grade: product.grade,
        partType: product.partType,
        partTypeLabel: product.partTypeLabel,
        brandSlug: product.brandSlug ?? null,
        qty,
        unitPrice: effectivePrice(product),
        lineTotal: effectivePrice(product) * qty,
        // Same snapshot as a loose line - a bundled part still has a cost, and
        // the margin on a combo is the number most worth knowing.
        unitCost: product.cost > 0 ? product.cost : undefined,
        inStock: product.stock > 0,
        exceedsStock: qty > product.stock,
      });
    }

    const unavailable =
      !complete || status !== 'live' || lines.some((line) => line.exceedsStock);

    out.push({
      offerId: offer._id.toString(),
      slug: offer.slug,
      title: offer.title,
      subtitle: offer.subtitle || '',
      accent: offer.accent || 'brand',
      qty: cartBundle.qty,
      bundlePrice: offer.bundlePrice,
      lineTotal: offer.bundlePrice * cartBundle.qty,
      listTotal,
      savings: Math.max(0, listTotal - offer.bundlePrice * cartBundle.qty),
      products: lines,
      status,
      available: !unavailable,
      reason: !complete
        ? 'A part in this bundle is no longer listed.'
        : status !== 'live'
          ? 'This bundle is no longer running.'
          : lines.some((line) => line.exceedsStock)
            ? 'A part in this bundle is short on stock.'
            : null,
    });
  }

  return out;
}

/** Refuses checkout on a bundle that cannot be honoured, with the reason. */
function assertBundlesOrderable(bundles) {
  const broken = bundles.find((bundle) => !bundle.available);
  if (broken) {
    throw ApiError.conflict(
      `${broken.title}: ${broken.reason} Remove it to continue.`,
      'BUNDLE_UNAVAILABLE',
    );
  }
}

/**
 * A cart's membership plan, priced from Settings (2026-10-02).
 *
 * A list of none or one, so every reader treats it like the other line kinds.
 * A plan taken off sale since it went in the cart stays visible with
 * `available: false` and checkout refuses it by name, like a sold phone.
 * Taxable: a membership is a supply of services. It ships nothing, so a cart
 * holding only a plan pays no shipping.
 */
async function expandMembership(cart) {
  const tier = cart.membership?.tier;
  if (!tier) return [];
  const plan = await membershipPlan(tier);
  const unitPrice = plan?.priceCents ?? 0;
  const name = plan?.name ?? tier.charAt(0).toUpperCase() + tier.slice(1);
  return [
    {
      tier,
      sku: `MBR-${tier.toUpperCase()}`,
      name: `${name} membership`,
      interval: plan?.interval ?? 'year',
      warrantyDays: plan?.warrantyDays ?? null,
      qty: 1,
      unitPrice,
      lineTotal: unitPrice,
      available: Boolean(plan) && unitPrice > 0,
      priceAtAdd: cart.membership.priceAtAdd,
      priceChanged: cart.membership.priceAtAdd !== unitPrice,
    },
  ];
}

export { OfferRejection, resolveCode, priceCart, expandBundles, expandPreowned, expandServices, expandMembership, assertBundlesOrderable };
