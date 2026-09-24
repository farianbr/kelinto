import env from '../config/env.js';

/**
 * Which application a host serves (CONSOLIDATE_AND_ROUTING §1).
 *
 * - `platform`   - the bare platform domain. Kelinto's own landing page.
 * - `superadmin` - `SUPERADMIN_HOST`. The super admin panel, and nothing else.
 * - `panel`      - `PANEL_HOST`. Every tenant's admin panel behind one sign-in.
 * - `storefront` - any other named host: a business's subdomain or its custom
 *                  domain. Everything a business's own customers use.
 * - `any`        - neither switch is on, or the host names nothing
 *                  (`localhost`, a bare IP). Every route, as before.
 *
 * Decided by the server because only the server knows the two hosts, and sent
 * to the client in the page itself (`injectSurface`) so the router knows before
 * its first render - a request to ask would be a flash of the wrong app.
 */
function hostOf(hostHeader) {
  return String(hostHeader ?? '')
    .toLowerCase()
    .split(':')[0]
    .trim();
}

function isUnnamed(host) {
  return !host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

function surfaceFor(hostHeader) {
  const host = hostOf(hostHeader);

  if (!env.PANEL_HOST && !env.SUPERADMIN_HOST) return 'any';
  if (isUnnamed(host)) return 'any';
  if (env.SUPERADMIN_HOST && host === env.SUPERADMIN_HOST) return 'superadmin';
  if (env.PANEL_HOST && host === env.PANEL_HOST) return 'panel';
  /**
   * The bare platform domain - `kelinto.com`, and `www.` in front of it - is
   * the platform's own front page, not a business's shop. Only once the split
   * is on: before that the apex is where the default business has always been
   * served, and moving it would take a live storefront off the air.
   */
  if (env.storefrontDomain && (host === env.storefrontDomain || host === `www.${env.storefrontDomain}`)) {
    return 'platform';
  }
  return 'storefront';
}

/**
 * The page shell with the surface written into it, as `<meta>` tags.
 *
 * Meta tags rather than an inline script: the CSP set by `helmet` refuses
 * inline scripts, and a value the page only has to READ does not need to run.
 * The two hosts travel with it so a page can send a path to the host that owns
 * it. Values are the server's own - never the request's - so nothing typed into
 * a Host header is written into the page.
 */
function injectSurface(html, hostHeader) {
  const tags = [
    `<meta name="app-surface" content="${surfaceFor(hostHeader)}" />`,
    env.PANEL_HOST && `<meta name="app-panel-host" content="${env.PANEL_HOST}" />`,
    env.SUPERADMIN_HOST && `<meta name="app-superadmin-host" content="${env.SUPERADMIN_HOST}" />`,
  ]
    .filter(Boolean)
    .join('');
  return html.replace('</head>', `${tags}</head>`);
}

/**
 * Paths under `/api/superadmin` that are NOT the super admin's own.
 *
 * Leaving a support session is called from the panel, by the operator who
 * stepped in - it ends a session that lives on the panel host, so it has to be
 * answered there.
 */
const SUPERADMIN_API_EXCEPTIONS = ['/impersonation/leave'];

/**
 * The super admin API answers on the super admin host only.
 *
 * **The reason the super admin has its own host is that it reaches every tenant**,
 * so a request for it arriving anywhere else is refused - 404, the same answer
 * as a path that does not exist, so a storefront host does not even confirm the
 * super admin is here. Off while `SUPERADMIN_HOST` is unset.
 *
 * Mounted on `/api/superadmin`, so `req.path` is the remainder.
 */
function superAdminHostOnly(req, res, next) {
  if (!env.SUPERADMIN_HOST) return next();
  if (SUPERADMIN_API_EXCEPTIONS.includes(req.path)) return next();
  if (hostOf(req.get('host')) === env.SUPERADMIN_HOST) return next();
  return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
}

/**
 * The same answer as the tags, as data - for development only.
 *
 * In development Vite serves the page, not this server, so nothing writes the
 * tags; the client asks this once at start-up instead (`main.jsx`) and writes
 * them itself. Production never mounts it: there the tags arrive in the page,
 * before any script runs.
 */
function surfaceInfo(hostHeader) {
  return {
    surface: surfaceFor(hostHeader),
    panelHost: env.PANEL_HOST || null,
    superAdminHost: env.SUPERADMIN_HOST || null,
  };
}

export { superAdminHostOnly, injectSurface, surfaceFor, surfaceInfo };
