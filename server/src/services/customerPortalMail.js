import sendMail from './mailer.js';
import env from '../config/env.js';
import { MAIL, escapeHtml } from './welcomeMail.js';

/**
 * The email that carries a customer their portal link (§6.13a).
 *
 * **The sending business is a parameter, not a constant.** Every other template
 * in this codebase renders `BUSINESS_INFO` - Cellvix's own name and address,
 * read from settings at import time - because every other template is sent by
 * Cellvix. This one is not: the whole reason the portal exists is that a
 * *service* business has no storefront, so the mail that most needs sending
 * comes from CellShoppe or whoever else, and a repair customer receiving
 * "Cellvix" over a link to their phone repair would reasonably assume it was a
 * phishing attempt.
 *
 * So the business travels with the call, and the template has no fallback to a
 * global. A missing name renders nothing rather than the wrong thing.
 *
 * **The link is the credential**, which shapes the copy: the mail says so
 * plainly rather than treating the URL as an ordinary link, because a customer
 * who does not know that will forward it to a group chat.
 */

async function sendCustomerPortalLink({ user, business, url }) {
  if (!user?.email) {
    return { delivered: false, via: null, error: 'This customer has no email address.' };
  }
  if (!url) {
    return { delivered: false, via: null, error: 'No portal link to send.' };
  }

  try {
    const shopName = business?.name ?? '';
    const shopPhone = business?.phone ?? '';
    const city = business?.address?.city ?? '';
    const region = business?.address?.region ?? '';
    const place = [city, region].filter(Boolean).join(', ');

    const { display, body, ink900, ink500, ink300, line, surface2 } = MAIL;

    // The name a customer will recognise, falling back to the person rather
    // than to a bare "Hello" - the mail is about their own record.
    const greeting = user.contactName || user.businessName || 'Hello';

    const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${surface2};">
  <!-- Preheader: the line inboxes show beside the subject. Hidden in the body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Follow your repairs, invoices and quotes. No password needed.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${surface2};">
    <tr><td align="center" style="padding:32px 16px;">

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${line};border-radius:${MAIL.radiusCard};overflow:hidden;">

      <tr><td style="height:3px;line-height:3px;font-size:0;background:${MAIL.brand};">
        <div style="height:3px;background:linear-gradient(90deg,#2e3c4d 0%,#41566e 55%,#5f7185 100%);">&nbsp;</div>
      </td></tr>

      <tr><td style="padding:36px 36px 8px;">
        <div style="font:700 ${MAIL.micro}/1 ${display};letter-spacing:0.14em;text-transform:uppercase;color:${ink300};">
          ${escapeHtml(shopName)}
        </div>
      </td></tr>

      <tr><td style="padding:0 36px;">
        <h1 style="margin:14px 0 0;font:700 ${MAIL.hero}/1.2 ${display};letter-spacing:-0.02em;color:${ink900};">Your account page</h1>
        <p style="margin:12px 0 0;font:400 ${MAIL.base}/1.65 ${body};color:${ink500};">
          ${escapeHtml(greeting)}, here is your own page with
          ${escapeHtml(shopName)}. It shows your repairs and where each one has
          got to, your invoices and what is still owed, and any quotes we have
          sent you.
        </p>
      </td></tr>

      <tr><td style="padding:24px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:${MAIL.radiusInner};background:${MAIL.brand};">
            <a href="${url}" style="display:inline-block;padding:13px 26px;font:600 ${MAIL.base}/1 ${display};color:#ffffff;text-decoration:none;">
              Open my page
            </a>
          </td>
        </tr></table>
      </td></tr>

      <tr><td style="padding:20px 36px 0;">
        <p style="margin:0;font:400 ${MAIL.small}/1.7 ${body};color:${ink500};">
          If the button does not work, paste this into your browser:<br />
          <span style="color:${MAIL.brand};word-break:break-all;">${escapeHtml(url)}</span>
        </p>
      </td></tr>

      <!-- Said plainly, and in a box, because a customer who does not know the
           link is the password will paste it into a group chat. -->
      <tr><td style="padding:20px 36px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${surface2};border-radius:${MAIL.radiusInner};">
          <tr><td style="padding:14px 16px;">
            <p style="margin:0;font:400 ${MAIL.small}/1.7 ${body};color:${ink500};">
              <strong style="color:${ink900};font-weight:600;">Keep this link to yourself.</strong>
              There is no password - anyone who has the link can see this page, so
              please do not forward it. Tell us if it reaches somebody it should
              not have and we will replace it.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="padding:18px 36px 0;text-align:center;font:400 ${MAIL.micro}/1.7 ${body};color:${ink300};">
        ${escapeHtml(shopName)}${place ? ` &nbsp;·&nbsp; ${escapeHtml(place)}` : ''}${shopPhone ? `<br />${escapeHtml(shopPhone)}` : ''}
      </td></tr>
    </table>

  </td></tr></table>
</body></html>`;

    const text = [
      `Your account page with ${shopName}`,
      '',
      `${greeting}, here is your own page with ${shopName}. It shows your repairs`,
      'and where each one has got to, your invoices and what is still owed, and',
      'any quotes we have sent you.',
      '',
      `  ${url}`,
      '',
      'Keep this link to yourself. There is no password, so anyone who has the',
      'link can see this page. Tell us if it reaches somebody it should not have',
      'and we will replace it.',
      shopPhone ? '' : null,
      shopPhone ? `${shopName} · ${shopPhone}` : null,
    ]
      .filter((line) => line !== null)
      .join('\n');

    return await sendMail({
      to: user.email,
      from: env.MAIL_FROM_ADMIN,
      subject: `Your account page with ${shopName}`,
      html,
      text,
    });
  } catch (error) {
    console.error(
      `  Mail: portal link for ${user?.email} could not be built - ${error.message}`,
    );
    return { delivered: false, via: null, error: error.message };
  }
}

export { sendCustomerPortalLink };
export default sendCustomerPortalLink;
