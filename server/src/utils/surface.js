import env from '../config/env.js';
import { hostOf, isUnnamed, lookupHost } from '../services/hostDirectory.js';

/**
 * Which application a host serves (CONSOLIDATE_AND_ROUTING §1).
 *
 * - `platform`   - the bare platform domain. Kelinto's own landing page.
 * - `superadmin` - `SUPERADMIN_HOST`. The super admin panel, and nothing else.
 * - `panel`      - `PANEL_HOST`, every tenant's admin panel behind one sign-in;
 *                  or a business's own `panelDomain`, that business's alone.
 * - `storefront` - any other named host: a business's subdomain or its custom
 *                  domain. Everything a business's own customers use.
 * - `any`        - no split is configured, or the host names nothing
 *                  (`localhost`, a bare IP). Every route, as before.
 *
 * Decided by the server because only the server knows the hosts, and sent to
 * the client in the page itself (`injectSurface`) so the router knows before
 * its first render - a request to ask would be a flash of the wrong app.
 *
 * `entry` is the host's `lookupHost` answer. Every host a business answers on
 * comes from the database, so adding one needs no config and no restart.
 */
function surfaceFor(hostHeader, entry = null) {
  const host = hostOf(hostHeader);

  if (env.SUPERADMIN_HOST && host === env.SUPERADMIN_HOST) return 'superadmin';
  if (env.PANEL_HOST && host === env.PANEL_HOST) return 'panel';
  if (entry?.role === 'panel') return 'panel';

  // With no split configured anywhere - no shared panel host, no super admin
  // host, and no panel domain of this business's own - every host is still
  // every route, exactly as before the split existed.
  const split = env.PANEL_HOST || env.SUPERADMIN_HOST || entry?.panelDomain;
  if (!split || isUnnamed(host)) return 'any';

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
 * Where this host's `/admin` lives.
 *
 * A business with a panel domain of its own sends its storefront's `/admin`
 * there, and its panel domain keeps every panel link on itself. Everything else
 * uses the shared `PANEL_HOST`, or nothing when there is none.
 */
function panelHostFor(entry) {
  return entry?.panelDomain || env.PANEL_HOST || null;
}

/**
 * Work out the host once per request: `req.hostEntry` (whose host it is) and
 * `req.surface` (which application it serves).
 *
 * Mounted ahead of `resolveBusiness`, which reads `req.hostEntry` to pin a
 * business's panel domain before anything else can name a business.
 */
async function attachSurface(req, _res, next) {
  try {
    req.hostEntry = await lookupHost(req.get('host'));
  } catch (error) {
    // A lookup failing must not take the site down: the host is then simply
    // unrecognised, which is how it behaved before this existed.
    console.error(`  Host lookup failed - ${error.message}`);
    req.hostEntry = null;
  }
  req.surface = surfaceFor(req.get('host'), req.hostEntry);
  next();
}

/** Attribute-safe: a business name is typed by a person and lands inside `content="..."`. */
function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * What the page is told about its host, as `name -> content`.
 *
 * `app-panel-business` names the business a pinned panel domain belongs to, so
 * its sign-in page greets that business instead of the platform.
 */
function surfaceTags(req) {
  const entry = req.hostEntry ?? null;
  const pinned = entry?.role === 'panel';
  return {
    'app-surface': req.surface ?? surfaceFor(req.get('host'), entry),
    'app-panel-host': panelHostFor(entry),
    'app-superadmin-host': env.SUPERADMIN_HOST || null,
    'app-panel-business': pinned ? entry.name : null,
  };
}

/**
 * The page shell with the surface written into it, as `<meta>` tags.
 *
 * Meta tags rather than an inline script: the CSP set by `helmet` refuses
 * inline scripts, and a value the page only has to READ does not need to run.
 * The hosts travel with it so a page can send a path to the host that owns
 * it. Values are the server's own - never the request's - so nothing typed into
 * a Host header is written into the page.
 */
function injectSurface(html, req) {
  const tags = Object.entries(surfaceTags(req))
    .filter(([, content]) => content)
    .map(([name, content]) => `<meta name="${name}" content="${escapeAttribute(content)}" />`)
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
 * super admin is here. Off while `SUPERADMIN_HOST` is unset, except on a
 * business's own panel domain: a host the business owns never serves the
 * operator console, split or no split.
 *
 * Mounted on `/api/superadmin`, so `req.path` is the remainder.
 */
function superAdminHostOnly(req, res, next) {
  if (SUPERADMIN_API_EXCEPTIONS.includes(req.path)) return next();
  const notFound = () =>
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  if (req.hostEntry?.role === 'panel') return notFound();
  if (!env.SUPERADMIN_HOST) return next();
  if (hostOf(req.get('host')) === env.SUPERADMIN_HOST) return next();
  return notFound();
}

/**
 * The same answer as the tags, as data - for development only.
 *
 * In development Vite serves the page, not this server, so nothing writes the
 * tags; the client asks this once at start-up instead (`main.jsx`) and writes
 * them itself. Production never mounts it: there the tags arrive in the page,
 * before any script runs.
 */
function surfaceInfo(req) {
  const tags = surfaceTags(req);
  return {
    surface: tags['app-surface'],
    panelHost: tags['app-panel-host'],
    superAdminHost: tags['app-superadmin-host'],
    panelBusiness: tags['app-panel-business'],
  };
}

export { attachSurface, superAdminHostOnly, injectSurface, surfaceFor, surfaceInfo };
