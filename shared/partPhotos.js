/**
 * CellShoppe's part photography, by brand + component type.
 *
 * The client has not shot the catalogue (PROGRESS.md open question #6). What it
 * has is one representative photo per brand-and-component-type pair - an iPhone
 * screen, a Pixel charging port - which stands in for every model of that pair.
 *
 * **Seed data, not a render-time lookup** (2026-10-06). The files belong to the
 * business and live in its photo library in R2,
 * `businesses/<code>/library/parts/` (`server/src/utils/photoLibrary.js`). The
 * seed and `backfill -- stock-media` write that key onto each product's
 * `image`; nothing derives a picture from brand and type on the way out any
 * more, because doing so showed one business's photos on every business.
 * Their names carry the mapping - "iPhone Screen.webp" is the screen photo for
 * every iPhone - so adding one is uploading a file to that folder, adding a
 * line to PHOTOS below and re-running the backfill.
 */

/**
 * `${brand key} ${part key}` -> filename.
 *
 * The brand key is the FAMILY, not the brandSlug: `apple` and `apple-tablet`
 * are different slugs for one manufacturer, and an iPad screen is not an iPhone
 * screen. See BRAND_KEY.
 */
const PHOTOS = {
  'iphone screen-assembly': 'iPhone Screen.webp',
  'iphone battery': 'iPhone Battery.webp',
  'iphone charging-port': 'iPhone Charging Port.webp',
  'iphone rear-camera': 'iPhone Back Camera.webp',
  'iphone front-camera': 'iPhone Front Camera.webp',

  'samsung screen-assembly': 'Samsung Screen.webp',
  'samsung rear-camera': 'Samsung Back Camera.webp',
  'samsung front-camera': 'Samsung Front Camera.webp',
  'samsung back-glass': 'Samsung Backpart.webp',
  'samsung loud-speaker': 'Samsung Loudspeaker.webp',
  'samsung flex-cable': 'Samsung Flex Cable.webp',

  'pixel screen-assembly': 'Pixel Screen.webp',
  'pixel rear-camera': 'Pixel Back Camera.webp',
  'pixel charging-port': 'Pixel Charging Port.webp',
  'pixel back-glass': 'Pixel Backpart.webp',
  'pixel loud-speaker': 'Pixel Speaker.webp',

  'motorola screen-assembly': 'Motorola Screen.webp',

  'xiaomi screen-assembly': 'Xiaomi Screen.webp',
};

/**
 * brandSlug -> the key used above.
 *
 * Only PHONE slugs map. `apple-tablet`, `apple-laptop`, `apple-watch` and
 * `apple-computer` are deliberately absent: an iPhone screen photo on an iPad
 * or a MacBook listing is a picture of the wrong product. Those products have
 * no photo, so the catalogue does not list them.
 */
const BRAND_KEY = {
  apple: 'iphone',
  samsung: 'samsung',
  google: 'pixel',
  motorola: 'motorola',
  xiaomi: 'xiaomi',
};

/** The stock-photo filename for a brand + component type, or null. */
function photoFile(brandSlug, partType) {
  const brand = BRAND_KEY[brandSlug];
  if (!brand) return null;
  return PHOTOS[`${brand} ${partType}`] ?? null;
}

/**
 * Every `{ brandSlug, partType }` pair that HAS a stock photo.
 *
 * The server turns this into the `$or` that keeps pictureless products out of
 * the catalogue. Derived from the same two tables the renderer uses, so a photo
 * added above becomes a visible product without touching the query.
 */
function photographedPairs() {
  const pairs = [];

  for (const brandSlug of Object.keys(BRAND_KEY)) {
    const brandKey = BRAND_KEY[brandSlug];

    for (const key of Object.keys(PHOTOS)) {
      const separator = key.indexOf(' ');
      if (key.slice(0, separator) !== brandKey) continue;
      pairs.push({ brandSlug, partType: key.slice(separator + 1) });
    }
  }

  return pairs;
}

/**
 * The Mongo clause that keeps pictureless products out of the storefront.
 *
 * Lives here rather than in productService because the taxonomy service needs
 * the identical rule - a component-type list counted without it would offer a
 * type whose every product the grid then hides. Importing productService from
 * taxonomyService would close a require cycle.
 *
 * A product's own `image` only (2026-10-06). It used to accept any product
 * whose brand and type had a photo above, which is what let every business
 * list products on CellShoppe's pictures; the photo is written onto the record
 * now, in the business's own library.
 */
const HAS_PICTURE = { image: { $nin: [null, ''] } };

export { PHOTOS, BRAND_KEY, photoFile, photographedPairs, HAS_PICTURE };
