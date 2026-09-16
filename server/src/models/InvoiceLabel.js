import mongoose from 'mongoose';

/**
 * The manual status an admin sets on an invoice (Sales § Invoice).
 *
 * ## Why this is not `Invoice.status`
 *
 * `Invoice.status` is **payment state** - unpaid, partial, paid, overdue - and
 * it is derived, never set: `invoicePaymentService.recompute` works it out from
 * the payment rows, so nothing may write it by hand. Two different questions
 * were being asked of one field: "has this been paid" and "where has this got
 * to with the customer".
 *
 * This is the second question. A shop marks an invoice **Thanks for Support**
 * once they have thanked the customer, or leaves it unset. It moves no money,
 * changes no balance, and is cleared by hand.
 *
 * ## Why the list is a collection and not an enum
 *
 * The labels are the shop's own vocabulary. CellShoppe wants "Thanks for
 * Support" and "Thank you for being part of us"; a garage would want something
 * else, and a second tenant certainly will. An enum would mean a deploy per
 * tenant per phrase - the same argument `ExpenseCategory` and
 * `InvoiceStatusRule` already make.
 *
 * ## No `business` field, deliberately
 *
 * This collection lives in the **shop's own database** - `db()` resolves the
 * connection from the request's business context, so a label created under
 * CellShoppe is only ever readable under CellShoppe. A `business` field here
 * would be a second, weaker copy of a separation the database already makes,
 * and the failure mode is worse than the redundancy: a row written without it
 * (a seed, a script, an older code path) is invisible to an exact-match filter
 * while sitting right there in the collection. `InvoiceStatusRule`, the closest
 * precedent and also an admin-editable per-shop list, carries none either.
 *
 * ## The side effect, and why it lives on the label
 *
 * A label may carry `sendsWarrantyEmail`. When it is first set on a **paid**
 * invoice, the warranty and review email goes out once. That is a property of
 * the label rather than of the code, because which label means "we have
 * finished with this customer" is exactly the thing that differs per shop -
 * hardcoding the phrase would put a tenant's wording inside a conditional.
 *
 * **Once, ever.** `Invoice.labelEmailSentAt` records it, so re-setting the same
 * label, or setting it again after clearing it, sends nothing. A customer who
 * gets the same warranty email twice because somebody was tidying a board is
 * the failure this prevents - the same "once per invoice" rule
 * `InvoiceStatusRule` enforces with its run collection.
 */
const invoiceLabelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },

    /**
     * A design token, not a hex.
     *
     * The same rule `ExpenseCategory.colorToken` follows: a colour typed into a
     * form is how a screen ends up off-brand, and nothing about a hex input
     * guarantees the text on it is readable.
     */
    colorToken: { type: String, default: 'ink' },

    /**
     * Whether setting this label sends the warranty and review email.
     *
     * Off by default. A label that mails a customer the moment somebody picks
     * it from a menu is a side effect nobody asked for, so it is opted into per
     * label and the picker says which ones do it.
     */
    sendsWarrantyEmail: { type: Boolean, default: false },

    /**
     * Retired rather than deleted.
     *
     * A label in use cannot be deleted (`invoiceLabelService.deleteLabel`
     * refuses), because `Invoice.label` is a reference and removing the target
     * would blank the status column on every invoice carrying it with no record
     * of what it said. Retiring takes it out of the picker and leaves the
     * history readable, which is what somebody tidying a list actually wants.
     */
    isActive: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/**
 * One label per name, within this shop's own database.
 *
 * Unique on `name` alone rather than on a business pair, for the reason the
 * header gives: the database IS the business boundary here. Two shops both
 * wanting "Thanks for Support" are rows in two different databases and never
 * meet.
 */
invoiceLabelSchema.index({ name: 1 }, { unique: true });
invoiceLabelSchema.index({ isActive: 1, order: 1, name: 1 });

const InvoiceLabel = mongoose.model('InvoiceLabel', invoiceLabelSchema);

export { InvoiceLabel };
export default InvoiceLabel;
