import { asyncHandler } from '../utils/ApiError.js';
import settingsService from '../services/settingsService.js';
import auditService from '../services/auditService.js';

/**
 * Settings (ERP rework §6.15, phase 11).
 *
 * One read and one write per section. There is no whole-document PUT, and that
 * is deliberate: a form posts back the copy it loaded on open, so a wholesale
 * write would let Sale Settings silently revert a shipping band somebody edited
 * in another tab. Each route touches only the paths its own screen owns.
 */

const get = asyncHandler(async (req, res) => {
  res.json(await settingsService.get());
});

/**
 * The business behind the storefront, for anybody (§6.15 category 1).
 *
 * **Unauthenticated, so the shape is an allowlist** - see
 * `settingsService.publicProfile`. A shopper has to be able to read the footer
 * before they have an account, which is the whole reason this is not behind
 * `settings: view`.
 *
 * Cached for a minute at the edge. These fields change when an owner edits
 * them, which is rarely, and the alternative is a settings read on every page
 * of every visit.
 */
const publicProfile = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await settingsService.publicProfile());
});

/**
 * Every settings write is audited (§7.5, phase 11b).
 *
 * These change what the whole system charges and promises - a tax rate, a
 * shipping price, a warranty length - so a change with no actor on it is a
 * number nobody can account for. One helper because all six writes are the
 * same shape: snapshot, write, log the diff between them.
 *
 * `recordChange` skips the row when nothing actually moved, so opening a form
 * and pressing save does not fill the log with entries that say nothing.
 */
function auditedWrite(section, write, describe) {
  return asyncHandler(async (req, res) => {
    const before = await settingsService.get();
    const after = await write(req.body);

    await auditService.recordChange({
      req,
      action: `settings.${section}`,
      entity: { kind: 'settings', id: section, label: describe },
      // Scoped to the section this route owns, so a shipping edit does not
      // produce a row listing every unrelated field on the document.
      before: sectionOf(before, section),
      after: sectionOf(after, section),
      description: `Updated ${describe}.`,
    });

    res.json(after);
  });
}

/**
 * The slice of the settings document a given screen owns.
 *
 * Flattened to one level: a diff over whole nested objects would report
 * `financial` as changed and leave the reader to work out which of its dozen
 * fields moved.
 */
function sectionOf(settings, section) {
  switch (section) {
    case 'business':
      return { ...settings.business, address: settings.business?.address };
    case 'sale':
      return {
        timezone: settings.financial?.timezone,
        defaultDueDays: settings.financial?.defaultDueDays,
        taxRatesByProvince: settings.financial?.taxRatesByProvince,
        warrantyByGrade: settings.financial?.warrantyByGrade,
        rmaSlaDays: settings.operations?.rmaSlaDays,
        ticketSlaDays: settings.operations?.ticketSlaDays,
      };
    case 'shipping':
      return { shippingMethods: settings.financial?.shippingMethods };
    case 'payment-methods':
      return { paymentMethods: settings.financial?.paymentMethods };
    case 'inventory':
      // `lowStockThreshold` is stored under `operations` - where it has always
      // lived and where the reports read it - but it is edited on the Inventory
      // Settings screen, so the section this screen posts back has to carry it.
      return { ...settings.inventory, lowStockThreshold: settings.operations?.lowStockThreshold };
    case 'communications':
      return settings.communications;
    case 'kiosk':
      return settings.kiosk;
    default:
      return {};
  }
}

const updateBusiness = auditedWrite(
  'business',
  (body) => settingsService.updateBusiness(body),
  'business information',
);

const updateSale = auditedWrite(
  'sale',
  (body) => settingsService.updateSale(body),
  'sale settings',
);

const updateShipping = auditedWrite(
  'shipping',
  (body) => settingsService.updateShipping(body),
  'shipping rates',
);

const updatePaymentMethods = auditedWrite(
  'payment-methods',
  (body) => settingsService.updatePaymentMethods(body),
  'payment methods',
);

/**
 * The kiosk screen writes everything but the PIN.
 *
 * Audited like every other settings write, and for a sharper reason than most:
 * `isEnabled` is what decides whether a tablet on the counter will unlock at
 * all, and the terms text is what a customer is shown they are agreeing to.
 * Both are worth being able to say who changed, and when.
 */
const updateKiosk = auditedWrite(
  'kiosk',
  (body) => settingsService.updateKiosk(body),
  'kiosk settings',
);

const updateCommunications = auditedWrite(
  'communications',
  (body) => settingsService.updateCommunications(body),
  'email settings',
);

const updateInventory = auditedWrite(
  'inventory',
  (body) => settingsService.updateInventory(body),
  'inventory defaults',
);

export { get, publicProfile, updateBusiness, updateSale, updateShipping, updatePaymentMethods, updateCommunications, updateInventory, updateKiosk };
