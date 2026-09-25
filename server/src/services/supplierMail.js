import env from '../config/env.js';
import { sendMail } from './mailer.js';
import { MAIL, escapeHtml } from './welcomeMail.js';
import { sendingBusiness } from './sendingBusiness.js';
// Supplier links go to the business's own website address, where its portal
// lives; the purchasing alert goes to the business's staff ERP address.
import { staffPanelOrigin, storefrontOrigin } from './linkOrigins.js';

/**
 * Mail to suppliers - the portal invitation, and everything a purchase order
 * puts to them (supplier process flow, §6.8a).
 *
 * Same contract as `welcomeMail.js` and for the same reason: **never throws**.
 * Every message here is a side effect of something already written to the
 * database - a supplier that exists, an order that has been sent - and a dead
 * SMTP host must not turn any of those into an error. Callers read `delivered`.
 *
 * Sent from `MAIL_FROM_ADMIN`, not `MAIL_FROM`. A supplier replying to their
 * portal credentials should reach whoever handles accounts, not the billing
 * desk.
 *
 * The palette, the shell and the escaping come from `welcomeMail.js` rather
 * than being redefined here, so supplier mail and customer mail stay one
 * design. What differs is only what these messages have to say.
 */

/** Cents to `$1,234.56`. Canadian conventions, as everywhere else. */
const CAD = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const money = (cents) => CAD.format((cents ?? 0) / 100);

/** The card shell every message below fills. Kept in one place, as in the buyer mail. */
/**
 * "Name · City, Region", leaving out what is not known - the platform itself
 * has no address to print, and " · , " at the foot of a mail reads as broken.
 */
function signOff(business) {
  const place = [business.address?.city, business.address?.region].filter(Boolean).join(', ');
  return [business.name, place].filter(Boolean).join(' · ');
}

function shell({ preheader, title, intro, blocks, footerNote, business }) {
  const { display, body, ink900, ink500, ink300, line, surface2 } = MAIL;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${surface2};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${surface2};">
    <tr><td align="center" style="padding:32px 16px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${line};border-radius:${MAIL.radiusCard};overflow:hidden;">

        <!-- The compact brand ramp as a hairline, matching the buyer mail. The
             full ramp spends its first third near black, which across 3px reads
             as a dark stub rather than as depth. -->
        <tr><td style="height:3px;line-height:3px;font-size:0;background:${MAIL.brand};">
          <div style="height:3px;background:linear-gradient(90deg,#8f221b 0%,#cf3429 55%,#e8564a 100%);">&nbsp;</div>
        </td></tr>

        <tr><td style="padding:36px 36px 8px;">
          <div style="font:700 ${MAIL.micro}/1 ${display};letter-spacing:0.14em;text-transform:uppercase;color:${ink300};">
            ${escapeHtml(business.name)}
          </div>
          <h1 style="margin:14px 0 0;font:700 ${MAIL.hero}/1.2 ${display};letter-spacing:-0.02em;color:${ink900};">
            ${escapeHtml(title)}
          </h1>
          <p style="margin:12px 0 0;font:400 ${MAIL.base}/1.65 ${body};color:${ink500};">${intro}</p>
        </td></tr>

        ${blocks}

        <tr><td style="padding:28px 36px 36px;">
          <p style="margin:0;font:400 ${MAIL.small}/1.6 ${body};color:${ink300};border-top:1px solid ${line};padding-top:16px;">
            ${footerNote}<br />
            ${escapeHtml(signOff(business))}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href, label) {
  const { display } = MAIL;
  return `
        <tr><td style="padding:24px 36px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:${MAIL.radiusInner};background:${MAIL.brand};">
              <a href="${href}" style="display:inline-block;padding:13px 26px;font:600 ${MAIL.base}/1 ${display};color:#ffffff;text-decoration:none;">
                ${escapeHtml(label)}
              </a>
            </td>
          </tr></table>
        </td></tr>`;
}

/** A label/value table, the same one the welcome mail's credentials block uses. */
function detailTable(rows) {
  const { body, mono, ink900, ink500, line } = MAIL;

  const cells = rows
    .map(
      ([label, value, isMono]) => `
          <tr>
            <td style="padding:11px 16px;border-top:1px solid ${line};font:400 ${MAIL.small}/1.4 ${body};color:${ink500};white-space:nowrap;">${escapeHtml(label)}</td>
            <td style="padding:11px 16px;border-top:1px solid ${line};font:${isMono ? `700 ${MAIL.lead}/1.4 ${mono};letter-spacing:0.4px` : `600 ${MAIL.base}/1.4 ${body}`};color:${ink900};">${escapeHtml(String(value))}</td>
          </tr>`,
    )
    .join('');

  return `
        <tr><td style="padding:22px 36px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${line};border-radius:${MAIL.radiusInner};overflow:hidden;">
            ${cells.replace(`border-top:1px solid ${line};`, '')}
          </table>
        </td></tr>`;
}

/**
 * The portal invitation: a link to set a password, never a password.
 *
 * The supplier chooses their own password from a single-use link that expires,
 * so no credential ever sits in a mailbox. Sent when a supplier is created and
 * from the ERP's **Resend portal link**; each send replaces the previous link.
 *
 * The portal is THIS business's (`<website>/supplier`), and the email says so,
 * because a supplier to two businesses on Kelinto has two separate logins and
 * must be able to tell which one this is.
 */
async function sendSupplierPortalInvite({ supplier, portal, link, expiresDays = 7 }) {
  if (!supplier?.email || !link) {
    return { delivered: false, via: null, error: 'No email address or link.' };
  }

  try {
    const business = await sendingBusiness();
    const strong = (value) => `<strong style="color:${MAIL.ink900};font-weight:600;">${escapeHtml(value)}</strong>`;

    const intro = `${strong(business.name)} has opened a supplier portal for ${strong(supplier.name)}. Set a password to see the requests for quote we send you, send your prices and track your orders.`;

    const blocks =
      detailTable([
        ['Portal', portal, false],
        ['Sign in with', supplier.email, false],
      ]) +
      button(link, 'Set your password') +
      `
        <tr><td style="padding:14px 36px 0;">
          <p style="margin:0;font:400 ${MAIL.small}/1.6 ${MAIL.body};color:${MAIL.ink500};">
            The button works once and expires in ${expiresDays} days. After that, sign in at the portal address above.
          </p>
        </td></tr>`;

    const text = [
      `${business.name} has opened a supplier portal for ${supplier.name}.`,
      '',
      `  Set your password  ${link}`,
      `  Portal             ${portal}`,
      `  Sign in with       ${supplier.email}`,
      '',
      `The link works once and expires in ${expiresDays} days.`,
      '',
      signOff(business),
      'Reply to this email and it reaches our purchasing team.',
    ].join('\n');

    return await sendMail({
      to: supplier.email,
      from: env.MAIL_FROM_ADMIN,
      subject: `Your ${business.name} supplier portal`,
      html: shell({
        business,
        preheader: `Set a password for the ${business.name} supplier portal.`,
        title: 'Your supplier portal is ready',
        intro,
        blocks,
        footerNote: 'Reply to this email and it reaches our purchasing team.',
      }),
      text,
    });
  } catch (error) {
    console.error(`  Mail: portal invite for ${supplier?.email} could not be built - ${error.message}`);
    return { delivered: false, via: null, error: error.message };
  }
}

/**
 * The portal password reset, for ONE business's portal.
 *
 * From that business, because the login belongs to it: resetting it changes
 * nothing at any other business the supplier works with. The link is the
 * secret, single-use and expiring.
 */
async function sendSupplierResetEmail({ supplier, link, expiresDays = 7 }) {
  if (!supplier?.email || !link) {
    return { delivered: false, via: null, error: 'No email address or link.' };
  }

  try {
    const business = await sendingBusiness();
    const text = [
      `Somebody asked to reset the ${business.name} supplier portal password for ${supplier.email}.`,
      '',
      `  Choose a new password  ${link}`,
      '',
      `The link works once and expires in ${expiresDays} days.`,
      'If this was not you, ignore this message. Nothing has changed.',
      '',
      signOff(business),
    ].join('\n');

    return await sendMail({
      to: supplier.email,
      from: env.MAIL_FROM_ADMIN,
      subject: `Reset your ${business.name} supplier portal password`,
      html: shell({
        business,
        preheader: `Choose a new password. The link expires in ${expiresDays} days.`,
        title: 'Reset your password',
        intro: `Somebody asked to reset the ${escapeHtml(business.name)} supplier portal password for <strong style="color:${MAIL.ink900};font-weight:600;">${escapeHtml(supplier.email)}</strong>. Use the button below within ${expiresDays} days.`,
        blocks: button(link, 'Choose a new password'),
        footerNote: 'If this was not you, ignore this message. Nothing has changed until the link is used.',
      }),
      text,
    });
  } catch (error) {
    console.error(`  Mail: portal reset for ${supplier?.email} could not be built - ${error.message}`);
    return { delivered: false, via: null, error: error.message };
  }
}

/**
 * "We would like a price for these parts."
 *
 * Carries the line list but **no prices at all** - not ours, not another
 * supplier's. The whole document is a question, and a number in it would be an
 * anchor we did not mean to set.
 */
async function sendPurchaseOrderInvitation({ supplier, po }) {
  if (!supplier?.email) {
    return { delivered: false, via: null, error: 'No email address on file.' };
  }

  try {
    // The business placing this order, not the house brand - a supplier who
    // deals with two businesses on one platform must see which one is writing.
    const business = await sendingBusiness();
    const origin = await storefrontOrigin();
    const link = `${origin}/supplier/orders/${po._id ?? po.id}`;

    const lineRows = (po.items ?? [])
      .slice(0, 12)
      .map(
        (item) => `
            <tr>
              <td style="padding:9px 16px;border-top:1px solid ${MAIL.line};font:400 ${MAIL.small}/1.4 ${MAIL.body};color:${MAIL.ink900};">${escapeHtml(item.name ?? item.sku ?? '')}</td>
              <td style="padding:9px 16px;border-top:1px solid ${MAIL.line};font:400 ${MAIL.small}/1.4 ${MAIL.mono};color:${MAIL.ink500};">${escapeHtml(item.sku ?? '')}</td>
              <td align="right" style="padding:9px 16px;border-top:1px solid ${MAIL.line};font:600 ${MAIL.small}/1.4 ${MAIL.body};color:${MAIL.ink900};">${item.qtyOrdered}</td>
            </tr>`,
      )
      .join('');

    const more = (po.items ?? []).length > 12 ? (po.items ?? []).length - 12 : 0;

    const blocks =
      `
        <tr><td style="padding:22px 36px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${MAIL.line};border-radius:${MAIL.radiusInner};overflow:hidden;">
            <tr>
              <td style="padding:9px 16px;background:${MAIL.surface2};font:600 ${MAIL.micro}/1.4 ${MAIL.display};letter-spacing:0.08em;text-transform:uppercase;color:${MAIL.ink300};">Part</td>
              <td style="padding:9px 16px;background:${MAIL.surface2};font:600 ${MAIL.micro}/1.4 ${MAIL.display};letter-spacing:0.08em;text-transform:uppercase;color:${MAIL.ink300};">SKU</td>
              <td align="right" style="padding:9px 16px;background:${MAIL.surface2};font:600 ${MAIL.micro}/1.4 ${MAIL.display};letter-spacing:0.08em;text-transform:uppercase;color:${MAIL.ink300};">Qty</td>
            </tr>
            ${lineRows}
          </table>
          ${more ? `<p style="margin:10px 0 0;font:400 ${MAIL.small}/1.5 ${MAIL.body};color:${MAIL.ink300};">and ${more} more line${more === 1 ? '' : 's'} in the portal.</p>` : ''}
        </td></tr>` + button(link, 'Send us your price');

    const text = [
      `${business.name} is asking for a price - ${po.poNumber}.`,
      '',
      ...(po.items ?? []).map(
        (item) => `  ${item.qtyOrdered} x ${item.name ?? ''} (${item.sku ?? ''})`,
      ),
      '',
      ...(po.closesAt ? [`Answers close ${new Date(po.closesAt).toDateString()}.`, ''] : []),
      `  Quote here  ${link}`,
      '',
      `${business.name} · ${business.address.city}, ${business.address.region}`,
    ].join('\n');

    return await sendMail({
      to: supplier.email,
      from: env.MAIL_FROM_ADMIN,
      subject: `Purchase order ${po.poNumber} - your price, please`,
      html: shell({
        business,
        preheader: `We would like a price for ${(po.items ?? []).length} line${(po.items ?? []).length === 1 ? '' : 's'}.`,
        title: 'Request for your price',
        intro: `We would like a price from <strong style="color:${MAIL.ink900};font-weight:600;">${escapeHtml(supplier.name)}</strong> for the parts below${po.closesAt ? `, by ${escapeHtml(new Date(po.closesAt).toDateString())}` : ''}. Prices go in the portal - the button is at the bottom.`,
        blocks,
        footerNote: `Reference ${escapeHtml(po.poNumber)}. Reply to this email and it reaches our purchasing team.`,
      }),
      text,
    });
  } catch (error) {
    console.error(
      `  Mail: purchase order invite for ${supplier?.email} could not be built - ${error.message}`,
    );
    return { delivered: false, via: null, error: error.message };
  }
}

/**
 * The outcome, sent to every supplier who priced the order.
 *
 * Losers are told, deliberately. A supplier who priced work and hears nothing
 * learns only that answering is not worth the effort, and the next order gets
 * fewer answers. The message carries no competitor's price and no ranking
 * what another supplier charges is not this one's business.
 */
async function sendPurchaseOrderOutcome({ supplier, po, won }) {
  if (!supplier?.email) {
    return { delivered: false, via: null, error: 'No email address on file.' };
  }

  try {
    // The business placing this order, not the house brand - a supplier who
    // deals with two businesses on one platform must see which one is writing.
    const business = await sendingBusiness();
    const origin = await storefrontOrigin();
    const link = `${origin}/supplier/orders/${po._id ?? po.id}`;

    const intro = won
      ? `Thank you for pricing ${escapeHtml(po.poNumber)} - we would like to go ahead. The order is confirmed with you, and the details are in your portal.`
      : `Thank you for pricing ${escapeHtml(po.poNumber)}. We have placed this order elsewhere on this occasion, and we will be in touch with the next one.`;

    const blocks = won
      ? detailTable([['Purchase order', po.poNumber, true]]) + button(link, 'Open the portal')
      : '';

    const text = [
      won
        ? `Your price for ${po.poNumber} was accepted.`
        : `Thank you for pricing ${po.poNumber}.`,
      '',
      ...(won
        ? [`  Purchase order  ${po.poNumber}`, `  Portal          ${link}`]
        : [
            'We have placed this order elsewhere on this occasion, and we will be in touch with the next one.',
          ]),
      '',
      `${business.name} · ${business.address.city}, ${business.address.region}`,
    ].join('\n');

    return await sendMail({
      to: supplier.email,
      from: env.MAIL_FROM_ADMIN,
      subject: won
        ? `Your price was accepted - ${po.poNumber}`
        : `Purchase order ${po.poNumber}`,
      html: shell({
        business,
        preheader: won ? 'We would like to go ahead.' : 'Thank you for pricing.',
        title: won ? 'Your price was accepted' : 'Thank you for pricing',
        intro,
        blocks,
        footerNote: 'Reply to this email and it reaches our purchasing team.',
      }),
      text,
    });
  } catch (error) {
    console.error(
      `  Mail: purchase outcome for ${supplier?.email} could not be built - ${error.message}`,
    );
    return { delivered: false, via: null, error: error.message };
  }
}

/**
 * We would like a better price. Sent whenever a negotiation round opens.
 *
 * The ask is stated plainly - a round that only says "please review" gives the
 * supplier nothing to answer. Where a target total was set it goes in the
 * message, because the number is the whole point of the conversation.
 */
async function sendNegotiationEmail({ supplier, po, askedTotal, note, subject }) {
  if (!supplier?.email) {
    return { delivered: false, via: null, error: 'No email address on file.' };
  }

  try {
    // The business placing this order, not the house brand - a supplier who
    // deals with two businesses on one platform must see which one is writing.
    const business = await sendingBusiness();
    const origin = await storefrontOrigin();
    const link = `${origin}/supplier/orders/${po._id ?? po.id}`;

    const blocks =
      detailTable([
        ['Purchase order', po.poNumber, false],
        ...(askedTotal != null ? [['Our target', money(askedTotal), true]] : []),
      ]) +
      (note
        ? `
        <tr><td style="padding:18px 36px 0;">
          <p style="margin:0;font:400 ${MAIL.small}/1.6 ${MAIL.body};color:${MAIL.ink700};">${escapeHtml(note)}</p>
        </td></tr>`
        : '') +
      button(link, 'Revise your price');

    const text = [
      `We would like to revisit ${po.poNumber}.`,
      '',
      ...(askedTotal != null ? [`  Our target  ${money(askedTotal)}`] : []),
      ...(note ? ['', note] : []),
      '',
      `  Revise here  ${link}`,
      '',
      `${business.name} · ${business.address.city}, ${business.address.region}`,
    ].join('\n');

    return await sendMail({
      to: supplier.email,
      from: env.MAIL_FROM_ADMIN,
      subject: subject ?? `We would like to revisit ${po.poNumber}`,
      html: shell({
        business,
        preheader: 'We would like to talk about the price.',
        title: 'About your price',
        intro: `Thank you for pricing <strong style="color:${MAIL.ink900};font-weight:600;">${escapeHtml(po.poNumber)}</strong>. Before we place it we would like to see whether there is any movement on the figure below.`,
        blocks,
        footerNote: `Reference ${escapeHtml(po.poNumber)}. Reply to this email and it reaches our purchasing team.`,
      }),
      text,
    });
  } catch (error) {
    console.error(
      `  Mail: negotiation for ${supplier?.email} could not be built - ${error.message}`,
    );
    return { delivered: false, via: null, error: error.message };
  }
}

/**
 * The non-email channels, where the supplier has consented to them.
 *
 * **Nothing sends yet, and this says so rather than pretending.** There is no
 * Twilio or WhatsApp client anywhere in this codebase - `marketingService`'s
 * own adapters declare `delivers: () => false` for both, so credentials can be
 * saved on the API Keys screen and still transmit nothing (§6b U3, phase 13).
 *
 * So this returns `false` **always**, and the negotiation round records only the
 * channels that genuinely carried the message. That matters more here than on
 * the customer side: a round claiming it was WhatsApped is a fact a buyer would
 * act on - they would stop chasing, believing the supplier had been reached.
 * The message is logged so the intent is not lost, and wiring a real client
 * later is a change to this one function.
 *
 * `MessageLog` is deliberately not written: every row in it is keyed to a
 * `User`, and a supplier is not one (rule 4).
 */
async function sendSupplierMessage({ supplier, channel, po, askedTotal, note }) {
  // The business placing this order, not the house brand.
  const business = await sendingBusiness();
  const body = [
    `${business.name}: we would like to revisit ${po.poNumber}.`,
    askedTotal != null ? `Our target is ${money(askedTotal)}.` : null,
    note,
    `${await storefrontOrigin()}/supplier/orders/${po._id ?? po.id}`,
  ]
    .filter(Boolean)
    .join(' ');

  console.warn(
    `  Purchase: ${channel} to ${supplier?.name ?? 'supplier'} not sent - no ${channel} client is wired up. Message was: ${body}`,
  );
  return false;
}

/**
 * Tell the purchasing desk that a supplier did something.
 *
 * A proforma invoice and a delivery update both arrive from **outside** the
 * panel, which is exactly the class of event nobody discovers on their own
 * the bell catches it, and this makes sure it also reaches somebody not looking
 * at the screen.
 */
async function sendPurchaseAdminAlert({ subject, po, supplierName, kind, status }) {
  const to = env.MAIL_FROM_ADMIN;
  if (!to) return { delivered: false, via: null, error: 'No admin address configured.' };

  try {
    // The business placing this order, not the house brand - a supplier who
    // deals with two businesses on one platform must see which one is writing.
    const business = await sendingBusiness();
    const origin = await staffPanelOrigin();
    const link = `${origin}/admin/purchase-orders/${po._id ?? po.id}`;

    const intro =
      kind === 'proforma'
        ? `<strong style="color:${MAIL.ink900};font-weight:600;">${escapeHtml(supplierName ?? 'A supplier')}</strong> has issued a proforma invoice against ${escapeHtml(po.poNumber)}. It is on the order for review.`
        : `<strong style="color:${MAIL.ink900};font-weight:600;">${escapeHtml(supplierName ?? 'A supplier')}</strong> has updated the delivery on ${escapeHtml(po.poNumber)}${status ? ` - now ${escapeHtml(String(status).replace('_', ' '))}` : ''}.`;

    const text = [
      subject,
      '',
      `  Purchase order  ${po.poNumber}`,
      `  Supplier        ${supplierName ?? '-'}`,
      ...(status ? [`  Delivery        ${String(status).replace('_', ' ')}`] : []),
      '',
      `  Open  ${link}`,
    ].join('\n');

    return await sendMail({
      to,
      from: env.MAIL_FROM_ADMIN,
      subject,
      html: shell({
        business,
        preheader: subject,
        title: kind === 'proforma' ? 'Proforma invoice received' : 'Delivery update',
        intro,
        blocks:
          detailTable([
            ['Purchase order', po.poNumber, false],
            ['Supplier', supplierName ?? '-', false],
            ...(status ? [['Delivery', String(status).replace('_', ' '), true]] : []),
          ]) + button(link, 'Open the order'),
        footerNote: 'You are receiving this because you handle purchasing.',
      }),
      text,
    });
  } catch (error) {
    console.error(`  Mail: purchase admin alert could not be built - ${error.message}`);
    return { delivered: false, via: null, error: error.message };
  }
}

export {
  sendSupplierPortalInvite,
  sendSupplierResetEmail,
  sendPurchaseOrderInvitation,
  sendPurchaseOrderOutcome,
  sendNegotiationEmail,
  sendSupplierMessage,
  sendPurchaseAdminAlert,
};
