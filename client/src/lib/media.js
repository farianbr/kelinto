/**
 * Picking the right size of an uploaded file.
 *
 * Every product picture uploaded is stored twice by the server
 * (`mediaProcessor`): the picture at up to 1600 px, and a 480 px copy beside it
 * named `<id>-480.webp`. A grid card is about 300 px wide, so it should never
 * download the large one; the product page and the zoom lens should.
 *
 * Recognised by path, not by host: only a product picture that went through
 * the upload pipeline has a thumbnail. Anything else - a stock photo, an older
 * file - is returned as it is.
 */
const PRODUCT_UPLOAD = /\/product-image\/[0-9a-f-]{36}\.webp$/i;

/** The 480 px copy of an uploaded product picture, or the URL unchanged. */
export function uploadThumb(url) {
  if (!url || !PRODUCT_UPLOAD.test(url)) return url;
  return url.replace(/\.webp$/i, '-480.webp');
}

/**
 * `srcSet` for a product picture: the browser picks the small copy for a card
 * and the large one for the product page. Undefined when there is no pair.
 */
export function uploadSrcSet(url) {
  if (!url || !PRODUCT_UPLOAD.test(url)) return undefined;
  return `${uploadThumb(url)} 480w, ${url} 1600w`;
}

export default uploadThumb;
