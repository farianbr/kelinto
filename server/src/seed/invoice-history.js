import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Invoice.js';
import '../models/InvoiceLabel.js';
import '../models/User.js';
import '../models/CreditTransaction.js';
// Registered for the business roster read below. `Business` is control-plane,
// so it is never bound to a business connection - see `db/models.js`.
import '../models/Business.js';
import { refundableOf } from '../services/invoiceRefundService.js';

/**
 * Demo history on invoices that already exist: a manual status, and one refund.
 *
 * **Additive, and it never invents an invoice.** The invoices come from
 * `seed:service-quotes` and the ticket flow; this only decorates ones already
 * there, so running it cannot produce a repair invoice with no repair behind it.
 * Running it twice is a no-op: an invoice that already carries a label is left
 * alone, and the refund is skipped once one is present.
 *
 * ## Why the refund goes through the service
 *
 * `invoiceRefundService.refundInvoice` writes the negative payment row, moves
 * the store-credit balance through `storeCreditService` and re-derives the
 * status. Writing those by hand here would produce a demo refund that no screen
 * agrees about - an invoice reading `paid` with a refund row under it, or a
 * balance the ledger cannot explain. A seeded record should be one a staff
 * member could have produced through the UI, which means going the same way.
 *
 * ## What it deliberately does NOT do
 *
 * **No label that sends the warranty email.** Setting one on a paid invoice
 * mails a real customer, and a seed script is the last place that should decide
 * to contact somebody. The mailing label stays available in the picker for a
 * human to choose; this only applies the quiet ones.
 */

/**
 * The label the demo applies, by name.
 *
 * One, and it is the quiet one: the other seeded status mails the customer
 * their warranty, and a seed script is the last place that should decide to
 * contact somebody. Named rather than "the first non-mailing label" so it is
 * obvious which one a re-run will use.
 */
const LABEL_PLAN = ['Thank You for Being Part of Us'];

async function seedInvoiceHistory({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const labels = await db()
    .InvoiceLabel.find({ isActive: true, sendsWarrantyEmail: false })
    .select('name')
    .lean();

  if (labels.length === 0) {
    log('    no manual statuses yet - run seed:invoice-labels first');
    return { labelled: 0, refunded: 0 };
  }

  const byName = new Map(labels.map((label) => [label.name, label._id]));

  /**
   * Real repair invoices only.
   *
   * A `receipt` is a store-credit movement, not a document with work on it, so a
   * manual status saying "Picked Up" against one would describe nothing.
   */
  const invoices = await db()
    .Invoice.find({ kind: { $in: ['invoice', 'due'] } })
    .sort({ issuedAt: 1 })
    .select('number status label amount amountPaid payments')
    .lean();

  let labelled = 0;
  let index = 0;

  for (const invoice of invoices) {
    // Already decorated by a human or an earlier run.
    if (invoice.label) continue;
    // Thanking somebody who has not paid yet is the wrong note, and it is the
    // same rule the warranty email follows.
    if (invoice.status !== 'paid') continue;

    const name = LABEL_PLAN[index % LABEL_PLAN.length];
    const labelId = byName.get(name);
    index += 1;
    if (!labelId) continue;

    await db().Invoice.updateOne(
      { _id: invoice._id },
      { $set: { label: labelId, labelSetAt: new Date() } },
    );
    labelled += 1;
  }

  log(`    manual statuses: set on ${labelled} invoice(s)`);

  /**
   * One partial refund, on the first invoice that can take one.
   *
   * To store credit rather than cash, because that is the case with two halves
   * to look at: the invoice row AND the ledger entry AND the customer's balance,
   * which is what somebody reviewing the feature wants to see joined up. A cash
   * refund is the simpler half and needs no demo to be legible.
   */
  let refunded = 0;

  /**
   * Skipped outright once ANY invoice carries a refund.
   *
   * **Caught by re-running the seed, which is the only way to catch it.** The
   * first version skipped invoices that were already refunded and took the next
   * clean one, so a second run refunded a second invoice and a third run a
   * third: real money moving every time somebody re-seeded, which is exactly
   * what "additive and safe to run twice" is supposed to rule out. One demo
   * refund is the whole point, so the question is "does one exist", not "which
   * invoice has not got one".
   */
  const anyRefund = await db().Invoice.findOne({
    kind: { $in: ['invoice', 'due'] },
    payments: { $elemMatch: { amount: { $lt: 0 }, method: { $ne: 'reversal' } } },
  })
    .select('number')
    .lean();

  if (anyRefund) {
    log(`    refund: ${anyRefund.number} already carries one, nothing to do`);
    return { labelled, refunded };
  }

  const candidates = await db()
    .Invoice.find({ kind: { $in: ['invoice', 'due'] } })
    .sort({ issuedAt: 1 })
    .select('number payments user');

  for (const invoice of candidates) {
    const refundable = refundableOf(invoice);
    // Something worth looking at: a refund of a few cents demonstrates nothing,
    // and refunding everything leaves no remaining balance to show the cap.
    if (refundable < 5000) continue;

    const amount = Math.round(refundable / 4 / 100) * 100;
    if (amount <= 0) continue;

    const { refundInvoice } = await import('../services/invoiceRefundService.js');
    await refundInvoice(
      invoice.number,
      {
        amountCents: amount,
        toStoreCredit: true,
        reason: 'Replacement part came in under quote',
      },
      null,
    );

    log(
      `    refund: $${(amount / 100).toFixed(2)} of ${invoice.number} to store credit`,
    );
    refunded += 1;
    break;
  }

  if (refunded === 0) log('    refund: nothing eligible - no invoice has enough paid on it');

  return { labelled, refunded };
}

// CLI entry: `npm run seed:invoice-history`
if (process.argv[1] && process.argv[1].endsWith('invoice-history.js')) {
  (async () => {
    console.log('\n  Seeding invoice statuses and a demo refund…\n');
    await connectDb();

    const businesses = await db()
      .Business.find({ deletedAt: null })
      .select('name code businessType')
      .lean();

    const targets = businesses.length ? businesses : [null];
    const results = [];

    for (const business of targets) {
      if (business && business.businessType === 'product') {
        console.log(`  ${business.name} (${business.code}) - product business, skipped`);
        continue;
      }

      if (business) console.log(`  ${business.name} (${business.code})`);
      const work = () => seedInvoiceHistory();

      if (business) {
        results.push(
          await runInBusiness(
            {
              businessId: String(business._id),
              code: business.code,
              connection: dbFor(business.code),
            },
            work,
          ),
        );
      } else {
        results.push(await work());
      }
    }

    console.log(`\n  Done. ${results.length} business(es) seeded.\n`);
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error('\n  Seed failed:', error.message, '\n');
    process.exit(1);
  });
}

export { seedInvoiceHistory };
export default seedInvoiceHistory;
