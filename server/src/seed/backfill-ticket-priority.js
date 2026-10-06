import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Ticket.js';

/**
 * Tickets no longer carry a priority (client ruling, 2026-10-05: "delete the
 * Priority field", from the code, the screens and the database alike).
 *
 * The field is gone from the model, so mongoose would simply stop reading it,
 * but every ticket written before the change still holds `priority` on disk,
 * and the collection still holds the index the old `index: true` built. Both
 * are removed here through the raw collection, which is the only handle that
 * can still see a field the schema no longer declares.
 *
 * Runs over **every** business, the soft-deleted Cellvix one included: its
 * database is kept, so its tickets are kept too, and leaving the old field in
 * one of them is exactly the obsolete data this exists to clear.
 *
 * Idempotent: it matches only tickets that still have the field, and dropping
 * an index that is already gone is caught and reported as nothing to do.
 */
async function clearPriority({ log = console.log } = {}) {
  const collection = db().Ticket.collection;

  const { modifiedCount } = await collection.updateMany(
    { priority: { $exists: true } },
    { $unset: { priority: '' } },
  );

  let dropped = false;
  try {
    await collection.dropIndex('priority_1');
    dropped = true;
  } catch {
    // No such index: a database created after the change, or a second run.
  }

  log(`    ${modifiedCount} tickets cleared${dropped ? ', priority index dropped' : ''}`);
  return { cleared: modifiedCount, indexDropped: dropped };
}

/** Every business, each in its own database. */
async function backfillTicketPriority({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const businesses = await db().Business.find({}).select('name code').lean();
  for (const business of businesses) {
    log(`  ${business.name} (${business.code})`);
    await runInBusiness(
      { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
      () => clearPriority({ log }),
    );
  }
}

export { backfillTicketPriority, clearPriority };
export default backfillTicketPriority;
