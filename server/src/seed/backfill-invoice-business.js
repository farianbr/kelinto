import { connectDb, disconnectDb } from '../config/db.js';
import { controlModels, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Invoice.js';
import '../models/Order.js';
import '../models/User.js';
import { db } from '../db/models.js';

/**
 * Stamps `business` onto invoices that were written without one.
 *
 * ## What went wrong
 *
 * Four things create an `Invoice`, and only the ticket path set `business`. A
 * receipt raised by `storeCreditService`, an invoice raised off an order, and a
 * standalone charge raised by an admin all wrote the document with the field
 * absent.
 *
 * **An unassigned record is invisible under every business, not visible under
 * all of them.** So the document showed on the customer's own profile, which
 * scopes by user, and was missing from the Invoices screen, which scopes by
 * business - one document giving two different answers about whether it exists,
 * with nothing anywhere reporting an error.
 *
 * ## Why not `backfill-business.js`
 *
 * That one assigns every unscoped record to the **oldest** business, which was
 * correct for its own job: it ran when there was one business and the records
 * predated the field. It is wrong now. An orphaned receipt belonging to a
 * CellShoppe customer would be handed to Cellvix, which does not fix the bug so
 * much as move it somewhere harder to see.
 *
 * This derives the business from the record itself - the order it settles, or
 * failing that the customer it belongs to - and **leaves a row alone when
 * neither knows**, because a wrong business is worse than a missing one.
 *
 * Runs per business database, since that is where invoices live.
 */

async function backfillInvoiceBusiness({ quiet = false, dryRun = false } = {}) {
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  const businesses = await controlModels().Business.find({ deletedAt: null }).select('code name').lean();
  if (businesses.length === 0) {
    log('No businesses exist - nothing to do.');
    return { assigned: 0 };
  }

  let assigned = 0;
  let skipped = 0;

  for (const business of businesses) {
    await runInBusiness(
      { businessId: business._id, code: business.code, connection: dbFor(business.code) },
      async () => {
        const orphans = await db()
          .Invoice.find({ $or: [{ business: null }, { business: { $exists: false } }] })
          .select('number kind user order')
          .lean();

        if (orphans.length === 0) {
          log(`  ${business.code} ${business.name}: nothing to do`);
          return;
        }

        log(`  ${business.code} ${business.name}: ${orphans.length} unscoped`);

        for (const invoice of orphans) {
          /**
           * The order first, the customer second.
           *
           * An order resolved its own business when it was placed, so it is the
           * more direct answer. A receipt and a standalone charge have no
           * order, and there the customer is the only thing that knows.
           */
          let target = null;

          if (invoice.order) {
            const order = await db().Order.findById(invoice.order).select('business').lean();
            target = order?.business ?? null;
          }

          if (!target && invoice.user) {
            const owner = await db().User.findById(invoice.user).select('business').lean();
            target = owner?.business ?? null;
          }

          if (!target) {
            // Neither the order nor the customer knows. Guessing here would
            // file somebody's money under the wrong business, which is worse
            // than leaving a row for a person to look at.
            log(`    ${invoice.number}: no business on its order or customer - left alone`);
            skipped += 1;
            continue;
          }

          if (!dryRun) {
            await db().Invoice.updateOne({ _id: invoice._id }, { $set: { business: target } });
          }
          log(`    ${invoice.number} (${invoice.kind}): ${dryRun ? 'would assign' : 'assigned'}`);
          assigned += 1;
        }
      },
    );
  }

  log(`\n${dryRun ? 'Would assign' : 'Assigned'} ${assigned} invoice(s).${skipped ? ` ${skipped} left alone.` : ''}`);
  return { assigned, skipped };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDb();
  try {
    await backfillInvoiceBusiness({ dryRun });
  } finally {
    await disconnectDb();
  }
}

// Run only when invoked directly, so the function can also be imported.
if (process.argv[1]?.endsWith('backfill-invoice-business.js')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { backfillInvoiceBusiness };
export default backfillInvoiceBusiness;
