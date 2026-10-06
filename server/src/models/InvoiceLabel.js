import mongoose from 'mongoose';

import { MESSAGE_BODY_MAX } from '../../../shared/messageHtml.js';

/** The channels a status message can go out on. A call is a task for staff, not a message. */
const LABEL_CHANNELS = ['email', 'sms', 'whatsapp'];

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
 * ## What a label sends
 *
 * Only its own message (`message`, `messageActive` below), written by the
 * owner and sent once per invoice with the scheduled messages. A fixed
 * warranty and review email armed by a `sendsWarrantyEmail` tick existed
 * until 2026-10-01; the client removed it, since the status's own message can
 * say the same in the business's own words. Stored documents may still carry
 * the old field; nothing reads it.
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

    /**
     * The message this status sends, a set number of days after it is set on
     * an invoice (2026-10-01, client request).
     *
     * The same shape as an `InvoiceStatusRule`, and run by the same pass
     * (`invoiceStatusService.run`) with the same once-per-invoice guard, except
     * that the delay counts from `Invoice.labelSetAt` rather than from a date
     * the invoice carries on its own. It lives on the status rather than as a
     * rule pointing at it because the client reads it as part of the status:
     * "Picked Up sends this, two days later".
     *
     * Never negative: nothing can be sent before the status exists.
     * `messageActive` is separate from `isActive` - retiring a status from the
     * picker says nothing about whether the invoices already carrying it
     * should still hear from us - and ships off, like every message here.
     */
    delayDays: { type: Number, default: 0, min: 0, max: 365 },
    /**
     * Every channel the message goes out on (client ruling 2026-10-06:
     * "template statuses should allow multiple channel selection, i.e. Thanks
     * for Support"). A list, so one status can email the warranty details and
     * text a short thank-you; the staff member setting the status can still
     * untick any of them for that one invoice (`Invoice.labelChannels`).
     */
    channels: {
      type: [{ type: String, enum: LABEL_CHANNELS }],
      default: ['email'],
    },
    subject: { type: String, trim: true, maxlength: 200, default: '' },
    message: { type: String, trim: true, maxlength: MESSAGE_BODY_MAX, default: '' },
    messageActive: { type: Boolean, default: false },

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

export { InvoiceLabel, LABEL_CHANNELS };
export default InvoiceLabel;
