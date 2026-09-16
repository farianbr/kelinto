import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/InvoiceLabel.js';
// Registered for the business roster read below. `Business` is control-plane,
// so it is never bound to a business connection - see `db/models.js`.
import '../models/Business.js';

/**
 * The starter manual invoice statuses (Sales § Invoice).
 *
 * **Upsert by name, never wipe.** `Invoice.label` points at these by id, so
 * deleting and re-inserting would detach the status from every invoice carrying
 * it - the column would empty out with no record of what it said. A row an admin
 * has renamed, recoloured or retired is left exactly as they left it, and only
 * genuinely missing names are added. Safe on a database with real invoices, and
 * safe to run twice.
 *
 * **Only one of these sends mail**, and it is the reason the flag is data rather
 * than code: "Thanks for Support" is what CellShoppe says when a repair is
 * finished and paid for, and that is the moment to send the warranty. Another
 * shop will word it differently, and a garage may not send one at all.
 *
 * Per business, because the vocabulary is the shop's own - and because the
 * collection lives in the shop's own database. A product business is skipped:
 * a parts wholesaler has orders and invoices but no "your repair is finished"
 * to say.
 *
 * All of them are editable from `/admin/settings/invoice-labels` - this is a
 * starting point, not a fixed list.
 */
/**
 * Two, and "no status" is the third answer.
 *
 * **Deliberately short.** It started as five - Picked Up, Awaiting Pickup,
 * Follow Up, Disputed - and that was a second workflow competing with the
 * ticket: where a repair has got to is what `Ticket.status` already tracks,
 * through nine stages, and duplicating a worse version of it on the invoice
 * gives a shop two places to look and two answers to reconcile.
 *
 * What is left is the thing an invoice can say that a ticket cannot: the job is
 * closed and this is how we left it with the customer. A picker of three reads
 * as a decision; a picker of six reads as a form.
 */
const INVOICE_LABELS = [
  {
    name: 'Thanks for Support',
    colorToken: 'ok',
    // The one that mails. See the header note.
    sendsWarrantyEmail: true,
    order: 10,
  },
  {
    name: 'Thank You for Being Part of Us',
    colorToken: 'brand',
    // A second way of saying the same thing, for a shop that prefers the
    // warmer wording. It does NOT mail: two labels that both send would make
    // "once per invoice" depend on which one somebody happened to pick first.
    sendsWarrantyEmail: false,
    order: 20,
  },
];

async function seedInvoiceLabels({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const existing = await db().InvoiceLabel.find({}).select('name').lean();
  const have = new Set(existing.map((label) => label.name));

  const missing = INVOICE_LABELS.filter((label) => !have.has(label.name));
  if (missing.length) await db().InvoiceLabel.insertMany(missing);

  log(`    invoice statuses: ${missing.length} added, ${have.size} already present`);
  return { added: missing.length, existing: have.size };
}

// CLI entry: `npm run seed:invoice-labels`
if (process.argv[1] && process.argv[1].endsWith('invoice-labels.js')) {
  (async () => {
    console.log('\n  Seeding manual invoice statuses…\n');
    await connectDb();

    const businesses = await db()
      .Business.find({ deletedAt: null })
      .select('name code businessType')
      .lean();

    /**
     * No businesses at all means a single-database install, so seed whatever
     * the URI names - the same fallback every other business-scoped seed makes.
     */
    const targets = businesses.length ? businesses : [null];
    const results = [];

    for (const business of targets) {
      if (business && business.businessType === 'product') {
        console.log(`  ${business.name} (${business.code}) - product business, skipped`);
        continue;
      }

      if (business) console.log(`  ${business.name} (${business.code})`);
      const work = () => seedInvoiceLabels();

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

export { INVOICE_LABELS, seedInvoiceLabels };
export default seedInvoiceLabels;
