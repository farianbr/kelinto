/**
 * A business's photo library, in Cloudflare R2.
 *
 * Named photographs a business keeps for its own catalogue, in three sets:
 *
 *   businesses/<code>/library/parts/<file>      one per brand-and-component pair (`shared/partPhotos.js`)
 *   businesses/<code>/library/phones/<file>     one per pre-owned handset (`seed:demo -- phones`)
 *   businesses/<code>/library/services/<file>   one per kind of repair (`shared/catalog.js` SERVICE_PHOTOS)
 *
 * ## Why under the business (client ruling 2026-10-06)
 *
 * These were briefly Kelinto's, under `kelinto/stock/`, and every business
 * drew them by brand, component type or service name at render time. They are
 * not Kelinto's: CellShoppe supplied them, and a garage on the same install was
 * being shown CellShoppe's iPhone screens. **A business's files live under the
 * business**, like its logo and its uploads, so each record now stores the key
 * of its own business's copy and nothing is looked up by name on the way out.
 * `npm run backfill -- stock-media` copied the old set across.
 *
 * ## Keys, not URLs
 *
 * A record stores the KEY, as every file in R2 does, and `storageService.urlOf`
 * puts the public address in front of it. The file names are the human ones
 * (the phones seed reads grade, model and colour off them), so each path
 * segment is encoded when the URL is built: a space or a bracket in an image
 * `src` breaks some browsers.
 *
 * Library files are shared by many records of the one business (every iPhone
 * screen points at the same photo), so no cleanup path ever deletes one.
 */

export const LIBRARY_SETS = ['parts', 'phones', 'services'];

/** `businesses/<code>/library/<set>/<file>`. */
const LIBRARY_KEY = /^businesses\/[a-z0-9_-]+\/library\/(parts|phones|services)\/[^/]+$/i;

/**
 * Where the set lived for one day (2026-10-06), as Kelinto's. Still read so a
 * record the backfill has not reached keeps rendering; never written.
 */
export const LEGACY_STOCK_PREFIX = 'kelinto/stock';
const LEGACY_STOCK_KEY = /^kelinto\/stock\/(parts|phones|services)\/[^/]+$/;

/** The folder digits of a business code: `#000001` is `000001`. */
function folderOf(code) {
  const folder = String(code ?? '').replace(/^#/, '');
  if (!/^[a-z0-9_-]+$/i.test(folder)) throw new Error(`Not a business code: ${code}`);
  return folder;
}

/** `businesses/<code>/library/<set>/` - one set's folder, for listing. */
export function libraryPrefix(code, set) {
  return `businesses/${folderOf(code)}/library/${set}/`;
}

/** The key of one file in a business's library. */
export function libraryKey(code, set, file) {
  return `${libraryPrefix(code, set)}${file}`;
}

export function isLibraryKey(value) {
  return LIBRARY_KEY.test(String(value ?? ''));
}

export function isLegacyStockKey(value) {
  return LEGACY_STOCK_KEY.test(String(value ?? ''));
}

/** The old Kelinto key for a file, where the backfill copies from. */
export function legacyStockKey(set, file) {
  return `${LEGACY_STOCK_PREFIX}/${set}/${file}`;
}

/** A key with human file names (library or legacy stock), which needs encoding in a URL. */
export function isNamedKey(value) {
  return isLibraryKey(value) || isLegacyStockKey(value);
}

/** The URL path of a named key, each segment encoded. */
export function encodeKey(key) {
  return String(key)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** The named key behind an encoded URL path, or null. */
export function decodeKey(path) {
  let key;
  try {
    key = String(path)
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
  return isNamedKey(key) ? key : null;
}
