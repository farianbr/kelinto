/**
 * Demo messages for the two starter after sales statuses (2026-10-01, client
 * request): real email layouts, so the Code and View tabs have something worth
 * looking at, and a shop has a finished starting point to edit rather than a
 * blank box.
 *
 * Built per business, because a layout is in somebody's colours: the accent is
 * the business's own palette colour, and the footer and review button use the
 * contact details and review link from its Settings. Anything not filled in is
 * left out rather than printed as a placeholder; a review button pointing
 * nowhere is worse than none.
 *
 * **No warranty numbers.** The period depends on Sale Settings and the
 * customer's tier, and a figure frozen into seeded HTML would be wrong the day
 * somebody changes either. The copy points at the invoice instead.
 *
 * Email-safe on purpose: tables for layout, inline styles only, six-digit hex
 * (Outlook ignores alpha), and nothing `services/messageBody.js` strips.
 */

const INK = '#18181b';
const MUTED = '#52525b';
const SOFT = '#71717a';
const LINE = '#e4e4e7';
const PAGE = '#f4f4f5';
const PANEL = '#fafafa';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The button every client draws the same: a table cell, not a styled link. */
function button(href, label, brand) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td bgcolor="${brand}" style="border-radius:6px;">
                <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a>
              </td>
            </tr>
          </table>`;
}

/** The outer page, the card, the accent bar, the wordmark and the footer. */
function shell({ brand, preheader, body, contact }) {
  const contactLine = contact.length
    ? `<p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:${SOFT};">${contact.join(' &middot; ')}</p>`
    : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background:${PAGE};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td bgcolor="#ffffff" style="background:#ffffff;border-top:4px solid ${brand};border-radius:8px;padding:32px 28px 28px;font-family:${FONT};color:${INK};">
            <p style="margin:0;font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${brand};">{{shop_name}}</p>
${body}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 24px 0;font-family:${FONT};">
            <p style="margin:0;font-size:12px;font-weight:600;color:${MUTED};">{{shop_name}}</p>
            ${contactLine}
            <p style="margin:10px 0 0;font-size:11px;line-height:1.6;color:${SOFT};">You are receiving this because of invoice {{invoice_number}}.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function labelMessages({ brand, reviewUrl, phone, email }) {
  const contact = [phone, email].filter(Boolean).map(escapeHtml);
  const reachUs = [phone && `call ${escapeHtml(phone)}`, email && `write to ${escapeHtml(email)}`]
    .filter(Boolean)
    .join(' or ');

  const review = reviewUrl
    ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-top:1px solid ${LINE};">
              <tr>
                <td style="padding-top:24px;">
                  <p style="margin:0;font-size:15px;font-weight:700;color:${INK};">Happy with the work?</p>
                  <p style="margin:6px 0 16px;font-size:14px;line-height:1.65;color:${MUTED};">A short review helps the next person with a cracked screen find us. It takes about a minute.</p>
                  ${button(reviewUrl, 'Leave a review', brand)}
                </td>
              </tr>
            </table>`
    : '';

  const thanks = `
            <h1 style="margin:22px 0 0;font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.015em;color:${INK};">Your device is ready, and it is covered.</h1>
            <p style="margin:14px 0 0;font-size:15px;line-height:1.7;color:${MUTED};">Hi {{customer_name}}, thank you for trusting us with your repair. Invoice {{invoice_number}} is settled and the work is complete.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
              <tr>
                <td bgcolor="${PANEL}" style="background:${PANEL};border-left:3px solid ${brand};border-radius:4px;padding:18px 20px;">
                  <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${brand};">Your warranty</p>
                  <p style="margin:8px 0 0;font-size:14px;line-height:1.65;color:${INK};">The repair is covered by our warranty for the period shown on your invoice. Keep this email: invoice {{invoice_number}} is all you need to make a claim.</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
                    <tr><td valign="top" style="padding:3px 10px 3px 0;font-size:14px;line-height:1.5;color:${brand};">&#10003;</td><td style="padding:3px 0;font-size:14px;line-height:1.5;color:${MUTED};">The part we fitted and our labour on it</td></tr>
                    <tr><td valign="top" style="padding:3px 10px 3px 0;font-size:14px;line-height:1.5;color:${SOFT};">&#10005;</td><td style="padding:3px 0;font-size:14px;line-height:1.5;color:${MUTED};">Liquid or physical damage after you collect it</td></tr>
                    <tr><td valign="top" style="padding:3px 10px 3px 0;font-size:14px;line-height:1.5;color:${SOFT};">&#10005;</td><td style="padding:3px 0;font-size:14px;line-height:1.5;color:${MUTED};">Faults in parts we did not work on</td></tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:15px;font-weight:700;color:${INK};">For the first few days</p>
            <p style="margin:6px 0 0;font-size:14px;line-height:1.7;color:${MUTED};">Let a new battery run through a full charge cycle, and give a new screen's adhesive 24 hours before it meets water or a tight case. If anything feels off, ${reachUs || 'reply to this email'} and we will look at it straight away.</p>
${review}`;

  const checkIn = `
            <h1 style="margin:22px 0 0;font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.015em;color:${INK};">A week on: how is everything working?</h1>
            <p style="margin:14px 0 0;font-size:15px;line-height:1.7;color:${MUTED};">Hi {{customer_name}}, it has been about a week since we finished the work on invoice {{invoice_number}}. Most problems with a repair show up in the first few days, so this is a good moment to check.</p>

            <!-- Stacked, not side by side: without media queries (mail clients
                 strip style blocks) two columns cannot reflow on a phone. -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
              <tr>
                <td bgcolor="${PANEL}" style="background:${PANEL};border-left:3px solid ${brand};border-radius:4px;padding:18px 20px;">
                  <p style="margin:0;font-size:14px;font-weight:700;color:${INK};">All good?</p>
                  <p style="margin:4px 0 0;font-size:14px;line-height:1.6;color:${MUTED};">Nothing to do. Your warranty keeps running for the period on your invoice.</p>
                  <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid ${LINE};font-size:14px;font-weight:700;color:${INK};">Something off?</p>
                  <p style="margin:4px 0 0;font-size:14px;line-height:1.6;color:${MUTED};">${reachUs ? `${reachUs.charAt(0).toUpperCase()}${reachUs.slice(1)}` : 'Reply to this email'} with your invoice number. A warranty fix costs you nothing.</p>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:${MUTED};">Thank you for being part of {{shop_name}}. Customers who come back, and send their friends, are how a local repair counter stays open.</p>
${review}`;

  return {
    'Thanks for Support': {
      delayDays: 0,
      channels: ['email'],
      subject: 'Thanks, {{customer_name}}: your repair is done and covered',
      message: shell({
        brand,
        preheader: 'Your warranty details for invoice {{invoice_number}}, and how to reach us.',
        body: thanks,
        contact,
      }),
    },
    'Thank You for Being Part of Us': {
      delayDays: 7,
      channels: ['email'],
      subject: 'How is your device doing, {{customer_name}}?',
      message: shell({
        brand,
        preheader: 'A quick check-in, one week after your repair.',
        body: checkIn,
        contact,
      }),
    },
  };
}

export { labelMessages };
export default labelMessages;
