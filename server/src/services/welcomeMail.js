import crypto from 'node:crypto';
import env from '../config/env.js';
import { sendMail } from './mailer.js';
import { sendingBusiness } from './sendingBusiness.js';
import { displayNameOf } from '../utils/displayName.js';
import { storefrontOrigin } from './linkOrigins.js';

/**
 * The welcome email, for both ways an account comes into being.
 *
 * A business that registers itself chose its own password and must never be
 * sent one; an account an admin opened has a password the customer has never
 * seen, so something has to carry it to them. Both get the same message with
 * the same shape - one of them has a credentials block, the other does not.
 *
 * Sent from `MAIL_FROM_ADMIN`, not `MAIL_FROM`. A welcome arriving from the
 * billing desk is the wrong address to reply to.
 *
 * **The generated password travels in the message body.** That is a deliberate
 * decision taken with the client, and it has a real cost: mail is stored
 * plaintext in the recipient's mailbox and on any server that relays it, so the
 * password remains readable there for as long as the message is kept. The email
 * therefore tells the customer to change it and links straight to the page
 * where they can. If that tradeoff is ever revisited, the fix is a one-time
 * set-password link - the customer sets a secret that was never transmitted
 * and this file is the only place that would need to change.
 *
 * Called fire-and-forget: the account is already written by the time this runs,
 * and a dead SMTP host must not turn a registration into an error. Every path
 * resolves, the same contract `notifications.js` keeps.
 */

// Unambiguous alphabet, for the same reason `referralService` uses one: this
// password gets read off a screen and retyped by somebody who did not choose
// it. No O/0, no I/l/1. Symbols are drawn from a small set that survives being
// read aloud and does not need escaping in a shell or a URL.
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%*?';
const LENGTH = 14;

/**
 * A password that satisfies `passwordSchema` by construction.
 *
 * One letter, one digit and one symbol are placed first and the remainder drawn
 * from the full alphabet, then the whole thing is shuffled - generating at
 * random and re-rolling until it happens to pass would occasionally loop, and
 * the schema is what the account is validated against on every later change.
 */
function generatePassword() {
  const all = LETTERS + DIGITS + SYMBOLS;
  const pick = (set) => set[crypto.randomInt(set.length)];

  const chars = [pick(LETTERS), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < LENGTH) chars.push(pick(all));

  // Fisher-Yates with a CSPRNG, so the guaranteed letter/digit/symbol are not
  // always sitting in the first three positions.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * The email.
 *
 * Built to the same rules as the storefront rather than as a generic template:
 * Archivo-then-system for display text, the ink/line greys from the design
 * tokens, and the brand gradient used once as a hairline rather than as a
 * coloured header band. Tables and inline styles throughout because that is
 * what mail clients render reliably; Outlook ignores flexbox and most clients
 * strip <style> blocks.
 *
 * The one deliberate exception to the storefront palette is the credentials
 * block, which is the only thing in the message the reader must not miss.
 */
/**
 * The palette and type scale both messages are built from.
 *
 * These used to be declared inside each renderer, so the welcome mail and the
 * password-reset mail each carried their own copy - and they had already
 * diverged: different card radii, different greys, twelve font sizes between
 * them with several a half-pixel apart. Mail cannot import a stylesheet, but
 * that is an argument for defining the values once in the module, not for
 * writing them out per element.
 */
const MAIL = {
  display: "'Archivo','Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif",
  body: "'Inter','Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif",
  mono: "ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace",

  ink900: '#18181b',
  ink500: '#5c5c66',
  ink300: '#9b9ba5',
  line: '#e7e7ea',
  surface2: '#f7f7f8',
  brand: '#CF3429',

  /* Six steps, mirroring the client's scale. */
  micro: '11px',
  small: '12px',
  base: '14px',
  lead: '15px',
  title: '20px',
  hero: '26px',

  /* Two radii: the card, and everything inside it. */
  radiusCard: '14px',
  radiusInner: '10px',
};

function renderHtml({ user, password, origin, approved, business }) {
  const account = `${origin}/account`;
  const security = `${origin}/account/company`;

  const { display, body, mono, ink900, ink500, ink300, line, surface2 } = MAIL;

  const row = (label, value, isMono) => `
        <tr>
          <td style="padding:11px 16px;border-top:1px solid ${line};font:400 ${MAIL.small}/1.4 ${body};color:${ink500};white-space:nowrap;">${label}</td>
          <td style="padding:11px 16px;border-top:1px solid ${line};font:${isMono ? `700 ${MAIL.lead}/1.4 ${mono};letter-spacing:0.4px` : `600 ${MAIL.base}/1.4 ${body}`};color:${ink900};">${value}</td>
        </tr>`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Welcome to ${escapeHtml(business.name)}</title></head>
<body style="margin:0;padding:0;background:${surface2};">
  <!-- Preheader: the line inboxes show beside the subject. Hidden in the body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${password ? 'Your sign-in details are inside.' : 'Your account is with our team for review.'}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${surface2};">
    <tr><td align="center" style="padding:32px 16px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${line};border-radius:${MAIL.radiusCard};overflow:hidden;">

        <!-- The gradient as a hairline rule: accent, not a filled header.

             It ran red-to-black, which is the brand ramp backwards, so the rule
             faded to black at its right end - and because the card clips its
             corners, that dark end was cut by the radius and read as a printing
             fault rather than as a brand mark. Black-to-red is the direction the
             brand sheet shows. The COMPACT ramp, though, starting at the deep
             red rather than at the near-black: across a 3px rule the full
             gradient spends its first third in something indistinguishable from
             black, which reads as a dark stub bolted to one end rather than as
             depth. Same identity, no stub - this mirrors bg-brand-gradient-compact
             in the client, which exists for exactly this reason. -->
        <tr><td style="height:3px;line-height:3px;font-size:0;background:${MAIL.brand};">
          <div style="height:3px;background:linear-gradient(90deg,#8f221b 0%,#cf3429 55%,#e8564a 100%);">&nbsp;</div>
        </td></tr>

        <tr><td style="padding:36px 36px 8px;">
          <div style="font:700 ${MAIL.micro}/1 ${display};letter-spacing:0.14em;text-transform:uppercase;color:${ink300};">
            ${escapeHtml(business.name)}
          </div>
          <h1 style="margin:14px 0 0;font:700 ${MAIL.hero}/1.2 ${display};letter-spacing:-0.02em;color:${ink900};">
            ${password ? 'Your account is ready' : 'Thanks for signing up'}
          </h1>
          <p style="margin:12px 0 0;font:400 ${MAIL.base}/1.65 ${body};color:${ink500};">
            ${
              password
                ? `We have opened a wholesale account for <strong style="color:${ink900};font-weight:600;">${escapeHtml(displayNameOf(user))}</strong>. Everything you need to sign in is below.`
                : `We have received the application for <strong style="color:${ink900};font-weight:600;">${escapeHtml(displayNameOf(user))}</strong> and our team is reviewing it now.`
            }
          </p>
        </td></tr>

        ${
          password
            ? `
        <!-- Credentials. The one block in the message that must not be missed. -->
        <tr><td style="padding:26px 36px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${line};border-radius:${MAIL.radiusInner};overflow:hidden;">
            <tr><td colspan="2" style="padding:12px 16px;background:${surface2};font:700 ${MAIL.micro}/1 ${display};letter-spacing:0.13em;text-transform:uppercase;color:${ink300};">
              Sign-in details
            </td></tr>
            ${row('Email', escapeHtml(user.email), false)}
            ${row('Password', escapeHtml(password), true)}
          </table>

          ${/*
              A quiet note, not a red panel.

              This was a filled pink block in danger red, sitting directly above
              the sign-in button - so the loudest thing in the message was a
              caveat, and the action the message exists to prompt was the
              quieter of the two. The warning is real and it stays, but nothing
              here is wrong yet: the reader is being told what to do afterwards,
              which is a note, not an error.

              A left rule in brand plus ink text carries it without competing:
              it is plainly a callout, and the button beside it is plainly the
              thing to press.
            */''}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:${surface2};border-left:3px solid ${MAIL.brand};border-radius:0 ${MAIL.radiusInner} ${MAIL.radiusInner} 0;">
            <tr><td style="padding:12px 14px;font:400 ${MAIL.small}/1.6 ${body};color:${ink500};">
              This password is written in this email. Anyone who can read the message can sign in as
              you, so please change it once you are in and delete this afterwards.
            </td></tr>
          </table>
        </td></tr>`
            : ''
        }

        <!-- Bulletproof-ish button: a padded table cell, not a styled <div>. -->
        <tr><td style="padding:26px 36px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr><td style="border-radius:${MAIL.radiusInner};background:${MAIL.brand};">
              <a href="${password ? origin : account}" style="display:inline-block;padding:13px 26px;font:600 ${MAIL.base}/1 ${display};color:#ffffff;text-decoration:none;">
                ${password ? `Sign in to ${escapeHtml(business.name)}` : 'Go to your dashboard'}
              </a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 36px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${line};">
            <tr><td style="padding-top:20px;font:400 ${MAIL.base}/1.65 ${body};color:${ink500};">
              ${
                approved
                  ? 'Your account is approved, so wholesale pricing and ordering are live the moment you sign in.'
                  : 'Approval usually takes one business day. You can sign in and browse now; wholesale pricing and ordering unlock once our team has verified your business.'
              }
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:20px 36px 34px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font:400 ${MAIL.small}/2 ${body};color:${ink500};">
                ${password ? `Change your password &nbsp;<a href="${security}" style="color:${MAIL.brand};text-decoration:none;font-weight:600;">${security.replace(/^https?:\/\//, '')}</a><br />` : ''}
                Your dashboard &nbsp;<a href="${account}" style="color:${MAIL.brand};text-decoration:none;font-weight:600;">${account.replace(/^https?:\/\//, '')}</a>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td style="padding:18px 36px 0;text-align:center;font:400 ${MAIL.micro}/1.7 ${body};color:${ink300};">
          ${escapeHtml(business.name)} &nbsp;·&nbsp; ${escapeHtml(business.address.city)}, ${escapeHtml(business.address.region)}<br />
          You are receiving this because an account was opened for this address.
          Reply to this email and it reaches our team.
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}

function renderText({ user, password, origin, approved, business }) {
  const lines = [
    password
      ? `Your ${business.name} account is ready`
      : `Thanks for signing up to ${business.name}`,
    '',
    password
      ? `We have opened a wholesale account for ${displayNameOf(user)}.`
      : `We have received the application for ${displayNameOf(user)} and our team is reviewing it now.`,
    '',
  ];

  if (password) {
    lines.push(
      'SIGN-IN DETAILS',
      `  Email     ${user.email}`,
      `  Password  ${password}`,
      '',
      'This password is written in this email. Anyone who can read the message can',
      'sign in as you, so please change it once you are in and delete this afterwards.',
      '',
      `  Sign in          ${origin}/`,
      `  Change password  ${origin}/account/company`,
    );
  } else {
    lines.push(`  Your dashboard   ${origin}/account`);
  }

  lines.push(
    '',
    approved
      ? 'Your account is approved, so wholesale pricing and ordering are live the moment you sign in.'
      : 'Approval usually takes one business day. You can sign in and browse now; wholesale pricing and ordering unlock once our team has verified your business.',
    '',
    `${business.name} · ${business.address.city}, ${business.address.region}`,
    'Reply to this email and it reaches our team.',
  );

  return lines.join('\n');
}

/**
 * Emails a welcome.
 *
 * `password` is omitted for a self-registered account - that buyer chose their
 * own and must never be sent one back. Passing it switches the message to the
 * credentials variant. Never throws.
 */
async function sendWelcomeEmail({ user, password = null }) {
  if (!user?.email) return { delivered: false, via: null, error: 'No email address on file.' };

  try {
    // A customer's welcome: their business's storefront (see `linkOrigins`).
    const origin = await storefrontOrigin();
    const approved = user.status === 'approved';
    /**
     * The business the account was opened with, not the house brand.
     *
     * The subject line is the half that shows in an inbox before anything is
     * opened, and it said "Cellvix" to every customer of every business - so a
     * repair customer of CellShoppe was told their account with a wholesaler
     * they have never dealt with was ready. That reads as phishing, and a
     * customer who treats it as phishing never opens the mail that carries
     * their password.
     */
    const business = await sendingBusiness();

    return await sendMail({
      to: user.email,
      from: env.MAIL_FROM_ADMIN,
      subject: password
        ? `Your ${business.name} account is ready`
        : `Welcome to ${business.name}`,
      html: renderHtml({ user, password, origin, approved, business }),
      text: renderText({ user, password, origin, approved, business }),
    });
  } catch (error) {
    console.error(`  Mail: welcome email for ${user?.email} could not be built - ${error.message}`);
    return { delivered: false, via: null, error: error.message };
  }
}

/**
 * The password reset email.
 *
 * Lives here rather than in its own file because it shares this one's palette,
 * shell and the "never throws" contract - the account state is already written
 * by the time it runs, and a dead SMTP host must not turn a reset request into
 * an error the caller reports back to a form.
 *
 * **The link is the secret.** Unlike the welcome mail there is no password in
 * the body: the token in the URL is single-use and expires, so a message left
 * sitting in a mailbox stops working on its own. The copy says so, because a
 * reset link that arrived unrequested is how somebody learns an attacker has
 * their address.
 */
async function sendPasswordResetEmail({ user, token, origin, business = null, expiresMinutes = 60 }) {
  if (!user?.email || !token) {
    return { delivered: false, via: null, error: 'No email address or token.' };
  }

  try {
    const base = origin || env.publicOrigin;
    // `business` names the database holding the account. The reset page sends
    // it back so the token is looked up where its hash actually lives - on the
    // shared admin host that is rarely the business the host resolves to.
    const link =
      `${base}/reset-password?token=${encodeURIComponent(token)}` +
      (business ? `&business=${encodeURIComponent(business)}` : '');
    // The business whose account this password opens - see `sendWelcomeEmail`.
    const business = await sendingBusiness();

    const { display, body, ink900, ink500, ink300, line, surface2 } = MAIL;

    const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${surface2};">
  <!-- Preheader: the line inboxes show beside the subject. Hidden in the body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Choose a new password. The link expires in ${expiresMinutes} minutes.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${surface2};">
    <tr><td align="center" style="padding:32px 16px;">

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${line};border-radius:${MAIL.radiusCard};overflow:hidden;">

      <!-- The same brand hairline the welcome mail carries. -->
      <tr><td style="height:3px;line-height:3px;font-size:0;background:${MAIL.brand};">
        <div style="height:3px;background:linear-gradient(90deg,#8f221b 0%,#cf3429 55%,#e8564a 100%);">&nbsp;</div>
      </td></tr>

      <tr><td style="padding:36px 36px 8px;">
        <div style="font:700 ${MAIL.micro}/1 ${display};letter-spacing:0.14em;text-transform:uppercase;color:${ink300};">
          ${escapeHtml(business.name)}
        </div>
      </td></tr>

      <tr><td style="padding:0 36px;">
        <h1 style="margin:14px 0 0;font:700 ${MAIL.hero}/1.2 ${display};letter-spacing:-0.02em;color:${ink900};">Reset your password</h1>
        <p style="margin:12px 0 0;font:400 ${MAIL.base}/1.65 ${body};color:${ink500};">
          Somebody asked to reset the password for
          <strong style="color:${ink900};font-weight:600;">${escapeHtml(user.email)}</strong>.
          Use the button below within ${expiresMinutes} minutes.
        </p>
      </td></tr>

      <tr><td style="padding:24px 36px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:${MAIL.radiusInner};background:${MAIL.brand};">
            <a href="${link}" style="display:inline-block;padding:13px 26px;font:600 ${MAIL.base}/1 ${display};color:#ffffff;text-decoration:none;">
              Choose a new password
            </a>
          </td>
        </tr></table>
      </td></tr>

      <tr><td style="padding:20px 36px 32px;">
        <p style="margin:0 0 10px;font:400 ${MAIL.small}/1.7 ${body};color:${ink500};">
          If the button does not work, paste this into your browser:<br />
          <span style="color:${MAIL.brand};word-break:break-all;">${escapeHtml(link)}</span>
        </p>
        <p style="margin:0;font:400 ${MAIL.small}/1.7 ${body};color:${ink500};">
          <strong style="color:${ink900};font-weight:600;">If you did not ask for this</strong>, you can
          ignore this email - your password stays as it is, and the link stops working on its own.
        </p>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="padding:18px 36px 0;text-align:center;font:400 ${MAIL.micro}/1.7 ${body};color:${ink300};">
        ${escapeHtml(business.name)} &nbsp;·&nbsp; ${escapeHtml(business.address.city)}, ${escapeHtml(business.address.region)}<br />
        This link expires in ${expiresMinutes} minutes and can only be used once.
      </td></tr>
    </table>

  </td></tr></table>
</body></html>`;

    const text = [
      `Reset your ${business.name} password`,
      '',
      `Somebody asked to reset the password for ${user.email}.`,
      `Open this link within ${expiresMinutes} minutes to choose a new one:`,
      '',
      `  ${link}`,
      '',
      'If you did not ask for this, ignore this email - your password stays as it',
      'is, and the link stops working on its own.',
    ].join('\n');

    return await sendMail({
      to: user.email,
      from: env.MAIL_FROM_ADMIN,
      subject: `Reset your ${business.name} password`,
      html,
      text,
    });
  } catch (error) {
    console.error(`  Mail: reset email for ${user?.email} could not be built - ${error.message}`);
    return { delivered: false, via: null, error: error.message };
  }
}

/**
 * `MAIL` and `escapeHtml` are exported for `supplierMail.js`, which builds the
 * portal-invite and request-for-quote messages.
 *
 * Exported rather than copied for the reason the palette was hoisted out of the
 * two renderers below in the first place: a second file with its own greys and
 * its own radii is a second design, and the two drift the first time either is
 * touched. This is the closest thing mail has to a stylesheet.
 */
export { generatePassword, sendWelcomeEmail, sendPasswordResetEmail, MAIL, escapeHtml };
export default sendWelcomeEmail;
