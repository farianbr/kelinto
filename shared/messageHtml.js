/**
 * A message body is either plain text or HTML, and both sides need to agree
 * which one they are holding.
 *
 * The template editors in Settings › Communications take HTML as well as plain
 * text (2026-10-01, client request): a shop that already has a branded email
 * layout wants to paste it, not retype it as paragraphs. Nothing is stored to
 * say which a body is - a flag would be a second thing to keep in step with
 * the text - so it is read off the body itself, the same way on the client
 * (the View tab) and on the server (the send).
 *
 * **Rendering is never trusted markup.** The client previews HTML inside a
 * sandboxed iframe with no scripts and no same-origin access, and the server
 * runs it through `sanitize-html` before it goes into an email. These helpers
 * only decide the shape; they do not make anything safe on their own.
 */

/** A body counts as HTML once it carries at least one real tag. */
const TAG = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/i;

function looksLikeHtml(body) {
  return TAG.test(String(body ?? ''));
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

/**
 * Plain text as the paragraphs an email shows: a blank line breaks a
 * paragraph, a single newline breaks a line.
 */
function textToHtml(body) {
  return String(body ?? '')
    .split(/\n{2,}/)
    .filter((block) => block.trim())
    .map((block) => `<p style="margin:0 0 14px">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * HTML flattened to what an SMS, a WhatsApp message or a plain-text mail part
 * can carry. Block ends become line breaks so the paragraphs survive.
 */
function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The longest body a template, a scheduled message or a status message takes. */
const MESSAGE_BODY_MAX = 20000;

export { looksLikeHtml, escapeHtml, textToHtml, htmlToText, MESSAGE_BODY_MAX };
