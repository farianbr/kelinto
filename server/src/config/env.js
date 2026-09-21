import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// One .env at the repo root serves both workspaces.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '..', '..', '..', '.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Required: there is no in-memory fallback (PROJECT_INSTRUCTIONS.md §8).
  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required - there is no in-memory fallback')
    .refine((uri) => uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'), {
      message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://',
    }),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  /**
   * The session cookie's name.
   *
   * **Defaults to the platform, not to tenant #1.** An existing deployment sets
   * this explicitly in its own `.env` and keeps whatever name its live sessions
   * were issued under - changing the name does not migrate a session, it
   * invalidates every one at once and logs out every customer, admin and
   * supplier on the next deploy. So the default moved and deployments did not.
   */
  COOKIE_NAME: z.string().default('kelinto_session'),

  /**
   * The prefix every platform database name is built from (SAAS_PLATFORM §0.1).
   *
   * **The platform is Kelinto; Cellvix is tenant #1's product business.** Every
   * database name derives from this one constant: `<prefix>_control` holds
   * tenants, plans and super admins, `<prefix>_biz_<code>` holds one business's
   * records.
   *
   * **Changing this does not rename anything.** It changes which databases the
   * process opens, and a database does not follow its name - point a running
   * installation at a new prefix and it opens empty databases beside the full
   * ones, which looks exactly like total data loss and is not recoverable by
   * changing the value back mid-write.
   *
   * So the default names the platform for **fresh installations**, and every
   * existing deployment pins its own prefix in `.env` and keeps the databases it
   * has. Renaming a live installation is a copy-verify-switch migration, and
   * deliberately not a config edit.
   */
  DB_PREFIX: z.string().trim().min(1).default('kelinto'),

  // Encrypts provider credentials at rest (§6.15, phase 11c). Optional: with it
  // unset, `utils/secrets.js` derives a key from JWT_SECRET through scrypt, so
  // an existing deployment keeps working without a config change.
  //
  // **Rotating either one makes every stored secret undecryptable** - by design,
  // not by accident. `decrypt` then returns null, the affected provider reports
  // itself unconfigured, and the keys have to be re-entered. That is the right
  // failure: the alternative is a key that silently decrypts to garbage and
  // gets sent to a provider.
  //
  // An **empty** `SECRETS_KEY=` in .env means "unset", not "a zero-length key":
  // .env.example ships the name with no value, and a bare `.optional()` would
  // read that as a present-but-too-short string and refuse to boot.
  SECRETS_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined)
    .refine((value) => value === undefined || value.length >= 16, {
      message: 'SECRETS_KEY must be at least 16 characters, or empty to derive one from JWT_SECRET',
    }),

  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  /**
   * Origins allowed by wildcard, comma separated, as `*.example.com`.
   *
   * **Why a wildcard at all.** Every business answers on its own subdomain
   * (SAAS_PLATFORM §4.2), so a fixed allowlist means adding a tenant is an env
   * edit plus a restart - a deployment step per customer, on the one action the
   * super-admin console is supposed to make self-service.
   *
   * Only the subdomain label is wildcarded, never the registrable domain: one
   * label, no dots, so `*.kelinto.com` admits `shop.kelinto.com` and refuses
   * `kelinto.com.attacker.example`. A tenant on a **custom** domain is still an
   * explicit `CLIENT_ORIGIN` entry, deliberately - a domain we do not control
   * is not one a pattern should admit sight unseen.
   */
  CORS_WILDCARD_ORIGINS: z.string().default(''),

  // Opt-in: makes the MOCK gateway decline every charge, so the payment-failure
  // page can be exercised end to end. Off by default - see services/payment.js.
  // ---- outbound mail ------------------------------------------------
  // Optional, but nothing can be emailed without it. With no SMTP_URL the
  // mailer logs each message as a failure instead of sending - the order still
  // completes either way, so a missing mail server can never fail a checkout.
  SMTP_URL: z.string().optional(),
  /**
   * The envelope sender, and **only** the envelope sender.
   *
   * This names the platform because it is one SMTP account for the whole
   * installation - the address mail is relayed through, not the business the
   * message is from. Who a message is *from* is resolved per business by
   * `services/sendingBusiness.js` and rendered in the subject, the body and the
   * footer; a deployment whose tenants each want their own envelope address
   * needs a per-business SMTP account, which this single value cannot express.
   */
  MAIL_FROM: z.string().default('Kelinto <billing@kelinto.com>'),
  // Account mail - a welcome, credentials, anything about the account itself
  // rather than money. A message telling somebody their account is open should
  // not arrive from the billing desk: the reply goes to whoever handles
  // accounts, and "billing" on a welcome is the wrong address to reply to.
  MAIL_FROM_ADMIN: z.string().default('Kelinto <admin@kelinto.com>'),
  // Where a link in an email should point. Defaults to the first CLIENT_ORIGIN.
  PUBLIC_ORIGIN: z.string().optional(),

  // ---- messaging providers (ERP rework §6b, U3–U4) ------------------
  // All optional and all absent today. `marketingService` reads these to decide
  // whether a channel can actually send: with none set, SMS and WhatsApp log
  // every message as `queued_unconfigured` and each screen says so, rather than
  // reporting a send that never happened. Setting them is what phase 13 does.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),

  MOCK_PAYMENT_DECLINE: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Crash loudly and specifically - a half-configured server is worse than none.
  console.error('\n  Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\n  Copy .env.example to .env and fill it in.\n');
  process.exit(1);
}

/**
 * `*.example.com` -> a matcher for ONE subdomain label of that domain.
 *
 * The rules are deliberately strict, because this decides who may read
 * authenticated responses:
 *
 *   - the scheme must match, so an `https://*.kelinto.com` rule never admits
 *     a plaintext origin;
 *   - the label is one segment with **no dots**, so `a.kelinto.com` passes and
 *     `a.b.kelinto.com` does not - and, far more importantly, neither does
 *     `kelinto.com.attacker.example`, which a naive `endsWith` would wave
 *     straight through;
 *   - the label must be non-empty, so the bare apex is not admitted by a rule
 *     about its subdomains. List the apex explicitly in `CLIENT_ORIGIN` when it
 *     should be allowed.
 */
function wildcardMatcher(pattern) {
  const trimmed = pattern.trim();
  if (!trimmed) return null;

  const match = /^(https?:\/\/)?\*\.(.+)$/.exec(trimmed);
  if (!match) return null;

  const scheme = match[1] ?? null;
  const domain = match[2].toLowerCase().replace(/\/+$/, '');

  return (origin) => {
    let url;
    // An origin that does not parse is not one to reason about.
    try {
      url = new URL(origin);
    } catch {
      return false;
    }

    if (scheme && `${url.protocol}//` !== scheme) return false;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

    const host = url.hostname.toLowerCase();
    if (!host.endsWith(`.${domain}`)) return false;

    const label = host.slice(0, -(domain.length + 1));
    return label.length > 0 && !label.includes('.');
  };
}

const wildcardMatchers = parsed.data.CORS_WILDCARD_ORIGINS.split(',')
  .map(wildcardMatcher)
  .filter(Boolean);

const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  origins: parsed.data.CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  publicOrigin:
    parsed.data.PUBLIC_ORIGIN ||
    parsed.data.CLIENT_ORIGIN.split(',')[0].trim(),
};

/**
 * May this origin read authenticated responses?
 *
 * A **listed** origin first, then a wildcard subdomain of a domain we control.
 * Everything else is refused.
 *
 * A missing origin is allowed: same-origin requests, `curl`, server-to-server
 * calls and health checks send no `Origin` header at all, and the browser only
 * enforces CORS where it sends one. Refusing those would break the storefront
 * the moment it is served from the same host as the API, which is exactly how
 * this is deployed.
 */
env.isAllowedOrigin = function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (env.origins.includes(origin)) return true;
  return wildcardMatchers.some((matches) => matches(origin));
};

if (env.isProd && env.JWT_SECRET.includes('dev-only')) {
  console.error('\n  Refusing to start: JWT_SECRET is still the development placeholder.\n');
  process.exit(1);
}

export { env };
export default env;
