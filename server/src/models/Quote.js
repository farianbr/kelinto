import mongoose from 'mongoose';

/**
 * A price quote built for an account (ERP rework §6.6).
 *
 * Admin-created only for now (§0.7), but `source` is modelled as `admin | web`
 * so a storefront request form is additive later rather than a migration.
 *
 * **A quote stores the price it promised.** That is the whole point of one - it
 * is a commitment for a period, so unlike a cart it does not re-read the
 * catalogue on every view. What it must never do is let that stored price write
 * itself into an order unexamined: conversion re-prices against live products
 * and surfaces any difference to the admin first (§6.6).
 */
const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'expired', 'converted', 'rejected'];

const quoteItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    // Denormalised the way an order line is, so a quote stays readable after
    // the catalogue moves on.
    sku: String,
    name: String,

    qty: { type: Number, required: true, min: 1 },

    // The quoted price, in integer cents. Unlike a sale, this one IS sent by
    // the admin - a quote is a negotiated number and has no server-side source
    // of truth to read it from. Every total computed from it is still the
    // server's (invariant 8).
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },

    // Cost at the time the quote was built, so a margin can be shown while
    // negotiating. Undefined rather than zero when unknown, exactly as an
    // order line treats it (§9.4).
    unitCost: Number,
  },
  { _id: false },
);

const quoteSchema = new mongoose.Schema(
  {
    quoteNumber: { type: String, required: true, unique: true, index: true }, // WQ-2026-00001 (a web quote)
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** The shop that quoted. An accepted quote passes this to its order. */
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },

    source: { type: String, enum: ['admin', 'web'], default: 'admin' },

    status: { type: String, enum: QUOTE_STATUSES, default: 'draft', index: true },

    items: [quoteItemSchema],

    // All integer cents, all recomputed server-side from the lines.
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    // **Expiry is honoured, not enforced by a job.** A quote is expired because
    // the date has passed, the same way an invoice is overdue - deriving it
    // means no nightly task exists whose only purpose is keeping a column
    // honest. `status` still stores the terminal states a staff member chose.
    validUntil: Date,

    notes: { type: String, trim: true, maxlength: 2000 },

    convertedOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },

    /**
     * The ticket this quote became, where it became one.
     *
     * A quote has two honest destinations and they are not the same thing: a
     * parts quote becomes an ORDER (goods ship, money is owed), and a repair
     * estimate becomes a TICKET (work starts, and the invoice comes later, off
     * the ticket). Both are recorded so a converted quote can say which way it
     * went rather than leaving somebody to search for it.
     */
    convertedTicket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },

    timeline: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        note: String,
        _id: false,
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

quoteSchema.index({ user: 1, createdAt: -1 });

const Quote = mongoose.model('Quote', quoteSchema);

export { QUOTE_STATUSES, Quote };
export default Quote;
