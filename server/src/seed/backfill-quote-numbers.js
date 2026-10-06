import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Quote.js';
import '../models/ServiceQuote.js';
import '../models/Ticket.js';
import '../models/Order.js';
import '../models/Invoice.js';

/**
 * Quote numbers say which kind of quote they are (client ruling, 2026-10-06).
 *
 * A **quote** (`ServiceQuote`, the service side) is `QT-`; a **web quote**
 * (`Quote`, products from the website) is `WQ-`. Before this the quote was
 * `EST-` - short for a word the client does not use - and the web quote held
 * `QT-`. So, in this order:
 *
 *   1. every web quote `QT-YYYY-N` becomes `WQ-YYYY-N`;
 *   2. every quote `EST-YYYY-N` becomes `QT-YYYY-N`;
 *   3. the numbers written into timeline notes and invoice references
 *      ("Converted from quote EST-2026-00003.") are rewritten to match.
 *
 * Year and sequence are kept, so a number a customer was given still reads the
 * same apart from its prefix. Links between records are ids and do not move.
 *
 * Every business, the soft-deleted Cellvix one included. Idempotent: it only
 * matches numbers still on the old prefixes.
 */

const NUMBER = /\b(QT|EST)-\d{4}-\d+\b/g;

async function renumber({ log = console.log } = {}) {
  const m = db();
  const map = new Map();

  const webQuotes = await m.Quote.collection.find({ quoteNumber: /^QT-/ }).project({ quoteNumber: 1 }).toArray();
  for (const row of webQuotes) {
    const next = row.quoteNumber.replace(/^QT-/, 'WQ-');
    map.set(row.quoteNumber, next);
    await m.Quote.collection.updateOne({ _id: row._id }, { $set: { quoteNumber: next } });
  }

  const quotes = await m.ServiceQuote.collection.find({ quoteNumber: /^EST-/ }).project({ quoteNumber: 1 }).toArray();
  for (const row of quotes) {
    const next = row.quoteNumber.replace(/^EST-/, 'QT-');
    map.set(row.quoteNumber, next);
    await m.ServiceQuote.collection.updateOne({ _id: row._id }, { $set: { quoteNumber: next } });
  }

  // Only numbers that were actually renamed are rewritten, so a note that
  // happens to contain some other code is left as it is.
  const rewrite = (text) =>
    typeof text === 'string' ? text.replace(NUMBER, (match) => map.get(match) ?? match) : text;

  let notes = 0;
  if (map.size) {
    for (const model of [m.Quote, m.ServiceQuote, m.Ticket, m.Order]) {
      const rows = await model.collection
        .find({ 'timeline.note': { $regex: NUMBER.source } })
        .project({ timeline: 1 })
        .toArray();
      for (const row of rows) {
        const timeline = row.timeline.map((entry) => ({ ...entry, note: rewrite(entry.note) }));
        await model.collection.updateOne({ _id: row._id }, { $set: { timeline } });
        notes += 1;
      }
    }

    const invoices = await m.Invoice.collection
      .find({ reference: { $regex: NUMBER.source } })
      .project({ reference: 1 })
      .toArray();
    for (const row of invoices) {
      await m.Invoice.collection.updateOne({ _id: row._id }, { $set: { reference: rewrite(row.reference) } });
      notes += 1;
    }
  }

  log(`    ${webQuotes.length} web quotes to WQ-, ${quotes.length} quotes to QT-, ${notes} records' notes updated`);
  return { webQuotes: webQuotes.length, quotes: quotes.length, notes };
}

/** Every business, each in its own database. */
async function backfillQuoteNumbers({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const businesses = await db().Business.find({}).select('name code').lean();
  for (const business of businesses) {
    log(`  ${business.name} (${business.code})`);
    await runInBusiness(
      { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
      () => renumber({ log }),
    );
  }
}

export { backfillQuoteNumbers, renumber };
export default backfillQuoteNumbers;
