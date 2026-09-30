import { db } from '../db/models.js';
import { currentContext } from '../db/context.js';
import '../models/GoogleReview.js';
import ApiError from '../utils/ApiError.js';
import storage from './storageService.js';
import settingsService from './settingsService.js';

/**
 * The business's Google reviews, entered by hand (SEO › Reviews, Google tab).
 *
 * Kept apart from `reviewService`, which handles buyers' reviews of parts and
 * checks every one against a delivered order. Nothing here is verified by us;
 * it is copied from the business's Google profile, and the website says it
 * came from Google and links there.
 */

function serialize(review) {
  return {
    id: review._id.toString(),
    authorName: review.authorName,
    // Stored as a key, sent as an address.
    photoUrl: storage.urlOf(review.photoUrl ?? ''),
    rating: review.rating,
    text: review.text,
    reviewedAt: review.reviewedAt,
    isPublished: review.isPublished !== false,
    order: review.order ?? 0,
    updatedAt: review.updatedAt,
  };
}

/** The date typed in the form. A date in the future is a typo, not a review. */
function reviewedAtFrom(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest('Enter the date it was posted.', 'VALIDATION', { reviewedAt: 'Enter a date.' });
  }
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw ApiError.badRequest('That date has not happened yet.', 'VALIDATION', { reviewedAt: 'Not in the future.' });
  }
  return date;
}

function assertOwnPhoto(url) {
  if (url && !storage.isAllowedUrl(url, currentContext()?.code)) {
    throw ApiError.badRequest('Upload the photo here rather than linking to another site.', 'ASSET_NOT_OURS', {
      photoUrl: 'Upload the photo instead.',
    });
  }
}

function shapeWrite(data) {
  return {
    authorName: data.authorName,
    photoUrl: storage.toKey(data.photoUrl ?? ''),
    rating: data.rating,
    text: data.text,
    reviewedAt: reviewedAtFrom(data.reviewedAt),
    isPublished: data.isPublished !== false,
    order: data.order ?? 0,
  };
}

/**
 * The website's reviews section. Newest first within the owner's order, capped:
 * a carousel of a hundred cards is a page nobody scrolls, and the summary line
 * links to the rest on Google.
 */
async function listPublic() {
  const [reviews, summary] = await Promise.all([
    db().GoogleReview.find({ isPublished: true }).sort({ order: 1, reviewedAt: -1 }).limit(24).lean(),
    settingsService.googleSummary(),
  ]);
  return { summary, reviews: reviews.map(serialize) };
}

async function listForAdmin() {
  const [reviews, summary] = await Promise.all([
    db().GoogleReview.find({}).sort({ order: 1, reviewedAt: -1 }).limit(500).lean(),
    settingsService.googleSummary(),
  ]);
  return { summary, reviews: reviews.map(serialize) };
}

async function create(data) {
  assertOwnPhoto(data.photoUrl);
  const review = await db().GoogleReview.create(shapeWrite(data));
  await storage.claim([data.photoUrl], currentContext()?.code);
  return serialize(review.toObject());
}

async function update(id, data) {
  assertOwnPhoto(data.photoUrl);
  const review = await db().GoogleReview.findById(id);
  if (!review) throw ApiError.notFound('Review not found.', 'REVIEW_NOT_FOUND');
  const before = review.photoUrl;
  Object.assign(review, shapeWrite(data));
  await review.save();
  await storage.releaseReplaced([before], [data.photoUrl ?? ''], currentContext()?.code);
  return serialize(review.toObject());
}

async function remove(id) {
  const review = await db().GoogleReview.findByIdAndDelete(id).lean();
  if (!review) throw ApiError.notFound('Review not found.', 'REVIEW_NOT_FOUND');
  await storage.release(review.photoUrl, currentContext()?.code);
  return serialize(review);
}

async function updateSummary(data) {
  return settingsService.updateGoogleSummary(data);
}

export default { listPublic, listForAdmin, create, update, remove, updateSummary };
export { listPublic, listForAdmin, create, update, remove, updateSummary };
