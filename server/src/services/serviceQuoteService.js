import mongoose from 'mongoose';

import {
  SERVICE_QUOTE_STATUSES,
  SERVICE_TYPES,
} from '../models/ServiceQuote.js';
import { db } from '../db/models.js';
import '../models/Ticket.js';
import '../models/Service.js';
import '../models/User.js';
import ApiError from '../utils/ApiError.js';
import { likeRegex } from '../utils/regex.js';
import { displayNameOf } from '../utils/displayName.js';

/**
 * Repair estimates (Sales § Quote, service businesses).
 *
 * An estimate exists for exactly one case: **the shop has not been handed the
 * device.** Somebody rings up asking what a screen costs, or fills in the web
 * form. A walk-in who puts a handset on the counter skips this entirely and
 * goes straight to a `Ticket` - an estimate for a device already on the bench
 * records nothing the ticket does not.
 *
 * Three rules live here:
 *
 * **Totals are the server's.** The client sends lines and a tax rate; every
 * figure stored is recomputed from them (invariant 8). The `*Cents` fields on
 * the document are a cache of that computation so the estimate can restate what
 * it promised, never an input.
 *
 * **Accepted before converted.** Starting work on an estimate the customer has
 * not agreed to is how a shop ends up eating the cost of it - the same rule
 * `quoteService` holds for orders.
 *
 * **Converting copies the devices whole.** The estimate and the ticket use the
 * same device shape precisely so this is a copy rather than a mapping; a
 * mapping is where a passcode or a per-device problem quietly stops travelling.
 */

/**
 * `EST-2026-00001`.
 *
 * A separate series from `QT-`: the two live in different databases under
 * database-per-business and could never actually collide, but a number that
 * says which kind of document it is saves a staff member opening it to find out.
 */
async function nextQuoteNumber() {
  const year = new Date().getFullYear();
  const prefix = `EST-${year}-`;
  const last = await db()
    .ServiceQuote.findOne({ quoteNumber: new RegExp(`^${prefix}`) })
    .sort({ quoteNumber: -1 })
    .select('quoteNumber')
    .lean();

  const sequence = last ? Number(last.quoteNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(sequence).padStart(5, '0')}`;
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value ?? ''));
}

function toDate(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function endOfDay(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * Expired is derived, not stored.
 *
 * The date has passed and nobody has answered - exactly the way an invoice is
 * overdue. Deriving it means no nightly job exists whose only purpose is
 * keeping a column honest, and the terminal states a staff member actually chose
 * still win.
 */
function isExpired(quote) {
  if (!quote?.validUntil) return false;
  if (['converted', 'rejected', 'accepted'].includes(quote.status)) return false;
  return new Date(quote.validUntil).getTime() < Date.now();
}

/**
 * Every figure on the estimate, recomputed from its lines.
 *
 * The extended service area fee is a **real charge and lands in the subtotal**,
 * so it is taxed like any other line - it is work done at the customer's
 * address, not a disbursement. `Invoice` treats it the same way, which is what
 * lets the number survive the whole chain without being re-derived.
 */
function priceQuote(devices = [], { discountCents = 0, taxRate = 0, feeCents = 0 } = {}) {
  const lines = devices.reduce(
    (sum, device) =>
      sum +
      [...(device.services ?? []), ...(device.parts ?? [])].reduce(
        (n, line) => n + (line.priceCents ?? 0) * (line.qty ?? 1),
        0,
      ),
    0,
  );

  const gross = lines + feeCents;

  // A discount can never exceed the work: a negative subtotal would tax
  // backwards and print a credit note nobody raised.
  const discount = Math.min(discountCents, gross);
  const subtotal = gross - discount;
  const taxCents = Math.round(subtotal * (taxRate / 100));

  return { lines, fee: feeCents, gross, discount, subtotal, taxCents, total: subtotal + taxCents };
}

function shapeLine(line) {
  return {
    name: line.name,
    description: line.description ?? '',
    priceCents: line.priceCents ?? 0,
    price: (line.priceCents ?? 0) / 100,
    qty: line.qty ?? 1,
    service: line.service ? String(line.service) : null,
    product: line.product ? String(line.product) : null,
    lineTotal: (line.priceCents ?? 0) * (line.qty ?? 1),
  };
}

function shapeQuote(quote) {
  if (!quote) return null;

  const expired = isExpired(quote);

  return {
    id: String(quote._id),
    quoteNumber: quote.quoteNumber,

    // The stored status and the displayed one are different facts: the second
    // folds in expiry, the first is what a staff member actually chose. Both are
    // sent so the row can show "expired" while the actions still reason about
    // "sent" - the same split `quoteService` makes.
    storedStatus: quote.status,
    status: expired ? 'expired' : quote.status,
    expired,

    user: quote.user?._id ? String(quote.user._id) : quote.user ? String(quote.user) : null,
    customerName: quote.customerName ?? (quote.user ? displayNameOf(quote.user) : ''),
    customerPhone: quote.customerPhone ?? '',
    customerEmail: quote.customerEmail ?? '',

    source: quote.source,
    serviceType: quote.serviceType,
    quoteDate: quote.quoteDate,
    validUntil: quote.validUntil ?? null,

    devices: (quote.devices ?? []).map((device) => ({
      category: device.category ?? '',
      brand: device.brand ?? '',
      series: device.series ?? '',
      model: device.model ?? '',
      serial: device.serial ?? '',
      passcode: device.passcode ?? '',
      problem: device.problem ?? '',
      solution: device.solution ?? '',
      notes: device.notes ?? '',
      services: (device.services ?? []).map(shapeLine),
      parts: (device.parts ?? []).map(shapeLine),
    })),

    clientNotes: quote.clientNotes ?? '',
    technicianNotes: quote.technicianNotes ?? '',
    internalNotes: quote.internalNotes ?? '',

    discountCents: quote.discountCents ?? 0,
    discountCode: quote.discountCode ?? '',
    extendedServiceFee: Boolean(quote.extendedServiceFee),
    extendedServiceFeeCents: quote.extendedServiceFeeCents ?? 0,
    taxRate: quote.taxRate ?? 0,
    taxCents: quote.taxCents ?? 0,
    province: quote.province ?? '',
    subtotalCents: quote.subtotalCents ?? 0,
    totalCents: quote.totalCents ?? 0,

    convertedTicket: quote.convertedTicket
      ? {
          id: String(quote.convertedTicket._id ?? quote.convertedTicket),
          ticketNumber: quote.convertedTicket.ticketNumber ?? null,
        }
      : null,

    timeline: quote.timeline ?? [],
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  };
}

/** Cents from the dollars a staff member types, clamped at zero. */
function toCents(dollars) {
  const amount = Number(dollars ?? 0);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

/**
 * Lines as the model stores them.
 *
 * **The price is taken from the request, not re-read from the catalogue.** A
 * quoted figure is a negotiated one - the catalogue price is what the picker
 * filled in, and a staff member who overrode it did so on purpose. What the server
 * refuses to accept is a *total*: those are computed below, from these.
 */
function shapeLinesIn(lines = []) {
  return lines
    .filter((line) => String(line?.name ?? '').trim())
    .map((line) => ({
      name: String(line.name).trim(),
      description: line.description ? String(line.description).trim() : undefined,
      priceCents: toCents(line.priceDollars ?? line.price),
      qty: Math.max(Number(line.qty) || 1, 1),
      service: isObjectId(line.service) ? line.service : null,
      product: isObjectId(line.product) ? line.product : null,
    }));
}

function shapeDevicesIn(devices = []) {
  return devices.map((device) => ({
    category: device.category || undefined,
    brand: device.brand || undefined,
    series: device.series || undefined,
    model: device.model || undefined,
    serial: device.serial || undefined,
    passcode: device.passcode || undefined,
    problem: device.problem || undefined,
    solution: device.solution || undefined,
    notes: device.notes || undefined,
    services: shapeLinesIn(device.services),
    parts: shapeLinesIn(device.parts),
  }));
}

async function listQuotes({ q, status, user, from, to, business } = {}) {
  const query = {};

  // Scoped the way every business-owned read is: resolved by
  // `resolveBusinessScope`, never read off the query string.
  if (business) query.business = business;

  if (user && isObjectId(user)) query.user = user;

  if (from || to) {
    query.quoteDate = {};
    if (from) query.quoteDate.$gte = toDate(from);
    if (to) query.quoteDate.$lte = endOfDay(to);
  }

  if (q) {
    const rx = likeRegex(q);
    query.$or = [
      { quoteNumber: rx },
      { customerName: rx },
      { customerEmail: rx },
      { customerPhone: rx },
      { 'devices.model': rx },
    ];
  }

  const rows = await db()
    .ServiceQuote.find(query)
    .populate('user', 'contactName businessName email phone')
    .populate('convertedTicket', 'ticketNumber')
    .sort({ createdAt: -1 })
    .lean();

  const shaped = rows.map(shapeQuote);

  /**
   * Status is filtered AFTER shaping, because `expired` is derived.
   *
   * A query on the stored column could not answer "show me the expired ones" -
   * nothing writes that value - and filtering in the database on a date range
   * would duplicate the rule in a second place where it could drift.
   */
  const filtered =
    !status || status === 'all' ? shaped : shaped.filter((row) => row.status === status);

  const counts = shaped.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const open = shaped
    .filter((row) => ['draft', 'sent'].includes(row.status))
    .reduce((sum, row) => sum + row.totalCents, 0);

  return {
    quotes: filtered,
    counts,
    totals: { open },
  };
}

async function getQuote(id) {
  const query = isObjectId(id) ? { _id: id } : { quoteNumber: String(id) };
  const quote = await db()
    .ServiceQuote.findOne(query)
    .populate('user', 'contactName businessName email phone')
    .populate('convertedTicket', 'ticketNumber')
    .lean();

  if (!quote) throw ApiError.notFound('Estimate not found.', 'SERVICE_QUOTE_NOT_FOUND');
  return { quote: shapeQuote(quote) };
}

/**
 * Apply the figures the estimate promised, recomputed from its own lines.
 *
 * Called on create and on every edit, so the cached totals can never drift from
 * the lines they came from.
 */
function applyTotals(doc) {
  const totals = priceQuote(doc.devices, {
    discountCents: doc.discountCents ?? 0,
    taxRate: doc.taxRate ?? 0,
    feeCents: doc.extendedServiceFee ? (doc.extendedServiceFeeCents ?? 0) : 0,
  });

  doc.subtotalCents = totals.subtotal;
  doc.taxCents = totals.taxCents;
  doc.totalCents = totals.total;
  return totals;
}

async function createQuote(body = {}, actor, business = null) {
  if (!isObjectId(body.user)) {
    throw ApiError.badRequest('Choose a customer for this estimate.', 'SERVICE_QUOTE_NO_CUSTOMER');
  }

  const customer = await db()
    .User.findById(body.user)
    .select('contactName businessName email phone address')
    .lean();
  if (!customer) {
    throw ApiError.badRequest('That customer no longer exists.', 'SERVICE_QUOTE_NO_CUSTOMER');
  }

  const devices = shapeDevicesIn(body.devices ?? []);
  if (!devices.length) {
    throw ApiError.badRequest('Add a device to this estimate.', 'SERVICE_QUOTE_NO_DEVICE');
  }

  const quote = new (db().ServiceQuote)({
    quoteNumber: await nextQuoteNumber(),
    user: customer._id,
    // Snapshotted, so an account renamed later does not rewrite what was sent.
    customerName: displayNameOf(customer),
    customerPhone: customer.phone ?? '',
    customerEmail: customer.email ?? '',
    business: business ?? null,

    source: body.source ?? 'counter',
    status: 'draft',
    serviceType: SERVICE_TYPES.includes(body.serviceType) ? body.serviceType : 'walk_in',

    quoteDate: toDate(body.quoteDate, new Date()),
    validUntil: toDate(body.validUntil),

    devices,

    clientNotes: body.clientNotes || undefined,
    technicianNotes: body.technicianNotes || undefined,
    internalNotes: body.internalNotes || undefined,

    discountCents: toCents(body.discountDollars ?? body.discount),
    discountCode: body.discountCode || undefined,
    extendedServiceFee: Boolean(body.extendedServiceFee),
    extendedServiceFeeCents: toCents(body.extendedServiceFeeDollars),
    taxRate: Number(body.taxRate) || 0,
    province: body.province || customer.address?.region || undefined,

    timeline: [{ status: 'draft', at: new Date(), note: 'Estimate created.', by: actor ?? null }],
    createdBy: actor ?? null,
  });

  applyTotals(quote);
  await quote.save();

  return getQuote(quote._id);
}

async function updateQuote(id, body = {}) {
  const query = isObjectId(id) ? { _id: id } : { quoteNumber: String(id) };
  const quote = await db().ServiceQuote.findOne(query);
  if (!quote) throw ApiError.notFound('Estimate not found.', 'SERVICE_QUOTE_NOT_FOUND');

  /**
   * **An estimate is editable at every status, converted included** (ruled
   * 2026-09-21).
   *
   * This refused once a ticket existed, on the grounds that the two records
   * would then disagree about what was promised. That is a real risk and it is
   * now the shop's to take: the common case is a typo or a price the counter
   * corrected while the customer was standing there, and refusing meant the
   * estimate stayed wrong for ever while the ticket carried the truth.
   *
   * The ticket is NOT rewritten to match - it is a separate record of separate
   * work, and editing an estimate has never reached forward into it. The
   * timeline on both still shows when each was changed.
   */
  if (body.devices !== undefined) {
    const devices = shapeDevicesIn(body.devices);
    if (!devices.length) {
      throw ApiError.badRequest('An estimate needs at least one device.', 'SERVICE_QUOTE_NO_DEVICE');
    }
    quote.devices = devices;
  }

  if (body.serviceType !== undefined && SERVICE_TYPES.includes(body.serviceType)) {
    quote.serviceType = body.serviceType;
  }
  if (body.quoteDate !== undefined) quote.quoteDate = toDate(body.quoteDate, quote.quoteDate);
  if (body.validUntil !== undefined) quote.validUntil = toDate(body.validUntil);

  if (body.clientNotes !== undefined) quote.clientNotes = body.clientNotes || undefined;
  if (body.technicianNotes !== undefined) {
    quote.technicianNotes = body.technicianNotes || undefined;
  }
  if (body.internalNotes !== undefined) quote.internalNotes = body.internalNotes || undefined;

  if (body.discountDollars !== undefined) quote.discountCents = toCents(body.discountDollars);
  if (body.discountCode !== undefined) quote.discountCode = body.discountCode || undefined;
  if (body.extendedServiceFee !== undefined) {
    quote.extendedServiceFee = Boolean(body.extendedServiceFee);
  }
  if (body.extendedServiceFeeDollars !== undefined) {
    quote.extendedServiceFeeCents = toCents(body.extendedServiceFeeDollars);
  }
  if (body.taxRate !== undefined) quote.taxRate = Number(body.taxRate) || 0;
  if (body.province !== undefined) quote.province = body.province || undefined;

  applyTotals(quote);
  await quote.save();

  return getQuote(quote._id);
}

/**
 * Move an estimate along.
 *
 * Unlike a ticket's status, this one IS a ladder in one respect: nothing moves
 * off `converted`, because the ticket downstream exists and a status saying
 * otherwise would be a lie about a record that is already being worked on.
 */
async function setQuoteStatus(id, { status, note } = {}, actor) {
  if (!SERVICE_QUOTE_STATUSES.includes(status)) {
    throw ApiError.badRequest('That is not an estimate status.', 'SERVICE_QUOTE_STATUS_INVALID');
  }

  const query = isObjectId(id) ? { _id: id } : { quoteNumber: String(id) };
  const quote = await db().ServiceQuote.findOne(query);
  if (!quote) throw ApiError.notFound('Estimate not found.', 'SERVICE_QUOTE_NOT_FOUND');

  if (quote.status === 'converted') {
    throw ApiError.badRequest(
      `${quote.quoteNumber} has already become a ticket.`,
      'SERVICE_QUOTE_CONVERTED',
    );
  }

  quote.status = status;
  quote.timeline.push({ status, at: new Date(), note: note || undefined, by: actor ?? null });
  await quote.save();

  return getQuote(quote._id);
}

async function deleteQuote(id) {
  const query = isObjectId(id) ? { _id: id } : { quoteNumber: String(id) };
  const quote = await db().ServiceQuote.findOne(query).lean();
  if (!quote) throw ApiError.notFound('Estimate not found.', 'SERVICE_QUOTE_NOT_FOUND');

  /**
   * **Deletable at every status, converted included** (ruled 2026-09-21).
   *
   * This refused once a ticket referenced the estimate. The reference is the
   * reason it has to be CLEANED rather than the reason to refuse: a ticket
   * pointing at a quote that no longer exists draws a lineage strip with a
   * dead station on it, which is a worse record than one that simply starts at
   * the ticket.
   *
   * So the pointer is cleared first and the ticket survives untouched - it is
   * the record of the work, and the work still happened. The estimate is the
   * document that goes.
   */
  // `serviceQuote`, not `quote` - the latter is the WHOLESALE quote reference
  // and is deliberately null on a repair ticket. Clearing the wrong one would
  // have left the dead pointer exactly where it was.
  if (quote.convertedTicket) {
    await db().Ticket.updateMany({ serviceQuote: quote._id }, { $set: { serviceQuote: null } });
  }

  await db().ServiceQuote.deleteOne({ _id: quote._id });
  return { deleted: true, quoteNumber: quote.quoteNumber };
}

/**
 * The customer accepted, arrived with the device, and work can start.
 *
 * **The devices come across whole**, which is the entire reason the two models
 * share a device shape: the technician opens a ticket that already knows the
 * passcode, the reported fault and every line that was quoted, rather than one
 * summarising them into a note.
 *
 * Converting **once** is enforced by `convertedTicket`. A second conversion
 * would put one job on the bench twice, and the counter would have no way to
 * tell which record the customer is asking about.
 */
async function convertToTicket(id, { priority = 'normal' } = {}, actor) {
  const query = isObjectId(id) ? { _id: id } : { quoteNumber: String(id) };
  const quote = await db().ServiceQuote.findOne(query).populate('user');
  if (!quote) throw ApiError.notFound('Estimate not found.', 'SERVICE_QUOTE_NOT_FOUND');

  if (quote.convertedTicket) {
    throw ApiError.badRequest(
      `${quote.quoteNumber} has already become a ticket.`,
      'SERVICE_QUOTE_CONVERTED',
    );
  }
  if (quote.status !== 'accepted') {
    throw ApiError.badRequest(
      `${quote.quoteNumber} has to be accepted before work starts on it.`,
      'SERVICE_QUOTE_NOT_ACCEPTED',
    );
  }
  if (!quote.devices?.length) {
    throw ApiError.badRequest('This estimate has no devices.', 'SERVICE_QUOTE_NO_DEVICE');
  }

  const devices = quote.devices.map((device) => ({
    category: device.category,
    brand: device.brand,
    series: device.series,
    model: device.model,
    serial: device.serial,
    passcode: device.passcode,
    problem: device.problem,
    solution: device.solution,
    notes: device.notes,
    // `condition` is deliberately absent: the counter grades the hardware when
    // it actually arrives, and an estimate never had it to give.
    services: (device.services ?? []).map((line) => ({
      name: line.name,
      description: line.description,
      priceCents: line.priceCents,
      qty: line.qty,
      product: line.product ?? undefined,
    })),
    parts: (device.parts ?? []).map((line) => ({
      name: line.name,
      description: line.description,
      priceCents: line.priceCents,
      qty: line.qty,
      product: line.product ?? undefined,
    })),
  }));

  const first = devices[0];
  const totals = priceQuote(quote.devices, {
    discountCents: quote.discountCents ?? 0,
    taxRate: quote.taxRate ?? 0,
    feeCents: quote.extendedServiceFee ? (quote.extendedServiceFeeCents ?? 0) : 0,
  });

  const ticketNumber = await nextTicketNumber();

  const ticket = await db().Ticket.create({
    ticketNumber,
    // Both ends of the edge, set together - a ticket that could not name its
    // own estimate leaves the lineage strip guessing at the half of the chain
    // behind it.
    quote: null,
    serviceQuote: quote._id,

    user: quote.user?._id ?? null,
    customerName: quote.customerName || displayNameOf(quote.user),
    customerPhone: quote.customerPhone || quote.user?.phone || '',
    customerEmail: quote.customerEmail || quote.user?.email || '',
    business: quote.business ?? null,

    status: 'diagnosis',
    priority,
    // Where the job came from, which is the estimate's own origin - a repair
    // quoted over the phone is a phone job even though the conversion happened
    // at the counter.
    source: quote.source === 'web' ? 'web' : quote.source === 'phone' ? 'phone' : 'counter',

    // The legacy single-device columns the list and search still read.
    deviceBrand: first?.brand,
    deviceModel: first?.model,
    deviceSerial: first?.serial,
    issue: first?.problem || `Quoted work from ${quote.quoteNumber}.`,

    devices,

    clientNotes: quote.clientNotes || undefined,
    technicianNotes: quote.technicianNotes || undefined,
    notes: quote.internalNotes || undefined,

    discountCents: quote.discountCents ?? 0,
    discountCode: quote.discountCode || undefined,
    taxRate: quote.taxRate ?? 0,
    taxCents: totals.taxCents,
    province: quote.province || undefined,
    estimateCents: totals.total,

    timeline: [
      {
        status: 'diagnosis',
        at: new Date(),
        note: `Converted from estimate ${quote.quoteNumber}.`,
        by: actor ?? null,
      },
    ],
    createdBy: actor ?? null,
  });

  quote.convertedTicket = ticket._id;
  quote.status = 'converted';
  quote.timeline.push({
    status: 'converted',
    at: new Date(),
    note: `Became ticket ${ticketNumber}.`,
    by: actor ?? null,
  });
  await quote.save();

  return {
    quote: (await getQuote(quote._id)).quote,
    ticket: { id: String(ticket._id), ticketNumber },
  };
}

/**
 * The ticket series, duplicated from `ticketService` rather than imported.
 *
 * Importing it would make these two modules circular: `ticketService` will read
 * estimates once the lineage strip draws the full chain. Six lines of sequence
 * generation is the cheaper of the two problems, and the format is fixed by the
 * documents already printed.
 */
async function nextTicketNumber() {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;
  const last = await db()
    .Ticket.findOne({ ticketNumber: new RegExp(`^${prefix}`) })
    .sort({ ticketNumber: -1 })
    .select('ticketNumber')
    .lean();

  const sequence = last ? Number(last.ticketNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(sequence).padStart(5, '0')}`;
}

export {
  priceQuote,
  shapeQuote,
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
  setQuoteStatus,
  deleteQuote,
  convertToTicket,
};
export default {
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
  setQuoteStatus,
  deleteQuote,
  convertToTicket,
};
