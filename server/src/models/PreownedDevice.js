import mongoose from 'mongoose';

import { CONDITION_GRADES } from './Ticket.js';

/**
 * One pre-owned phone in stock (Inventory › Pre-owned).
 *
 * ## Its own stock, not a `Product`
 *
 * A `Product` is a SKU: many identical parts, a quantity, a reorder point, a
 * supplier, a place in the parts taxonomy. A pre-owned phone is one physical
 * handset with an IMEI, a grade and a history. Filed as a product it would sit
 * in low-stock alerts the moment it sold, appear in reorder suggestions and
 * supplier purchase orders, and need excluding from every catalogue query by
 * hand. So it is its own record, and the website sells it through its own page
 * and its own cart line (`Cart.preowned`).
 *
 * ## Status
 *
 * `in_stock` when accepted from a buyback, `listed` once somebody puts it on
 * the website, `sold` when an order takes it (online or at the counter), and
 * `withdrawn` for one pulled from sale without being sold (sent for parts,
 * returned). Only `listed` is visible to customers.
 */

const PREOWNED_STATUSES = ['in_stock', 'listed', 'sold', 'withdrawn'];

/** What the website says about wear. The counter grades components separately. */
const PREOWNED_GRADES = ['like_new', 'excellent', 'good', 'fair'];

const preownedDeviceSchema = new mongoose.Schema(
  {
    /** `PO-00001`. Also the SKU its order line carries. */
    stockNumber: { type: String, required: true, unique: true, index: true },
    buyback: { type: mongoose.Schema.Types.ObjectId, ref: 'Buyback', default: null },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },

    category: { type: String, trim: true, maxlength: 60 },
    brand: { type: String, trim: true, maxlength: 60 },
    series: { type: String, trim: true, maxlength: 120 },
    model: { type: String, trim: true, maxlength: 120, required: true },
    /**
     * Where the phone sits in the Phones taxonomy (2026-10-01), so the Phones
     * page filters it the way the Parts page filters a part. Resolved from the
     * four names above by `catalogTaxonomyService.resolvePhone` whenever the
     * phone is listed or edited, creating any level the tree is missing: the
     * names are what staff and the kiosk actually write, and a listed phone the
     * finder cannot reach is a phone nobody buys.
     */
    deviceTypeSlug: { type: String, index: true },
    brandSlug: { type: String, index: true },
    seriesSlug: { type: String, index: true },
    modelSlug: { type: String, index: true },
    storage: { type: String, trim: true, maxlength: 20 },
    colour: { type: String, trim: true, maxlength: 40 },
    /** Staff only. Never in a website payload. */
    imei: { type: String, trim: true, maxlength: 20, index: true },

    grade: { type: String, enum: PREOWNED_GRADES, default: 'good' },
    condition: { type: Map, of: { type: String, enum: CONDITION_GRADES }, default: undefined },
    /** Shown on the website, under the grade. */
    description: { type: String, trim: true, maxlength: 1000 },
    /** R2 keys in the PUBLIC bucket, like product pictures. */
    photos: [{ type: String, trim: true }],

    /** What we paid. Staff only; it is the margin's other half. Integer cents. */
    costCents: { type: Number, min: 0, default: 0 },
    /** What it sells for. Integer cents, gated like every price on the website. */
    priceCents: { type: Number, min: 0, required: true },

    status: { type: String, enum: PREOWNED_STATUSES, default: 'in_stock', index: true },
    listedAt: { type: Date, default: null },
    soldAt: { type: Date, default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  },
  { timestamps: true },
);

const PreownedDevice = mongoose.model('PreownedDevice', preownedDeviceSchema);

export { PREOWNED_STATUSES, PREOWNED_GRADES, PreownedDevice };
export default PreownedDevice;
