import mongoose from 'mongoose';

/**
 * A repair or labour service the shop **sells** - the service business's
 * equivalent of `Product`.
 *
 * ## Why this is not `Product`
 *
 * A `Product` is a physical part: it has stock, a grade, a shelf, a supplier,
 * a picture and a place in the taxonomy tree, and the storefront draws it. A
 * screen replacement has none of those. Modelling labour as a `Product` with
 * `stock: null` would put a row with no stock, no photo and no shelf into every
 * inventory count, every reorder report and every stock movement query - and
 * the catalogue rule that a product without a picture does not exist would have
 * to grow an exception for exactly the rows it was written to exclude.
 *
 * ## Why this is not `SupplierService`
 *
 * `SupplierService` is money OUT - a courier account, a software subscription,
 * things the shop buys. This is money IN. They share a word and nothing else.
 *
 * ## Why it is not an enum or a settings list
 *
 * The price list is the shop's, it changes without a deploy, and it is what the
 * quote and ticket forms search. A staff member adds "iPhone 15 back glass" the
 * afternoon they start offering it.
 *
 * ## Deactivate, never delete
 *
 * A service that has been quoted or ticketed is referenced by lines that
 * recorded its name and price at the time. Deleting it would not corrupt those
 * lines - they carry their own snapshot, exactly as an order line does - but it
 * would break the reporting that groups historical work by service. `isActive`
 * takes it out of the pickers and leaves the history intact.
 */

/**
 * What kind of work this is (its repair type). Groups the picker, the revenue
 * report and the website's Services finder.
 *
 * The list was fixed until 2026-10-02 and is now the Services type's first
 * finder step, edited in Settings › Taxonomy and checked by
 * `serviceCatalogService.repairTypeOf`, so the field takes any value from
 * that list. These ten are its starting entries (`DEFAULT_REPAIR_TYPES`).
 */
const SERVICE_CATEGORIES = [
  'screen',
  'battery',
  'charging_port',
  'camera',
  'audio',
  'water_damage',
  'software',
  'data',
  'diagnostic',
  'other',
];

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },

    /**
     * Shown under the name in the picker and printed on the quote line when the
     * staff member does not type their own.
     */
    description: { type: String, trim: true, maxlength: 500 },

    /**
     * The website's detail page for this service (2026-10-02): a picture, the
     * long-form copy, and the address it lives at.
     *
     * `image` is an R2 KEY, never a URL (`storage.urlOf` on the way out);
     * blank falls back to the stock photo matched by name (`SERVICE_PHOTOS`).
     * `details` is admin-authored copy, rendered through `lib/richText.jsx`.
     * `slug` is derived from the name once and kept, so a renamed service keeps
     * its address; one written before slugs existed gets one on first read.
     */
    image: { type: String, trim: true, default: '' },
    details: { type: String, trim: true, maxlength: 6000, default: '' },
    slug: { type: String, trim: true, index: true },

    /** The shop that sells it. Scoped like every other business-owned record. */
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },

    category: { type: String, trim: true, maxlength: 40, default: 'other', index: true },

    /**
     * The list price, in integer cents, like every other amount in this system.
     *
     * **A starting point, not a fixed price.** The staff member can overwrite it on
     * the line - a screen on a cracked frame costs more than the list says - so
     * this is what the picker fills in, never what the total is computed from.
     * The line's own price is authority, exactly as it is for a part.
     */
    priceCents: { type: Number, default: 0, min: 0 },

    /**
     * What the work costs the shop to do, so a margin can be shown while
     * quoting. Labour, mostly; a part fitted alongside carries its own cost.
     *
     * Undefined rather than zero when unknown - the same distinction an order
     * line draws, because a zero cost and an unrecorded one produce very
     * different margin numbers.
     */
    costCents: { type: Number, min: 0 },

    /** Typical bench time, in minutes. Drives scheduling and the promised date. */
    durationMinutes: { type: Number, default: 0, min: 0 },

    /**
     * How long the shop stands behind this work, in days. `0` means none.
     *
     * Held here rather than on the ticket so a change to the policy applies to
     * work quoted from now on and leaves what was already promised alone - the
     * ticket snapshots it at the time, the way it snapshots the price.
     */
    warrantyDays: { type: Number, default: 0, min: 0 },

    /**
     * The device types this applies to, lowercase, free-form: `phone`,
     * `laptop`, `tablet`.
     *
     * A hint for the picker, which narrows to the device being worked on, and
     * **never a restriction** - an empty list means "offer it for anything",
     * which is the right default for a diagnostic fee. Free-form rather than an
     * enum because the kinds of device a shop takes in are the shop's business,
     * not this schema's.
     */
    deviceTypes: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],

    /**
     * Narrows the service to one branch of the Services taxonomy (2026-10-01):
     * "iPhone 15 screen replacement" sits on the iPhone 15 model, "Screen
     * replacement" on nothing and so applies to every device. Slugs, plus the
     * names for display, exactly as a product carries its place in the Parts
     * tree. All blank is the common case, and the right one for a diagnostic.
     */
    deviceTypeSlug: { type: String, trim: true, default: '' },
    brandSlug: { type: String, trim: true, default: '' },
    seriesSlug: { type: String, trim: true, default: '' },
    modelSlug: { type: String, trim: true, default: '' },
    scopeLabel: { type: String, trim: true, maxlength: 160, default: '' },

    /** Whether tax applies. A few services are exempt; most are not. */
    taxable: { type: Boolean, default: true },

    isActive: { type: Boolean, default: true, index: true },

    /** Manual ordering in the picker, so the common jobs sit at the top. */
    order: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/**
 * Unique per business, not globally: two shops both sell "Screen replacement",
 * and under database-per-business they are different rows in different
 * databases anyway. The index makes the duplicate impossible within one shop,
 * which is the case that actually confuses a staff member.
 */
serviceSchema.index({ business: 1, name: 1 }, { unique: true });
serviceSchema.index({ isActive: 1, order: 1, name: 1 });
// What the picker's search box hits.
serviceSchema.index({ name: 'text', description: 'text' });

const Service = mongoose.model('Service', serviceSchema);

export { SERVICE_CATEGORIES, Service };
export default Service;
