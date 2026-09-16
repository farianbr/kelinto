import SettingsModel from '../models/Settings.js';

/**
 * What the shop promises, resolved once for everything that states it.
 *
 * The warranty ladder is printed on the ticket's second sheet AND mailed when an
 * invoice is labelled, and those two have to agree: a customer holding a sheet
 * that says 120 days beside an email that says 90 has been told two different
 * things by the same shop, and only one of them can be honoured. So the ladder
 * is computed here and read by both, rather than copied into each renderer.
 *
 * Everything comes from the shop's own settings. Nothing in this file is a
 * number a template made up.
 */

/**
 * The membership ladder a warranty table prints.
 *
 * `standard` is deliberately absent: it is the baseline every repair already
 * carries, so a row saying "Standard, 90 days" beside "Silver, 120 days" makes
 * the table look like an upsell rather than a record of what was promised. A
 * standard customer sees the three tiers above them and no row marked as
 * theirs, which is the honest version - they are on the base cover the copy
 * already states.
 */
const WARRANTY_TIERS = [
  { key: 'silver', label: 'Silver' },
  { key: 'gold', label: 'Gold' },
  { key: 'platinum', label: 'Platinum' },
];

/**
 * A settings value, but only when somebody actually set it.
 *
 * The `business` block defaults to Cellvix's own name, phone and address, so a
 * shop that has never opened that screen still carries them. A placeholder
 * phone number on a customer's paperwork is worse than none, because somebody
 * will ring it.
 *
 * The defaults are read off the schema rather than copied here, so changing one
 * there cannot leave this comparing against a string that no longer exists.
 */
function unlessDefault(value, field) {
  if (!value) return null;
  const fallback = SettingsModel?.schema?.path(`business.${field}`)?.defaultValue;
  return value === fallback ? null : value;
}

/** A Mongoose Map or a plain object, read the same way. */
function mapGet(source, key) {
  if (!source) return 0;
  return Number(source instanceof Map ? source.get(key) : source[key]) || 0;
}

/**
 * The ladder, the customer's place on it, and how to reach the shop.
 *
 * @param {object} settings  a loaded `Settings` document
 * @param {string} [customerTier]  the customer's membership tier
 * @returns {{ tiers: Array, mine: object|null, baseDays: number, review: string|null, contact: string }}
 */
function warrantyTerms(settings, customerTier) {
  const info = settings?.business ?? {};

  /**
   * Base days plus the tier bonus, so a table prints what this business
   * actually promises. A shop that changes either figure in Settings changes
   * every sheet printed and every email sent afterwards.
   */
  const baseDays = Number(settings?.financial?.warrantyBaseDays ?? 90);
  const bonuses = settings?.financial?.warrantyBonusByTier;

  const tiers = WARRANTY_TIERS.map((tier) => ({
    key: tier.key,
    label: tier.label,
    days: baseDays + mapGet(bonuses, tier.key),
    isCustomer: (customerTier ?? 'standard') === tier.key,
  }));

  return {
    tiers,
    mine: tiers.find((tier) => tier.isCustomer) ?? null,
    baseDays,
    review: info.reviewUrl || null,
    contact: [unlessDefault(info.phone, 'phone'), unlessDefault(info.email, 'email')]
      .filter(Boolean)
      .join('  |  '),
  };
}

export { WARRANTY_TIERS, warrantyTerms, unlessDefault };
export default warrantyTerms;
