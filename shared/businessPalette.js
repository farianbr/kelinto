/**
 * The identity colours a business can be painted in (SAAS_PLATFORM §1.1).
 *
 * ## Why this is not the status palette
 *
 * `colorToken` used to be one of `brand · info · success · warn · danger · ink`
 * and was only ever read to paint a swatch on the businesses list. The moment
 * it drives the panel's accent - which is the whole point of it - four of those
 * six become a lie: `info` is "informational", `success` is paid and approved,
 * `warn` is overdue, `danger` is failed and rejected. A business on `info`
 * would render its primary button, its active nav item and an informational
 * callout in one blue; a business on `danger` would make every Save button the
 * colour of Delete. **Status has to stay readable as status**, so identity gets
 * its own list and the semantic tokens are left alone.
 *
 * Every colour here sits at least 35 RGB units from the nearest semantic token
 * (`--color-info` #2563eb, `--color-ok` #15803d, `--color-warn` #b45309,
 * `--color-danger` #b91c1c) so an accent is never mistaken for a state. Red is
 * the one that comes close, at 35 from danger - that is Cellvix's existing
 * brand and predates the rule, not an exception granted lightly.
 *
 * ## Why a fixed list and not a hex field
 *
 * `Business.js` rejected free hex for a reason worth restating: a colour typed
 * into a form is how a page ends up off-brand, and nothing about a hex input
 * guarantees that white is readable on it. Every ramp below is checked instead
 * - see the contrast notes on `BUSINESS_PALETTE` - so no business can be
 * configured into a panel that fails the audit.
 *
 * ## Why the ramps live here rather than in CSS
 *
 * The server writes them into a `<style>` block per business and the client
 * applies them to the panel shell, so one drifting from the other would mean
 * two businesses of slightly different colour depending on which end painted.
 * One list, imported by both.
 */

/**
 * The ramps.
 *
 * Each entry mirrors the shape of the `--color-brand*` tokens in
 * `client/src/styles/index.css`, plus the gradient stops and the sidebar
 * ground, because those are the two things that do NOT follow a plain token
 * swap: the gradient utilities hardcoded hex literals, and `--color-ink-deep`
 * is a near-black deliberately warmed toward the accent.
 *
 * Contrast, verified for every entry (`npm run a11y` re-checks it):
 *
 * - `base` on white and on `--color-surface-2` clears 4.5:1, so it can carry
 *   text and an icon stroke.
 * - white on `base` clears 4.5:1, so a solid button's label is readable.
 * - `c700` on `c50` clears 8:1, which is the badge pairing.
 * - white on `gradientEnd` is ALLOWED to fall under 4.5 - that ramp is for
 *   short bold CTA labels, exactly as the red one always was - but white on
 *   `panelEnd` clears 7:1, which is the ramp a text-bearing block takes.
 * - white on `deep` clears 19:1, the sidebar ground.
 */
const BUSINESS_PALETTE = {
  /**
   * The original Cellvix red, kept as a choice. No longer the default.
   *
   * **These are the published brand values, copied exactly** - not regenerated
   * from a formula like the others. The Cellvix ramp was hand-tuned (the
   * gradient's 38%/72% stops, the #e8564a end) and a generated approximation
   * would have quietly restyled the live brand to something a few units off.
   */
  red: {
    label: 'Red',
    base: '#cf3429',
    c600: '#b02a21',
    c700: '#8e211a',
    c100: '#fadcd9',
    c50: '#fdf1f0',
    deep: '#1b0101',
    gradient: { dark: '#1a0603', mid: '#8f221b', base: '#cf3429', end: '#e8564a' },
    panelEnd: '#9d251d',
    panelMid: '#7d1e17',
    orbPanel: { dark: '#5e120d', mid: '#8b2019', end: '#9d251d' },
    rule: { dark: '#1a0603', mid: '#cf3429', end: '#e8564a' },
  },

  /** CellShoppe. Deliberately NOT `--color-info` blue - see the note above. */
  indigo: {
    label: 'Indigo',
    base: '#3730a3',
    c600: '#2e2889',
    c700: '#25216f',
    c100: '#e3e2f2',
    c50: '#f6f6fb',
    deep: '#060510',
    gradient: { dark: '#080717', mid: '#272272', base: '#3730a3', end: '#5751b2' },
    panelEnd: '#2b257f',
    panelMid: '#221d66',
    orbPanel: { dark: '#16134a', mid: '#242073', end: '#2b257f' },
    rule: { dark: '#080717', mid: '#3730a3', end: '#5751b2' },
  },

  teal: {
    label: 'Teal',
    base: '#0d7d77',
    c600: '#0b6964',
    c700: '#095551',
    c100: '#ddedec',
    c50: '#f4f9f9',
    deep: '#010d0c',
    gradient: { dark: '#021211', mid: '#095853', base: '#0d7d77', end: '#34928d' },
    panelEnd: '#0a625d',
    panelMid: '#084e4a',
    orbPanel: { dark: '#04322f', mid: '#095853', end: '#0a625d' },
    rule: { dark: '#021211', mid: '#0d7d77', end: '#34928d' },
  },

  violet: {
    label: 'Violet',
    base: '#6d3bd4',
    c600: '#5c32b2',
    c700: '#4a2890',
    c100: '#ebe4f9',
    c50: '#f8f6fd',
    deep: '#0b0615',
    gradient: { dark: '#0f081e', mid: '#4c2994', base: '#6d3bd4', end: '#845adb' },
    panelEnd: '#552ea5',
    panelMid: '#442485',
    orbPanel: { dark: '#2c1a54', mid: '#4a2890', end: '#552ea5' },
    rule: { dark: '#0f081e', mid: '#6d3bd4', end: '#845adb' },
  },

  plum: {
    label: 'Plum',
    base: '#86198f',
    c600: '#711578',
    c700: '#5b1161',
    c100: '#eedfef',
    c50: '#faf5fa',
    deep: '#0d030e',
    gradient: { dark: '#130414', mid: '#5e1264', base: '#86198f', end: '#993ea1' },
    panelEnd: '#691470',
    panelMid: '#54105a',
    orbPanel: { dark: '#380a3c', mid: '#5b1161', end: '#691470' },
    rule: { dark: '#130414', mid: '#86198f', end: '#993ea1' },
  },

  /** The quiet one, for a business that should not shout. */
  slate: {
    label: 'Slate',
    base: '#41566e',
    c600: '#37485c',
    c700: '#2c3a4b',
    c100: '#e4e7eb',
    c50: '#f6f7f8',
    deep: '#07090b',
    gradient: { dark: '#090c0f', mid: '#2e3c4d', base: '#41566e', end: '#5f7185' },
    panelEnd: '#334356',
    panelMid: '#293544',
    orbPanel: { dark: '#1b232d', mid: '#2c3a4b', end: '#334356' },
    rule: { dark: '#090c0f', mid: '#41566e', end: '#5f7185' },
  },
};

/** The enum `Business.colorToken` validates against. */
const BUSINESS_COLOR_TOKENS = Object.keys(BUSINESS_PALETTE);

/**
 * What an unset or unrecognised token falls back to.
 *
 * Slate, the quiet one. It used to be `red`, Cellvix's brand, so every new
 * business opened wearing another company's colour until somebody changed it.
 * A business picks its own in the ERP or the console; until then it is neutral.
 */
const DEFAULT_BUSINESS_COLOR = 'slate';

/**
 * The ramp for a token, never undefined.
 *
 * A business carrying a token from the old list (`info`, `success`, `ink`…)
 * resolves to the default rather than throwing: a panel that will not paint is
 * a worse answer than a panel painted in the house colour, and `migrateColorToken`
 * moves the stored value across on the next write.
 */
function paletteFor(token) {
  return BUSINESS_PALETTE[token] ?? BUSINESS_PALETTE[DEFAULT_BUSINESS_COLOR];
}

/**
 * The old six mapped onto the new list, for data written before this existed.
 *
 * `brand` was Cellvix red and stays red. `info` becomes indigo - it is the
 * nearest identity colour to the blue those businesses were already showing,
 * which matters because CellShoppe is one of them and its staff have been
 * looking at a blue swatch. `success` has no green in the identity list on
 * purpose (too close to `--color-ok`), so it lands on teal, the nearest thing
 * that is not a status colour. `warn` and `danger` land on plum rather than on
 * anything orange or red, for the same reason. `ink` becomes slate.
 */
const LEGACY_COLOR_TOKENS = {
  brand: 'red',
  info: 'indigo',
  success: 'teal',
  warn: 'plum',
  danger: 'plum',
  ink: 'slate',
};

/** Normalise any stored value - new, legacy or junk - to a token that exists. */
function migrateColorToken(token) {
  if (BUSINESS_PALETTE[token]) return token;
  return LEGACY_COLOR_TOKENS[token] ?? DEFAULT_BUSINESS_COLOR;
}

/**
 * The ramp as CSS custom properties, ready to drop into a `style` attribute or
 * a `<style>` block.
 *
 * **These are the same variable names Tailwind's `@theme` already emits**,
 * which is the whole trick: every `bg-brand` / `text-brand-700` / `border-brand`
 * in the panel compiles to `var(--color-brand*)`, so redefining them on one
 * ancestor re-points all of them with no component edits. The gradient and
 * sidebar variables are additions, because those two did not read tokens.
 */
function paletteVars(token) {
  const p = paletteFor(token);
  return {
    '--color-brand': p.base,
    '--color-brand-600': p.c600,
    '--color-brand-700': p.c700,
    '--color-brand-100': p.c100,
    '--color-brand-50': p.c50,
    '--color-ink-deep': p.deep,
    '--brand-grad-dark': p.gradient.dark,
    '--brand-grad-mid': p.gradient.mid,
    '--brand-grad-base': p.gradient.base,
    '--brand-grad-end': p.gradient.end,
    '--brand-grad-panel-mid': p.panelMid,
    '--brand-grad-panel-end': p.panelEnd,
    '--brand-grad-orb-panel-dark': p.orbPanel.dark,
    '--brand-grad-orb-panel-mid': p.orbPanel.mid,
    '--brand-grad-orb-panel-end': p.orbPanel.end,
    '--brand-rule-dark': p.rule.dark,
    '--brand-rule-mid': p.rule.mid,
    '--brand-rule-end': p.rule.end,
  };
}

/** The same thing as a CSS declaration string, for a server-rendered block. */
function paletteCss(token) {
  return Object.entries(paletteVars(token))
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

export {
  BUSINESS_PALETTE,
  BUSINESS_COLOR_TOKENS,
  DEFAULT_BUSINESS_COLOR,
  LEGACY_COLOR_TOKENS,
  paletteFor,
  migrateColorToken,
  paletteVars,
  paletteCss,
};
export default BUSINESS_PALETTE;
