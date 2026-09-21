import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Quote.js';
import '../models/Order.js';
import '../models/User.js';
import '../models/Product.js';
import '../models/Settings.js';
import { buildQuotes } from './sales.data.js';

/**
 * Demo quotes, added to a database that already has real data.
 *
 * **Seeds every business, each in its own database** (2026-09-21). It used to
 * seed whichever database `MONGODB_URI` named and nothing else, so on a
 * multi-business install only the default business ever got quotes - and the
 * other one looked like a screen that did not work rather than a screen with
 * nothing in it. A business missing the accounts or the catalogue a quote
 * needs is **skipped with a line saying so**, not thrown on: one business
 * without a parts shelf must not stop the rest of the run.
 *
 * **Additive, like `seed:content` - it never wipes.** `npm run seed` rebuilds
 * the whole database from scratch, which is the wrong tool for "give me some
 * quotes to look at" on an instance that already holds accounts and orders
 * somebody is using. This adds rows and leaves everything else alone.
 *
 * Quote numbers continue from whatever is already there rather than restarting
 * at 1, so running it twice does not collide on the unique index - and it
 * refuses to run at all against a database with no approved buyer or no
 * catalogue, because a quote is priced *for an account* and a quote with no
 * lines teaches the screen nothing.
 *
 * Pricing comes from `buildQuotes`, the same builder the full seed uses, which
 * computes totals exactly as `quoteService.recomputeTotals` does. Duplicating
 * that arithmetic here is how a seeded quote ends up disagreeing with one the
 * running code would produce.
 */

/**
 * The one state `buildQuotes` cannot produce on its own.
 *
 * `converted` means a real order came out of the quote, so it needs an order to
 * point at - the builder runs before orders exist in the full seed, and a
 * `convertedOrder` pointing at nothing would render a broken link on the row
 * the client's screenshots show. It is added here, where orders are already in
 * the database.
 */
async function attachConverted(quote, order) {
  return {
    ...quote,
    status: 'converted',
    convertedOrder: order._id,
    timeline: [
      ...quote.timeline,
      { status: 'accepted', at: order.createdAt, note: 'Client accepted.' },
      { status: 'converted', at: order.createdAt, note: `Converted to ${order.orderNumber}.` },
    ],
  };
}

/**
 * One business. Returns what it did rather than exiting, so the caller can
 * keep going and report at the end.
 */
async function seedQuotes() {
  const [buyers, products, settings] = await Promise.all([
    db().User.find({ role: 'buyer', status: 'approved' }).select('_id businessName').lean(),
    db().Product.find({ isActive: true }).select('_id sku name price cost').limit(200).lean(),
    db().Settings.load(),
  ]);

  /*
    Skipped, not thrown.

    A quote is priced for an account and made of lines, so a business with
    neither has nothing to seed - which is a fact about that business, not a
    failure of the run. Throwing here stopped every business after it.
  */
  if (!buyers.length) {
    console.log('    skipped - no approved buyer to quote for');
    return { skipped: 'no buyers' };
  }
  if (!products.length) {
    console.log('    skipped - no active products to put on a quote');
    return { skipped: 'no products' };
  }

  // Continue the sequence rather than restarting it, so a second run does not
  // collide on `quoteNumber`'s unique index.
  const year = new Date().getFullYear();
  const prefix = `QT-${year}-`;
  const last = await db().Quote.findOne({ quoteNumber: new RegExp(`^${prefix}`) })
    .sort({ quoteNumber: -1 })
    .select('quoteNumber')
    .lean();
  const startAt = last ? Number(last.quoteNumber.slice(prefix.length)) + 1 : 1;

  const rate = db().Settings.rateFor(settings, 'ON');
  const built = buildQuotes({ products, users: buyers, rate, year });

  // Renumber onto the end of the existing sequence.
  const rows = built.map((quote, index) => ({
    ...quote,
    quoteNumber: `${prefix}${String(startAt + index).padStart(5, '0')}`,
  }));

  // Give one of them the `converted` state, pointed at a real order.
  const order = await db().Order.findOne({ status: { $ne: 'cancelled' } })
    .sort({ createdAt: -1 })
    .select('_id orderNumber createdAt user')
    .lean();

  if (order) {
    /**
     * The converted row is **added**, not promoted from the accepted one.
     *
     * Converting the accepted quote in place left the `accepted` filter with
     * nothing in it - the builder produces exactly one of each state, so
     * borrowing one empties a pill. It is cloned instead, and belongs to the
     * account that actually placed the order, because a quote converted into
     * somebody else's order is nonsense.
     */
    const source = rows.find((row) => row.status === 'accepted') ?? rows[0];

    rows.push(
      await attachConverted(
        {
          ...source,
          user: order.user,
          quoteNumber: `${prefix}${String(startAt + rows.length).padStart(5, '0')}`,
          createdAt: order.createdAt,
          updatedAt: order.createdAt,
        },
        order,
      ),
    );
  }

  const inserted = await db().Quote.insertMany(rows);

  const byStatus = inserted.reduce((out, row) => {
    out[row.status] = (out[row.status] ?? 0) + 1;
    return out;
  }, {});

  console.log(`    added ${inserted.length} quotes (${inserted[0].quoteNumber} … ${inserted[inserted.length - 1].quoteNumber})`);
  console.log(`      by status: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`      total in this business: ${await db().Quote.countDocuments({})}`);
  if (!order) {
    console.log('      note: no order to point at, so nothing is `converted`.');
  }

  return { added: inserted.length };
}

// CLI entry: `npm run seed:quotes`
if (process.argv[1] && process.argv[1].endsWith('quotes.js')) {
  (async () => {
    console.log('\n  Seeding demo quotes…\n');
    await connectDb();

    const businesses = await db()
      .Business.find({ deletedAt: null })
      .select('name code')
      .lean();

    /**
     * No businesses at all means a single-database install, so seed whatever
     * the URI names - the same fallback every other business-scoped seed makes.
     */
    const targets = businesses.length ? businesses : [null];
    const results = [];

    for (const business of targets) {
      if (business) console.log(`  ${business.name} (${business.code})`);

      if (business) {
        results.push(
          await runInBusiness(
            {
              businessId: String(business._id),
              code: business.code,
              connection: dbFor(business.code),
            },
            () => seedQuotes(),
          ),
        );
      } else {
        results.push(await seedQuotes());
      }
    }

    const seeded = results.filter((row) => row.added).length;
    console.log(`\n  Done. ${seeded} of ${results.length} business(es) got quotes.\n`);
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch(async (error) => {
    console.error(`\n  Seeding quotes failed: ${error.message}\n`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
}

export { seedQuotes };
export default seedQuotes;
