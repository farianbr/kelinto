import mongoose from 'mongoose';
import {
  BUSINESS_COLOR_TOKENS,
  DEFAULT_BUSINESS_COLOR,
  migrateColorToken,
} from '../../../shared/businessPalette.js';

/**
 * One operating business (SAAS_PLATFORM §1.1, re-ruled 2026-09-11).
 *
 * **This was `Outlet`.** An outlet was a physical shop inside one business; a
 * business is the thing that owns records and carries a type. The rename is the
 * whole of the change for existing data - every record that carried `outlet`
 * now carries `business`, and the scoping middleware that filtered by outlet
 * filters by business.
 *
 * ## The isolation this does NOT have, stated plainly
 *
 * §4.1 specifies **database-per-business** and rejects separating businesses by
 * a filter inside one database by name: a `Model.find({ status })` that forgets
 * its filter silently serves another business's customers, invoices and
 * margins. That ruling was reversed on 2026-09-11 in favour of shipping
 * businesses are rows here and every scoped query carries a `business` filter.
 *
 * The consequence is real and belongs next to the model it applies to: **a
 * query that forgets `businessFilter(req)` is a cross-business leak, not a
 * cosmetic bug.** `middleware/businessScope.js` is the one place that decides
 * scope, and anything reading records for a screen must spread its filter.
 *
 * ## Type
 *
 * `businessType` decides which sections exist and what they are called (§1.1).
 * It sets **defaults, not walls** - a super admin may switch any individual
 * feature on afterwards through `featureOverrides`, and the enforcement path is
 * the same single `requireFeature` 404 either way. A product business that
 * starts doing repairs turns `sales.tickets` on; it is not migrated to a
 * different type.
 */

/**
 * Colour identity comes from a fixed palette, never arbitrary hex: a colour
 * typed into a form is how a page ends up off-brand (§2b).
 *
 * **The list moved to `shared/businessPalette.js`** and changed while it moved.
 * It used to be the SEMANTIC tokens - `brand · info · success · warn · danger ·
 * ink` - which was harmless while the value only painted a swatch on the
 * businesses list. It stopped being harmless when the token started driving the
 * panel's whole accent: a business on `info` would render its primary button,
 * its active nav item and an informational callout in one blue, and a business
 * on `danger` would make every Save button the colour of Delete. Identity now
 * has its own six colours, each held at a distance from every status colour,
 * and the semantic tokens are left to mean what they say.
 *
 * Re-exported here because callers import the enum from the model.
 */
const BUSINESS_STATUSES = ['active', 'inactive', 'maintenance'];

/** The three shapes the product optimises for (§1.1). */
const BUSINESS_TYPES = ['product', 'service', 'both'];

const hoursSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      required: true,
    },
    // Stored as "09:00" / "17:30", not Dates: these are wall-clock opening
    // hours, not instants, and a Date here would drag a timezone into a field
    // that has no business carrying one.
    open: String,
    close: String,
    closed: { type: Boolean, default: false },
  },
  { _id: false },
);

const businessSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // The zero-padded `#000001` form the switcher shows. Assigned server-side
    // by `nextBusinessCode` - a code the client proposes is a code two
    // staff can pick at the same moment.
    code: { type: String, required: true, unique: true, index: true },

    /**
     * What shape of business this is. Decides the feature defaults, and through
     * them which sections the panel renders (§1.1).
     *
     * Indexed because the feature resolver reads it on every request that
     * carries a business scope.
     */
    businessType: {
      type: String,
      enum: BUSINESS_TYPES,
      default: 'product',
      required: true,
      index: true,
    },

    /**
     * How a request finds this business before anybody signs in
     * (SAAS_PLATFORM §4.2).
     *
     * `slug` becomes the subdomain - `northline.<platform>` - and `domain` is a
     * custom one the business has pointed at us. **A custom domain wins**: a
     * business that bought a domain means it more than it means the handle we
     * gave them.
     *
     * Both are optional, and both are unique through a **partial** index rather
     * than a sparse one.
     *
     * `sparse` skips documents where the field is *absent* - but these carry
     * `default: null`, so the field is present holding null and every such
     * document is indexed. The second business then collides with the first on
     * `{ domain: null }`, which is exactly what happened the first time this
     * seed ran. A partial index filtered to string values indexes only the
     * businesses that actually have one.
     */
    slug: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },

    domain: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },

    /**
     * A domain the business owns that serves its ERP panel rather than its
     * storefront - `app.cellshoppe.ca`.
     *
     * `domain` above is where the business's CUSTOMERS go; this is where its
     * STAFF go. A request on it is pinned to this business alone: the sign-in
     * finds only this business's accounts, and no switcher or query string can
     * move the request into another one (`resolveBusiness`). The shared panel
     * host keeps working beside it.
     *
     * Unique across both fields, not just this one - one host cannot be a
     * storefront and a panel at once (`superAdminService.setBusinessAddress`).
     */
    panelDomain: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },

    /**
     * A web address the tenant has ASKED for, waiting on a super admin.
     *
     * `slug` above is the live address and only the platform writes it; this is
     * the request beside it, so a tenant can propose `cellshoppe` without it
     * answering on anything until it is approved. Approval moves the slug
     * across and clears this; a rejection keeps it here with the reason, so the
     * tenant reads why rather than finding their request simply gone.
     *
     * Null when nothing is asked for. One request at a time - asking again
     * replaces it.
     */
    addressRequest: {
      type: new mongoose.Schema(
        {
          slug: { type: String, required: true, lowercase: true, trim: true },
          status: { type: String, enum: ['pending', 'rejected'], default: 'pending' },
          requestedAt: { type: Date, default: Date.now },
          // Who asked, as text: the account lives in a database the console
          // does not read, and the name is what an operator needs to see.
          requestedBy: { type: String, default: '' },
          decidedAt: { type: Date, default: null },
          note: { type: String, default: '', maxlength: 500 },
        },
        { _id: false },
      ),
      default: null,
    },

    status: { type: String, enum: BUSINESS_STATUSES, default: 'active', index: true },
    /**
     * The identity ramp the panel paints itself in (`shared/businessPalette.js`).
     *
     * A `set` rather than a bare enum, because the enum changed under existing
     * documents: every business in the database carries one of the old
     * semantic names, and a plain enum would refuse to save any of them on the
     * next unrelated edit. `migrateColorToken` maps the old six onto the new
     * list on write, so a document repairs itself the first time it is touched
     * and nothing has to be migrated up front.
     */
    colorToken: {
      type: String,
      enum: BUSINESS_COLOR_TOKENS,
      default: DEFAULT_BUSINESS_COLOR,
      set: migrateColorToken,
    },

    address: {
      street: String,
      line2: String,
      city: String,
      // Canadian conventions throughout - the province list and the A1A 1A1
      // rule are validated by the shared schema, not re-stated here.
      region: String,
      postal: String,
      country: { type: String, default: 'Canada' },
    },

    phone: String,
    email: { type: String, lowercase: true, trim: true },

    // Free text, not a ref: the manager is often named before they have a
    // login, and blocking creation on user creation is backwards.
    manager: String,

    // Staff assigned here. The authoritative link is `User.business` - this is
    // the reverse index, kept for the card's roster and repaired by
    // `accessService` whenever a user's assignment moves.
    staff: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    hours: [hoursSchema],

    // Exactly one business is the default, enforced in `accessService`. It is
    // where a movement lands when nothing names one, so the field cannot be
    // allowed to go empty.
    isDefault: { type: Boolean, default: false },

    /**
     * Which tenant owns this business (§1). Optional until the control plane
     * exists - a business with no tenant is tenant #1's, which is every
     * business today.
     */
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },

    /**
     * Per-business feature switches, written **only** by a super admin (§3.3).
     *
     * `{ 'sales.tickets': true }` - a sparse object of deliberate answers, not
     * a full set. Anything absent falls back to the business type's default, so
     * this document never has to be rewritten when a new feature key is added.
     *
     * A `locked` key here is ignored: `resolveFeatures` forces those on
     * whatever any layer says (§3.2 rule 4).
     *
     * **`Mixed`, not `Map`.** Mongoose maps reject keys containing a dot, and
     * every feature key in the registry is dot-namespaced (`sales.orders`)
     * a `Map` threw on the first write the console attempted. The dots are the
     * namespace and are not negotiable, so the field type gives way instead.
     */
    featureOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },

    /** The plan this business is on. Sets feature defaults beneath overrides. */
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },

    /** When a slot was spent to create this. Null for businesses that predate slots. */
    slotGrantedAt: Date,

    /**
     * Soft deletion, and the retention window `Tenant.slots` already documents.
     *
     * **A deleted business keeps its slot consumed until the window closes.**
     * Returning the slot immediately would let a tenant delete-and-recreate its
     * way to a free business, and would also mean a restore could land with no
     * slot to hold it. `Tenant.slots` states that rule; this is the field that
     * makes it true.
     *
     * **Soft, never hard.** The records are still there - orders, invoices, a
     * credit ledger - and a business is deleted by somebody who wants it out of
     * their way, not by somebody asking us to destroy their accounting history.
     * Purging after the window is a separate, deliberate act.
     */
    deletedAt: { type: Date, default: null, index: true },

    /** When the slot comes back and the records may be purged. */
    purgeAfter: { type: Date, default: null },

    notes: String,
  },
  { timestamps: true },
);

businessSchema.index({ status: 1, name: 1 });

/**
 * Unique only among businesses that actually have one (SAAS_PLATFORM §4.2).
 *
 * `partialFilterExpression` on the type is what makes this work where `sparse`
 * did not: these fields default to `null`, so they are always present and a
 * sparse index would still index every one of them - two businesses without a
 * domain would then collide on `{ domain: null }`.
 */
businessSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
);
businessSchema.index(
  { domain: 1 },
  { unique: true, partialFilterExpression: { domain: { $type: 'string' } } },
);
businessSchema.index(
  { panelDomain: 1 },
  { unique: true, partialFilterExpression: { panelDomain: { $type: 'string' } } },
);

businessSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    code: this.code,
    slug: this.slug ?? null,
    domain: this.domain ?? null,
    panelDomain: this.panelDomain ?? null,
    addressRequest: this.addressRequest ?? null,
    businessType: this.businessType,
    status: this.status,
    // Normalised on the way out as well as on the way in: a document written
    // before the palette changed is read far more often than it is saved, and
    // the client must never receive a token it cannot paint.
    colorToken: migrateColorToken(this.colorToken),
    address: this.address,
    phone: this.phone,
    email: this.email,
    manager: this.manager,
    staff: this.staff,
    hours: this.hours,
    isDefault: this.isDefault,
    tenant: this.tenant?.toString() ?? null,
    // A plain object, because a Map does not survive `res.json` as one.
    featureOverrides: this.featureOverrides ?? {},
    plan: this.plan?.toString() ?? null,
    notes: this.notes,
    createdAt: this.createdAt,
  };
};

const Business = mongoose.model('Business', businessSchema);

export { BUSINESS_COLOR_TOKENS, BUSINESS_STATUSES, BUSINESS_TYPES, Business };
export default Business;
