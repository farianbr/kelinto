/**
 * Which business the panel is looking at.
 *
 * **Not React state, and not a context.** The value has to be readable from
 * `lib/api.js`, which is a plain module that every request passes through and
 * which cannot call a hook. A tiny store with a subscribe function serves both:
 * the API layer reads it synchronously, and `useBusiness()` subscribes so the
 * shell re-renders when it changes.
 *
 * **`null` means "not chosen yet", not "all businesses"** (SAAS_PLATFORM §4.1).
 *
 * It used to mean both, because an admin's default view spanned every business.
 * That view is gone: under database-per-business a request resolves to exactly
 * one database, so there is nothing for an unscoped admin query to read. The
 * switcher now lands on the default business when this is empty, and `null`
 * survives only as the state before that has happened.
 *
 * ## Persisted in `localStorage`, not `sessionStorage`
 *
 * It was `sessionStorage`, on the reasoning that the business you are working
 * in is a working context that should survive a reload but not still be there
 * next week. The flaw is that `sessionStorage` is **per tab**: a new tab starts
 * empty, so opening any admin page in one - middle-click, "open in new tab", a
 * pasted link - selected nothing and fell through to the default business. On
 * this installation that is Cellvix, so a CellShoppe staff member opening an
 * invoice in a second tab watched the panel become another shop.
 *
 * That is not a working context surviving too long, it is one failing to
 * survive an action people take constantly. `localStorage` is shared across the
 * origin, so every tab agrees about which business is on screen, and the
 * selection outlives a reload in whichever tab made it.
 *
 * **A stale value is still harmless.** A staff member's business is enforced
 * server-side and the switcher only offers businesses the account may see, so
 * this can never widen access - the worst case is landing in the business you
 * were last in, which is the intent.
 */

const KEY = 'cellvix:admin:business';

/**
 * The selected business's `colorToken`, cached beside its id.
 *
 * **Only the id is authority. This is a paint hint, and nothing but the theme
 * reads it.**
 *
 * It exists because the id alone cannot colour the panel. On a reload the id is
 * in `localStorage` and readable synchronously, but the token that goes with
 * it lives on the business record, which arrives a network round-trip later.
 * For the length of that round-trip `paletteVars(undefined)` returned the
 * default ramp, so a CellShoppe admin reloading their own panel watched it open
 * in Cellvix red and then settle into indigo - the panel flashing another
 * business's identity at the one moment the staff member is checking which business
 * they are in.
 *
 * Caching the token closes the gap: the first paint is already right, and
 * `rememberColorToken` corrects the cache once the record confirms it.
 *
 * A stale value is survivable and self-correcting - it costs one wrong frame
 * before the fetch resolves, which is the same failure this replaces, only far
 * rarer.
 */
const COLOR_KEY = 'cellvix:admin:business:color';

/**
 * The selected business name, cached beside its id for the same reason.
 *
 * The rail renders the name before `useAdminBusinesses` resolves, and with
 * nothing cached it fell back to the platform word - so every reload flashed
 * "Operations" and then settled into the shop name. That is the same wrong
 * frame the colour used to show, in the one place whose entire job is saying
 * which business you are in.
 *
 * A paint hint, never authority: the record overwrites it the moment it loads.
 */
const NAME_KEY = 'cellvix:admin:business:name';

let current = read(KEY);
let currentColor = read(COLOR_KEY);
let currentName = read(NAME_KEY);
const listeners = new Set();

function read(key) {
  try {
    return localStorage.getItem(key) || null;
  } catch {
    // Storage blocked (private window, site data off). All businesses is the
    // right answer, and the panel must still render.
    return null;
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Not persisting is survivable; the value still holds for this page.
  }
}

/** The selected business id, or null for all businesses. */
export function getBusiness() {
  return current;
}

/** The cached display name, or null when it is not known yet. */
export function getBusinessName() {
  return currentName;
}

/** The cached identity token for that business, or null when it is not known. */
export function getBusinessColor() {
  return currentColor;
}

/**
 * Cache the token of the business now on screen.
 *
 * Called once the business record has actually loaded, so the NEXT reload paints
 * correctly from the first frame. A no-op when the token has not moved, so it is
 * safe to call on every render pass.
 */
export function rememberBusiness({ colorToken, name } = {}) {
  const nextColor = colorToken || null;
  const nextName = name || null;
  if (nextColor === currentColor && nextName === currentName) return;

  currentColor = nextColor;
  currentName = nextName;
  write(COLOR_KEY, nextColor);
  write(NAME_KEY, nextName);

  for (const listener of listeners) listener(current);
}

/**
 * Select a business.
 *
 * `colorToken` is optional but should be passed wherever the caller has the
 * record in hand - the switcher does. **Switching without one clears the cached
 * token rather than keeping it**: holding the old business's colour would paint
 * the shop you just left, confidently, for the whole first frame. `null` falls
 * back to the house ramp, which is at least not a claim about which business is
 * on screen.
 */
export function setBusiness(id, { colorToken = null, name = null } = {}) {
  const next = id || null;
  const nextColor = colorToken || null;
  const nextName = name || null;
  if (next === current && nextColor === currentColor && nextName === currentName) return;

  current = next;
  currentColor = nextColor;
  currentName = nextName;
  write(KEY, next);
  write(COLOR_KEY, nextColor);
  write(NAME_KEY, nextName);

  for (const listener of listeners) listener(current);
}

/**
 * A client-route URL carrying the selected business.
 *
 * **For a link that leaves the panel**, where the store cannot speak for
 * itself. Since the selection moved to `localStorage` a new admin tab inherits
 * it, so an ordinary "open in new tab" is covered - but a surface that is not
 * the admin panel still needs telling. The kiosk is the case: it is its own
 * application on its own session, and a CellShoppe staff member opening it was
 * shown Cellvix's, reported as "kiosk says it is off" about a kiosk that was on.
 *
 * It also still pins the business into a link somebody PASTES elsewhere, where
 * neither storage nor the host can answer the question.
 *
 * The API layer already solves this for API paths (`apiUrl`, and the
 * `?business=` every request carries). This is the same idea for an
 * application route, and the receiving page adopts the parameter before it
 * fetches anything.
 *
 * Returns the path unchanged when nothing is selected, so a link is never
 * broken by the absence of a business.
 */
export function businessUrl(path) {
  const id = getBusiness();
  if (!id) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}business=${encodeURIComponent(id)}`;
}

export function subscribeBusiness(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export default getBusiness;
