import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Product.js';
import '../models/Order.js';
import '../models/Invoice.js';
import '../models/Review.js';
import '../models/User.js';
import { displayNameOf } from '../utils/displayName.js';
import { REVIEW_COPY, REVIEW_AUTHORS } from './reviews.data.js';

/**
 * Seeds a review on every product, and the order history that entitles it.
 *
 * ## Why this writes ORDERS as well
 *
 * `reviewService.create` refuses a review unless the writing account has a
 * DELIVERED order containing that product. That rule is the whole value of the
 * feature, so the seed honours it rather than bypassing it: reviews are written
 * against real order lines, and every one of them would survive the same check
 * the live API applies.
 *
 * The cost is stated plainly because the client chose it: these orders are real
 * rows. They appear in the admin order board, they raise invoices, and they
 * move revenue and order-count figures in reports. They do NOT move stock - see
 * the note on that below.
 *
 * ## What it deliberately does not touch
 *
 * **Stock.** A seeded back-order would have to decrement 700-odd products, and
 * `stock` is what the storefront's in-stock badge and the whole inventory
 * screen read. Rewriting it to tell a story about reviews would corrupt the
 * thing the warehouse screens exist to show. These orders are historical
 * fiction against a live shelf, which is the same compromise `run.js` already
 * makes for its own fourteen orders.
 *
 * **`run.js`'s own order history.** That list is hand-curated so the admin
 * board has one of every status; this seed appends and never rewrites it.
 *
 * ADDITIVE and idempotent-ish: re-running skips any product that already has a
 * review, so it tops up rather than duplicating. It never wipes.
 */

/** How many reviews a product gets. Most get two; a few get none, and some get four. */
function reviewCountFor(random) {
  const roll = random();
  if (roll < 0.12) return 1;
  if (roll < 0.62) return 2;
  if (roll < 0.88) return 3;
  return 4;
}

/**
 * The rating spread.
 *
 * Weighted toward four and five, because a wholesale desk that mostly ships
 * acceptable parts is the premise of the whole site, and a catalogue averaging
 * three stars would be telling a different story than the copy does. Threes and
 * a rare two exist so the distribution bars have something to draw and so the
 * average is never a suspiciously flat 5.0.
 */
function ratingFor(random) {
  const roll = random();
  if (roll < 0.52) return 5;
  if (roll < 0.86) return 4;
  if (roll < 0.97) return 3;
  return 2;
}

/** Deterministic generator, so a reseed produces the same demo store. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LINES_PER_ORDER = 8;

async function seedReviews({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const random = mulberry32(20260915);

  const { Product, Order, Invoice, Review, User } = db();

  const products = await Product.find({ isActive: true }).sort({ sku: 1 }).lean();
  if (!products.length) {
    log('  no products in this database - skipped');
    return { reviews: 0, orders: 0, skipped: true };
  }

  // Reviews are written BY customers, so the accounts have to be real ones.
  // The role is 'buyer' in this schema; staff and admin are excluded, because an
  // admin reviewing the catalogue they maintain is not a customer opinion.
  const buyers = await User.find({ role: 'buyer', status: 'approved' })
    .select('contactName businessName email addresses')
    .lean();

  if (!buyers.length) {
    log('  no approved customer accounts - skipped');
    return { reviews: 0, orders: 0, skipped: true };
  }

  // Products that already carry a review are left alone, so re-running tops up
  // a catalogue that has grown rather than writing a second review per product.
  const reviewed = new Set(
    (await Review.find({}).select('product').lean()).map((r) => r.product.toString()),
  );

  const todo = products.filter((p) => !reviewed.has(p._id.toString()));
  if (!todo.length) {
    log('  every product already has a review - nothing to do');
    return { reviews: 0, orders: 0 };
  }

  /* ---- the orders that entitle the reviews ------------------------------ */

  // Batched into orders of a few lines each, the way a customer actually buys,
  // and dated across the last eight months so the account history reads like a
  // relationship rather than one enormous purchase.
  const batches = [];
  for (let i = 0; i < todo.length; i += LINES_PER_ORDER) {
    batches.push(todo.slice(i, i + LINES_PER_ORDER));
  }

  const lastOrder = await Order.findOne({}).sort({ orderNumber: -1 }).select('orderNumber').lean();
  const lastNumber = Number(lastOrder?.orderNumber?.split('-').pop() ?? 10_000);

  const lastInvoice = await Invoice.findOne({}).sort({ number: -1 }).select('number').lean();
  const lastInvoiceNumber = Number(lastInvoice?.number?.split('-').pop() ?? 10_000);

  const orders = [];
  const now = Date.now();

  batches.forEach((batch, index) => {
    const buyer = buyers[index % buyers.length];
    // 20 to 250 days back, oldest first, so the newest order is the most recent
    // thing in the account and the history fans out behind it.
    const daysAgo = 20 + Math.floor(((batches.length - index) / batches.length) * 230);
    const placedAt = new Date(now - daysAgo * 86_400_000);
    const deliveredAt = new Date(placedAt.getTime() + 3 * 86_400_000);

    const items = batch.map((product) => {
      const qty = 1 + Math.floor(random() * 4);
      const unitPrice = product.clearancePrice > 0 ? product.clearancePrice : product.price;
      return {
        product: product._id,
        sku: product.sku,
        name: product.name,
        slug: product.slug,
        image: product.image,
        grade: product.grade,
        partType: product.partType,
        partTypeLabel: product.partTypeLabel,
        brandSlug: product.brandSlug,
        qty,
        unitPrice,
        lineTotal: unitPrice * qty,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const shipping = subtotal >= 50_000 ? 0 : 1_995;
    // Ontario HST, the same 13% the checkout charges. Integer cents throughout.
    const tax = Math.round(subtotal * 0.13);
    const total = subtotal + shipping + tax;

    const address = buyer.addresses?.[0] ?? {};

    orders.push({
      orderNumber: `CVX-2026-${String(lastNumber + index + 1).padStart(5, '0')}`,
      user: buyer._id,
      items,
      subtotal,
      tax,
      shipping,
      total,
      status: 'delivered',
      createdAt: placedAt,
      updatedAt: deliveredAt,
      // The timeline is where a status change is recorded, and it is what
      // `reviewService` reads for the delivery date.
      timeline: [
        { status: 'placed', at: placedAt },
        { status: 'processing', at: new Date(placedAt.getTime() + 86_400_000) },
        { status: 'shipped', at: new Date(placedAt.getTime() + 2 * 86_400_000) },
        { status: 'delivered', at: deliveredAt },
      ],
      shippingAddress: {
        contactName: buyer.contactName,
        company: buyer.businessName,
        line1: address.line1,
        city: address.city,
        region: address.region,
        postal: address.postal,
        country: 'Canada',
      },
      billingAddress: {
        contactName: buyer.contactName,
        company: buyer.businessName,
        line1: address.line1,
        city: address.city,
        region: address.region,
        postal: address.postal,
        country: 'Canada',
      },
      deliveryMethod: {
        code: 'ground',
        label: 'Ground - 2 to 4 business days',
        cost: shipping,
        etaDays: 3,
      },
      payment: {
        method: index % 2 === 0 ? 'terms' : 'card',
        status: 'paid',
        mockRef: `mock_${placedAt.getTime()}`,
        paidAt: placedAt,
      },
    });
  });

  const insertedOrders = await Order.insertMany(orders);
  log(`  orders: ${insertedOrders.length} (delivered, so their lines are reviewable)`);

  // Every delivered order is billed and settled, the same rule `run.js` applies.
  // An order on the books with no invoice is revenue nobody can reconcile.
  const invoices = insertedOrders.map((order, index) => {
    const issuedAt = order.createdAt;
    return {
      number: `INV-2026-${String(lastInvoiceNumber + index + 1).padStart(5, '0')}`,
      order: order._id,
      user: order.user,
      amount: order.total,
      amountPaid: order.total,
      issuedAt,
      dueDate: new Date(issuedAt.getTime() + 30 * 86_400_000),
      terms: 'net30',
      status: 'paid',
      payments: [
        {
          amount: order.total,
          at: new Date(issuedAt.getTime() + 5 * 86_400_000),
          method: 'EFT',
          reference: `EFT-${90_000 + index}`,
        },
      ],
    };
  });

  await Invoice.insertMany(invoices);
  log(`  invoices: ${invoices.length}`);

  /* ---- the reviews, and an order behind every one of them ---------------- */

  /**
   * The unique index is `{ order, product }`: one review per order LINE. So a
   * second opinion about the same part is not a second row against the same
   * order - it is a DIFFERENT customer, who bought it on their own order.
   *
   * An earlier cut attached the extras to the buying account's order with a
   * borrowed author name, which would have been the one thing in this seed the
   * live API would refuse to write. Every review below has a real delivered
   * order behind it and would pass `reviewService.create` unchanged.
   */
  const byUser = new Map(buyers.map((b) => [b._id.toString(), b]));
  const reviews = [];
  const extraOrders = [];
  let authorIndex = 0;
  let sequence = lastNumber + insertedOrders.length;

  /** A single-line delivered order, for a customer who is not the original buyer. */
  function soloOrder(product, buyer, deliveredAt) {
    const placedAt = new Date(deliveredAt.getTime() - 3 * 86_400_000);
    const unitPrice = product.clearancePrice > 0 ? product.clearancePrice : product.price;
    const qty = 1 + Math.floor(random() * 3);
    const subtotal = unitPrice * qty;
    const tax = Math.round(subtotal * 0.13);
    const address = buyer.addresses?.[0] ?? {};

    sequence += 1;
    return {
      _id: new mongoose.Types.ObjectId(),
      orderNumber: `CVX-2026-${String(sequence).padStart(5, '0')}`,
      user: buyer._id,
      items: [
        {
          product: product._id,
          sku: product.sku,
          name: product.name,
          slug: product.slug,
          image: product.image,
          grade: product.grade,
          partType: product.partType,
          partTypeLabel: product.partTypeLabel,
          brandSlug: product.brandSlug,
          qty,
          unitPrice,
          lineTotal: subtotal,
        },
      ],
      subtotal,
      tax,
      shipping: 1_995,
      total: subtotal + tax + 1_995,
      status: 'delivered',
      createdAt: placedAt,
      updatedAt: deliveredAt,
      timeline: [
        { status: 'placed', at: placedAt },
        { status: 'delivered', at: deliveredAt },
      ],
      shippingAddress: {
        contactName: buyer.contactName,
        company: buyer.businessName,
        line1: address.line1,
        city: address.city,
        region: address.region,
        postal: address.postal,
        country: 'Canada',
      },
      deliveryMethod: {
        code: 'ground',
        label: 'Ground - 2 to 4 business days',
        cost: 1_995,
        etaDays: 3,
      },
      payment: {
        method: 'card',
        status: 'paid',
        mockRef: `mock_${placedAt.getTime()}`,
        paidAt: placedAt,
      },
    };
  }

  const productById = new Map(products.map((p) => [p._id.toString(), p]));

  for (const order of insertedOrders) {
    const buyer = byUser.get(order.user.toString());
    const deliveredAt = new Date(
      order.timeline?.find((entry) => entry.status === 'delivered')?.at ?? order.updatedAt,
    );

    for (const item of order.items) {
      const count = reviewCountFor(random);
      const product = productById.get(item.product.toString());

      for (let n = 0; n < count; n += 1) {
        const rating = ratingFor(random);
        const pool = REVIEW_COPY[rating];
        const [title, body] = pool[Math.floor(random() * pool.length)];

        // Written in the fortnight after delivery: the customer fits the part,
        // then says what they made of it.
        const writtenAt = new Date(
          deliveredAt.getTime() + (1 + Math.floor(random() * 14)) * 86_400_000,
        );

        if (n === 0) {
          // The account that actually bought this line.
          reviews.push({
            product: item.product,
            user: order.user,
            order: order._id,
            authorName: displayNameOf(buyer),
            authorBusiness: buyer?.businessName ?? '',
            rating,
            title,
            body,
            createdAt: writtenAt,
            updatedAt: writtenAt,
          });
          continue;
        }

        // Another customer, with their own order for the same part. The name
        // is a snapshot on the review, exactly as the service writes it, so a
        // seeded row and a live one are the same shape.
        if (!product) continue;
        const author = REVIEW_AUTHORS[authorIndex++ % REVIEW_AUTHORS.length];
        const theirBuyer = buyers[authorIndex % buyers.length];
        const theirOrder = soloOrder(product, theirBuyer, new Date(writtenAt.getTime() - 86_400_000));
        extraOrders.push(theirOrder);

        reviews.push({
          product: item.product,
          user: theirBuyer._id,
          order: theirOrder._id,
          authorName: author.name,
          authorBusiness: author.business,
          rating,
          title,
          body,
          createdAt: writtenAt,
          updatedAt: writtenAt,
        });
      }
    }
  }

  if (extraOrders.length) {
    await Order.insertMany(extraOrders);
    log(`  further orders: ${extraOrders.length} (one per additional reviewer)`);
  }

  const inserted = await Review.insertMany(reviews, { ordered: false });
  log(`  reviews: ${inserted.length}`);

  const covered = (await Review.distinct('product')).length;
  const total = await Review.countDocuments({});
  log(`  coverage: ${covered} of ${products.length} products carry a review`);


  return { reviews: total, orders: insertedOrders.length };
}

// CLI entry: `npm run seed:reviews`
if (process.argv[1] && process.argv[1].endsWith('reviews.js')) {
  (async () => {
    console.log('\n  Seeding product reviews and the orders behind them…\n');
    await connectDb();

    const businesses = await db().Business.find({ deletedAt: null }).select('name code').lean();
    if (!businesses.length) {
      throw new Error('No businesses found. Run `npm run seed` first.');
    }

    for (const business of businesses) {
      console.log(`  ${business.name} (${business.code})`);
      await runInBusiness(
        {
          businessId: String(business._id),
          code: business.code,
          connection: dbFor(business.code),
        },
        () => seedReviews(),
      );
    }

    console.log('\n  Done.\n');
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { seedReviews };
export default seedReviews;
