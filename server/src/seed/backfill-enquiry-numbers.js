import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import { numberEnquiries } from '../services/webQuoteNumbers.js';

/**
 * Give every web quote (website enquiry) its `WQ-` number (2026-10-06).
 *
 * Enquiries were unnumbered until the client asked for the number on the Web
 * Quote screen. This numbers each one that has none, oldest first, in the year
 * it arrived, continuing the counter the product `Quote` shares
 * (`services/webQuoteNumbers.js`). Every business, each in its own database.
 * Idempotent: a numbered enquiry is never renumbered.
 */
async function backfillEnquiryNumbers({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const businesses = await db().Business.find({}).select('name code').lean();
  for (const business of businesses) {
    const numbered = await runInBusiness(
      { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
      () => numberEnquiries(),
    );
    log(`  ${business.name} (${business.code}): ${numbered} web quotes numbered`);
  }
}

export { backfillEnquiryNumbers };
export default backfillEnquiryNumbers;
