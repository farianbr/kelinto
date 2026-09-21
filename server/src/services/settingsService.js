import {
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_SHIPPING_METHODS,
  DEFAULT_TAX_RATES,
  DEFAULT_TIER_WARRANTY_BONUS,
} from '../models/Settings.js';
import { controlModels, db } from '../db/models.js';
import { currentBusinessId } from '../db/context.js';
import { BUSINESS_INFO } from '../../../shared/business.js';
import { COUNTRIES } from '../../../shared/countries.js';
import '../models/Settings.js';
import ApiError from '../utils/ApiError.js';

/**
 * The settings singleton's read and write surface (ERP rework §6.15, phase 11).
 *
 * **The data model landed first, deliberately.** Tax rates, invoice due days,
 * warranty lengths and shipping bands have been read by phases 5, 6 and 7 since
 * they were built, from `Settings` with seeded defaults. §10's sequencing note
 * is explicit about why: hard-coding a rate and "moving it to Settings later"
 * is how a system ends up with two sources of truth for the tax rate. So this
 * file builds no new source of truth - it is the **editor** for one that has
 * been live all along.
 *
 * Three rules hold it together:
 *
 * **1. One document, always.** Every write targets `{ key: 'singleton' }` with
 * an upsert, so a settings write can never mint a second document under a race.
 *
 * **2. Writes are per-section, never wholesale.** Each function `$set`s only
 * the paths its own screen owns. A whole-document `save()` would let the Sale
 * Settings form silently revert a shipping band edited in another tab, because
 * it would post back the copy it loaded on open.
 *
 * **3. `referralPercent` is not writable here.** It lives in
 * `financial.referralPercent` and is set only by `referralService.setPercent`,
 * behind an admin-only route - it multiplies every future payout, and §6.13 put
 * it under Marketing → Referrals rather than in Settings for exactly that
 * reason. A `financial` write must not become a second door onto it.
 */

/** Provinces the tax table may name. Mirrors `shared/schemas/checkout.js`. */
const PROVINCE_CODES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

const TAX_KINDS = new Set(['GST', 'HST', 'GST+PST', 'GST+QST']);

/**
 * A country's printable name from its two-letter code.
 *
 * Address fields store the code; a storefront prints the name. A code nobody
 * recognises is returned as it was given rather than dropped - a wrong-looking
 * country line is a data problem somebody can see and fix, where a missing one
 * looks like an address that simply has no country.
 */
function countryName(code) {
  if (!code) return '';
  return COUNTRIES.find((row) => row.code === code)?.name ?? code;
}

/**
 * Which automatic-email toggles gate a path that actually runs (phase 11e).
 *
 * **This is the honest half of the Email Settings screen.** §6.15 lists eleven
 * toggles; three of them currently sit in front of live code and the rest
 * describe email paths nobody has written yet. Presenting all eleven identically
 * would have a staff member switch one on, assume customers are being emailed, and
 * find out otherwise from a customer.
 *
 * A toggle flips to `true` here the moment its send path lands - one edit, and
 * the screen stops marking it.
 */
const COMMUNICATIONS_WIRED = {
  // Live since phase 2: `orderService.placeOrder` emails the invoice.
  invoiceOnOrder: true,
  // Live since phase 11d: the invoice-message rules send these.
  invoiceReminders: true,
  paymentStatusUpdates: true,

  // Live since 2026-09-21: `adminService.approveUser` and `rejectUser` send
  // these through `accountDecisionMail`.
  accountApproved: true,
  accountRejected: true,

  /**
   * Also live since 2026-09-21, through `transactionalMail`.
   *
   * - `quoteOnCreate` - `quoteService.createQuote`
   * - `paymentConfirmation` - `invoicePaymentService.recordPayment`, the one
   *   write path every payment goes through
   * - `lowStockAlerts` - `lowStockAlertService.sendLowStockAlert`, its own job
   *   rather than part of the invoice pass, because that pass exits early
   *   unless invoice reminders are on and these are separate decisions
   *
   * Every entry in this map is now `true`, which is the point: the screen has
   * nothing left to mark as unbuilt.
   */
  quoteOnCreate: true,
  paymentConfirmation: true,
  lowStockAlerts: true,
};

/**
 * Reads the whole singleton, shaped for the client.
 *
 * `Settings.load()` upserts on first read, so this never has to branch on "not
 * configured yet" - every caller gets a fully-defaulted document.
 *
 * `warrantyByGrade` is stored as a Map, which does not survive `.lean()` as a
 * plain object identically across driver versions, so it is normalised here
 * rather than in each screen.
 */
async function get() {
  const doc = await db().Settings.load();

  /**
   * Whether a kiosk PIN has ever been set.
   *
   * Its own query because `pinHash` is `select: false`, and widening
   * `Settings.load()` to include it would put a credential into the forty other
   * reads that call it - tax rates, shipping bands, invoice defaults. This asks
   * for the one field, and never for its value: `hasPin` is a boolean the
   * screen needs (change a PIN, or set the first one) and the hash itself never
   * leaves the server.
   */
  const pinDoc = await db()
    .Settings.findOne({ key: 'singleton' })
    .select('+kiosk.pinHash')
    .lean();

  return {
    /**
     * Defaulted field by field for the reason the blocks below give: a schema
     * `default` only fires when a document is created, and every business
     * already has a settings row. Passed through raw, the fields added after
     * those rows existed read as `undefined`, and the Business Info form would
     * save that back as a blank.
     *
     * **The two mailboxes are NOT defaulted to `email` here.** They fall back
     * to it where they are read (`publicProfile` below), not where they are
     * edited: this shape feeds the Business Info form, and handing that form a
     * resolved value would have it save `email` back as an explicit support
     * address - freezing a copy that stops tracking the main one the moment it
     * changes. Empty has to survive the round trip to keep meaning "follow the
     * main address".
     */
    business: {
      ...doc.business,
      logoUrl: doc.business?.logoUrl ?? '',
      supportEmail: doc.business?.supportEmail ?? '',
      billingEmail: doc.business?.billingEmail ?? '',
      whatsapp: doc.business?.whatsapp ?? '',
      mapUrl: doc.business?.mapUrl ?? '',
      hours: doc.business?.hours ?? [],
      social: doc.business?.social ?? [],
    },
    financial: {
      timezone: doc.financial?.timezone ?? 'America/Toronto',
      // Fixed, not a preference. Cellvix sells in Canada and every amount in
      // the system is CAD cents; a currency select here would imply a
      // conversion layer that does not exist (§9).
      currency: 'CAD',
      taxRatesByProvince: doc.financial?.taxRatesByProvince ?? DEFAULT_TAX_RATES,
      defaultDueDays: doc.financial?.defaultDueDays ?? 30,
      warrantyByGrade: Object.fromEntries(
        doc.financial?.warrantyByGrade instanceof Map
          ? doc.financial.warrantyByGrade
          : Object.entries(doc.financial?.warrantyByGrade ?? {}),
      ),
      /**
       * Same Map normalisation as the grade table above - plus a default for
       * documents that predate the field.
       *
       * A schema `default` only runs when a document is created, and this
       * deployment's Settings row already exists, so without the fallback every
       * existing install would read an empty table and quietly give every tier
       * a zero bonus. `DEFAULT_TAX_RATES` is handled the same way, one line up,
       * for exactly this reason.
       */
      warrantyBonusByTier: (() => {
        const stored = Object.fromEntries(
          doc.financial?.warrantyBonusByTier instanceof Map
            ? doc.financial.warrantyBonusByTier
            : Object.entries(doc.financial?.warrantyBonusByTier ?? {}),
        );
        return Object.keys(stored).length > 0 ? stored : { ...DEFAULT_TIER_WARRANTY_BONUS };
      })(),
      paymentMethods: doc.financial?.paymentMethods?.length
        ? doc.financial.paymentMethods
        : DEFAULT_PAYMENT_METHODS,
      shippingMethods: doc.financial?.shippingMethods?.length
        ? doc.financial.shippingMethods
        : DEFAULT_SHIPPING_METHODS,
      // Read-only here. Shown so the Financial screens can say where it lives
      // rather than leaving an admin hunting for it.
      referralPercent: doc.financial?.referralPercent ?? 5,

      /**
       * What a kilometre of travel is worth, in cents.
       *
       * **Defaulted here as well as on the schema.** The schema default only
       * applies to a document being created; every business already had a
       * settings record, so those carry `undefined` and the invoice form read
       * the rate as 0 - showing "$0.00/km" and calculating no allowance at all.
       * A read shape that whitelists fields has to default each one it adds.
       */
      travelRateCentsPerKm: doc.financial?.travelRateCentsPerKm ?? 56.7,

      // Same reason as the rate above: the schema default never ran for a
      // settings document that already existed, so the warranty sheet read it
      // as undefined and silently fell back to a literal 90.
      warrantyBaseDays: doc.financial?.warrantyBaseDays ?? 90,
    },
    inventory: {
      defaultMarkupPercent: doc.inventory?.defaultMarkupPercent ?? 40,
      defaultMarginPercent: doc.inventory?.defaultMarginPercent ?? 28.5,
    },
    communications: {
      invoiceOnOrder: doc.communications?.invoiceOnOrder !== false,
      quoteOnCreate: Boolean(doc.communications?.quoteOnCreate),
      paymentConfirmation: Boolean(doc.communications?.paymentConfirmation),
      paymentStatusUpdates: Boolean(doc.communications?.paymentStatusUpdates),
      accountApproved: Boolean(doc.communications?.accountApproved),
      accountRejected: Boolean(doc.communications?.accountRejected),
      invoiceReminders: Boolean(doc.communications?.invoiceReminders),
      lowStockAlerts: Boolean(doc.communications?.lowStockAlerts),
      reminderDaysBefore: doc.communications?.reminderDaysBefore ?? 3,
      followUpDaysAfter: doc.communications?.followUpDaysAfter ?? 7,
      adminEmail: doc.communications?.adminEmail ?? '',
      notifyAboveAmount: doc.communications?.notifyAboveAmount ?? 0,
      lowStockEmail: doc.communications?.lowStockEmail ?? '',
    },
    /**
     * The kiosk tablet's own copy and switches (Sales § Kiosk).
     *
     * **`pinHash` is never in this shape.** It is `select: false` on the model
     * for the same reason `User.password` is, and the settings read is the
     * single most-called read in the panel. `hasPin` is the only fact the
     * screen needs: whether there is a PIN to change or one to set for the
     * first time.
     *
     * Defaulted field by field rather than passed through, because a schema
     * `default` only runs when a document is created and every business already
     * has a settings record - so a passed-through read would hand the form
     * `undefined` for each of these and blank the shop's welcome message the
     * first time somebody pressed save.
     */
    kiosk: {
      isEnabled: doc.kiosk?.isEnabled === true,
      hasPin: Boolean(pinDoc?.kiosk?.pinHash),
      welcomeMessage:
        doc.kiosk?.welcomeMessage ?? 'Welcome! Check in your device in just a minute.',
      thankYouMessage:
        doc.kiosk?.thankYouMessage ?? "You're all set! Please hand your device to our team.",
      readAloud: doc.kiosk?.readAloud !== false,
      requireTerms: doc.kiosk?.requireTerms !== false,
      termsText:
        doc.kiosk?.termsText ??
        "I agree to leave my device for diagnosis and to the shop's repair terms.",
    },
    // Which toggles actually gate a live path today (§6b rule 4, applied to a
    // settings screen). Sent so the screen can mark the rest plainly instead of
    // presenting eleven switches that all look equally functional - a toggle
    // that changes nothing is worse than a missing one, because somebody will
    // switch it on and believe the emails are going out.
    communicationsWired: COMMUNICATIONS_WIRED,
    /**
     * Defaulted field by field, for the reason the financial block above gives:
     * a schema `default` only fires when a document is created, and every
     * business already has a settings row. Passed through raw, a document
     * predating `lowStockThreshold` handed the form `undefined` - which the
     * screen would then save back as a blank.
     */
    operations: {
      rmaSlaDays: doc.operations?.rmaSlaDays ?? 14,
      ticketSlaDays: doc.operations?.ticketSlaDays ?? 7,
      lowStockThreshold: doc.operations?.lowStockThreshold ?? 50,
    },
    updatedAt: doc.updatedAt,
  };
}

/**
 * What the storefront is allowed to know about the business it is serving.
 *
 * ## Why this is a separate shape
 *
 * `get()` is the admin read: it carries tax rates, invoice defaults, warranty
 * tables and the kiosk's switches, and it sits behind `settings: view`. None of
 * that belongs on a public route, so this is an **allowlist**, built field by
 * field - the same posture `productService.serialize` takes for a product. A
 * spread of `doc.business` would work today and leak the next field somebody
 * adds to it.
 *
 * ## Why it exists at all
 *
 * `shared/business.js` is one hardcoded object holding Cellvix's name, address,
 * phone, hours and social handles, and fifteen client files read it. That was
 * correct while Cellvix was the only business. It stopped being correct the
 * moment a second one existed: CellShoppe's storefront footer printed the
 * wholesaler's address, its contact page offered the wholesaler's phone number,
 * and its social row linked to `@cellvix`.
 *
 * `services/sendingBusiness.js` fixed exactly this for documents and email. The
 * storefront half was never done, and it is the more visible one - an invoice
 * is read once, a footer is on every page.
 *
 * ## The name comes from the record, not from Settings
 *
 * Same rule as `sendingBusiness`, and for the same reason: `Settings.business.name`
 * defaults to `'Cellvix'` in the schema, so a business nobody filled that field
 * in for still carries the wholesaler's name. The `Business` record's name is
 * what a super admin typed when the business was created, so it is always
 * right. Everything else has no such authoritative source and comes from
 * Settings, which is the screen an owner edits.
 */
async function publicProfile() {
  const doc = await db().Settings.load();
  const info = doc?.business ?? {};

  const businessId = currentBusinessId();
  const record = businessId
    ? await controlModels().Business.findById(businessId).select('name isDefault').lean()
    : null;

  const email = info.email ?? '';

  return {
    // The record wins, then Settings, then the house name - see the note above.
    name: record?.name || info.name || BUSINESS_INFO.name,
    tagline: info.tagline ?? '',
    logoUrl: info.logoUrl ?? '',

    /**
     * Whether this is the house business - the one carrying `isDefault`.
     *
     * The storefront's bundled artwork (`/brand/logo.png`, the footer wordmark)
     * is Cellvix's own, so it is right for exactly one business and wrong for
     * every other. A business with no `logoUrl` of its own falls back to that
     * artwork only when this is true, and to its name set as a wordmark
     * otherwise - which is why the flag has to reach the client rather than
     * being inferred from the name matching a string.
     */
    isHouse: record?.isDefault === true,

    phone: info.phone ?? '',
    email,
    // Resolved here rather than on the way out of the editor, so a business
    // that has not set a separate mailbox keeps following its main one.
    supportEmail: info.supportEmail || email,
    billingEmail: info.billingEmail || email,
    whatsapp: info.whatsapp ?? '',
    mapUrl: info.mapUrl ?? '',
    website: info.website ?? '',

    address: {
      line1: info.address?.line1 ?? '',
      line2: info.address?.line2 ?? '',
      city: info.address?.city ?? '',
      region: info.address?.region ?? '',
      postal: info.address?.postal ?? '',
      /**
       * The country's **name**, not its code.
       *
       * Settings stores `'CA'`, because that is what a two-letter address field
       * holds and what every other address in the system carries. The
       * storefront prints this under a postal code, where "CA" reads as an
       * abbreviation nobody asked for - the hardcoded constant it replaces said
       * "Canada". Resolved here so each of the surfaces that print an address
       * does not have to know the difference.
       */
      country: countryName(info.address?.country),
    },

    // Both default to an empty list, and every surface that renders them omits
    // its block entirely when empty rather than printing a placeholder.
    hours: (info.hours ?? []).map((row) => ({ days: row.days, time: row.time })),
    social: (info.social ?? []).map((row) => ({
      network: row.network,
      url: row.url,
      handle: row.handle ?? '',
    })),

    /**
     * Deliberately absent: `taxNumber`.
     *
     * It belongs on an invoice, which is a document addressed to one customer,
     * not on an unauthenticated route that answers anybody who asks. Nothing on
     * the storefront prints it today, and this shape is what would make doing
     * so accidental.
     */
  };
}

/** The one way a section is written. Keeps rule 1 in a single place. */
async function patch($set) {
  await db().Settings.updateOne({ key: 'singleton' }, { $set }, { upsert: true });
  return get();
}

/**
 * Business Info (§6.15, category 1).
 *
 * Feeds invoices, transactional email and the storefront footer, which is why
 * it is the answer to the `BUSINESS_INFO` placeholder constants still sitting
 * in `client/src/lib/constants.js`.
 */
async function updateBusiness(input) {
  return patch({
    'business.name': input.name,
    'business.tagline': input.tagline ?? '',
    'business.phone': input.phone ?? '',
    'business.email': input.email ?? '',
    'business.website': input.website ?? '',
    'business.taxNumber': input.taxNumber ?? '',
    'business.reviewUrl': input.reviewUrl ?? '',
    'business.logoUrl': input.logoUrl ?? '',
    'business.supportEmail': input.supportEmail ?? '',
    'business.billingEmail': input.billingEmail ?? '',
    'business.whatsapp': input.whatsapp ?? '',
    'business.mapUrl': input.mapUrl ?? '',
    /**
     * Lists are replaced wholesale, unlike the warranty maps in `updateSale`.
     *
     * That is right here: the screen edits the whole list on one form and posts
     * all of it back, so a row that is missing from the payload is one the staff
     * member deleted. The merge in `updateSale` exists because a payload there
     * names a subset of the grades by design.
     *
     * **But an ABSENT list is not an empty one.** Both fields are optional, so
     * a client that predates them sends neither - and writing `[]` for those
     * would let saving any other field on this form silently delete the hours
     * a business had entered. Absent means "not edited"; `[]` means "cleared",
     * and only the second is written.
     */
    ...(input.hours === undefined ? {} : { 'business.hours': input.hours }),
    ...(input.social === undefined ? {} : { 'business.social': input.social }),
    'business.address': input.address,
  });
}

/**
 * Sale Settings (§6.15, category 2) - regional defaults, invoice due days,
 * the per-province tax table and warranty by product grade.
 *
 * **The tax table is validated hard.** It is the single input that decides what
 * every future invoice charges a customer, and a rate stored as `13` instead of
 * `0.13` would overcharge by two orders of magnitude without throwing anything.
 * So rates are fractions here, the way the model stores and `rateFor` reads
 * them, and the screen does the percent conversion for display.
 */
async function updateSale(input) {
  const seen = new Set();

  for (const row of input.taxRatesByProvince) {
    if (!PROVINCE_CODES.has(row.province)) {
      throw ApiError.badRequest(`${row.province} is not a Canadian province code.`, 'UNKNOWN_PROVINCE');
    }
    if (seen.has(row.province)) {
      throw ApiError.badRequest(`${row.province} is listed twice.`, 'DUPLICATE_PROVINCE');
    }
    seen.add(row.province);

    if (!TAX_KINDS.has(row.kind)) {
      throw ApiError.badRequest(`${row.kind} is not a tax kind this system knows.`, 'UNKNOWN_TAX_KIND');
    }
  }

  // Warranty is **merged**, not replaced. `$set` on a Map overwrites the whole
  // thing, so a payload naming three grades would silently delete the other
  // two - and a grade with no warranty length is not the same as a grade with
  // a zero-day one. RMA reads these to decide whether a return is in warranty,
  // so a quietly missing grade is a wrong answer rather than a missing screen.
  const current = await db().Settings.load();
  const existingWarranty = Object.fromEntries(
    current.financial?.warrantyByGrade instanceof Map
      ? current.financial.warrantyByGrade
      : Object.entries(current.financial?.warrantyByGrade ?? {}),
  );

  /**
   * The tier bonus table is merged for the same reason, and additionally
   * tolerates being absent from the payload: a client that predates the field
   * must not wipe it by saving the rest of the form.
   *
   * **The stored value falls back to the defaults, not to `{}`.** A document
   * that predates the field has an empty Map, so merging onto `{}` and then
   * `$set`ting the result would let a payload naming one tier delete the other
   * three - the exact whole-Map overwrite this merge exists to prevent, just
   * arriving one save later. Merging onto the same defaults the read path
   * serves keeps the two halves telling the same story.
   */
  const storedTierBonus = Object.fromEntries(
    current.financial?.warrantyBonusByTier instanceof Map
      ? current.financial.warrantyBonusByTier
      : Object.entries(current.financial?.warrantyBonusByTier ?? {}),
  );
  const existingTierBonus =
    Object.keys(storedTierBonus).length > 0
      ? storedTierBonus
      : { ...DEFAULT_TIER_WARRANTY_BONUS };

  return patch({
    'financial.timezone': input.timezone,
    'financial.defaultDueDays': input.defaultDueDays,
    'financial.taxRatesByProvince': input.taxRatesByProvince,
    'financial.warrantyByGrade': { ...existingWarranty, ...input.warrantyByGrade },
    'financial.warrantyBonusByTier': {
      ...existingTierBonus,
      ...(input.warrantyBonusByTier ?? {}),
    },
    'operations.rmaSlaDays': input.rmaSlaDays,
    // Optional on the form for the same reason the two below are: a payload
    // that predates the field must not blank a figure somebody already set.
    ...(input.ticketSlaDays === undefined
      ? {}
      : { 'operations.ticketSlaDays': input.ticketSlaDays }),
    // Optional on the form, so an older payload that omits it must not write
    // `undefined` over a rate somebody already set.
    ...(input.travelRateCentsPerKm === undefined
      ? {}
      : { 'financial.travelRateCentsPerKm': input.travelRateCentsPerKm }),
    ...(input.warrantyBaseDays === undefined
      ? {}
      : { 'financial.warrantyBaseDays': input.warrantyBaseDays }),
  });
}

/**
 * Shipping Rates (§6.15 - the slot CellShoppe gives *Services*).
 *
 * The codes are not editable and no band can be added or removed: checkout
 * validates `deliveryMethod` against a fixed enum in
 * `shared/schemas/checkout.js`, so a fourth band invented here would be
 * unselectable, and deleting one would break every order that already names it.
 * What is editable is the part a staff member actually needs to change - the
 * label, the description, the price and the free-shipping threshold.
 */
async function updateShipping(input) {
  const current = await db().Settings.load();
  const existing = current.financial?.shippingMethods?.length
    ? current.financial.shippingMethods
    : DEFAULT_SHIPPING_METHODS;

  const byCode = new Map(input.methods.map((row) => [row.code, row]));

  for (const code of byCode.keys()) {
    if (!existing.some((row) => row.code === code)) {
      throw ApiError.badRequest(`There is no shipping method called “${code}”.`, 'UNKNOWN_SHIPPING_METHOD');
    }
  }

  // Merged onto the existing list rather than replacing it, so a partial post
  // cannot silently drop a band.
  const merged = existing.map((row) => {
    const patchRow = byCode.get(row.code);
    if (!patchRow) return row;
    return {
      code: row.code,
      label: patchRow.label,
      detail: patchRow.detail ?? '',
      cost: patchRow.cost,
      etaDays: patchRow.etaDays,
      // An empty threshold means "never free", stored as null rather than 0
      // 0 would mean every order ships free.
      freeOver: patchRow.freeOver ?? null,
    };
  });

  return patch({ 'financial.shippingMethods': merged });
}

/**
 * Payment Methods (§6.15, category 2).
 *
 * A flat editable list. `code` is generated from the label on create and then
 * frozen: expenses and payments store the code, so letting it change would
 * orphan every row already recorded against it.
 */
async function updatePaymentMethods(input) {
  const seen = new Set();

  for (const row of input.methods) {
    if (seen.has(row.code)) {
      throw ApiError.badRequest(`“${row.code}” is listed twice.`, 'DUPLICATE_PAYMENT_METHOD');
    }
    seen.add(row.code);
  }

  if (input.methods.length === 0) {
    throw ApiError.badRequest(
      'Keep at least one payment method - every expense and payment has to name one.',
      'NO_PAYMENT_METHODS',
    );
  }

  return patch({ 'financial.paymentMethods': input.methods });
}

/**
 * Inventory Settings (§6.15, category 2).
 *
 * Pre-fills the New Product form and nothing else. Changing a default never
 * reprices the catalogue - a per-product value always wins - and the screen
 * says so, because "did I just change every price" is the first thing a
 * staff member will wonder.
 */
async function updateInventory(input) {
  return patch({
    'inventory.defaultMarkupPercent': input.defaultMarkupPercent,
    'inventory.defaultMarginPercent': input.defaultMarginPercent,
    // Filed under `operations` rather than `inventory` because that is where
    // the field already lives and where `reportService` has always read it
    // from; moving it to match this screen's name would orphan the value every
    // running business has. Optional on the form, so an older payload that
    // omits it must not write `undefined` over a threshold somebody set.
    ...(input.lowStockThreshold === undefined
      ? {}
      : { 'operations.lowStockThreshold': input.lowStockThreshold }),
  });
}

/**
 * Email Settings (§6.15, category 5).
 *
 * Toggles and the reminder schedule. Nothing here sends anything - it decides
 * what the paths that do send are allowed to do.
 */
async function updateCommunications(input) {
  return patch({
    'communications.invoiceOnOrder': input.invoiceOnOrder,
    'communications.quoteOnCreate': input.quoteOnCreate,
    'communications.paymentConfirmation': input.paymentConfirmation,
    'communications.paymentStatusUpdates': input.paymentStatusUpdates,
    'communications.accountApproved': input.accountApproved,
    'communications.accountRejected': input.accountRejected,
    'communications.invoiceReminders': input.invoiceReminders,
    'communications.lowStockAlerts': input.lowStockAlerts,
    'communications.reminderDaysBefore': input.reminderDaysBefore,
    'communications.followUpDaysAfter': input.followUpDaysAfter,
    'communications.adminEmail': input.adminEmail ?? '',
    'communications.notifyAboveAmount': input.notifyAboveAmount ?? 0,
    'communications.lowStockEmail': input.lowStockEmail ?? '',
  });
}

/**
 * Kiosk (§6.15) - the copy and switches behind the check-in tablet.
 *
 * **The PIN is not written here.** It has its own audited route, and it is the
 * one field on this screen that is a credential rather than a preference.
 *
 * `isEnabled` is the switch `kioskService.unlock` checks, so turning it off
 * here locks every tablet in the shop at the next unlock. It does not sign out
 * a tablet that is already unlocked: a customer halfway through a check-in
 * should not lose what they have typed because somebody saved a settings form.
 */
async function updateKiosk(input) {
  return patch({
    'kiosk.isEnabled': input.isEnabled,
    'kiosk.welcomeMessage': input.welcomeMessage,
    'kiosk.thankYouMessage': input.thankYouMessage,
    'kiosk.readAloud': input.readAloud,
    'kiosk.requireTerms': input.requireTerms,
    'kiosk.termsText': input.termsText,
  });
}

export default {
  get,
  publicProfile,
  updateKiosk,
  updateBusiness,
  updateSale,
  updateShipping,
  updatePaymentMethods,
  updateInventory,
  updateCommunications,
};

export {
  COMMUNICATIONS_WIRED,
  get,
  publicProfile,
  updateKiosk,
  updateBusiness,
  updateSale,
  updateShipping,
  updatePaymentMethods,
  updateInventory,
  updateCommunications,
};
