import { db } from '../db/models.js';
import '../models/User.js';
import '../models/Settings.js';
import { sendMail } from './mailer.js';
import { resolveInvoiceBrand } from './invoiceDocument.js';
import { warrantyTerms } from './warrantyTerms.js';

/**
 * The warranty and review email, sent once when an invoice is labelled.
 *
 * The same two things the printed ticket's second sheet carries - what the shop
 * stands behind, and an invitation to leave a review - in the one form a
 * customer who has already walked out will actually see. Both read
 * `warrantyTerms`, so the sheet in their hand and the mail in their inbox state
 * the same promise; computing the ladder twice is how a shop ends up having
 * promised 120 days on paper and 90 by email.
 *
 * **It is not a copy of the invoice.** They have that: it was printed at the
 * counter or emailed when the invoice was raised. Sending it again under a
 * thank-you would read as a second demand for money already paid, which is
 * precisely the wrong note.
 *
 * Sent at most once per invoice, and only on a paid one - both enforced by the
 * caller, `invoiceLabelService.setInvoiceLabel`. This function checks neither:
 * it renders and sends what it is asked to.
 */

const INK = '#111113';
const MUTED = '#6b6b73';
const LINE = '#e4e4e8';

/**
 * The fallback brand, for an invoice with no business on it.
 *
 * Cellvix red, because that is what the rest of the install falls back to
 * (`DEFAULT_BUSINESS_COLOR`); an email is not the place to introduce a fourth
 * answer to "what colour is this shop".
 */
const BRAND_FALLBACK = '#cf3429';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * @param {object} invoice  a loaded `Invoice`
 * @returns {Promise<{ delivered: boolean, error?: string }>} never throws for a
 *   missing address - the caller reads `delivered`, like every other mail path.
 */
async function sendWarrantyEmail(invoice) {
  const user = await db().User.findById(invoice.user).select('contactName email tier').lean();
  if (!user?.email) return { delivered: false, error: 'No email address on file.' };

  /**
   * The shop's own name and colour, resolved the way the invoice document
   * resolves them - the business RECORD names the shop, because
   * `Settings.business.name` defaults to "Cellvix" and a repair shop that has
   * never opened that screen still carries it.
   */
  const { shop: shopInfo, brandColor } = await resolveInvoiceBrand(invoice.business);
  const settings = await db().Settings.load();

  const shop = shopInfo?.name || settings?.business?.name || 'Your repair shop';
  const brand = brandColor ?? BRAND_FALLBACK;

  const { tiers, mine, baseDays, review, contact } = warrantyTerms(settings, user.tier);
  const firstName = String(user.contactName ?? '')
    .trim()
    .split(/\s+/)[0];

  const cover = mine
    ? ` As a <strong>${escapeHtml(mine.label)} Member</strong>, it is covered by a <strong>${mine.days}-day warranty</strong>.`
    : ` It is covered by our <strong>${baseDays}-day warranty</strong>.`;

  const html = `
<div style="margin:0;padding:24px 16px;background:#f4f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-top:4px solid ${brand};">
    <div style="padding:26px 28px;">
      <div style="font-size:18px;font-weight:800;color:${brand};">${escapeHtml(shop)}</div>

      <p style="margin:18px 0 0;font-size:14px;line-height:1.7;">
        ${firstName ? `Hi ${escapeHtml(firstName)},` : 'Hello,'}
      </p>
      <p style="margin:10px 0 0;font-size:14px;line-height:1.7;">
        Thank you for choosing <strong>${escapeHtml(shop)}</strong>. The work on invoice
        <strong>${escapeHtml(invoice.number)}</strong> is complete and settled.${cover}
      </p>

      <div style="margin-top:20px;border:1px solid ${brand}33;border-radius:6px;background:${brand}0a;padding:16px 18px;">
        <div style="font-size:15px;font-weight:800;color:${brand};">WARRANTY INFORMATION</div>

        <table role="presentation" width="100%" style="margin-top:11px;border-collapse:collapse;">
          <tr style="background:${brand};color:#fff;">
            <th style="padding:5px 10px;font-size:11px;text-align:left;">Membership tier</th>
            <th style="padding:5px 10px;font-size:11px;text-align:right;">Warranty period</th>
          </tr>
          ${tiers
            .map(
              (tier) => `
          <tr${tier.isCustomer ? ` style="background:${brand};color:#fff;"` : ''}>
            <td style="padding:4px 10px;font-size:11px;font-weight:700;">${escapeHtml(tier.label)} Member${tier.isCustomer ? ' (you)' : ''}</td>
            <td style="padding:4px 10px;font-size:11px;font-weight:700;text-align:right;">${tier.days} days</td>
          </tr>`,
            )
            .join('')}
        </table>

        <div style="margin-top:12px;font-size:11px;font-weight:700;">Important terms and conditions:</div>
        <ul style="margin:5px 0 0;padding-left:16px;font-size:11px;line-height:1.8;color:${MUTED};">
          <li>Warranty does not cover liquid damage or physical damage occurring after service.</li>
          <li>Warranty applies only to the specific repair performed.</li>
          <li>Proof of this invoice is required to claim warranty service.</li>
        </ul>
        ${contact ? `<div style="margin-top:9px;font-size:11px;font-weight:700;">For warranty support: ${escapeHtml(contact)}</div>` : ''}
      </div>

      ${
        review
          ? `<div style="margin-top:14px;border:1px solid ${LINE};border-radius:6px;background:#f6f8fb;padding:16px 18px;">
        <div style="font-size:15px;font-weight:800;color:${brand};">YOUR FEEDBACK MATTERS</div>
        <p style="margin:9px 0 0;font-size:13px;line-height:1.7;">
          We strive to deliver reliable repair service every time. Enjoyed our service? We would
          love to hear from you.
        </p>
        <p style="margin:13px 0 0;">
          <a href="${escapeHtml(review)}" style="display:inline-block;padding:9px 18px;border-radius:6px;background:${brand};color:#fff;font-size:13px;font-weight:700;text-decoration:none;">Leave us a review</a>
        </p>
      </div>`
          : ''
      }
    </div>

    <div style="padding:14px 28px;border-top:2px solid ${brand};text-align:center;">
      <div style="font-size:12px;font-weight:700;">${escapeHtml(shop)}</div>
      ${contact ? `<div style="margin-top:3px;font-size:11px;color:${MUTED};">${escapeHtml(contact)}</div>` : ''}
    </div>
  </div>
</div>`;

  const text = [
    `${shop} - invoice ${invoice.number}`,
    '',
    `Thank you for choosing ${shop}. The work on this invoice is complete and settled.`,
    mine
      ? `As a ${mine.label} Member, it is covered by a ${mine.days}-day warranty.`
      : `It is covered by our ${baseDays}-day warranty.`,
    '',
    'Important terms and conditions:',
    '- Warranty does not cover liquid damage or physical damage occurring after service.',
    '- Warranty applies only to the specific repair performed.',
    '- Proof of this invoice is required to claim warranty service.',
    review ? `\nEnjoyed our service? Leave us a review: ${review}` : '',
    contact ? `\nFor warranty support: ${contact}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return sendMail({
    to: user.email,
    subject: `Your warranty - ${shop}`,
    html,
    text,
  });
}

export { sendWarrantyEmail };
export default sendWarrantyEmail;
