import mongoose from 'mongoose';

/**
 * Imported for its side effect, and it is load-bearing.
 *
 * `label` below is a ref, and `db/models.js` binds a ref onto a business
 * connection only if the model is ALREADY registered globally - an unknown
 * name is skipped silently rather than thrown, so a missing import here does
 * not fail at startup. It fails later, on the first read that populates it,
 * which is every invoice list and every invoice detail.
 *
 * Declared here rather than in each service that populates it, because the ref
 * is declared here: a new consumer should not have to discover this.
 */
import './InvoiceLabel.js';

/**
 * One priced line - a service performed or a part fitted.
 *
 * `priceCents` is the price AT THE TIME OF INVOICING, copied rather than
 * looked up: a catalogue price that moves next month must not silently rewrite
 * an invoice that has already been sent. `product` stays as the link back to
 * the row it came from, which is what lets stock move and what a reorder reads.
 */
const invoiceLineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    priceCents: { type: Number, default: 0 },
    qty: { type: Number, default: 1 },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    // Integer cents, snapshotted off the product when the invoice is raised, so
    // the P&L costs a repair part at what it cost THEN (as an order line does).
    // Absent on typed lines and on invoices raised before 2026-09-24.
    unitCost: Number,
  },
  { _id: false },
);

const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true, index: true }, // INV-2026-00042

    /**
     * What kind of document this row is.
     *
     * A tax invoice is issued only when the money is actually in - before that
     * the record is an **amount due**, which is payable and ages towards its due
     * date but is not yet an invoice anybody can file. That is why `due` exists
     * rather than an `unpaid` invoice: an invoice that might still be voided,
     * disputed or never paid is not a document to hand an accountant.
     *
     *   due      CVX-…  an order placed on terms, or a standalone charge. Payable.
     *   invoice  INV-…  settled in full. Its `status` is always `paid`.
     *   receipt  RCT-…  a store-credit movement - a top-up, a grant, a refund,
     *                   referral commission. No line items, no tax.
     *
     * A `due` record is **renumbered** into the `INV-` series the moment it
     * settles (`services/invoicePaymentService.js`), so invoice numbers stay a
     * gapless sequence of real invoices rather than a sequence with holes where
     * unpaid rows used to sit.
     */
    kind: {
      type: String,
      enum: ['due', 'invoice', 'receipt'],
      default: 'invoice',
      index: true,
    },

    /**
     * Optional, and the only reason it is: an invoice raised by hand (§7.2) has
     * no order behind it - a restocking fee, a repair, an agreed adjustment.
     * Every invoice an order raises still sets it.
     */
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },

    /**
     * The repair ticket this invoice bills, where it came from one.
     *
     * `Ticket.invoice` points forwards and was the only edge, so an invoice
     * knew it was for a repair from its `reference` string and nothing more
     * a sentence a human reads, not a link a screen can follow. This is the
     * same relationship stored as a reference, which is what lets the invoice
     * draw the quote → ticket → invoice chain it sits at the end of.
     */
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null, index: true },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /**
     * The shop this invoice is raised by.
     *
     * Copied from the order where there is one, so the money and the goods
     * agree about which location they belong to; set from the staff member's
     * current business on a standalone invoice.
     */
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },


    /**
     * The ledger row a receipt documents. Set on `kind: 'receipt'` only, and it
     * is what makes a receipt traceable back to the money that moved - and what
     * stops a replayed movement raising a second receipt for the same cents.
     */
    creditTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditTransaction' },

    /**
     * What a standalone invoice is *for*. An invoice with an order behind it
     * needs neither - the order says what was bought - but one raised by hand
     * that says only "$240" is a document nobody can reconcile six weeks later.
     */
    reference: String,
    notes: String,

    /**
     * The work this invoice bills for, when it bills for work.
     *
     * Empty on every invoice an order raises and on a flat standalone charge
     * those are a single figure by design, and the model comment above is still
     * true of them. A repair invoice fills it, and its `amount` is then
     * DERIVED from these lines by `invoiceTotals()` rather than typed.
     *
     * The shape mirrors `Ticket.devices` so a ticket can become an invoice
     * without translating between two ideas of the same object.
     */
    devices: [
      {
        category: String,
        brand: String,
        series: String,
        model: String,
        serial: String,
        problem: String,
        solution: String,
        notes: String,
        services: [invoiceLineSchema],
        parts: [invoiceLineSchema],
        _id: false,
      },
    ],

    /**
     * The tax actually applied, stored as the rate AND the cents.
     *
     * Both, because a rate alone cannot reproduce an old invoice after the
     * province's rate changes, and cents alone cannot explain themselves. A
     * document has to still be readable in five years.
     */
    province: String,
    taxPercent: { type: Number, default: 0 },
    taxCents: { type: Number, default: 0 },
    subtotalCents: { type: Number, default: 0 },
    discountCents: { type: Number, default: 0 },
    discountCode: String,

    /**
     * Kilometres driven, and whether the out-of-area fee was charged.
     *
     * `travelKm` is internal mileage - recorded for the business, never added
     * to what the customer owes. The extended service fee is the opposite: a
     * real charge, so it lands in the subtotal like any other line.
     */
    travelKm: { type: Number, default: 0 },
    extendedServiceFee: { type: Boolean, default: false },

    /**
     * The mileage allowance those kilometres came to, in integer cents.
     *
     * **Stored, not derived at render time.** It is `travelKm` times the rate in
     * `Settings.financial.travelRateCentsPerKm`, and that rate changes - the CRA
     * publishes a new one every year. Recomputing an old invoice against today's
     * rate would quietly restate what was claimed for a journey driven two years
     * ago, which is the same argument `taxPercent` is stored for.
     *
     * Still never part of `amount`: see the note above.
     */
    travelAllowanceCents: { type: Number, default: 0, min: 0 },

    /**
     * What the out-of-area fee was charged at, when it was charged.
     *
     * Snapshotted for the same reason, and separate from the boolean because
     * "not charged" and "charged nothing" are different answers - a fee waived
     * for a regular is worth being able to see.
     */
    extendedServiceFeeCents: { type: Number, default: 0, min: 0 },

    technician: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    serviceType: {
      type: String,
      enum: ['walk_in', 'pickup', 'onsite', 'mail_in'],
      default: 'walk_in',
    },

    /**
     * The manual status an admin set, separate from `status` below.
     *
     * `status` is **payment state** and is derived from the payment rows -
     * nothing writes it by hand. This is the other question a shop asks of an
     * invoice: where it has got to with the customer. It moves no money, and
     * `null` is the ordinary state rather than a missing value.
     *
     * A reference, not a string, so renaming a label on the settings screen
     * renames it on every invoice carrying it. See `models/InvoiceLabel.js`.
     */
    label: { type: mongoose.Schema.Types.ObjectId, ref: 'InvoiceLabel', default: null, index: true },
    labelSetAt: { type: Date, default: null },

    /**
     * When the warranty and review email went out, if it ever did.
     *
     * **The once-ever guard.** A label may be configured to send that email the
     * first time it is set on a paid invoice; this is what stops it sending
     * again when somebody clears the label and re-sets it, or picks a second
     * label that also sends. A customer receiving the same warranty email twice
     * because a board was being tidied is the failure this exists to prevent.
     *
     * Deliberately on the INVOICE, not on the label: the promise is "once per
     * invoice", and a counter on the label could not express that.
     */
    labelEmailSentAt: { type: Date, default: null },

    /** `internalNotes` is the only one that never reaches the document. */
    customerNotes: String,
    technicianNotes: String,
    internalNotes: String,

    amount: { type: Number, required: true }, // cents
    amountPaid: { type: Number, default: 0 },

    issuedAt: { type: Date, default: Date.now },
    dueDate: Date,
    /** When the balance reached zero, and the `due` record became an invoice. */
    settledAt: Date,
    terms: { type: String, enum: ['prepaid', 'net15', 'net30', 'net60'], default: 'prepaid' },

    status: {
      type: String,
      enum: ['unpaid', 'partial', 'paid', 'overdue'],
      default: 'unpaid',
      index: true,
    },

    /**
     * When this invoice's catalogue parts came off the shelf
     * (services/repairPartsService.js). An edit moves only the difference and
     * a delete puts them back - but only when this is set. Invoices raised
     * before repair parts moved stock never took anything, and returning parts
     * they never took would inflate the count.
     */
    partsStockMovedAt: Date,

    /**
     * A gratuity, kept apart from the repair total.
     *
     * **Not a payment row and not part of `amount`.** `amountPaid` is the sum of
     * `payments`, and `amount` is what the work cost - so a tip recorded as a
     * payment would settle a balance that is still owed, and a tip added to
     * `amount` would tax a gratuity and inflate every revenue figure that reads
     * the invoice total as the price of the work.
     *
     * It is money the shop received, so it belongs on the record; it is not
     * money the customer owed, so it belongs beside the total rather than in it.
     * Integer cents, like everything else.
     *
     * `tipAt` is separate because a tip is almost always given at the moment of
     * payment, which is not when the invoice was issued.
     */
    tipCents: { type: Number, default: 0, min: 0 },
    tipAt: { type: Date, default: null },

    payments: [
      {
        amount: Number,
        at: { type: Date, default: Date.now },
        method: String,
        reference: String,
        // Set on the ORIGINAL row when it is reversed, so the UI can strike it
        // through without pairing rows up by amount and guessing which
        // reversal belongs to which payment. The reversal itself is a separate
        // row carrying the negative amount.
        reversedAt: Date,
        _id: false,
      },
    ],
  },
  { timestamps: true },
);

invoiceSchema.index({ user: 1, issuedAt: -1 });
// The customer invoice screen reads these two lists separately - what is still
// payable, and what has been invoiced - so the split is indexed rather than
// filtered in memory.
invoiceSchema.index({ user: 1, kind: 1, issuedAt: -1 });
// A receipt is raised at most once per ledger row. Sparse because only receipts
// carry the field at all.
invoiceSchema.index({ creditTransaction: 1 }, { sparse: true });

const Invoice = mongoose.model('Invoice', invoiceSchema);

export { Invoice };
export default Invoice;
