import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/InvoiceLabel.js';
import '../models/Settings.js';
import { paletteFor, migrateColorToken } from '../../../shared/businessPalette.js';
import { labelMessages } from './invoice-label-messages.js';
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
 * **Neither sends anything.** Each gets a designed demo message
 * (`invoice-label-messages.js`), written only where the status has none, so an
 * owner's own words are never replaced. Every message is left switched OFF:
 * the owner turns it on in the ERP; a seed never decides to contact a customer.
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
    order: 10,
  },
  {
    name: 'Thank You for Being Part of Us',
    colorToken: 'brand',
    // A second way of saying the same thing, for a shop that prefers the
    // warmer wording.
    order: 20,
  },
];

async function seedInvoiceLabels({ quiet = false, colorToken } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const existing = await db().InvoiceLabel.find({}).select('name').lean();
  const have = new Set(existing.map((label) => label.name));

  const missing = INVOICE_LABELS.filter((label) => !have.has(label.name));
  if (missing.length) await db().InvoiceLabel.insertMany(missing);

  /*
    The demo messages, in this business's colour and with its own contact
    details. Written only onto a starter status whose message is empty, and
    always left off: `messageActive` is never touched here.
  */
  const settings = await db().Settings.load();
  const info = settings?.business ?? {};
  const messages = labelMessages({
    brand: paletteFor(migrateColorToken(colorToken)).base,
    reviewUrl: info.reviewUrl || info.googleReviewsUrl || '',
    phone: info.phone || '',
    email: info.supportEmail || info.email || '',
  });

  let written = 0;
  for (const [name, fields] of Object.entries(messages)) {
    const result = await db().InvoiceLabel.updateOne(
      { name, $or: [{ message: { $exists: false } }, { message: '' }, { message: null }] },
      { $set: fields },
    );
    written += result.modifiedCount;
  }

  log(
    `    invoice statuses: ${missing.length} added, ${have.size} already present, ` +
      `${written} demo message${written === 1 ? '' : 's'} written`,
  );
  return { added: missing.length, existing: have.size, messages: written };
}

// CLI entry: `npm run seed:demo -- invoice-labels`
if (process.argv[1] && process.argv[1].endsWith('invoice-labels.js')) {
  (async () => {
    console.log('\n  Seeding manual invoice statuses…\n');
    await connectDb();

    const businesses = await db()
      .Business.find({ deletedAt: null })
      .select('name code businessType colorToken')
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
      const work = () => seedInvoiceLabels({ colorToken: business?.colorToken });

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
