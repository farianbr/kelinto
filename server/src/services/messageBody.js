import sanitizeHtml from 'sanitize-html';

import { looksLikeHtml, textToHtml, htmlToText } from '../../../shared/messageHtml.js';

/**
 * A stored message body, turned into what a send needs (2026-10-01).
 *
 * The Communications editors accept HTML as well as plain text. A plain body
 * is escaped into paragraphs exactly as it always was; an HTML body is
 * **sanitised, never passed through**: admin-authored markup is not trusted on
 * the server any more than on the client, and a template is one stolen staff
 * session away from being a phishing kit sent in the business's own name.
 *
 * The allowlist is what an email layout actually uses - tables, inline styles,
 * images, links - and nothing that runs: no script, no iframe, no form, no
 * event handler, no `javascript:` URL. `<style>` blocks go too; mail clients
 * mostly strip them anyway, and inline `style` is what survives.
 */
const EMAIL_HTML = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img',
    'span',
    'center',
    'font',
  ],
  allowedAttributes: {
    '*': [
      'style',
      'align',
      'valign',
      'width',
      'height',
      'bgcolor',
      'border',
      'cellpadding',
      'cellspacing',
      'colspan',
      'rowspan',
      'dir',
      'lang',
      'title',
    ],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    font: ['color', 'face', 'size'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'cid'] },
  allowProtocolRelative: false,
};

/** The HTML part of an email, from a stored body in either form. */
function toEmailHtml(body) {
  const value = String(body ?? '');
  return looksLikeHtml(value) ? sanitizeHtml(value, EMAIL_HTML) : textToHtml(value);
}

/** The text a plain-text part, an SMS or a WhatsApp message carries. */
function toPlainText(body) {
  const value = String(body ?? '');
  return looksLikeHtml(value) ? htmlToText(sanitizeHtml(value, EMAIL_HTML)) : value;
}

export { toEmailHtml, toPlainText, looksLikeHtml };
export default { toEmailHtml, toPlainText, looksLikeHtml };
