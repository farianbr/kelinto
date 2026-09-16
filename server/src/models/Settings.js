import mongoose from 'mongoose';

/**
 * The settings singleton (ERP rework §8, §6.15).
 *
 * **The screens that edit these are phase 11; the data model is not.** Tax
 * rates, invoice due days, warranty lengths and shipping bands are read by
 * earlier phases, and §10's sequencing note is explicit about why they land
 * here first: hard-coding a rate in phase 5 or 6 and "moving it to Settings
 * later" is how a system ends up with two sources of truth for the tax rate.
 *
 * Phase 6 reads `financial.taxRatesByProvince`. Phase 11 builds the form.
 *
 * One document, found by `Settings.load()`, which creates it from the seeded
 * defaults on first read so no caller has to handle its absence.
 */

/**
 * Extra warranty days each membership tier adds on top of the part's grade.
 *
 * Defined here rather than inline in the schema so the read path can fall back
 * to it: a schema `default` only fires when a document is created, and every
 * existing deployment already has its Settings row.
 */
const DEFAULT_TIER_WARRANTY_BONUS = { standard: 0, silver: 30, gold: 90, platinum: 180 };

/**
 * Standard 2026 provincial rates (§0.13 - to be confirmed with the client,
 * editable in Settings from day one).
 *
 * `kind` matters for the tax report: HST is a single combined tax, GST+PST are
 * two taxes that happen to be collected together, and the register has to be
 * able to say which it is rather than printing one blended number.
 */
const DEFAULT_TAX_RATES = [
  { province: 'AB', rate: 0.05, kind: 'GST' },
  { province: 'BC', rate: 0.12, kind: 'GST+PST' },
  { province: 'MB', rate: 0.12, kind: 'GST+PST' },
  { province: 'NB', rate: 0.15, kind: 'HST' },
  { province: 'NL', rate: 0.15, kind: 'HST' },
  { province: 'NS', rate: 0.14, kind: 'HST' },
  { province: 'NT', rate: 0.05, kind: 'GST' },
  { province: 'NU', rate: 0.05, kind: 'GST' },
  { province: 'ON', rate: 0.13, kind: 'HST' },
  { province: 'PE', rate: 0.15, kind: 'HST' },
  { province: 'QC', rate: 0.14975, kind: 'GST+QST' },
  { province: 'SK', rate: 0.11, kind: 'GST+PST' },
  { province: 'YT', rate: 0.05, kind: 'GST' },
];

/**
 * The payment methods behind every expense and payment form (§6.15, Financial).
 *
 * **Not the buyer's saved cards.** `User.paymentMethods` is what a customer
 * pays *with*; this is the vocabulary staff pick from when they record money
 * moving - an expense paid by cheque, an invoice settled by e-Transfer. The two
 * lists are unrelated and must not be merged.
 *
 * `code` is the stable key and `label` is what the staff member reads, so renaming
 * a label never orphans the expenses already recorded against its code.
 */
const DEFAULT_PAYMENT_METHODS = [
  { code: 'cash', label: 'Cash' },
  { code: 'debit', label: 'Debit' },
  { code: 'credit-card', label: 'Credit Card' },
  { code: 'e-transfer', label: 'e-Transfer' },
  { code: 'cheque', label: 'Cheque' },
  { code: 'bank-transfer', label: 'Bank Transfer' },
  { code: 'paypal', label: 'PayPal' },
  { code: 'other', label: 'Other' },
];

/**
 * Shipping bands (§6.15 - CellShoppe's per-km mileage rate is dropped; Cellvix
 * ships parts, it does not drive to jobs).
 *
 * These are the three methods `shared/schemas/checkout.js` currently hard-codes,
 * and the codes match deliberately: `DELIVERY_METHODS` stays the shape checkout
 * renders and validates against, while the **money** moves here so a rate can
 * change without a deploy. Costs are integer cents, like every other amount.
 *
 * `freeOver: null` means the method never ships free - deliberately distinct
 * from `0`, which would mean it always does.
 */
const DEFAULT_SHIPPING_METHODS = [
  { code: 'ground', label: 'Ground', detail: '2–4 business days', cost: 1895, etaDays: 3, freeOver: 50_000 },
  { code: 'express', label: 'Express', detail: 'Next business day', cost: 3495, etaDays: 1, freeOver: null },
  { code: 'pickup', label: 'Warehouse pickup', detail: 'Ready in 2 hours', cost: 0, etaDays: 0, freeOver: null },
];

const settingsSchema = new mongoose.Schema(
  {
    // The singleton key. Unique, so a second document cannot be created by a
    // race - `load()` upserts against it.
    key: { type: String, default: 'singleton', unique: true, index: true },

    business: {
      name: { type: String, default: 'Cellvix' },
      tagline: { type: String, default: 'Wholesale phone and laptop parts' },
      phone: { type: String, default: '(416) 555-0100' },
      email: { type: String, default: 'sales@cellvix.ca' },
      website: { type: String, default: 'https://cellvix.ca' },
      // Dummy until the client supplies the real number (§0.15).
      taxNumber: { type: String, default: '12345 6789 RT0001' },
      /**
       * Where a happy customer is sent to leave a review.
       *
       * No default, and that is the point: the warranty sheet and the warranty
       * email both omit the whole feedback block when it is empty. A review
       * button pointing at a placeholder is worse than no button, because the
       * customer who clicks it lands nowhere and the shop never finds out.
       */
      reviewUrl: { type: String, default: '' },
      address: {
        line1: { type: String, default: '2200 Meadowvale Blvd' },
        line2: { type: String, default: 'Unit 12' },
        city: { type: String, default: 'Mississauga' },
        region: { type: String, default: 'ON' },
        postal: { type: String, default: 'L5N 6H8' },
        country: { type: String, default: 'CA' },
      },
    },

    financial: {
      timezone: { type: String, default: 'America/Toronto' },
      currency: { type: String, default: 'CAD' },

      taxRatesByProvince: {
        type: [
          {
            _id: false,
            province: String,
            rate: Number, // a fraction, not a percentage: 0.13, never 13
            kind: String,
          },
        ],
        default: () => DEFAULT_TAX_RATES,
      },

      defaultDueDays: { type: Number, default: 30 },

      // Referral commission (§6.13), as a percentage - 5 means 5%, not 0.05.
      // Stored as a percent because that is the unit the staff member types into
      // the screen and the unit the rate is discussed in; the division happens
      // once, inside `referralService`.
      //
      // Changing this is **not retroactive**: every accrual snapshots the rate
      // in force when it was earned onto its own ledger row.
      referralPercent: { type: Number, default: 5, min: 0, max: 100 },

      /**
       * What a kilometre of travel costs the business, in integer cents.
       *
       * Used on an on-site repair to work out the technician's mileage from the
       * distance they drove. `56.7` is 2026's CRA rate for the first 5,000 km,
       * held in cents-per-km rather than dollars so it carries the tenth of a
       * cent the rate actually has.
       *
       * **This is internal cost, never a charge.** The allowance it produces is
       * recorded against the invoice for the shop's own books and is NOT added
       * to what the customer owes - that is the extended service area fee, which
       * is a separate ticked line. Mixing them would bill a customer for the
       * shop's own mileage claim.
       */
      travelRateCentsPerKm: { type: Number, default: 56.7, min: 0 },
      /**
       * The warranty every repair carries before any tier bonus, in days.
       *
       * The floor the tier table adds to: Silver's bonus of 30 means 90 + 30,
       * not 30. Separate from warrantyByGrade, which is the cover a PART
       * carries by its condition - a shop promising 90 days on its own labour
       * is a different promise from the one a NEW part comes with, and a
       * repair invoice makes both.
       */
      warrantyBaseDays: { type: Number, default: 90, min: 0 },

      // Dummy values until the client confirms (§0.12).
      warrantyByGrade: {
        type: Map,
        of: Number, // days
        default: () => new Map([['NEW', 365], ['OEM', 180], ['PULL-A', 90], ['PULL-B', 60], ['AFTERMARKET', 90]]),
      },

      /**
       * Extra warranty days a membership tier adds **on top of** the grade.
       *
       * Additive rather than absolute, and that is the whole design decision.
       * An absolute figure per tier would silently overwrite the grade table
       * a Gold customer's 90-day tier warranty would *shorten* the 365 days a
       * NEW part already carries, which is the opposite of what a tier is for.
       * A bonus can only ever improve the cover, so the two tables can never
       * contradict each other.
       *
       * Standard is 0 by definition: it is the baseline the grade table already
       * describes.
       */
      warrantyBonusByTier: {
        type: Map,
        of: Number, // extra days
        default: () => new Map(Object.entries(DEFAULT_TIER_WARRANTY_BONUS)),
      },

      // The vocabulary staff pick from when recording money moving. See
      // DEFAULT_PAYMENT_METHODS - this is not the buyer's saved cards.
      paymentMethods: {
        type: [{ _id: false, code: String, label: String }],
        default: () => DEFAULT_PAYMENT_METHODS,
      },

      // Integer cents, like every other amount in this system.
      shippingMethods: {
        type: [
          {
            _id: false,
            code: String,
            label: String,
            detail: String,
            cost: Number,
            etaDays: Number,
            // null means "never ships free" - not the same as 0.
            freeOver: { type: Number, default: null },
          },
        ],
        default: () => DEFAULT_SHIPPING_METHODS,
      },
    },

    /**
     * Defaults that pre-fill the New Product form (§6.15, Inventory Settings).
     *
     * **Pre-fill only - a per-product value always wins.** These never
     * retroactively reprice anything already in the catalogue; changing a
     * default changes what the next blank form suggests and nothing else.
     *
     * Markup and margin are two views of one number, related by
     * `markup = margin ÷ (100 − margin) × 100`. Both are stored because the
     * staff member thinks in whichever one their supplier quotes in, and the screen
     * prints the conversion so the two can never silently disagree.
     */
    inventory: {
      defaultMarkupPercent: { type: Number, default: 40, min: 0, max: 1000 },
      defaultMarginPercent: { type: Number, default: 28.5, min: 0, max: 99.9 },
    },

    operations: {
      rmaSlaDays: { type: Number, default: 14 },
      // A repair is a promise with a date on it, so an open ticket ages
      // against its own SLA rather than borrowing the returns one.
      ticketSlaDays: { type: Number, default: 7 },
      lowStockThreshold: { type: Number, default: 50 },
    },

    /**
     * The self-service check-in tablet (Sales § Kiosk).
     *
     * **The PIN is hashed, never stored in the clear.** It is a credential: it
     * is what stops the tablet being picked up and used, and a shop reusing a
     * memorable four digits elsewhere should not have them readable by anybody
     * who can see this document. `select: false` for the same reason
     * `User.password` is - it must not ride along on the forty other reads of
     * the settings record.
     *
     * **One PIN per business, not per staff member.** The lock screen says
     * "Staff: enter the kiosk PIN", singular: it is a door to the tablet, not
     * an identity. A kiosk ticket records no staff member because none was
     * there - the customer filled it in themselves, which is the whole point,
     * and `intake.awaitingReview` is how a person gets attached to it later.
     *
     * Absent means the kiosk has never been set up, which is different from a
     * PIN of `0000`: the screen offers to set one rather than refusing entry to
     * a door nobody has locked yet.
     */
    kiosk: {
      pinHash: { type: String, select: false },
      /** Off by default. A tablet in the window is a deliberate act. */
      isEnabled: { type: Boolean, default: false },
      /** Shown on the welcome screen, under the business name. */
      welcomeMessage: {
        type: String,
        trim: true,
        maxlength: 200,
        default: 'Welcome! Check in your device in just a minute.',
      },
      /** Shown on the done screen, above the ticket number. */
      thankYouMessage: {
        type: String,
        trim: true,
        maxlength: 200,
        default: "You're all set! Please hand your device to our team.",
      },
      /**
       * Whether the questions are read aloud by default.
       *
       * An accessibility feature, and the reason the flow is one question per
       * screen rather than a form: a screen with one question on it is a screen
       * that can be read out in one breath. The customer can still toggle it.
       */
      readAloud: { type: Boolean, default: true },
      /**
       * Whether agreeing to the repair terms is required to finish.
       *
       * On by default. It is the shop's protection - a customer who says they
       * never agreed to leave the device is answered by the row they ticked,
       * and a shop that cannot say when that was agreed cannot rely on it.
       */
      requireTerms: { type: Boolean, default: true },
      termsText: {
        type: String,
        trim: true,
        maxlength: 1000,
        default: "I agree to leave my device for diagnosis and to the shop's repair terms.",
      },
    },

    /**
     * Automatic email, and who hears about what (§6.15 category 5, phase 11e).
     *
     * **Everything defaults off.** CellShoppe ships them off and that is the
     * right call for anything that emails a customer: a toggle that starts on
     * sends mail nobody chose to send, from a system nobody has finished
     * configuring.
     *
     * One exception, deliberately: `invoiceOnOrder` defaults **true**, because
     * it is already live - `orderService.placeOrder` has emailed the invoice
     * since phase 2. Shipping it off would silently switch off a path that has
     * been running for months, which is a behaviour change disguised as a
     * default.
     */
    communications: {
      // Live today.
      invoiceOnOrder: { type: Boolean, default: true },

      // Paths that exist but are not yet called from anywhere - see the
      // `wired` map in `settingsService`, which is what stops the screen
      // implying these do something.
      quoteOnCreate: { type: Boolean, default: false },
      paymentConfirmation: { type: Boolean, default: false },
      paymentStatusUpdates: { type: Boolean, default: false },
      accountApproved: { type: Boolean, default: false },
      accountRejected: { type: Boolean, default: false },
      invoiceReminders: { type: Boolean, default: false },
      lowStockAlerts: { type: Boolean, default: false },

      // Reminders & notifications.
      reminderDaysBefore: { type: Number, default: 3, min: 0, max: 90 },
      followUpDaysAfter: { type: Number, default: 7, min: 0, max: 90 },
      adminEmail: { type: String, default: '' },
      // Cents, like every other amount. 0 means "never notify on size".
      notifyAboveAmount: { type: Number, default: 0, min: 0 },
      lowStockEmail: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

/**
 * The one way to read settings.
 *
 * Upserts on first call so every caller gets a fully-defaulted document rather
 * than having to branch on "not configured yet". Returns a lean object - this
 * is read on report paths and nothing mutates it through here.
 */
settingsSchema.statics.load = async function load() {
  const existing = await this.findOne({ key: 'singleton' }).lean();
  if (existing) return existing;

  await this.updateOne({ key: 'singleton' }, { $setOnInsert: { key: 'singleton' } }, { upsert: true });
  return this.findOne({ key: 'singleton' }).lean();
};

/**
 * The rate for one province, as a fraction. Falls back to Ontario's HST, which
 * is where Cellvix is registered - an unknown province is a data problem, not a
 * reason to charge zero tax.
 */
settingsSchema.statics.rateFor = function rateFor(settings, province) {
  const rates = settings?.financial?.taxRatesByProvince ?? DEFAULT_TAX_RATES;
  const match = rates.find((row) => row.province === province);
  return match?.rate ?? rates.find((row) => row.province === 'ON')?.rate ?? 0.13;
};

/**
 * One shipping method by code, falling back to the first configured band.
 *
 * Mirrors `rateFor`'s posture: an unrecognised code is a data problem, and
 * falling back to a real band is safer than charging nothing for delivery.
 */
settingsSchema.statics.shippingFor = function shippingFor(settings, code) {
  const methods = settings?.financial?.shippingMethods?.length
    ? settings.financial.shippingMethods
    : DEFAULT_SHIPPING_METHODS;
  return methods.find((row) => row.code === code) ?? methods[0];
};

const Settings = mongoose.model('Settings', settingsSchema);

export {
  DEFAULT_TAX_RATES,
  DEFAULT_TIER_WARRANTY_BONUS,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_SHIPPING_METHODS,
  Settings,
};
export default Settings;
