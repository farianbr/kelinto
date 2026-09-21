import { sendMail } from './mailer.js';
import env from '../config/env.js';
import { sendingBusiness } from './sendingBusiness.js';
import { MAIL, escapeHtml } from './welcomeMail.js';

/**
 * The three sends the Email Settings screen offered and nobody had written.
 *
 * `quoteOnCreate`, `paymentConfirmation` and `lowStockAlerts` have been toggles
 * on that screen since it shipped, each marked as unbuilt. They are built here,
 * in one module rather than three, because they share every structural decision:
 * the business identity, the card chrome, the gate on the setting, and the rule
 * that a mail failure never fails the operation that triggered it.
 *
 * ## Two of these go to a customer; one goes to the shop
 *
 * The quote and the receipt are customer mail, so they carry the business's own
 * name through `sendingBusiness()` - a CellShoppe customer told their "Cellvix
 * quote" is ready reads as phishing. The low-stock alert goes to whoever the
 * shop nominated on Email Settings, which is internal, so it is addressed from
 * the admin sender and says nothing a customer would see.
 *
 * ## Money is formatted once, here
 *
 * Every amount in this system is integer cents. A template is exactly where
 * that gets divided by a hundred in four slightly different ways, so it does
 * not: `money()` below is the only place it happens.
 */

/** Integer cents to `$1,234.56`. The one place this conversion happens here. */
function money(cents) {
  return `$${((cents ?? 0) / 100).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The card every message in this file sits in. Matches `accountDecisionMail`. */
function shell({ business, heading, intro, body, cta }) {
  const { display, body: bodyFont, ink900, ink500, line, surface2 } = MAIL;

  return `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:${surface2};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid ${line};border-radius:${MAIL.radiusCard};">
    <tr><td style="padding:28px 28px 0;">
      <p style="margin:0 0 18px;font:700 ${MAIL.small}/1.2 ${display};color:${MAIL.brand};letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(business.name)}</p>
      <h1 style="margin:0 0 12px;font:700 ${MAIL.hero}/1.2 ${display};color:${ink900};">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 16px;font:400 ${MAIL.lead}/1.6 ${bodyFont};color:${ink500};">${intro}</p>
      ${body ?? ''}
    </td></tr>
    ${
      cta
        ? `<tr><td style="padding:8px 28px 28px;">
             <a href="${cta.href}" style="display:inline-block;padding:11px 20px;background:${MAIL.brand};color:#fff;font:600 ${MAIL.base}/1 ${display};text-decoration:none;border-radius:${MAIL.radiusInner};">${escapeHtml(cta.label)}</a>
           </td></tr>`
        : '<tr><td style="padding:0 28px 28px;"></td></tr>'
    }
  </table>
</body></html>`;
}

/** A two-column table of label/value rows. Used by all three messages. */
function rows(pairs) {
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;border:1px solid ${MAIL.line};border-radius:${MAIL.radiusInner};">
        ${pairs
          .filter(Boolean)
          .map(
            ([label, value], index) => `
          <tr>
            <td style="padding:11px 16px;${index ? `border-top:1px solid ${MAIL.line};` : ''}font:400 ${MAIL.small}/1.4 ${MAIL.body};color:${MAIL.ink500};">${escapeHtml(label)}</td>
            <td style="padding:11px 16px;${index ? `border-top:1px solid ${MAIL.line};` : ''}font:600 ${MAIL.base}/1.4 ${MAIL.body};color:${MAIL.ink900};text-align:right;">${escapeHtml(String(value))}</td>
          </tr>`,
          )
          .join('')}
      </table>`;
}

/**
 * "Here is your quote" - sent when a quote is raised for a customer.
 *
 * The total and the expiry are the two facts that decide whether the customer
 * acts, so they are the table rather than the prose. A quote with no expiry
 * simply omits that row instead of printing "none", which would read as a
 * mistake.
 */
async function sendQuoteCreatedEmail({ user, quote }) {
  if (!user?.email) return { delivered: false, via: null, error: 'No email address on file.' };

  const business = await sendingBusiness();
  const origin = env.publicOrigin;
  const name = user.contactName || user.businessName || 'there';

  const expires = quote.validUntil
    ? new Date(quote.validUntil).toLocaleDateString('en-CA', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  const detail = rows([
    ['Quote', quote.quoteNumber],
    ['Total', money(quote.total)],
    expires && ['Valid until', expires],
  ]);

  const text = [
    `Hello ${name},`,
    '',
    `Quote ${quote.quoteNumber} from ${business.name} is ready.`,
    '',
    `Total: ${money(quote.total)}`,
    expires ? `Valid until: ${expires}` : null,
    '',
    `${origin}/account/quotes`,
    '',
    business.name,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return sendMail({
    to: user.email,
    subject: `Quote ${quote.quoteNumber} from ${business.name}`,
    html: shell({
      business,
      heading: `Quote ${quote.quoteNumber}`,
      intro: `Hello ${escapeHtml(name)}, your quote is ready. It is below and in your account.`,
      body: detail,
      cta: { href: `${origin}/account/quotes`, label: 'View the quote' },
    }),
    text,
  });
}

/**
 * "We received your payment" - a receipt, sent when a payment is recorded.
 *
 * **What is still owed is the point.** A receipt that says only "thank you"
 * leaves the customer to work out whether they are square; the balance row is
 * why this is worth sending at all, and it says "Paid in full" rather than
 * "$0.00" when there is nothing left.
 */
async function sendPaymentReceiptEmail({ user, invoice, amount }) {
  if (!user?.email) return { delivered: false, via: null, error: 'No email address on file.' };

  const business = await sendingBusiness();
  const origin = env.publicOrigin;
  const name = user.contactName || user.businessName || 'there';
  // `amount` is the invoice total on this model; `total` does not exist on it.
  const outstanding = Math.max(0, (invoice.amount ?? 0) - (invoice.amountPaid ?? 0));

  const detail = rows([
    ['Invoice', invoice.number],
    ['Payment received', money(amount)],
    ['Still owing', outstanding > 0 ? money(outstanding) : 'Paid in full'],
  ]);

  const text = [
    `Hello ${name},`,
    '',
    `${business.name} has recorded your payment of ${money(amount)} against invoice ${invoice.number}.`,
    '',
    outstanding > 0 ? `Still owing: ${money(outstanding)}` : 'This invoice is now paid in full.',
    '',
    `${origin}/account/invoices`,
    '',
    business.name,
  ].join('\n');

  return sendMail({
    to: user.email,
    subject: `Payment received for invoice ${invoice.number}`,
    html: shell({
      business,
      heading: 'Payment received',
      intro: `Hello ${escapeHtml(name)}, thank you - we have recorded your payment against invoice ${escapeHtml(invoice.number)}.`,
      body: detail,
      cta: { href: `${origin}/account/invoices`, label: 'View your invoices' },
    }),
    text,
  });
}

/**
 * "These parts are running low" - internal, to whoever the shop nominated.
 *
 * ## Why it lists the parts rather than a count
 *
 * "12 products are low" is a notification; a list with the shortfall against
 * each is something somebody can act on without opening the panel. Capped at
 * ten rows, because a mail listing four hundred is one nobody reads and the
 * count carries the rest.
 *
 * Addressed from the admin sender and carrying no customer-facing language:
 * this goes to the shop about its own shelves.
 */
async function sendLowStockEmail({ to, items, total }) {
  if (!to) return { delivered: false, via: null, error: 'No alert address is set.' };
  if (!items?.length) return { delivered: false, via: null, error: 'Nothing is low.' };

  const business = await sendingBusiness();
  const origin = env.publicOrigin;

  const shown = items.slice(0, 10);
  const more = Math.max(0, (total ?? items.length) - shown.length);

  const detail = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;border:1px solid ${MAIL.line};border-radius:${MAIL.radiusInner};">
        ${shown
          .map(
            (item, index) => `
          <tr>
            <td style="padding:11px 16px;${index ? `border-top:1px solid ${MAIL.line};` : ''}font:400 ${MAIL.base}/1.4 ${MAIL.body};color:${MAIL.ink900};">
              ${escapeHtml(item.name)}
              <span style="display:block;font:400 ${MAIL.small}/1.4 ${MAIL.mono};color:${MAIL.ink300};">${escapeHtml(item.sku ?? '')}</span>
            </td>
            <td style="padding:11px 16px;${index ? `border-top:1px solid ${MAIL.line};` : ''}font:600 ${MAIL.base}/1.4 ${MAIL.body};color:${item.stock <= 0 ? MAIL.brand : MAIL.ink900};text-align:right;white-space:nowrap;">
              ${item.stock <= 0 ? 'Out of stock' : `${item.stock} left`}
            </td>
          </tr>`,
          )
          .join('')}
      </table>
      ${
        more
          ? `<p style="margin:10px 0 0;font:400 ${MAIL.small}/1.5 ${MAIL.body};color:${MAIL.ink500};">and ${more} more.</p>`
          : ''
      }`;

  const text = [
    `${total ?? items.length} product${(total ?? items.length) === 1 ? '' : 's'} at ${business.name} ${(total ?? items.length) === 1 ? 'is' : 'are'} at or below its reorder point.`,
    '',
    ...shown.map(
      (item) => `  ${item.name} (${item.sku ?? '-'}) - ${item.stock <= 0 ? 'out of stock' : `${item.stock} left`}`,
    ),
    more ? `  and ${more} more.` : null,
    '',
    `${origin}/admin/inventory?stock=attention`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const count = total ?? items.length;

  return sendMail({
    to,
    from: env.MAIL_FROM_ADMIN,
    subject: `${count} product${count === 1 ? '' : 's'} running low`,
    html: shell({
      business,
      heading: 'Stock running low',
      intro: `${count} product${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} at or below ${count === 1 ? 'its' : 'their'} reorder point.`,
      body: detail,
      cta: { href: `${origin}/admin/inventory?stock=attention`, label: 'Open inventory' },
    }),
    text,
  });
}

export { sendQuoteCreatedEmail, sendPaymentReceiptEmail, sendLowStockEmail };
export default { sendQuoteCreatedEmail, sendPaymentReceiptEmail, sendLowStockEmail };
