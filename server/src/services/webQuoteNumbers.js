import { db } from '../db/models.js';
import '../models/ContactMessage.js';
import '../models/Quote.js';

/**
 * The `WQ-` series: `WQ-2026-00001`.
 *
 * A web quote is an enquiry from the website's contact form (client,
 * 2026-10-06: "web quote IS the contact form enquiries from the website"), and
 * each one carries a number from the day it arrives (`ContactMessage.number`).
 * The product `Quote` was given `WQ-` the same morning and keeps it, so the two
 * draw from **one** counter: the next number is one past the highest either
 * holds for the year, and no enquiry and quote ever share a number a person
 * could read out to the wrong record. `QT-` is the service quote's, apart.
 */
const PREFIX = 'WQ';

function prefixFor(year) {
  return `${PREFIX}-${year}-`;
}

/** The highest sequence used in a year, across both records. */
async function highest(year) {
  const prefix = prefixFor(year);
  const rx = new RegExp(`^${prefix}`);
  const [quote, enquiry] = await Promise.all([
    db().Quote.findOne({ quoteNumber: rx }).sort({ quoteNumber: -1 }).select('quoteNumber').lean(),
    db().ContactMessage.findOne({ number: rx }).sort({ number: -1 }).select('number').lean(),
  ]);
  const of = (value) => (value ? Number(value.slice(prefix.length)) || 0 : 0);
  return Math.max(of(quote?.quoteNumber), of(enquiry?.number));
}

const format = (year, sequence) => `${prefixFor(year)}${String(sequence).padStart(5, '0')}`;

/** The next `WQ-` number for the current year. */
async function nextWebQuoteNumber(date = new Date()) {
  const year = date.getFullYear();
  return format(year, (await highest(year)) + 1);
}

/**
 * Create a record under a fresh number, retrying when two arrive at once and
 * the unique index refuses the second. `create(number)` does the insert.
 */
async function withWebQuoteNumber(create, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    const number = await nextWebQuoteNumber();
    try {
      return await create(number);
    } catch (error) {
      if (error?.code !== 11000 || attempt >= attempts) throw error;
    }
  }
}

/**
 * Number every enquiry that has none, oldest first, in the year it arrived.
 * Used by the seed after it inserts enquiries and by
 * `npm run backfill -- enquiry-numbers`. Idempotent.
 */
async function numberEnquiries() {
  const rows = await db()
    .ContactMessage.find({ $or: [{ number: null }, { number: '' }, { number: { $exists: false } }] })
    .sort({ createdAt: 1, _id: 1 })
    .select('createdAt')
    .lean();
  const next = new Map();
  for (const row of rows) {
    const year = new Date(row.createdAt ?? Date.now()).getFullYear();
    if (!next.has(year)) next.set(year, (await highest(year)) + 1);
    const sequence = next.get(year);
    next.set(year, sequence + 1);
    await db().ContactMessage.updateOne({ _id: row._id }, { $set: { number: format(year, sequence) } });
  }
  return rows.length;
}

export { nextWebQuoteNumber, withWebQuoteNumber, numberEnquiries, highest as highestWebQuoteSequence };
