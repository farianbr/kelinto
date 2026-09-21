import { currentBusinessId } from '../db/context.js';
import { controlModels, db } from '../db/models.js';
// Registers the schema `db().Settings` resolves. Without it this module works
// only when something else happened to import Settings first, which is a load
// order dependency rather than a guarantee - and it fails exactly where it is
// least expected, on whichever mail path is reached first.
import '../models/Settings.js';
import { migrateColorToken, paletteFor } from '../../../shared/businessPalette.js';
import { BUSINESS_INFO } from '../../../shared/business.js';

/**
 * Who is sending this - the business, never the platform.
 *
 * ## Why this exists
 *
 * `shared/business.js` is one hardcoded object holding Cellvix's name, domain,
 * address, phone and **GST number**, and ten services read it. That was correct
 * while Cellvix was the only business. It stopped being correct the moment a
 * second one existed, and the failure is not cosmetic: a CellShoppe invoice
 * carried the wholesaler's tax number, and a repair customer received "Your
 * Cellvix account is ready" about a phone they had fixed somewhere else. One is
 * a billing defect and the other reads as phishing.
 *
 * `invoiceDocument`, `ticketDocument` and `adminService` each solved this for
 * themselves. The rest - welcome mail, supplier mail, proformas, statements,
 * campaign footers - did not, so this is the shared answer rather than a fourth
 * private copy of it.
 *
 * ## Where the name comes from, and why not from Settings
 *
 * **The business RECORD names the business; Settings fills in the rest.**
 * `Settings.business.name` defaults to `'Cellvix'` in the schema, so a business
 * nobody has filled that field in for still carries the wholesaler's name - and
 * preferring Settings would print the wrong company on exactly the documents
 * this exists to fix. The record's name is the one a super admin typed when the
 * business was created, so it is always right. Address, phone, email and tax
 * number have no such authoritative source and come from Settings, which is the
 * screen an owner edits them on.
 *
 * ## The fallback
 *
 * `BUSINESS_INFO` remains the answer when no business is in context - a script,
 * a cron job, a record written before businesses existed. That is a real state
 * rather than a bug, so it returns the constant instead of throwing: a mail
 * that goes out branded as the house is better than an order confirmation that
 * never sends.
 */
async function sendingBusiness() {
  const businessId = currentBusinessId();
  if (!businessId) return { ...BUSINESS_INFO, brandColor: null, isHouse: true };

  const business = await controlModels()
    .Business.findById(businessId)
    .select('name colorToken isDefault')
    .lean();

  if (!business) return { ...BUSINESS_INFO, brandColor: null, isHouse: true };

  const settings = await db().Settings.load();
  const info = settings?.business ?? {};

  return {
    // Settings first so an owner's own details win, then the record's name over
    // the top of it - see the note above on why that order is not arbitrary.
    ...BUSINESS_INFO,
    ...info,
    name: business.name || info.name || BUSINESS_INFO.name,
    address: { ...BUSINESS_INFO.address, ...(info.address ?? {}) },
    brandColor: paletteFor(migrateColorToken(business.colorToken)).base,
    isHouse: business.isDefault === true,
  };
}

export { sendingBusiness };
export default sendingBusiness;
