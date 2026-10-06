/**
 * A product's picture: its own `image`, or null.
 *
 * Null means the caller should draw `PartIllustration` instead - which, for a
 * catalogue product, should not happen: the server does not list products
 * without a picture.
 *
 * There is no brand-and-component-type fallback any more (2026-10-06). It drew
 * one business's photos for every business; the seeded photos are now written
 * onto each product as a key into its own business's library in R2.
 */
export function productPhoto(product) {
  return product?.image || null;
}

export default productPhoto;
