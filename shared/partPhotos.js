/**
 * Stock photography for a part, chosen by brand + component type.
 *
 * Cellvix has not shot the catalogue (PROGRESS.md open question #6). What it
 * has is one representative photo per brand-and-component-type pair - an iPhone
 * screen, a Pixel charging port - which stands in for every model of that pair.
 *
 * This map is SHARED rather than client-only because the catalogue hides
 * products that have no picture, and that decision is made server-side so the
 * result count and the pagination match what the grid actually renders. The
 * client resolves the same map to draw the image. One copy, so the two can
 * never disagree about which products are visible.
 *
 * The files live in client/public/product-photos/parts (moved from
 * stock-photos on 2026-10-02, beside the phones' photos), so they are served
 * from our own origin and there is no CDN in the path. Their names carry the
 * mapping - "iPhone Screen.webp" is the screen photo for every iPhone - so
 * adding a photo is dropping a file in that folder and adding one line to
 * PHOTOS below.
 */

const DIR = '/product-photos/parts';

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
 * The stock photo path for a product, or null when there is none.
 *
 * Returns an encoded path - the filenames contain spaces, and an unencoded
 * space in a `src` is a broken image in some browsers.
 */
function partPhoto(product) {
  if (!product) return null;

  const file = photoFile(product.brandSlug, product.partType);
  if (!file) return null;

  // Encode each path SEGMENT, so spaces become %20 but the separators survive.
  return `${DIR}/${file}`
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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
 * taxonomyService would close a require cycle; the map both of them already
 * depend on is the honest place for it.
 *
 * Built once: the pair list is static.
 */
const HAS_PICTURE = {
  $or: [
    { image: { $nin: [null, ''] } },
    ...photographedPairs().map(({ brandSlug, partType }) => ({ brandSlug, partType })),
  ],
};

export { DIR, PHOTOS, BRAND_KEY, photoFile, partPhoto, photographedPairs, HAS_PICTURE };
