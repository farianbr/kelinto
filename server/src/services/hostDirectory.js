import Business from '../models/Business.js';
import env from '../config/env.js';
import { isReservedSubdomain } from '../../../shared/hosts.js';

/**
 * Every hostname this installation answers on, and what each one is.
 *
 * **The one place a host is looked up.** Business resolution, the page's
 * surface, CORS and the TLS gate all ask the same question - "is this host
 * ours, and whose?" - and each used to answer it its own way: resolution from
 * the database, CORS from `CLIENT_ORIGIN`, TLS from an nginx `server_name`
 * somebody edited by hand. A custom domain then needed three separate acts
 * before it worked, two of them on the server. Now it needs the database row,
 * which the super admin console writes.
 *
 * A host is one of:
 *
 * - **a platform host** - `PANEL_HOST`, `SUPERADMIN_HOST`, the platform apex
 *   and its `www.`. Configured, never stored.
 * - **a business's storefront** - `<slug>.<platform>` or `Business.domain`.
 * - **a business's own panel** - `Business.panelDomain`, the ERP on an address
 *   the business owns (`app.cellshoppe.ca`). Pinned to that one business.
 *
 * Lookups are cached per host, misses included, and dropped by
 * `resetHostDirectory` whenever an address changes.
 */

/** `Shop.Example.com:443` -> `shop.example.com`. */
function hostOf(hostHeader) {
  return String(hostHeader ?? '')
    .toLowerCase()
    .split(':')[0]
    .trim()
    .replace(/\.$/, '');
}

/** A host that names nothing: empty, `localhost`, or a bare IPv4 address. */
function isUnnamed(host) {
  return !host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

/** `shop.example.com` -> `shop`. Null when the host has no meaningful label. */
function subdomainOf(hostHeader) {
  const name = hostOf(hostHeader);
  if (!name || /^\d+\.\d+\.\d+\.\d+$/.test(name)) return null;

  const parts = name.split('.');
  /**
   * `cellshoppe.localhost` is a subdomain too. Browsers resolve every
   * `*.localhost` name to this machine without any setup (RFC 6761), which is
   * what lets the whole subdomain arrangement be exercised in development
   * exactly as it runs in production - only with `localhost` for the domain.
   */
  const local = parts.length === 2 && parts[1] === 'localhost';
  if (parts.length < 3 && !local) return null;

  const label = parts[0];
  // `www`, `app` and the rest are the platform's own surfaces, not a tenant.
  // See `shared/hosts.js` for why a business may never answer on one.
  if (isReservedSubdomain(label)) return null;
  return label;
}

/**
 * The business label of a host on the platform's own domain: exactly one label
 * in front of it, `cellshoppe.kelinto.com` -> `cellshoppe`.
 *
 * Once the platform domain is known, a slug answers there and nowhere else.
 * Otherwise `cellshoppe.anything-at-all.com`, pointed at this server by anybody,
 * would resolve to CellShoppe and pass the TLS gate below. `*.localhost` stays
 * accepted for development, and with no platform domain configured at all the
 * older any-host reading is kept.
 */
function platformLabelOf(host) {
  const apex = env.storefrontDomain;
  if (!apex || host.endsWith('.localhost')) return subdomainOf(host);
  if (!host.endsWith(`.${apex}`)) return null;
  const label = host.slice(0, -(apex.length + 1));
  if (!label || label.includes('.') || isReservedSubdomain(label)) return null;
  return label;
}

/** The hosts the platform answers on as itself. Read from config, so never cached. */
function isPlatformHost(host) {
  if (!host) return false;
  if (env.PANEL_HOST && host === env.PANEL_HOST) return true;
  if (env.SUPERADMIN_HOST && host === env.SUPERADMIN_HOST) return true;
  const apex = env.storefrontDomain;
  return Boolean(apex && (host === apex || host === `www.${apex}`));
}

/** host -> entry | null. */
const byHost = new Map();

/**
 * Which business a host belongs to, and in which role.
 *
 * Returns `{ businessId, role, name, panelDomain }` or null:
 *
 * - `role: 'panel'` - the host is that business's own `panelDomain`.
 * - `role: 'storefront'` - its custom `domain`, or `<slug>.<platform>`.
 *
 * `panelDomain` travels on a storefront entry too, so the storefront can send
 * `/admin` to the business's own panel rather than the shared one.
 *
 * A custom domain is matched before a slug, because a business that bought a
 * domain means it more than it means the handle we gave it.
 */
async function lookupHost(hostHeader) {
  const host = hostOf(hostHeader);
  if (isUnnamed(host)) return null;
  if (byHost.has(host)) return byHost.get(host);

  const fields = '_id name domain panelDomain';
  // Two reads rather than one `$or`, so an exact domain always wins over a
  // slug that happens to match the same host's first label.
  let found = await Business.findOne({
    deletedAt: null,
    $or: [{ domain: host }, { panelDomain: host }],
  })
    .select(fields)
    .lean();

  /**
   * A slug answers only under the platform's own domain once one is known.
   * Otherwise `cellshoppe.anything-at-all.com`, pointed at this server by
   * anybody, would resolve to CellShoppe and pass the TLS gate below.
   */
  const sub = found ? null : platformLabelOf(host);
  if (sub) {
    found = await Business.findOne({ deletedAt: null, $or: [{ slug: sub }, { code: sub }] })
      .select(fields)
      .lean();
  }

  const entry = found
    ? {
        businessId: String(found._id),
        role: found.panelDomain === host ? 'panel' : 'storefront',
        name: found.name,
        panelDomain: found.panelDomain ?? null,
      }
    : null;

  // Cached even when null, so a request for an unknown host does not re-read
  // the collection on every retry.
  byHost.set(host, entry);
  return entry;
}

/**
 * Does this installation serve this host?
 *
 * **The TLS gate.** Caddy's on-demand TLS asks this before requesting a
 * certificate for a host it has never seen (`/api/internal/tls-allowed`), so a
 * certificate exists for exactly the hosts a business or the platform answers
 * on. Without the check, anybody pointing a domain at the server could make it
 * request certificates until Let's Encrypt rate-limits the whole installation.
 */
async function isServedHost(hostHeader) {
  const host = hostOf(hostHeader);
  if (isUnnamed(host)) return false;
  if (isPlatformHost(host)) return true;
  return Boolean(await lookupHost(host));
}

/**
 * May this origin read authenticated responses because a business answers on it?
 *
 * The CORS half of the same rule. `env.isAllowedOrigin` covers configured
 * origins and the platform wildcard; this covers every custom domain and panel
 * domain a super admin has saved, so a new one needs no `CLIENT_ORIGIN` edit
 * and no restart. HTTPS only in production: a custom domain served over plain
 * http is not one a session should be readable from.
 */
async function isBusinessOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (env.isProd && url.protocol !== 'https:') return false;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return Boolean(await lookupHost(url.hostname));
}

/** Forget every cached host. After any address change, and for tests. */
function resetHostDirectory() {
  byHost.clear();
}

export {
  hostOf,
  isUnnamed,
  subdomainOf,
  isPlatformHost,
  lookupHost,
  isServedHost,
  isBusinessOrigin,
  resetHostDirectory,
};
