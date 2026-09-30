import mongoose from 'mongoose';

/**
 * One Google review of the BUSINESS, entered by hand in the ERP.
 *
 * Not `Review`, which is a buyer's review of a part they bought on a delivered
 * order and is verified by that order. These are what people said about the
 * business on Google, copied in by staff (client ruling 2026-09-30: hand-entered
 * first, a Places sync can fill the same collection later). Keeping them apart
 * keeps `Review`'s one guarantee true: every row there was earned by an order.
 *
 * `photoUrl` is an R2 KEY like every other media field; the service adds the
 * public origin on the way out (`storage.urlOf`).
 */
const googleReviewSchema = new mongoose.Schema(
  {
    authorName: { type: String, required: true, trim: true, maxlength: 80 },
    photoUrl: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    // When the reviewer wrote it on Google, as they did. Printed as "7 months
    // ago", so it has to be the real date rather than the day it was copied in.
    reviewedAt: { type: Date, required: true },
    isPublished: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

googleReviewSchema.index({ isPublished: 1, order: 1, reviewedAt: -1 });

const GoogleReview = mongoose.model('GoogleReview', googleReviewSchema);

export { GoogleReview };
export default GoogleReview;
