import mongoose from 'mongoose';

/**
 * A repair quote, given before the shop has the device.
 *
 * ## Why this is not `Quote`
 *
 * `Quote` is a wholesale parts quote: SKU lines, quantities, a shipping charge,
 * and it converts into an `Order`. This is a quote for work on a device the
 * shop has not been handed yet - somebody rings up asking what a screen costs,
 * or fills in the web form - and it converts into a `Ticket`.
 *
 * The two share a word and almost no fields. `Quote` carries `items[]` with a
 * `sku` and a `product` ref; this carries `devices[]`, each with a problem, a
 * passcode, its own services and its own parts. Branching one model on business
 * type would mean every read guessing which half of the document is real, and
 * every validator written twice - which is the same argument that keeps `Rma`
 * and `Ticket` apart.
 *
 * **The two mirror each other rather than nesting**: product runs
 * Quote → Order → Invoice, service runs ServiceQuote → Ticket → Invoice.
 *
 * ## When one exists at all
 *
 * Only when the customer does **not** leave the device. A walk-in who hands
 * over a handset goes straight to a `Ticket` - a quote for a device already
 * on the bench is a step that records nothing the ticket does not.
 *
 * ## The price is a promise, and the ticket re-prices anyway
 *
 * Like `Quote`, this stores the figures it quoted rather than re-reading a
 * price list on every view - that is what makes it a commitment. And like
 * `Quote`, conversion does not let those figures write themselves onward
 * unexamined: the technician sees the device, and the ticket's own lines are
 * what gets invoiced.
 */

/** Mirrors `Quote`'s ladder, minus the states that only make sense for goods. */
const SERVICE_QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'expired', 'converted', 'rejected'];

/** Where the quote came from. `web` is the Web Quote form. */
const SERVICE_QUOTE_SOURCES = ['counter', 'phone', 'web', 'kiosk'];

/**
 * Walk-in or door-step, as the quote form asks it.
 *
 * The same vocabulary `Invoice.serviceType` already uses, so the answer given
 * at quote time survives all the way to the document without translation.
 */
const SERVICE_TYPES = ['walk_in', 'pickup', 'onsite', 'mail_in'];

/**
 * One quoted line - a service or a part.
 *
 * **Deliberately the same shape as `Ticket`'s line**, so converting is a copy
 * rather than a mapping. The `service` and `product` refs record where the line
 * came from; the name and price are snapshotted beside them, because a price
 * list that moves must not silently rewrite a quote already sent.
 */
const serviceQuoteLineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 300 },
    // Integer cents, like every other amount in this system.
    priceCents: { type: Number, default: 0, min: 0 },
    qty: { type: Number, default: 1, min: 1 },

    /** Set when the line came from the service catalogue rather than typed. */
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
    /** Set when the line came from inventory rather than typed. */
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  },
  { _id: false },
);

/**
 * One device on the quote.
 *
 * Mirrors `ticketDeviceSchema` field for field, with **one deliberate
 * omission**: there is no `condition` map. A component-by-component check is
 * something a counter does with the hardware in front of them, and a grid of
 * "untested" rows filled in over the phone would be a record that looks like
 * evidence and is not.
 */
const serviceQuoteDeviceSchema = new mongoose.Schema(
  {
    category: { type: String, trim: true, maxlength: 60 },
    brand: { type: String, trim: true, maxlength: 60 },
    series: { type: String, trim: true, maxlength: 120 },
    model: { type: String, trim: true, maxlength: 120 },
    serial: { type: String, trim: true, maxlength: 80 },
    // Never rendered on a customer-facing document.
    passcode: { type: String, trim: true, maxlength: 60 },

    problem: { type: String, trim: true, maxlength: 500 },
    solution: { type: String, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 500 },

    services: [serviceQuoteLineSchema],
    parts: [serviceQuoteLineSchema],
  },
  { _id: false },
);

const serviceQuoteSchema = new mongoose.Schema(
  {
    // `QT-`; the web quote (`Quote`) is `WQ-`, so a number says which it is.
    quoteNumber: { type: String, required: true, unique: true, index: true }, // QT-2026-00001

    /**
     * The customer.
     *
     * **Required, unlike a `Ticket`'s.** A ticket exists because a device is
     * physically on the bench and the counter can chase the name later; an
     * quote exists to be sent to somebody, and one addressed to nobody
     * cannot be. The denormalised contact fields beside it are what the list
     * searches and what a document prints, held the way `Ticket` holds them so
     * an account renamed later does not rewrite what was sent.
     */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerName: { type: String, trim: true, maxlength: 120 },
    customerPhone: { type: String, trim: true, maxlength: 40, index: true },
    customerEmail: { type: String, trim: true, lowercase: true, maxlength: 160 },

    /** The shop that quoted. An accepted quote passes this to its ticket. */
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },

    source: { type: String, enum: SERVICE_QUOTE_SOURCES, default: 'counter' },
    status: { type: String, enum: SERVICE_QUOTE_STATUSES, default: 'draft', index: true },

    serviceType: { type: String, enum: SERVICE_TYPES, default: 'walk_in' },

    /**
     * The date the quote is dated, which is not `createdAt`.
     *
     * A staff member writing up yesterday's phone call dates it yesterday, and the
     * document has to say so.
     */
    quoteDate: { type: Date, default: Date.now },

    /**
     * Expiry is honoured, not enforced by a job - the same rule `Quote` states:
     * a quote is expired because the date has passed, so no nightly task
     * exists whose only purpose is keeping a column honest.
     */
    validUntil: Date,

    devices: [serviceQuoteDeviceSchema],

    // --- notes, by audience -------------------------------------------------
    // Three readers, three fields, and one of them must never be printed. The
    // same split `Ticket` and `Invoice` already make.
    clientNotes: { type: String, trim: true, maxlength: 2000 },
    technicianNotes: { type: String, trim: true, maxlength: 2000 },
    internalNotes: { type: String, trim: true, maxlength: 2000 },

    // --- money --------------------------------------------------------------
    // Every figure integer cents, every one recomputed server-side from the
    // lines above. Stored so the quote can restate what it promised.
    discountCents: { type: Number, default: 0, min: 0 },
    discountCode: { type: String, trim: true, maxlength: 40 },

    /**
     * Charged when the customer is outside the standard service area.
     *
     * A boolean plus an amount rather than just an amount, because "not
     * charged" and "charged nothing" are different answers and the second one
     * happens - a fee waived for a regular is worth being able to see.
     */
    extendedServiceFee: { type: Boolean, default: false },
    extendedServiceFeeCents: { type: Number, default: 0, min: 0 },

    /**
     * The rate quoted at, as a percentage, stored rather than read from
     * settings at render time: a quote priced at 5% must still say 5% after
     * the shop changes its default.
     */
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    taxCents: { type: Number, default: 0, min: 0 },
    province: { type: String, trim: true, maxlength: 2 },

    subtotalCents: { type: Number, default: 0 },
    totalCents: { type: Number, default: 0 },

    /** The ticket this quote became, once the customer brought the device in. */
    convertedTicket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },

    timeline: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        note: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        _id: false,
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

serviceQuoteSchema.index({ user: 1, createdAt: -1 });
serviceQuoteSchema.index({ status: 1, createdAt: -1 });

const ServiceQuote = mongoose.model('ServiceQuote', serviceQuoteSchema);

export {
  SERVICE_QUOTE_STATUSES,
  SERVICE_QUOTE_SOURCES,
  SERVICE_TYPES,
  ServiceQuote,
};
export default ServiceQuote;
