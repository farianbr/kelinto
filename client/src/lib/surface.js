/**
 * Which application this host is (server/src/utils/surface.js).
 *
 * Read from the `<meta>` tags the server writes into the page, once, at load.
 * Constant for the life of the page: a host does not change what it is while
 * somebody is looking at it.
 *
 * In development Vite serves the page and writes no tags, so this answers
 * `any` and every route stays reachable on one `localhost` - which is what
 * development needs, since there is no second host to send anybody to.
 */
function readMeta(name) {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || null;
}

const SURFACES = new Set(['platform', 'superadmin', 'panel', 'storefront', 'any']);

const surface = SURFACES.has(readMeta('app-surface')) ? readMeta('app-surface') : 'any';

/** The admin panel's host, when that split is on. */
const panelHost = readMeta('app-panel-host');

/** The super admin panel's host, when that split is on. */
const superAdminHost = readMeta('app-superadmin-host');

/**
 * The same path on another of the platform's hosts.
 *
 * Built from the server's own values, never from the current URL's host, so a
 * link somebody crafted cannot turn this into a redirect to anywhere else. With
 * no host configured the path is returned as it is - callers only redirect when
 * the host exists, and a redirect to the same path would loop.
 */
function urlOn(host, pathAndQuery) {
  if (!host) return pathAndQuery;
  // The page's own protocol and port: every platform host is served the same
  // way, so `https://app.kelinto.com` in production and
  // `http://app.localhost:5173` in development both come out right.
  const { protocol, port } = window.location;
  return `${protocol}//${host}${port ? `:${port}` : ''}${pathAndQuery}`;
}

const panelUrl = (pathAndQuery) => urlOn(panelHost, pathAndQuery);
const superAdminUrl = (pathAndQuery) => urlOn(superAdminHost, pathAndQuery);

export { superAdminHost, superAdminUrl, panelHost, panelUrl, surface };
