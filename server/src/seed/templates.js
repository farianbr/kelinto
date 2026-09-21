import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/MessageTemplate.js';
// Registered for the business roster read below. `Business` is control-plane,
// so it is never bound to a business connection - see `db/models.js`.
import '../models/Business.js';

/**
 * The messages a shop sends as work moves through it.
 *
 * ## Why these exist as seed data
 *
 * `/admin/settings/templates` is a grid of "what do we say at this status", and
 * an empty grid teaches nobody what it is for: a staff member opening a screen
 * of forty-five blank cells has no idea what a good message looks like, and the
 * screen reads as broken rather than as unfilled. These are a worked example on
 * the statuses a customer actually hears about.
 *
 * **Deliberately not every status.** Diagnosis, Waiting for Parts, Ready to
 * Pickup and Completed are the four a customer wants to hear about; Accepted,
 * Processing and Ready to Repair are internal, and a shop that messages on
 * every one of the nine is a shop whose customers stop reading. The gaps are
 * part of the example.
 *
 * ## Why the wording is plain
 *
 * Each one is short enough to be an SMS and says the one thing that changed.
 * `{{shopName}}` rather than a typed company name, because the same seed runs
 * on every business and a message naming the wrong shop is exactly the defect
 * the token exists to prevent.
 *
 * Upsert by (channel, document, status), never wiped: a message an owner has
 * rewritten is theirs, and re-running this must not put the house wording back.
 */
const TEMPLATES = [
  // ---- SMS: the channel a repair shop actually uses ----------------------
  {
    channel: 'sms',
    document: 'ticket',
    status: 'diagnosis',
    name: 'Ticket · Diagnosis',
    body: 'Hi {{contactName}}, we have your device and are looking at it now. We will let you know what it needs before any work starts. - {{shopName}}',
  },
  {
    channel: 'sms',
    document: 'ticket',
    status: 'waiting_for_parts',
    name: 'Ticket · Waiting for Parts',
    body: 'Hi {{contactName}}, the part for your repair is on order. We will text you as soon as it lands and work restarts. - {{shopName}}',
  },
  {
    channel: 'sms',
    document: 'ticket',
    status: 'ready_to_pickup',
    name: 'Ticket · Ready to Pickup',
    body: 'Good news {{contactName}} - your device is ready to collect. Ticket {{ticketNumber}}. - {{shopName}}',
  },
  {
    channel: 'sms',
    document: 'ticket',
    status: 'completed',
    name: 'Ticket · Completed',
    body: 'Thanks {{contactName}}, your repair is complete and collected. Any trouble at all, bring it back to us. - {{shopName}}',
  },
  {
    channel: 'sms',
    document: 'invoice',
    status: 'overdue',
    name: 'Invoice · Overdue',
    body: 'Hi {{contactName}}, invoice {{invoiceNumber}} is past due at {{amount}}. Please get in touch if anything is unclear. - {{shopName}}',
  },

  // ---- WhatsApp: the same two moments, slightly longer --------------------
  {
    channel: 'whatsapp',
    document: 'ticket',
    status: 'ready_to_pickup',
    name: 'Ticket · Ready to Pickup',
    body: 'Hi {{contactName}}, your device is repaired and ready to collect. Ticket {{ticketNumber}}, balance {{amount}}. We are open until 6pm. - {{shopName}}',
  },
  {
    channel: 'whatsapp',
    document: 'quote',
    status: 'sent',
    name: 'Quote · Sent',
    body: 'Hi {{contactName}}, we have sent over your repair estimate. Reply here if you would like us to go ahead. - {{shopName}}',
  },

  // ---- Email: the ones that carry a subject line -------------------------
  {
    channel: 'email',
    document: 'ticket',
    status: 'diagnosis',
    name: 'Ticket · Diagnosis',
    subject: 'We have your device - {{ticketNumber}}',
    body: 'Hi {{contactName}},\n\nThanks for bringing your device in. It is booked in as {{ticketNumber}} and our technician is looking at it now.\n\nWe will be in touch with what it needs and what it will cost before any work starts.\n\n{{shopName}}',
  },
  {
    channel: 'email',
    document: 'ticket',
    status: 'ready_to_pickup',
    name: 'Ticket · Ready to Pickup',
    subject: 'Your repair is ready - {{ticketNumber}}',
    body: 'Hi {{contactName}},\n\nYour device is repaired and ready to collect. The balance due is {{amount}}.\n\nPlease bring this email or your ticket number {{ticketNumber}} with you.\n\n{{shopName}}',
  },
  {
    channel: 'email',
    document: 'invoice',
    status: 'unpaid',
    name: 'Invoice · Unpaid',
    subject: 'Invoice {{invoiceNumber}} from {{shopName}}',
    body: 'Hi {{contactName}},\n\nInvoice {{invoiceNumber}} is attached, for {{amount}}.\n\nThank you for your business.\n\n{{shopName}}',
  },

  // ---- Call: a script, not a message -------------------------------------
  {
    channel: 'call',
    document: 'ticket',
    status: 'waiting_for_parts',
    name: 'Ticket · Waiting for Parts',
    body: 'Let the customer know the part is delayed, give the new expected date, and ask whether they would rather collect the device unrepaired in the meantime.',
  },
  {
    channel: 'call',
    document: 'ticket',
    status: 'retention_policy',
    name: 'Ticket · Retention Policy',
    body: 'Device has been ready for collection for some time. Remind the customer of the holding period, confirm they still want it, and note the outcome on the ticket.',
  },
];

async function seedTemplates({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const existing = await db()
    .MessageTemplate.find({ status: { $gt: '' } })
    .select('channel document status')
    .lean();

  const have = new Set(existing.map((row) => `${row.channel}:${row.document}:${row.status}`));

  const missing = TEMPLATES.filter(
    (row) => !have.has(`${row.channel}:${row.document}:${row.status}`),
  ).map((row) => ({ ...row, subject: row.subject ?? '', isActive: true }));

  if (missing.length) await db().MessageTemplate.insertMany(missing);

  log(`    notification messages: ${missing.length} added, ${have.size} already present`);
  return { added: missing.length, existing: have.size };
}

// CLI entry: `npm run seed:templates`
if (process.argv[1] && process.argv[1].endsWith('templates.js')) {
  (async () => {
    console.log('\n  Seeding notification messages…\n');
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
      if (business) console.log(`  ${business.name} (${business.code})`);
      const work = () => seedTemplates();

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

export { TEMPLATES, seedTemplates };
export default seedTemplates;
