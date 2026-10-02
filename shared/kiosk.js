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
 * A typed name in the case it is written on an ID: `john doe` and `JOHN DOE`
 * both become `John Doe` (client ruling, 2026-10-01).
 *
 * Only a word typed in ONE case is recased. A word already mixed, like
 * `McDonald` or `DeShawn`, is how its owner spells it and is left alone, since
 * lowering everything after the first letter would misspell exactly the names
 * somebody took care over. Hyphens and apostrophes start a new word, so
 * `o'neil-smith` becomes `O'Neil-Smith`.
 */
export function nameCase(value = '') {
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\s'’-]+/g, (word) => {
      const single = word === word.toLowerCase() || word === word.toUpperCase();
      return single ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
    });
}
