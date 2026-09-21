import { createContext, useContext } from 'react';

/**
 * How tall the form controls are, for a whole subtree.
 *
 * ## Two densities, each earned
 *
 * - **`comfortable`** (the default) - 44px controls, 16px text on a phone.
 *   The storefront: checkout, sign-up, the account forms, the kiosk. A buyer
 *   is on a phone with one hand, and 44px is the accessibility-recommended
 *   minimum touch target.
 * - **`compact`** - 36px controls, 13px labels. The admin panel: a desktop
 *   tool somebody fills in all day, where the extra 8px per field buys nothing
 *   and costs the number of fields that fit on one screen. That cost is what
 *   raised this: a settings form ran well past the fold for no reason a reader
 *   could see.
 *
 * ## Why a context rather than a prop
 *
 * The alternative is a `density` prop threaded through every form and passed
 * down to every field, which is forty files that each have to remember. The
 * shell declares it once and every control inside inherits - and a control
 * rendered outside the panel keeps the comfortable default by construction,
 * rather than by somebody remembering not to pass the prop.
 *
 * ## 16px on a phone survives the compaction
 *
 * Mobile Safari zooms the page in when a focused input's text is under 16px
 * and never zooms back out, which leaves a sticky header wider than the
 * viewport for the rest of the visit. So the font size only drops from `sm:`
 * up, exactly as the primitives already did it. Height compacts at every width,
 * because height does not trigger the zoom.
 */
const DensityContext = createContext('comfortable');

/** The control classes for the current density. */
export function useDensity() {
  return useContext(DensityContext);
}

/**
 * Height and text for a field, by density.
 *
 * Returned as a class string rather than numbers so a component can drop it
 * straight into `cn()` beside everything else it needs.
 */
export function fieldSize(density) {
  return density === 'compact'
    ? 'h-9 text-lg sm:text-sm'
    : 'h-11 text-lg sm:text-md';
}

/** The label above a field. Drops a step when compact, so it cannot out-weigh the control it names. */
export function labelSize(density) {
  return density === 'compact' ? 'mb-1 text-xs' : 'mb-1.5 text-sm';
}

/** The hint or error under a field. */
export function hintSize(density) {
  return density === 'compact' ? 'mt-1 text-xs' : 'mt-1.5 text-sm';
}

export const DensityProvider = DensityContext.Provider;
export default DensityContext;
