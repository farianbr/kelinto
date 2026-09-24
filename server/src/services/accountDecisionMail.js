import { sendMail } from './mailer.js';
import env from '../config/env.js';
import { sendingBusiness } from './sendingBusiness.js';
import { MAIL, escapeHtml } from './welcomeMail.js';
import { storefrontOrigin } from './linkOrigins.js';

/**
 * The two emails a pending account eventually gets: approved, or not.
 *
 * ## Why these did not exist
 *
 * `adminService.approveUser` carried `TODO(email): notify the buyer once a mail
 * provider is chosen`. A provider has been chosen and configured since - SMTP
 * is live and every other transactional mail goes out through it - so the only
 * thing still missing was these two sends. The Email Settings screen has been
 * showing both toggles as "not wired" ever since, which reads as *email is off*
 * rather than *this message was never written*.
 *
 * ## The business sends this, never the platform
 *
 * `sendingBusiness()` for the name, exactly as `welcomeMail` does it and for the
 * same reason: a repair customer of CellShoppe told their "Cellvix account" is
 * approved reads as phishing, and a customer who treats mail as phishing does
 * not act on it. CASL also requires the actual sender be identified.
 *
 * ## A rejection names the reason
 *
 * `rejectUser` already requires one, and it is the whole content of the
 * message - "your application was unsuccessful" with no reason gives the
 * business nothing to fix and guarantees a phone call. It is included verbatim
 * because a staff member wrote it for this customer.
 */

/** The shared card chrome both messages sit in. */
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

/**
 * "Your account is approved" - with the terms it was approved on.
 *
 * The credit limit and payment terms are the reason this mail is worth sending
 * at all: they are what the buyer needs before their first order, and without
 * them the message says only that something happened.
 */
async function sendAccountApprovedEmail({ user }) {
  if (!user?.email) return { delivered: false, via: null, error: 'No email address on file.' };

  const business = await sendingBusiness();
  // The customer's own storefront, where `/account` is (see `linkOrigins`).
  const origin = await storefrontOrigin();
  const name = user.contactName || user.businessName || 'there';

  const terms = user.terms && user.terms !== 'prepaid' ? user.terms.toUpperCase() : 'Prepaid';
  const limit =
    user.creditLimit > 0
      ? `$${(user.creditLimit / 100).toLocaleString('en-CA', { minimumFractionDigits: 2 })}`
      : null;

  const detail = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;border:1px solid ${MAIL.line};border-radius:${MAIL.radiusInner};">
        <tr>
          <td style="padding:11px 16px;font:400 ${MAIL.small}/1.4 ${MAIL.body};color:${MAIL.ink500};">Payment terms</td>
          <td style="padding:11px 16px;font:600 ${MAIL.base}/1.4 ${MAIL.body};color:${MAIL.ink900};text-align:right;">${escapeHtml(terms)}</td>
        </tr>
        ${
          limit
            ? `<tr>
                 <td style="padding:11px 16px;border-top:1px solid ${MAIL.line};font:400 ${MAIL.small}/1.4 ${MAIL.body};color:${MAIL.ink500};">Credit limit</td>
                 <td style="padding:11px 16px;border-top:1px solid ${MAIL.line};font:600 ${MAIL.base}/1.4 ${MAIL.body};color:${MAIL.ink900};text-align:right;">${limit}</td>
               </tr>`
            : ''
        }
      </table>`;

  const text = [
    `Hello ${name},`,
    '',
    `Your ${business.name} account has been approved. You can sign in and order at wholesale pricing.`,
    '',
    `Payment terms: ${terms}`,
    limit ? `Credit limit: ${limit}` : null,
    '',
    `${origin}/account`,
    '',
    business.name,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return sendMail({
    to: user.email,
    from: env.MAIL_FROM_ADMIN,
    subject: `Your ${business.name} account is approved`,
    html: shell({
      business,
      heading: 'Your account is approved',
      intro: `Hello ${escapeHtml(name)}, your account has been approved. You can sign in and order at wholesale pricing.`,
      body: detail,
      cta: { href: `${origin}/account`, label: 'Open your account' },
    }),
    text,
  });
}

/**
 * "Your application was not approved" - and why.
 *
 * Sent from the admin address rather than sales: a reply to this goes to
 * somebody who can reconsider it, which is the only useful destination for a
 * reply to a rejection.
 */
async function sendAccountRejectedEmail({ user, reason }) {
  if (!user?.email) return { delivered: false, via: null, error: 'No email address on file.' };

  const business = await sendingBusiness();
  const name = user.contactName || user.businessName || 'there';
  const because = reason || user.rejectionReason;

  const detail = because
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;border:1px solid ${MAIL.line};border-radius:${MAIL.radiusInner};background:${MAIL.surface2};">
         <tr><td style="padding:14px 16px;font:400 ${MAIL.base}/1.6 ${MAIL.body};color:${MAIL.ink900};">${escapeHtml(because)}</td></tr>
       </table>`
    : '';

  const text = [
    `Hello ${name},`,
    '',
    `We were unable to approve your ${business.name} wholesale account at this time.`,
    because ? '' : null,
    because || null,
    '',
    'If you believe this is a mistake, or you can supply more information, reply to this message.',
    '',
    business.name,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return sendMail({
    to: user.email,
    from: env.MAIL_FROM_ADMIN,
    subject: `About your ${business.name} account application`,
    html: shell({
      business,
      heading: 'We could not approve your account',
      intro: `Hello ${escapeHtml(name)}, we were unable to approve your wholesale account at this time.`,
      body: `${detail}<p style="margin:16px 0 0;font:400 ${MAIL.base}/1.6 ${MAIL.body};color:${MAIL.ink500};">If you believe this is a mistake, or you can supply more information, reply to this message.</p>`,
      cta: null,
    }),
    text,
  });
}

export { sendAccountApprovedEmail, sendAccountRejectedEmail };
export default { sendAccountApprovedEmail, sendAccountRejectedEmail };
