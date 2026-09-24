import env from '../config/env.js';

/**
 * Mail sent by Kelinto itself, not by any business on it.
 *
 * Almost everything the platform sends is a BUSINESS's mail and goes through
 * `sendingBusiness` (CLAUDE.md: "a document or an email is sent by a business,
 * never by the platform"). The exceptions are messages about an account that
 * spans businesses - a supplier's platform-wide login is the first - where no
 * one business is the sender and naming one would be wrong.
 *
 * ## The address
 *
 * `MAIL_FROM_PLATFORM` when it is set, e.g. `Kelinto <no-reply@kelinto.com>`.
 * Until then the display name is Kelinto and the address is the one the SMTP
 * account already sends as (`MAIL_FROM_ADMIN`). That is deliberate: a From
 * address on a domain the SMTP server is not authorised for fails the
 * receiving server's SPF/DMARC checks and lands in spam, so the address has to
 * stay on the server's own domain until a kelinto.com mailbox exists.
 */
function platformFrom() {
  if (env.MAIL_FROM_PLATFORM) return env.MAIL_FROM_PLATFORM;
  const address = /<([^>]+)>/.exec(env.MAIL_FROM_ADMIN)?.[1] ?? env.MAIL_FROM_ADMIN;
  return `Kelinto <${address}>`;
}

/**
 * The identity a mail frame prints for the platform. Shaped like the object
 * `sendingBusiness` returns, so the same templates can carry it; the address is
 * empty because Kelinto has none to print, and the frames leave it out.
 */
const PLATFORM_IDENTITY = Object.freeze({
  name: 'Kelinto',
  address: Object.freeze({ city: '', region: '' }),
});

export { PLATFORM_IDENTITY, platformFrom };
