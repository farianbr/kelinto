import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/InvoiceLabel.js';

/**
 * An invoice status sends on a LIST of channels now (client ruling,
 * 2026-10-06: "template statuses should allow multiple channel selection").
 *
 * Each status written before the change holds a single `channel`. This copies
 * it into `channels` and removes the old field, through the raw collection,
 * because the model no longer declares `channel` and mongoose would neither
 * read nor unset it. A status with no channel at all gets email, which was the
 * old default.
 *
 * Runs over every business, the soft-deleted Cellvix one included, so no
 * database keeps the retired field.
 *
 * Idempotent: it matches only statuses that still carry `channel` or lack
 * `channels`, so a second run finds nothing.
 */
async function moveChannels({ log = console.log } = {}) {
  const collection = db().InvoiceLabel.collection;
  const rows = await collection
    .find({ $or: [{ channel: { $exists: true } }, { channels: { $exists: false } }] })
    .project({ channel: 1, channels: 1 })
    .toArray();

  for (const row of rows) {
    const channels = row.channels?.length ? row.channels : [row.channel || 'email'];
    await collection.updateOne({ _id: row._id }, { $set: { channels }, $unset: { channel: '' } });
  }

  log(`    ${rows.length} status${rows.length === 1 ? '' : 'es'} moved to a channel list`);
  return { moved: rows.length };
}

/** Every business, each in its own database. */
async function backfillLabelChannels({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const businesses = await db().Business.find({}).select('name code').lean();
  for (const business of businesses) {
    log(`  ${business.name} (${business.code})`);
    await runInBusiness(
      { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
      () => moveChannels({ log }),
    );
  }
}

export { backfillLabelChannels, moveChannels };
export default backfillLabelChannels;
