import { asyncHandler } from '../utils/ApiError.js';
import ApiError from '../utils/ApiError.js';
import { db } from '../db/models.js';
import '../models/ContactMessage.js';
import { likeRegex } from '../utils/regex.js';
import { displayNameOf } from '../utils/displayName.js';

/**
 * Web quotes - enquiries the storefront's contact form sent in.
 *
 * **They are `ContactMessage` rows, not a new record type.** Somebody asking
 * "what would it cost to fix this" through the website has not created a quote:
 * a quote is a priced document with line items and an expiry, which nobody can
 * produce until the shop has read the enquiry. Storing web enquiries as draft
 * quotes would fill the Quotes list with rows carrying no prices, no validity
 * and nothing to convert.
 *
 * So this is the inbox, and `Convert` is the bridge: it opens the real quote
 * form seeded with the enquirer's details. What was previously invisible
 * contact messages had no admin screen at all - becomes a queue that can be
 * worked and closed.
 */

/** Newest first, because this is a queue and the top of it is what is unanswered. */
function shape(row) {
  return {
    id: row._id.toString(),
    // WQ-2026-00012: the web quote number (services/webQuoteNumbers.js).
    number: row.number ?? null,
    name: row.name,
    business: row.business ?? null,
    email: row.email,
    phone: row.phone ?? null,
    topic: row.topic,
    orderNumber: row.orderNumber ?? null,
    message: row.message,
    status: row.status,
    // Set when a signed-in customer submitted it, so the row can link to the
    // account rather than making somebody search for it by email.
    user: row.user?._id
      ? {
          id: row.user._id.toString(),
          displayName: displayNameOf(row.user),
          email: row.user.email ?? null,
        }
      : null,
    createdAt: row.createdAt,
  };
}

async function listWebQuotes({ status, q, user } = {}) {
  const query = {};

  if (status && status !== 'all') query.status = String(status);
  // The customer profile's Web Quotes tab - only enquiries from that account.
  if (user) query.user = user;

  if (q) {
    const rx = likeRegex(q);
    query.$or = [{ number: rx }, { name: rx }, { email: rx }, { phone: rx }, { message: rx }];
  }

  const [rows, counts] = await Promise.all([
    db().ContactMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('user', 'contactName businessName email')
      .lean(),
    // Counts over the whole collection, not the filtered set: a pill showing
    // the count of what the current filter already excludes is useless.
    db().ContactMessage.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  return {
    webQuotes: rows.map(shape),
    counts: Object.fromEntries(counts.map((row) => [row._id, row.count])),
  };
}

/**
 * Moving an enquiry through the queue.
 *
 * Three states only - `new`, `read`, `closed`. An enquiry that became a real
 * quote is closed here and lives on as that quote; duplicating its progress in
 * two places is how the two start disagreeing.
 */
async function setWebQuoteStatus(id, status) {
  const row = await db().ContactMessage.findByIdAndUpdate(
    id,
    { $set: { status } },
    { new: true },
  ).populate('user', 'contactName businessName email');

  if (!row) throw ApiError.notFound('Enquiry not found.', 'WEB_QUOTE_NOT_FOUND');
  return { webQuote: shape(row.toObject()) };
}

const list = asyncHandler(async (req, res) => {
  res.json(await listWebQuotes(req.query));
});

const setStatus = asyncHandler(async (req, res) => {
  res.json(await setWebQuoteStatus(req.params.id, req.body.status));
});

export { list, setStatus, listWebQuotes };
