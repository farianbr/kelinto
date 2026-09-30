/**
 * The kiosk's clocks and their limits, in one place.
 *
 * Read by the settings model's defaults, the settings form, the public config
 * the tablet fetches and the tablet itself. Four readers of three numbers is
 * how a default ends up 60 in one file and 90 in another, and the one a
 * customer meets is whichever the last reader happened to use.
 */

export const KIOSK_CLOCKS = {
  /** No touch for this long on any screen past the welcome, and it warns. */
  idleTimeoutSeconds: { default: 60, min: 15, max: 900 },
  /** How long the "Still there?" warning counts down before signing out. */
  idleWarningSeconds: { default: 10, min: 5, max: 60 },
  /** How long "Order again?" waits after a purchase before signing out. */
  orderAgainSeconds: { default: 30, min: 10, max: 300 },
};

/**
 * The three clocks off a stored kiosk block, each defaulted and clamped.
 *
 * Clamped as well as defaulted because a value outside the range can only have
 * come from a hand edit, and a zero-second idle timer is a tablet that signs
 * every customer out as they touch it.
 */
export function kioskClocks(kiosk = {}) {
  return Object.fromEntries(
    Object.entries(KIOSK_CLOCKS).map(([key, rule]) => {
      const value = Number(kiosk?.[key]);
      if (!Number.isFinite(value)) return [key, rule.default];
      return [key, Math.min(rule.max, Math.max(rule.min, Math.round(value)))];
    }),
  );
}

/**
 * Show a looked-up customer without naming them.
 *
 * "Is this you?" has to show something, and the tablet is in a public room:
 * anybody can type a number and see who it belongs to. So the answer carries
 * enough for the owner to recognise it and nothing a stranger could use -
 * initials, and the last two digits of the number or the first letter and
 * domain of the email.
 */
export function maskName(contactName = '') {
  const parts = String(contactName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A customer';
  return parts.map((part) => `${part[0].toUpperCase()}.`).join(' ');
}

export function maskPhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 2 ? `ending ${digits.slice(-2)}` : '';
}

export function maskEmail(email = '') {
  const [local, domain] = String(email).split('@');
  if (!local || !domain || domain.endsWith('.invalid')) return '';
  return `${local[0]}•••@${domain}`;
}
