/**
 * Subdomain labels the platform keeps for itself (CONSOLIDATE_AND_ROUTING §1).
 *
 * Each business answers on `<slug>.<platform>`, and the platform's own surfaces
 * live on the same domain: the admin panel on `app.`, the API possibly on
 * `api.`, and so on. **A business must never be able to take one of these as
 * its slug.** A tenant holding `app` would receive every request meant for the
 * shared admin login, which is every tenant's staff typing their password into
 * a page that business controls.
 *
 * Two readers, so one list:
 *
 * - `resolveBusiness` treats these labels as naming no business, the way it
 *   has always treated `www`.
 * - Anything that assigns a business slug refuses them.
 *
 * Deliberately broader than what is deployed today. Reserving a label nobody
 * uses costs nothing; un-reserving one a tenant already holds means asking them
 * to move.
 */
const RESERVED_SUBDOMAINS = Object.freeze([
  'www',
  'app',
  'api',
  'admin',
  'superadmin',
  'supplier',
  'suppliers',
  'kiosk',
  'mail',
  'email',
  'smtp',
  'status',
  'help',
  'support',
  'docs',
  'static',
  'assets',
  'cdn',
]);

const RESERVED = new Set(RESERVED_SUBDOMAINS);

/** Is this label one the platform keeps for itself? Case-insensitive. */
function isReservedSubdomain(label) {
  return RESERVED.has(String(label ?? '').trim().toLowerCase());
}

/**
 * A slug is one DNS label: what a business answers on as `<slug>.<platform>`.
 *
 * Lowercase letters, digits and inner hyphens, 2 to 40 characters. DNS allows
 * 63, but a storefront address somebody has to read aloud over the phone is not
 * helped by the extra 23, and a hyphen at either end is not a valid label.
 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;

/** Why this slug cannot be used, or null when it can. */
function businessSlugProblem(slug) {
  const value = String(slug ?? '').trim();
  if (!value) return 'Give the business a web address.';
  if (value !== value.toLowerCase()) return 'Use lowercase letters only.';
  if (!SLUG_PATTERN.test(value)) {
    return 'Use 2 to 40 lowercase letters, digits or hyphens, not starting or ending with a hyphen.';
  }
  if (isReservedSubdomain(value)) return `"${value}" is kept for the platform. Choose another.`;
  return null;
}

/**
 * The slug a business name suggests: "Northline Repairs & Co." -> `northline-repairs-co`.
 *
 * One function for both sides, so the address the console previews while
 * somebody types is exactly the one the server assigns when they leave the field
 * alone. Cut to 40 and re-trimmed, because a cut can land on a hyphen.
 */
function suggestSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/**
 * Whatever somebody pasted, reduced to the bare hostname.
 *
 * People paste `https://www.example.com/` from the address bar far more often
 * than they type `www.example.com`, and refusing the paste teaches them nothing
 * the form could not have done for them. The `www.` is kept: it is a different
 * host, and which one they pointed at us is their decision.
 */
function normaliseDomain(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Why this custom domain cannot be used, or null when it can.
 *
 * `platformDomains` are the domains this installation answers on as itself
 * (`env.platformDomains` on the server). A business's domain may be neither one
 * of them nor sit beneath one - `resolveBusiness` tries custom domains before
 * anything else, so a business given `app.<platform>` would receive the shared
 * admin login. A subdomain of the platform is what a SLUG is for.
 */
function customDomainProblem(domain, platformDomains = []) {
  const value = normaliseDomain(domain);
  if (!value) return null;
  if (!DOMAIN_PATTERN.test(value)) return 'Enter a domain like shop.example.com.';
  const owned = platformDomains.find((base) => value === base || value.endsWith(`.${base}`));
  if (owned) return `Addresses on ${owned} are set with the web address above, not as a custom domain.`;
  return null;
}

export {
  RESERVED_SUBDOMAINS,
  businessSlugProblem,
  customDomainProblem,
  isReservedSubdomain,
  normaliseDomain,
  suggestSlug,
};
