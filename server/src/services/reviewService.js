import { urlOf } from './storageService.js';
import { db } from '../db/models.js';
import '../models/Review.js';
import '../models/Order.js';
import '../models/Product.js';
import ApiError from '../utils/ApiError.js';
import { displayNameOf } from '../utils/displayName.js';

/**
 * Product reviews, written by the customer who bought the part.
 *
 * ## The one rule everything else follows from
 *
 * A review requires a DELIVERED order containing that product, placed by the
 * user writing it. That is checked here, on every write, against the order
 * itself - never trusted from the client, which sends only an order id, a
 * product id and the words.
 *
 * Gating on delivery rather than on placement is what makes the review mean
 * something: somebody who has not received the part cannot have an opinion
 * about it yet, and a "verified purchase" that only verifies a payment is a
 * label doing no work.
 */

/** The statuses that entitle a buyer to review a line. */
const REVIEWABLE_STATUSES = ['delivered'];

function serialize(review) {
  return {
    id: review._id.toString(),
    product: review.product?.toString?.() ?? String(review.product),
    rating: review.rating,
    title: review.title ?? '',
    body: review.body,
    authorName: review.authorName,
    authorBusiness: review.authorBusiness ?? '',
    createdAt: review.createdAt,
  };
}

/**
 * The rating summary a product page and a card need.
 *
 * Hidden reviews are excluded from BOTH the list and the average. A hidden
 * review that still moved the star rating would be half-removed, which is the
 * worst of the two options.
 */
async function summaryFor(productIds = []) {
  if (!productIds.length) return new Map();

  const rows = await db().Review.aggregate([
    { $match: { product: { $in: productIds }, isHidden: { $ne: true } } },
    { $group: { _id: '$product', count: { $sum: 1 }, average: { $avg: '$rating' } } },
  ]);

  return new Map(
    rows.map((row) => [
      row._id.toString(),
      // One decimal place, rounded once here rather than at each render, so the
      // card and the detail page can never print different numbers.
      { count: row.count, average: Math.round(row.average * 10) / 10 },
    ]),
  );
}

/** Published reviews for one product, newest first. */
async function listForProduct(productId, { limit = 20 } = {}) {
  const reviews = await db()
    .Review.find({ product: productId, isHidden: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const summary = (await summaryFor([reviews[0]?.product].filter(Boolean))).get(
    String(productId),
  ) ?? { count: 0, average: 0 };

  return { reviews: reviews.map(serialize), ...summary };
}

/**
 * What this user may still review, across their delivered orders.
 *
 * Returns one entry per ORDER LINE rather than per product, because that is the
 * thing being reviewed: the same screen bought on two orders is two entries,
 * and each carries the order it belongs to so the client can post it back.
 *
 * `orderId` narrows it to a single order, which is what the Thank You page and
 * one row of the orders list ask for.
 */
async function listPending(userId, { orderId = null } = {}) {
  const { Order, Review } = db();

  const query = { user: userId, status: { $in: REVIEWABLE_STATUSES } };
  if (orderId) query._id = orderId;

  const orders = await Order.find(query).sort({ createdAt: -1 }).limit(50).lean();
  if (!orders.length) return [];

  // Every review this user has already written against these orders, in one
  // query rather than one per line.
  const written = await Review.find({
    user: userId,
    order: { $in: orders.map((o) => o._id) },
  })
    .select('order product')
    .lean();

  const done = new Set(written.map((r) => `${r.order}|${r.product}`));

  const pending = [];
  for (const order of orders) {
    for (const item of order.items ?? []) {
      // A line whose product has since been deleted cannot be reviewed - there
      // is no page for the review to appear on.
      if (!item.product) continue;
      if (done.has(`${order._id}|${item.product}`)) continue;

      pending.push({
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        // There is no `deliveredAt` field; the timeline is where a status
        // change is recorded, so the delivery entry is the honest source. Falls
        // back to `updatedAt` for an order whose timeline predates the entry.
        deliveredAt:
          (order.timeline ?? []).find((entry) => entry.status === 'delivered')?.at ??
          order.updatedAt,
        productId: item.product.toString(),
        // The order's own snapshot, so the row renders the part as it was
        // bought even if the catalogue has moved on.
        name: item.name,
        slug: item.slug,
        image: urlOf(item.image) ?? null,
        grade: item.grade,
        partType: item.partType,
        partTypeLabel: item.partTypeLabel,
        brandSlug: item.brandSlug,
      });
    }
  }

  return pending;
}

/**
 * Write a review.
 *
 * The entitlement check is the whole function. Everything after it is bookkeeping.
 */
async function create(userId, { orderId, productId, rating, title, body }) {
  const { Order, Review, User } = db();

  const order = await Order.findOne({ _id: orderId, user: userId }).lean();
  // Same answer for "no such order" and "not your order": a stranger probing
  // order ids learns nothing either way.
  if (!order) throw new ApiError(404, 'Order not found');

  if (!REVIEWABLE_STATUSES.includes(order.status)) {
    throw new ApiError(
      400,
      'This order can be reviewed once it has been delivered.',
    );
  }

  const line = (order.items ?? []).find(
    (item) => item.product && item.product.toString() === String(productId),
  );
  if (!line) throw new ApiError(400, 'That part is not on this order.');

  const user = await User.findById(userId).select('contactName businessName email').lean();

  try {
    const review = await Review.create({
      product: productId,
      user: userId,
      order: orderId,
      // Snapshotted. See the model note on why this is not a join.
      authorName: displayNameOf(user),
      authorBusiness: user?.businessName?.trim() || '',
      rating,
      title: title?.trim() || '',
      body: body.trim(),
    });
    return serialize(review.toObject());
  } catch (error) {
    // The unique index on { order, product } is what enforces one review per
    // line; catching it here turns a 500 into the sentence the buyer needs.
    if (error?.code === 11000) {
      throw new ApiError(409, 'You have already reviewed this part on this order.');
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* admin                                                                       */
/* -------------------------------------------------------------------------- */

/** Every review, newest first, for the moderation screen. */
async function listForAdmin({ q = '', hidden = '' } = {}) {
  const { Review } = db();

  const query = {};
  if (hidden === 'hidden') query.isHidden = true;
  if (hidden === 'visible') query.isHidden = { $ne: true };

  const reviews = await Review.find(query)
    .sort({ createdAt: -1 })
    .limit(300)
    .populate('product', 'name sku slug')
    .lean();

  const rows = reviews
    .map((review) => ({
      id: review._id.toString(),
      rating: review.rating,
      title: review.title ?? '',
      body: review.body,
      authorName: review.authorName,
      authorBusiness: review.authorBusiness ?? '',
      productName: review.product?.name ?? 'Deleted part',
      productSku: review.product?.sku ?? '',
      productSlug: review.product?.slug ?? '',
      isHidden: Boolean(review.isHidden),
      hiddenReason: review.hiddenReason ?? '',
      createdAt: review.createdAt,
    }))
    // Filtering after the populate, because the searchable product name lives
    // on the other collection.
    .filter((row) => {
      if (!q) return true;
      const needle = q.toLowerCase();
      return (
        row.productName.toLowerCase().includes(needle) ||
        row.authorName.toLowerCase().includes(needle) ||
        row.body.toLowerCase().includes(needle)
      );
    });

  const counts = rows.reduce(
    (acc, row) => {
      acc[row.isHidden ? 'hidden' : 'visible'] += 1;
      return acc;
    },
    { visible: 0, hidden: 0 },
  );

  return { rows, counts, total: rows.length };
}

/** Hide or unhide one review. */
async function setHidden(id, { isHidden, reason = '' }) {
  const review = await db().Review.findByIdAndUpdate(
    id,
    { $set: { isHidden: Boolean(isHidden), hiddenReason: isHidden ? reason.trim() : '' } },
    { new: true },
  ).lean();

  if (!review) throw new ApiError(404, 'Review not found');
  return { id: review._id.toString(), isHidden: Boolean(review.isHidden) };
}

export default { summaryFor, listForProduct, listPending, create, listForAdmin, setHidden };
export { summaryFor, listForProduct, listPending, create, listForAdmin, setHidden };
