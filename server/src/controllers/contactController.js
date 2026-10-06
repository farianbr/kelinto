import { asyncHandler } from '../utils/ApiError.js';
import { db } from '../db/models.js';
import '../models/ContactMessage.js';
import { withWebQuoteNumber } from '../services/webQuoteNumbers.js';

/**
 * Accepts a contact enquiry: a web quote, numbered as it arrives (`WQ-`).
 *
 * Stored, not emailed - no mail provider is configured yet. Storing means the
 * message survives until one is, which a fire-and-forget stub would not.
 * TODO(email): notify the sales desk once a provider is chosen (PROGRESS.md Q7).
 */
const submit = asyncHandler(async (req, res) => {
  const row = await withWebQuoteNumber((number) =>
    db().ContactMessage.create({ ...req.body, number, user: req.user?._id ?? null }),
  );

  res.status(201).json({
    number: row.number,
    message: `Thanks - the sales desk has your message and will reply within one business day. Your reference is ${row.number}.`,
  });
});

export { submit };
