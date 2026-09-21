/**
 * Thin fetch wrapper for the Cellvix API.
 *
 * Every error the server raises arrives as `{ error: { code, message } }`
 * (PROJECT_INSTRUCTIONS.md §5.1). This normalises that into an ApiError so callers
 * can branch on `err.code` - never on message text.
 */

import { getBusiness } from '@/store/businessStore';

const BASE = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  constructor(message, { code = 'UNKNOWN', status = 0, fields = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

/**
 * Paths where the admin's business selection is a real instruction.
 *
 * The panel's own calls, and `/auth/me` - which carries the feature set back,
 * and a business's type is what decides which sections exist
 * (SAAS_PLATFORM §1.1). Without the scope on that one call the sidebar would
 * never change, however many admin lists switched correctly underneath it.
 *
 * Everything else - the catalogue, the cart, checkout, `/auth/login`,
 * `/auth/register` - is customer-facing and belongs to the business the HOST
 * names. Sending a selection there lets a panel session somebody opened once
 * redirect a shopper's browser into another business. See `buildUrl`.
 *
 * `/kiosk` is deliberately absent: it is its own application on its own
 * session and adopts its business from the URL, not from the panel's store.
 */
const SELECTABLE = ['/admin', '/auth/me'];

function isSelectable(path) {
  return SELECTABLE.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
}

function buildUrl(path, params) {
  const url = `${BASE}${path}`;

  /**
   * The selected business rides on every admin request.
   *
   * Injected here rather than at each call site because there are well over a
   * hundred of them, and one that forgot would silently show another shop's
   * data - the kind of bug nobody notices until the figures are wrong. The
   * server decides what to do with it: most admin lists scope by it, a few
   * (the catalogue, settings) deliberately do not.
   *
   * Only `/admin` paths **and `/auth/me`**, and never when a caller passed its
   * own `business` - the customer profile asks for one account's records across
   * all businesses, and the switcher must not narrow that.
   *
   * `/auth/me` is on the list because the **feature set** comes back with the
   * session, and a business's type is what decides which sections exist
   * (SAAS_PLATFORM §1.1). Without the scope on this one call the server would
   * resolve the union on every request and the sidebar would never change,
   * however many admin lists switched correctly underneath it.
   */
  /**
   * **Every path, not only `/admin`** (SAAS_PLATFORM §4.2).
   *
   * The storefront used to send no business at all, which is why a checkout
   * order was written with none and vanished from an admin list scoped to one.
   * In production the host resolves the business server-side and this parameter
   * is redundant; in development everything runs on one `localhost`, where
   * there is no host to read - so the selected business travels with the
   * request instead.
   *
   * `/superadmin` is the exception: the console is a platform application that
   * sits above every business, and scoping it to one would be meaningless.
   *
   * ## Why the host wins in production, and this does not
   *
   * The admin selection is in `localStorage`, which outlives the session that
   * set it: it survives sign-out, and it is shared by every tab on the origin.
   * So a staff member who opened CellShoppe in the panel once had that id
   * attached to **every** later request from that browser - including the
   * storefront's, and including `/auth/login`.
   *
   * Because `?business=` outranks the host in `resolveBusiness`, that turned a
   * correctly-routed production request into a request for another business:
   * the shop rendered CellShoppe's 12 shelf parts (none of which have photos,
   * so the grid was *empty*), and `buyer@cellvix.ca` was rejected as a bad
   * credential because `User` is per-business and that account is not in
   * CellShoppe's database. Both read as application bugs and neither mentions
   * the business.
   *
   * So the parameter is now sent only where it is a genuine selection - the
   * panel and the session call that shapes it - and never on a customer-facing
   * request, where the host is the authority and is already right. Development
   * keeps the old behaviour for every path, because on one `localhost` there
   * is no host to read and the selection is the only answer available.
   */
  const scopedPath = !path.startsWith('/superadmin') && (import.meta.env.DEV || isSelectable(path));
  const business = scopedPath ? getBusiness() : null;
  const scoped = business && !(params && 'business' in params) ? { ...params, business } : params;

  if (!scoped) return url;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(scoped)) {
    if (value === null || value === undefined || value === '' || value === false) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request(path, { method = 'GET', body, params, signal } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      // The session is an httpOnly cookie - it must ride along on every call.
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    throw new ApiError('Could not reach the server. Check your connection.', {
      code: 'NETWORK_ERROR',
    });
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (response.ok) return response;
    throw new ApiError('Unexpected response from the server.', {
      code: 'BAD_RESPONSE',
      status: response.status,
    });
  }

  const payload = await response.json();

  if (!response.ok) {
    const err = payload?.error || {};
    throw new ApiError(err.message || 'Something went wrong.', {
      code: err.code || 'UNKNOWN',
      status: response.status,
      fields: err.fields || null,
    });
  }

  return payload;
}

/**
 * The absolute URL of an API path, for the places a browser has to fetch it
 * rather than this wrapper - a link the user opens in a new tab, an <img src>.
 *
 * **It goes through `buildUrl`, so the selected business rides along.** It used
 * to be a bare template string, which meant every document opened this way -
 * the account statement, an invoice PDF, a proforma - asked the server for a
 * record without saying which business it belonged to. Under
 * database-per-business the server then looked in the default business's
 * database and answered `USER_NOT_FOUND` for a customer sitting on the screen
 * that raised the link.
 *
 * A new tab carries no headers of ours and no way to intercept the request, so
 * the scope has to be in the URL itself. This is the same `?business=` every
 * `api.get` already sends; the two cannot now disagree.
 */
export const apiUrl = (path, params) => buildUrl(path, params);

export const api = {
  get: (path, params, options) => request(path, { ...options, params }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export default api;
