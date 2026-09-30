import mongoose from 'mongoose';

import { CONDITION_GRADES } from './Ticket.js';

/**
 * A phone a customer offered to sell us (Sales § Sell your phone).
 *
 * ## Where it comes from
 *
 * The kiosk's "Sell your phone" door, and only there for now (client ruling,
 * 2026-09-29). The customer hands the phone to staff with it, so a buyback is
 * a phone already in the shop, waiting for somebody to decide what it is worth.
 *
 * ## Its life
 *
 * `pending` until a staff member reviews it in Inventory › Buyback requests.
 * Reviewing sets what we paid, what we will sell it for and how the customer
 * was paid, and turns it `accepted`, which creates the `PreownedDevice` that
 * goes into stock. **The customer does not accept an offer**: the staff member
 * agrees the price with them at the counter and records it (client ruling).
 * `declined` is the other way out: the phone goes back to the customer.
 *
 * ## What it keeps about the seller, and why
 *
 * Buying a used phone from the public is the one transaction here where the
 * business must be able to say who it bought from, later, if the phone turns
 * out to be stolen. So each buyback snapshots the ID type and the last four
 * digits, and keeps **the photo taken at this sale** in the private bucket: a
 * photo on file from last year proves nothing about who stood at the tablet
 * today. The full ID number lives encrypted on the account (`User.identity`).
 */

const BUYBACK_STATUSES = ['pending', 'accepted', 'declined'];

const ID_TYPES = ['drivers_licence', 'passport', 'provincial_id', 'other'];

const buybackSchema = new mongoose.Schema(
  {
    /** `BB-00001`: a flat running count, like the kiosk's `KS-` series. */
    number: { type: String, required: true, unique: true, index: true },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerName: { type: String, trim: true, maxlength: 120 },
    customerPhone: { type: String, trim: true, maxlength: 40 },
    customerEmail: { type: String, trim: true, lowercase: true, maxlength: 160 },

    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
    source: { type: String, enum: ['kiosk'], default: 'kiosk' },

    device: {
      category: { type: String, trim: true, maxlength: 60 },
      brand: { type: String, trim: true, maxlength: 60 },
      series: { type: String, trim: true, maxlength: 120 },
      model: { type: String, trim: true, maxlength: 120 },
      storage: { type: String, trim: true, maxlength: 20 },
      colour: { type: String, trim: true, maxlength: 40 },
      /**
       * Required at the tablet: it is what a stolen-phone check is run against,
       * and what tells two identical handsets in stock apart.
       */
      imei: { type: String, trim: true, maxlength: 20, index: true },
      /** So staff can test it. Never shown on anything a customer reads. */
      passcode: { type: String, trim: true, maxlength: 60 },
      notes: { type: String, trim: true, maxlength: 500 },
    },

    /** The eight components, as the SELLER described them. A claim, not a test. */
    customerCondition: { type: Map, of: { type: String, enum: CONDITION_GRADES }, default: undefined },

    /** The seller's ID at the time of this sale. See the note above. */
    identity: {
      idType: { type: String, enum: ID_TYPES },
      idLast4: { type: String, trim: true, maxlength: 4 },
      /** A key in the PRIVATE bucket, never a URL: it is served only to staff. */
      photoKey: { type: String, trim: true },
    },
    /** When the seller declared the phone is theirs to sell. */
    declaredOwnerAt: { type: Date, default: null },

    status: { type: String, enum: BUYBACK_STATUSES, default: 'pending', index: true },

    /** Filled in by the staff member who reviews it. Integer cents throughout. */
    review: {
      purchasePriceCents: { type: Number, min: 0 },
      sellingPriceCents: { type: Number, min: 0 },
      /**
       * How the seller was paid: a code from Settings › Payment methods, or
       * `store-credit`, which moves the amount onto their account through
       * `storeCreditService` rather than being recorded as cash that left.
       */
      payoutMethod: { type: String, trim: true, maxlength: 40 },
      payoutReference: { type: String, trim: true, maxlength: 80 },
      /** The counter's own grading, the same grid a repair ticket uses. */
      condition: { type: Map, of: { type: String, enum: CONDITION_GRADES }, default: undefined },
      grade: { type: String, trim: true, maxlength: 20 },
      notes: { type: String, trim: true, maxlength: 1000 },
      declineReason: { type: String, trim: true, maxlength: 500 },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
    },

    /** The stock unit this became, once accepted. */
    preowned: { type: mongoose.Schema.Types.ObjectId, ref: 'PreownedDevice', default: null },

    timeline: [
      {
        _id: false,
        status: { type: String, enum: BUYBACK_STATUSES },
        at: { type: Date, default: Date.now },
        note: { type: String, trim: true, maxlength: 300 },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      },
    ],
  },
  { timestamps: true },
);

const Buyback = mongoose.model('Buyback', buybackSchema);

export { BUYBACK_STATUSES, ID_TYPES, Buyback };
export default Buyback;
