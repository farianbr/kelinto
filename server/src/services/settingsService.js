import Settings, {
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_SHIPPING_METHODS,
  DEFAULT_TAX_RATES,
  DEFAULT_TIER_WARRANTY_BONUS,
} from '../models/Settings.js';
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

  // Not yet called from anywhere.
  quoteOnCreate: false,
  paymentConfirmation: false,
  accountApproved: false,
  accountRejected: false,
  lowStockAlerts: false,
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
  const doc = await Settings.load();

  return {
    business: doc.business,
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
    // Which toggles actually gate a live path today (§6b rule 4, applied to a
    // settings screen). Sent so the screen can mark the rest plainly instead of
    // presenting eleven switches that all look equally functional - a toggle
    // that changes nothing is worse than a missing one, because somebody will
    // switch it on and believe the emails are going out.
    communicationsWired: COMMUNICATIONS_WIRED,
    operations: doc.operations,
    updatedAt: doc.updatedAt,
  };
}

/** The one way a section is written. Keeps rule 1 in a single place. */
async function patch($set) {
  await Settings.updateOne({ key: 'singleton' }, { $set }, { upsert: true });
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
  const current = await Settings.load();
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
  const current = await Settings.load();
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

export default {
  get,
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
  updateBusiness,
  updateSale,
  updateShipping,
  updatePaymentMethods,
  updateInventory,
  updateCommunications,
};
