import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Ticket.js';
import '../models/User.js';

/**
 * Demo repair tickets (Sales § Ticket).
 *
 * **Seeds every business, each in its own database** (2026-09-21). It used to
 * seed whichever database `MONGODB_URI` named, so on a multi-business install
 * only the default business got tickets - and CellShoppe, the one that
 * actually repairs things, was the business left with an empty board.
 *
 * **Insert-only, never wipe.** Unlike `run.js`, this is safe on a database with
 * real work in it: it adds the tickets whose numbers are missing and touches
 * nothing else, so it can be run twice without duplicating a board or
 * destroying a ticket somebody actually opened.
 *
 * The rows are spread across the status vocabulary and given real ages so the
 * list has something to show: a couple are deliberately past the 7-day SLA so
 * the Age column's warning treatment is visible, and the closed ones carry a
 * `closedAt` so they read as the days the work took rather than the days since.
 */

/** Days ago, as a Date. */
function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000);
}

/**
 * `[status, ageDays, closedAfterDays | null]`.
 *
 * `closedAfterDays` is only meaningful for a closed status - it is what makes a
 * completed repair read "2d" rather than "24d".
 */
const DEMO_TICKETS = [
  {
    customerName: 'Aayush Yadav',
    customerPhone: '+1 9336523862',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 15 Pro Max',
    issue: 'Battery drains within a few hours.',
    status: 'diagnosis',
    priority: 'normal',
    source: 'kiosk',
    age: 1,
    estimateCents: 12_900,
  },
  {
    customerName: 'Aisha Khan',
    customerPhone: '+1 7804514944',
    customerEmail: 'aisha.khan@example.ca',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 13 Pro Max',
    issue: 'Screen replacement - waiting on the OEM panel.',
    status: 'waiting_for_parts',
    priority: 'high',
    age: 13,
    estimateCents: 34_900,
  },
  {
    customerName: 'Aisha Khan',
    customerPhone: '+1 7804514944',
    customerEmail: 'aisha.khan@example.ca',
    deviceBrand: 'Apple',
    deviceModel: 'iPad Pro 12.9 (2022)',
    issue: 'Will not charge past 40%.',
    status: 'completed',
    priority: 'normal',
    age: 13,
    closedAfter: 4,
    estimateCents: 18_900,
    finalCents: 17_500,
  },
  {
    customerName: 'David Reyes',
    customerPhone: '+1 7802197935',
    deviceBrand: 'Google',
    deviceModel: 'Pixel 8 Pro',
    issue: 'Software boot loop after an update.',
    status: 'completed',
    priority: 'low',
    age: 20,
    closedAfter: 2,
    estimateCents: 7_900,
    finalCents: 7_900,
  },
  {
    customerName: 'Michael Reyes',
    customerPhone: '+1 7802166941',
    deviceBrand: 'Samsung',
    deviceModel: 'Galaxy S24 Ultra',
    issue: 'Back glass cracked, camera ring intact.',
    status: 'ready_to_pickup',
    priority: 'normal',
    age: 21,
    estimateCents: 24_900,
    finalCents: 23_400,
  },
  {
    customerName: 'Chen Davis',
    customerPhone: '+1 7805855124',
    deviceBrand: 'OnePlus',
    deviceModel: 'OnePlus 13',
    issue: 'Cracked screen, touch not registering on the left edge.',
    status: 'processing',
    priority: 'urgent',
    age: 23,
    estimateCents: 28_900,
  },
  {
    customerName: 'Hana Park',
    customerPhone: '+1 7803678638',
    deviceBrand: 'Motorola',
    deviceModel: 'Edge 50 Pro',
    issue: 'No sound from the earpiece speaker.',
    status: 'ready_to_pickup',
    priority: 'normal',
    age: 24,
    estimateCents: 9_900,
    finalCents: 9_900,
  },
  {
    customerName: 'Priya Brown',
    customerPhone: '+1 7801419610',
    deviceBrand: 'Google',
    deviceModel: 'Pixel 8 Pro',
    issue: 'No sound from speaker after a water spill.',
    status: 'completed',
    priority: 'normal',
    age: 25,
    closedAfter: 6,
    estimateCents: 11_900,
    finalCents: 14_200,
  },
  {
    customerName: 'Marcus Bell',
    customerPhone: '+1 5875550118',
    deviceBrand: 'Apple',
    deviceModel: 'MacBook Air M2',
    issue: 'Keyboard unresponsive after a spill. Customer approved the quote.',
    status: 'accepted',
    priority: 'high',
    age: 4,
    estimateCents: 46_900,
  },
  {
    customerName: 'Sofia Nguyen',
    customerPhone: '+1 6045550142',
    customerEmail: 'sofia.nguyen@example.ca',
    deviceBrand: 'Samsung',
    deviceModel: 'Galaxy Tab S9',
    issue: 'Digitiser replaced, awaiting workshop time.',
    status: 'ready_to_repair',
    priority: 'normal',
    age: 6,
    estimateCents: 21_900,
  },
  {
    customerName: 'Owen Fitzgerald',
    customerPhone: '+1 4165550177',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 12',
    issue: 'Uncollected since the repair finished. Retention letter sent.',
    status: 'retention_policy',
    priority: 'low',
    age: 92,
    estimateCents: 15_900,
    finalCents: 15_900,
  },
  {
    customerName: 'Leila Haddad',
    customerPhone: '+1 5145550163',
    deviceBrand: 'OnePlus',
    deviceModel: 'Nord 4',
    issue: 'Charging port lint-blocked - cleaned, customer declined further work.',
    status: 'cancelled',
    priority: 'low',
    age: 30,
    closedAfter: 1,
    estimateCents: 4_900,
  },
];

async function seedTickets({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const year = new Date().getFullYear();

  // Assign against whoever is actually on this database rather than a name
  // baked into the file - a technician id that points at nothing would show as
  // a blank column and break the filter.
  const staff = await db().User.find({ role: { $in: ['staff', 'admin'] } })
    .select('_id')
    .lean();

  const existing = await db().Ticket.find({ ticketNumber: new RegExp(`^TKT-${year}-`) })
    .select('ticketNumber')
    .lean();

  // Continue the sequence rather than restarting it, so running this on a board
  // that already has tickets cannot collide on the unique index.
  const highest = existing.reduce((max, ticket) => {
    const n = Number(ticket.ticketNumber.slice(`TKT-${year}-`.length));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  const have = new Set(existing.map((ticket) => ticket.ticketNumber));

  // Nothing to do if a previous run already put a full set in - matched by the
  // customer/device pair, since the numbers are assigned fresh each time.
  const already = await db().Ticket.find({
    customerName: { $in: DEMO_TICKETS.map((t) => t.customerName) },
  })
    .select('customerName deviceModel')
    .lean();

  const seen = new Set(already.map((t) => `${t.customerName}|${t.deviceModel}`));
  const missing = DEMO_TICKETS.filter((t) => !seen.has(`${t.customerName}|${t.deviceModel}`));

  if (!missing.length) {
    log(`  tickets: 0 added, ${seen.size} already present`);
    return { added: 0, existing: seen.size };
  }

  const rows = missing.map((demo, index) => {
    const createdAt = daysAgo(demo.age);
    const closed = ['completed', 'cancelled'].includes(demo.status);
    const closedAt = closed ? daysAgo(demo.age - (demo.closedAfter ?? 1)) : null;

    let number = highest + index + 1;
    while (have.has(`TKT-${year}-${String(number).padStart(5, '0')}`)) number += 1;

    return {
      ticketNumber: `TKT-${year}-${String(number).padStart(5, '0')}`,

      customerName: demo.customerName,
      customerPhone: demo.customerPhone,
      customerEmail: demo.customerEmail,

      deviceBrand: demo.deviceBrand,
      deviceModel: demo.deviceModel,
      issue: demo.issue,

      status: demo.status,
      priority: demo.priority,
      source: demo.source ?? 'counter',

      // Leave roughly a third unassigned so the "Unassigned" filter has
      // something to find.
      technician: staff.length && index % 3 !== 0 ? staff[index % staff.length]._id : null,

      estimateCents: demo.estimateCents ?? 0,
      finalCents: demo.finalCents ?? 0,

      closedAt,
      timeline: [{ status: demo.status, at: createdAt, note: 'Opened.' }],

      createdAt,
      updatedAt: closedAt ?? createdAt,
    };
  });

  // `timestamps` would otherwise stamp today over the ages above, and every
  // ticket would read 0d.
  await db().Ticket.insertMany(rows, { timestamps: false });

  log(`  tickets: ${rows.length} added, ${seen.size} already present`);
  return { added: rows.length, existing: seen.size };
}

// CLI entry: `npm run seed:tickets`
if (process.argv[1] && process.argv[1].endsWith('tickets.js')) {
  (async () => {
    console.log('\n  Seeding demo repair tickets…\n');
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
            () => seedTickets(),
          ),
        );
      } else {
        results.push(await seedTickets());
      }
    }

    const added = results.reduce((sum, row) => sum + (row?.added ?? 0), 0);
    console.log(`\n  Done. ${added} ticket(s) added across ${results.length} business(es).\n`);
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch(async (error) => {
    console.error(`\n  Seeding tickets failed: ${error.message}\n`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
}

export { DEMO_TICKETS, seedTickets };
