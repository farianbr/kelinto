import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Ticket.js';
import '../models/ServiceQuote.js';
import '../models/Quote.js';
import '../models/Invoice.js';
import '../models/InvoiceLabel.js';
import '../models/Service.js';
import '../models/DeviceCatalog.js';
import '../models/Product.js';
import '../models/User.js';
import '../models/Settings.js';
import { InvoiceStatusRun } from '../models/InvoiceStatusRule.js';
import { CONDITION_PARTS } from '../../../shared/deviceCondition.js';
import { TAX_RATES } from '../../../shared/schemas/admin.js';
import * as ticketService from '../services/ticketService.js';
import * as serviceQuoteService from '../services/serviceQuoteService.js';
import { createInvoice } from '../services/adminService.js';
import { applyPayment } from '../services/invoicePaymentService.js';
import { setInvoiceLabel } from '../services/invoiceLabelService.js';
import { partsDemand, returnRepairParts } from '../services/repairPartsService.js';
import creditService from '../services/creditService.js';

/**
 * Repair-side sales demo data, made the way the screens make it (client
 * request, 2026-10-06: "remove the old dummy data for quote, ticket, invoices
 * and create fresh data following the new create forms").
 *
 * ## Why this replaces three seeds and a block of `npm run seed`
 *
 * The old demo data was written as raw records: `repairs.data.js` inside
 * `npm run seed`, and `seed:demo -- sales`, `seed:demo -- sales` and
 * `seed:demo -- invoice-history` on top. Raw records drift from the forms the moment a
 * form changes - and they had: tickets with a typed customer and no account, a
 * priority field that no longer exists, no business stamp (so they showed on
 * no list), repair quotes kept in the web quote collection (`Quote`), no service
 * references on lines and no condition grid.
 *
 * Everything here goes through the **same service functions the create forms
 * call** - `createQuote`, `convertToTicket`, `createTicket`, `setTicketStatus`,
 * `recordDeposit`, `createInvoice` - so a seeded record is exactly what a
 * person at the counter would have produced, stock movements and the
 * quote → ticket → invoice links included.
 *
 * ## It never messages anybody
 *
 * Every status move is made with an empty channel list (the dialog's "change it
 * silently"), payments go through `applyPayment` rather than the path that
 * emails a receipt, and only the seeded demo customers (`@example.ca`) are
 * used, never an account somebody created by hand.
 *
 * ## Usage
 *
 *   npm run seed:demo -- sales --dry-run   what --reset would delete, per business
 *   npm run seed:demo -- sales --reset     delete the old data, then build fresh
 *   npm run seed:demo -- sales                build fresh on top of what is there
 *
 * **What `--reset` deletes**: every ticket, every repair quote, the old
 * repair quotes left in the web quote collection (any quote that points
 * at a ticket), and every invoice that does not bill an order and is not a
 * store-credit receipt. Invoices behind parts orders, store-credit receipts,
 * web quotes and all accounts are left alone. Parts a deleted invoice
 * had taken go back on the shelf; each affected customer's line of credit is
 * recomputed.
 *
 * Runs over every business that is not deleted and has a repair catalogue
 * (services and a device list); one without is skipped with a line saying so.
 */

const DEMO_CUSTOMER = /@example\.ca$/i;
const DAY = 86_400_000;

const isoDay = (daysFromNow) => new Date(Date.now() + daysFromNow * DAY).toISOString().slice(0, 10);

/** A full drop-off grid, mostly fine, with the part the job is about marked. */
function conditionFor(problemPart) {
  return Object.fromEntries(
    CONDITION_PARTS.map((part) => {
      if (part.key === problemPart) {
        const bad = part.options.find((option) => option.value !== 'good') ?? part.options[0];
        return [part.key, bad.value];
      }
      const good = part.options.find((option) => option.value === 'good') ?? part.options[0];
      return [part.key, good.value];
    }),
  );
}

// ---- reset ------------------------------------------------------------------

async function resetSales({ dryRun = false, log = console.log } = {}) {
  const m = db();

  const tickets = await m.Ticket.find({}).select('_id').lean();
  const quotes = await m.ServiceQuote.countDocuments({});
  const repairQuotes = await m.Quote.find({ convertedTicket: { $ne: null } }).select('_id').lean();
  const invoiceFilter = { order: null, kind: { $ne: 'receipt' } };
  const invoices = await m.Invoice.find(invoiceFilter)
    .select('_id number user devices partsStockMovedAt business')
    .lean();

  log(
    `    ${dryRun ? 'would delete' : 'deleting'}: ${tickets.length} tickets, ${quotes} repair quotes, ` +
      `${repairQuotes.length} old repair quotes, ${invoices.length} repair and hand-raised invoices`,
  );
  if (dryRun) return { tickets: tickets.length, quotes, repairQuotes: repairQuotes.length, invoices: invoices.length };

  // Parts a deleted ticket was holding go back (an invoiced one's too: its
  // invoice is deleted with it), then parts an invoice took itself.
  const holding = await m.Ticket.find({ partsStockMovedAt: { $ne: null } })
    .select('_id ticketNumber devices business')
    .lean();
  for (const ticket of holding) {
    await returnRepairParts(partsDemand(ticket.devices), {
      reference: { kind: 'ticket', id: ticket._id, label: ticket.ticketNumber },
      business: ticket.business ?? undefined,
      note: 'Back on the shelf: demo ticket removed by seed:demo -- sales --reset.',
    });
  }
  for (const invoice of invoices) {
    if (!invoice.partsStockMovedAt) continue;
    await returnRepairParts(partsDemand(invoice.devices), {
      reference: { kind: 'invoice', id: invoice._id, label: invoice.number },
      business: invoice.business ?? undefined,
      note: 'Back on the shelf: demo invoice removed by seed:demo -- sales --reset.',
    });
  }

  const invoiceIds = invoices.map((invoice) => invoice._id);
  await InvoiceStatusRun.deleteMany({ invoice: { $in: invoiceIds } });
  await m.Invoice.deleteMany({ _id: { $in: invoiceIds } });
  await m.Ticket.deleteMany({});
  await m.ServiceQuote.deleteMany({});
  await m.Quote.deleteMany({ _id: { $in: repairQuotes.map((quote) => quote._id) } });

  // The line of credit is summed from open invoices, so it moves with them.
  const users = [...new Set(invoices.map((invoice) => String(invoice.user)).filter(Boolean))];
  for (const user of users) await creditService.syncBalance(user);

  return { tickets: tickets.length, quotes, repairQuotes: repairQuotes.length, invoices: invoices.length };
}

// ---- inputs -----------------------------------------------------------------

/** Every model in the shop's own device tree, with the names of its ancestors. */
async function deviceModels() {
  const nodes = await db().DeviceCatalog.find({}).select('kind name parent').lean();
  const byId = new Map(nodes.map((node) => [String(node._id), node]));

  return nodes
    .filter((node) => node.kind === 'model')
    .map((node) => {
      const chain = {};
      for (let at = node; at; at = at.parent ? byId.get(String(at.parent)) : null) chain[at.kind] = at.name;
      return {
        category: chain.deviceType ?? '',
        brand: chain.brand ?? '',
        series: chain.series ?? '',
        model: chain.model ?? '',
      };
    });
}

/** The parts on the shelf that fit a device, the same match the part search uses. */
async function partsFor(device) {
  const exact = (value) => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  return db()
    .Product.find({
      brandName: exact(device.brand),
      $or: [{ modelName: exact(device.model) }, { modelSlug: { $in: [null, ''] } }],
      stock: { $gte: 4 },
      category: { $in: [null, 'parts'] },
    })
    .select('name sku price stock')
    .limit(6)
    .lean();
}

const serviceLine = (service) => ({
  name: service.name,
  description: service.description || '',
  priceDollars: (service.priceCents ?? 0) / 100,
  qty: 1,
  service: String(service._id),
});

const partLine = (part, qty = 1) => ({
  name: part.name,
  description: part.sku || '',
  priceDollars: (part.price ?? 0) / 100,
  qty,
  product: String(part._id),
});

// ---- build ------------------------------------------------------------------

/**
 * The jobs, written as a counter would describe them. Each names the part of
 * the device the job is about, which is what the drop-off grid marks.
 */
const JOBS = [
  { problem: 'Dropped face down; glass cracked across the top third, touch still works.', solution: 'Replace the display assembly.', part: 'screen', service: /screen/i, part2: /screen/i },
  { problem: 'Battery drains from full to empty in about two hours.', solution: 'Replace the battery and recalibrate.', part: 'battery', service: /battery/i, part2: /battery/i },
  { problem: 'Will not charge unless the cable is held at an angle.', solution: 'Clean the port; replace it if the pins are worn.', part: 'chargingPort', service: /charg|port/i, part2: /charg|port/i },
  { problem: 'Back glass shattered after a fall; camera ring intact.', solution: 'Replace the back glass.', part: 'backGlass', service: /back|glass|housing/i, part2: /back/i },
  { problem: 'Rear camera will not focus; photos come out blurred.', solution: 'Replace the rear camera module.', part: 'backCamera', service: /camera/i, part2: /back camera/i },
  { problem: 'Caller cannot be heard unless on speaker.', solution: 'Replace the earpiece speaker.', part: 'earSpeaker', service: /speaker|ear/i, part2: /speaker/i },
  { problem: 'Front camera shows a black screen in every app.', solution: 'Replace the front camera.', part: 'frontCamera', service: /camera/i, part2: /front camera/i },
  { problem: 'No sound from the bottom speaker; ringtone silent.', solution: 'Replace the loudspeaker.', part: 'loudSpeaker', service: /speaker/i, part2: /speaker/i },
];

const NOTES = {
  client: [
    'Customer will collect after 5 pm.',
    'Please call before replacing anything over the quoted price.',
    'Customer asked us to keep the old screen.',
    '',
  ],
  technician: [
    'Frame slightly bent at the lower corner; straightened before fitting.',
    'Adhesive replaced, water seal reapplied.',
    'Tested all buttons and both cameras after the repair.',
    '',
  ],
  internal: ['Returning customer, offer the loyalty discount next time.', 'Part ordered from Pacific Cell.', '', ''],
};

/** Walk a ticket up the status ladder, silently, so its timeline reads like real work. */
async function moveTicket(ticketId, path, actor) {
  for (const status of path) {
    await ticketService.setTicketStatus(ticketId, { status, channels: [], note: undefined }, actor);
  }
}

const LADDER = ['accepted', 'waiting_for_parts', 'ready_to_repair', 'processing', 'ready_to_pickup', 'completed'];
const pathTo = (target) => (target === 'diagnosis' ? [] : LADDER.slice(0, LADDER.indexOf(target) + 1));

async function buildSales({ businessId, log = console.log } = {}) {
  const m = db();

  const customers = (await m.User.find({ role: 'buyer', status: 'approved' }).lean()).filter((user) =>
    DEMO_CUSTOMER.test(user.email ?? ''),
  );
  const staff = await m.User.find({ role: { $in: ['staff', 'admin'] }, lockedAt: null }).lean();
  const services = await m.Service.find({ isActive: true }).lean();
  const devices = await deviceModels();

  if (customers.length < 3 || !services.length || !devices.length || !staff.length) {
    log(
      `    skipped: needs demo customers (${customers.length}), services (${services.length}), ` +
        `a device list (${devices.length}) and staff (${staff.length}). Run seed and seed:demo -- service-business first.`,
    );
    return null;
  }

  const actor = staff[0]._id;
  const technicians = staff.filter((person) => person.role === 'staff');
  // A status whose message is ON would queue that message for the customer on
  // the next run, so the seed only uses one that is off (as invoice-history does).
  const label = await m.InvoiceLabel.findOne({
    name: 'Thanks for Support',
    isActive: true,
    messageActive: { $ne: true },
  }).lean();

  // Devices that have parts on the shelf come first, so most jobs carry a part.
  const withParts = [];
  for (const device of devices) {
    const parts = await partsFor(device);
    if (parts.length) withParts.push({ device, parts });
    if (withParts.length >= 10) break;
  }
  const pool = withParts.length ? withParts : devices.slice(0, 10).map((device) => ({ device, parts: [] }));

  let n = 0;
  const pick = (list) => list[n % list.length];

  /** One device block, as the form sends it. */
  function deviceFor({ withCondition = true } = {}) {
    const { device, parts } = pick(pool);
    const job = JOBS[n % JOBS.length];
    const service = services.find((entry) => job.service.test(entry.name)) ?? pick(services);
    const part = parts.find((entry) => job.part2.test(entry.name)) ?? parts[0];
    n += 1;
    return {
      ...device,
      serial: `SN${String(100000 + n * 7919).slice(-6)}`,
      problem: job.problem,
      solution: job.solution,
      notes: n % 3 === 0 ? 'Minor scratches on the frame, noted at drop-off.' : '',
      ...(withCondition ? { condition: conditionFor(job.part) } : {}),
      services: [serviceLine(service)],
      parts: part ? [partLine(part)] : [],
    };
  }

  const notesFor = (i) => ({
    clientNotes: NOTES.client[i % NOTES.client.length],
    technicianNotes: NOTES.technician[i % NOTES.technician.length],
  });

  const counts = { quotes: 0, tickets: 0, invoices: 0 };

  // ---- quotes ---------------------------------------------------------------
  // One per state a quote can be in, two of them taken through to tickets.
  const quotePlan = [
    { status: 'draft', serviceType: 'walk_in', daysAgo: 1 },
    { status: 'sent', serviceType: 'pickup', daysAgo: 3 },
    { status: 'accepted', serviceType: 'onsite', daysAgo: 4 },
    { status: 'rejected', serviceType: 'walk_in', daysAgo: 12 },
    { status: 'expired', serviceType: 'walk_in', daysAgo: 30 },
    { status: 'converted', serviceType: 'walk_in', daysAgo: 9, ticketTo: 'processing' },
    { status: 'converted', serviceType: 'pickup', daysAgo: 16, ticketTo: 'ready_to_pickup' },
  ];

  for (const [i, spec] of quotePlan.entries()) {
    const customer = customers[i % customers.length];
    const { quote } = await serviceQuoteService.createQuote(
      {
        user: String(customer._id),
        source: i % 2 ? 'phone' : 'counter',
        serviceType: spec.serviceType,
        quoteDate: isoDay(-spec.daysAgo),
        validUntil: isoDay(spec.status === 'expired' ? -spec.daysAgo + 14 : 21 - spec.daysAgo),
        devices: [deviceFor({ withCondition: false })],
        ...notesFor(i),
        internalNotes: NOTES.internal[i % NOTES.internal.length],
        province: 'AB',
        taxRate: TAX_RATES.AB,
      },
      actor,
      businessId,
    );
    counts.quotes += 1;

    const ladder = { sent: ['sent'], accepted: ['sent', 'accepted'], rejected: ['sent', 'rejected'], expired: ['sent'], converted: ['sent', 'accepted'] };
    for (const status of ladder[spec.status] ?? []) {
      await serviceQuoteService.setQuoteStatus(quote.id, { status }, actor);
    }
    // Through the raw collection: `createdAt` is immutable to mongoose, which
    // drops it from an update without saying so.
    await m.ServiceQuote.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(quote.id) },
      { $set: { createdAt: new Date(Date.now() - spec.daysAgo * DAY) } },
    );

    if (spec.status === 'converted') {
      const { ticket } = await serviceQuoteService.convertToTicket(quote.id, {}, actor);
      counts.tickets += 1;
      // The counter grades the device once it is in their hands.
      const stored = await m.Ticket.findById(ticket.id);
      stored.devices.forEach((device, index) => {
        device.condition = conditionFor(JOBS[(i + index) % JOBS.length].part);
      });
      stored.technician = technicians.length ? pick(technicians)._id : null;
      await stored.save();
      await moveTicket(ticket.id, pathTo(spec.ticketTo), actor);
      if (spec.ticketTo === 'ready_to_pickup') counts.invoices += 1;
    }
  }

  // ---- tickets --------------------------------------------------------------
  // Raised at the counter, across the status ladder, with real ages so the SLA
  // warning and the Age column have something to show.
  const tickets = [
    { to: 'diagnosis', daysAgo: 0, serviceType: 'walk_in' },
    { to: 'diagnosis', daysAgo: 1, serviceType: 'walk_in', deposit: 40 },
    { to: 'accepted', daysAgo: 2, serviceType: 'pickup' },
    { to: 'waiting_for_parts', daysAgo: 9, serviceType: 'walk_in', deposit: 60 },
    { to: 'ready_to_repair', daysAgo: 4, serviceType: 'onsite' },
    { to: 'processing', daysAgo: 3, serviceType: 'walk_in', devices: 2 },
    { to: 'ready_to_pickup', daysAgo: 6, serviceType: 'walk_in', deposit: 50, pay: 'full', label: true },
    { to: 'ready_to_pickup', daysAgo: 5, serviceType: 'pickup', pay: 'part' },
    { to: 'completed', daysAgo: 14, serviceType: 'walk_in', pay: 'full', label: true },
    { to: 'completed', daysAgo: 20, serviceType: 'onsite' },
    { to: 'cancelled', daysAgo: 11, serviceType: 'walk_in' },
  ];

  for (const [i, spec] of tickets.entries()) {
    const customer = customers[(i + 2) % customers.length];
    const { ticket } = await ticketService.createTicket(
      {
        user: String(customer._id),
        serviceType: spec.serviceType,
        source: i % 4 === 3 ? 'phone' : 'counter',
        technician: technicians.length ? String(pick(technicians)._id) : '',
        dueDate: isoDay(-spec.daysAgo + 3),
        devices: Array.from({ length: spec.devices ?? 1 }, () => deviceFor()),
        ...notesFor(i),
        notes: NOTES.internal[i % NOTES.internal.length],
        province: 'AB',
        taxRate: TAX_RATES.AB,
      },
      actor,
      businessId,
    );
    counts.tickets += 1;

    if (spec.deposit) {
      await ticketService.recordDeposit(ticket.id, { amountDollars: spec.deposit, method: 'card' }, { _id: actor });
    }

    // A cancelled job had got somewhere first.
    const path = spec.to === 'cancelled' ? ['accepted', 'cancelled'] : pathTo(spec.to);
    await moveTicket(ticket.id, path, actor);

    // Raw collection, for the reason given on the quotes above. A closed job
    // closed a couple of days after it came in, so its age stops there.
    const openedAt = new Date(Date.now() - spec.daysAgo * DAY);
    await m.Ticket.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(ticket.id) },
      {
        $set: {
          createdAt: openedAt,
          ...(['completed', 'cancelled'].includes(spec.to)
            ? { closedAt: new Date(openedAt.getTime() + Math.min(spec.daysAgo, 3) * DAY) }
            : {}),
        },
      },
    );

    // Reaching ready to pickup raised the invoice; settle it as the counter would.
    const stored = await m.Ticket.findById(ticket.id).lean();
    if (stored.invoice) {
      counts.invoices += 1;
      const invoice = await m.Invoice.findById(stored.invoice);
      const owed = invoice.amount - invoice.amountPaid;
      if (spec.pay && owed > 0) {
        await applyPayment(invoice, {
          amount: spec.pay === 'full' ? owed : Math.max(1, Math.round(owed / 2)),
          method: i % 2 ? 'cash' : 'card',
          reference: 'At the counter',
        });
      }
      if (spec.label && label) {
        const fresh = await m.Invoice.findById(stored.invoice).lean();
        await setInvoiceLabel(fresh.number, { labelId: String(label._id), channels: label.channels ?? ['email'] });
      }
    }
  }

  // ---- invoices raised by hand ----------------------------------------------
  // A repair billed without a ticket: an on-site job priced on the spot.
  for (const [i, spec] of [
    { serviceType: 'onsite', pay: 'full' },
    { serviceType: 'walk_in', pay: null },
  ].entries()) {
    const customer = customers[(i + 5) % customers.length];
    // Returns the shaped invoice itself, not an envelope.
    const invoice = await createInvoice(
      {
        user: String(customer._id),
        issuedAt: isoDay(-(i + 2)),
        terms: 'prepaid',
        serviceType: spec.serviceType,
        devices: [deviceFor({ withCondition: false })],
        customerNotes: 'Thank you for choosing us.',
        technicianNotes: 'Device tested and working before handover.',
        internalNotes: 'Raised without a ticket: priced at the customer’s door.',
        province: 'AB',
        taxPercent: TAX_RATES.AB,
      },
      businessId,
    );
    counts.invoices += 1;
    if (spec.pay) {
      const stored = await m.Invoice.findOne({ number: invoice.number });
      await applyPayment(stored, { amount: stored.amount - stored.amountPaid, method: 'card', reference: 'On site' });
    }
  }

  log(
    `    built: ${counts.quotes} quotes, ${counts.tickets} tickets, ${counts.invoices} invoices`,
  );
  return counts;
}

// ---- CLI --------------------------------------------------------------------

async function seedSales({ reset = false, dryRun = false, log = console.log } = {}) {
  const businesses = await db().Business.find({ deletedAt: null }).select('name code').lean();
  for (const business of businesses) {
    log(`  ${business.name} (${business.code})`);
    await runInBusiness(
      { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
      async () => {
        if (reset || dryRun) await resetSales({ dryRun, log });
        if (!dryRun) await buildSales({ businessId: business._id, log });
      },
    );
  }
}

if (process.argv[1] && process.argv[1].endsWith('sales-demo.js')) {
  (async () => {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === '1';
    const reset = args.includes('--reset') || process.env.RESET === '1';

    console.log(`\n  Sales demo data${dryRun ? ' (dry run, nothing written)' : reset ? ' (reset, then build)' : ''}\n`);
    await connectDb();
    await seedSales({ reset, dryRun });
    console.log('\n  Done.\n');
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error('\n  seed:demo -- sales failed:', error.message, '\n');
    process.exit(1);
  });
}

export { seedSales, resetSales, buildSales };
export default seedSales;
