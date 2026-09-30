/**
 * Google's "Embed a map" link, taken from whatever the owner pasted.
 *
 * Google's share dialog hands out a whole `<iframe src="..." ...></iframe>`, and
 * that is what people paste. Asking them to find the `src` inside it first is a
 * step most would get wrong, so both forms are accepted and only the address is
 * kept: the website draws its own frame around it, and markup from a text box is
 * never rendered (Instructions §8).
 *
 * Only Google's embed endpoint is accepted. The frame is allowed through the
 * page's security policy for that one origin, so any other address would render
 * as a blank box; refusing it here tells the owner while they can still fix it.
 */

const EMBED_PREFIX = 'https://www.google.com/maps/embed';

/** The `src` out of a pasted iframe, or the text itself when it is a bare URL. */
function mapEmbedSrc(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/\ssrc\s*=\s*["']([^"']+)["']/i);
  // Browsers copy `&` as `&amp;` inside an attribute.
  return (match ? match[1] : text).replaceAll('&amp;', '&').trim();
}

function isMapEmbedUrl(url) {
  return url === '' || url.startsWith(`${EMBED_PREFIX}?`) || url.startsWith(`${EMBED_PREFIX}/`);
}

export { EMBED_PREFIX, mapEmbedSrc, isMapEmbedUrl };
