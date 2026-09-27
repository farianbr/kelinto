import { db, controlModels } from '../db/models.js';
import '../models/Settings.js';
import '../models/PlatformSettings.js';
import { businessConfig } from '../middleware/businessConfigCache.js';
import { urlOf } from '../services/storageService.js';
import { migrateColorToken, paletteCss, paletteFor } from '../../../shared/businessPalette.js';

/**
 * Whose page this is: its title, its icon and its colours, decided per host
 * before the browser draws anything.
 *
 * ## Why the server writes it
 *
 * `index.html` is one file for every host. Before this it carried Cellvix's
 * title, Cellvix's favicon and Cellvix red in `theme-color`, so every business's
 * website opened in another company's name and colour and then repainted once
 * the app had asked who it was. Written here, the first frame is already right:
 *
 * - a **website** (and plain `localhost`) wears its business: the business's
 *   name as the title, its uploaded favicon, and its colour ramp as CSS
 *   variables on `:root`, so every `bg-brand` is the business's colour before
 *   any script runs;
 * - the **ERP** on a business's own ERP domain wears that business too;
 * - **Kelinto's** own hosts (the landing page, the shared ERP sign-in, the
 *   console) wear Kelinto's favicon and name.
 *
 * Nothing set means a neutral placeholder icon, never another company's.
 *
 * Read once a minute per business, not per page: these change when an owner
 * edits them, and the settings screens clear the entry when they do.
 */

const PLACEHOLDER_FAVICON = '/placeholder-favicon.svg';
const TTL_MS = 60_000;

const businessCache = new Map();
let platformCache = null;

function forgetBusinessIdentity(businessId = null) {
  if (businessId) businessCache.delete(String(businessId));
  else businessCache.clear();
}

function invalidatePlatformIdentity() {
  platformCache = null;
}

async function platformIdentity() {
  if (platformCache && Date.now() - platformCache.at < TTL_MS) return platformCache.value;
  const settings = await controlModels().PlatformSettings.load().catch(() => null);
  const value = {
    title: 'Kelinto',
    description: 'Kelinto: one ERP and website for service and retail businesses.',
    favicon: urlOf(settings?.faviconUrl) || PLACEHOLDER_FAVICON,
    themeColor: '#0f5e62',
    paletteCss: null,
  };
  platformCache = { at: Date.now(), value };
  return value;
}

async function businessIdentity(businessId) {
  const key = String(businessId);
  const hit = businessCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const [config, settings] = await Promise.all([
    businessConfig(businessId),
    db().Settings.findOne({ key: 'singleton' }).select('business').lean().catch(() => null),
  ]);
  if (!config || config.deletedAt) return null;

  const token = migrateColorToken(config.colorToken);
  const name = config.name || settings?.business?.name || 'Welcome';
  const tagline = settings?.business?.tagline ?? '';
  const value = {
    title: tagline ? `${name} · ${tagline}` : name,
    description: tagline || `${name}. Shop online.`,
    favicon: urlOf(settings?.business?.faviconUrl) || PLACEHOLDER_FAVICON,
    themeColor: paletteFor(token).base,
    paletteCss: paletteCss(token),
  };
  businessCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * The identity for this request's host. Business surfaces fall back to
 * Kelinto's identity only when no business can be read at all.
 */
async function pageIdentity(req) {
  const businessSurface =
    req.surface === 'storefront' || req.surface === 'any' || req.hostEntry?.role === 'panel';
  if (businessSurface && req.businessScope) {
    const identity = await businessIdentity(req.businessScope).catch(() => null);
    if (identity) return identity;
  }
  return platformIdentity();
}

/** HTML-escape for text and attribute positions alike. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The shell with this host's identity written in. The placeholders it
 * replaces are the ones `client/index.html` ships; anything the page does not
 * carry is added before `</head>`.
 *
 * The colour block is plain declarations built from the fixed palette list,
 * never from anything a person typed, so it cannot carry markup.
 */
function injectIdentity(html, identity) {
  const tags = [
    `<title>${escapeHtml(identity.title)}</title>`,
    `<meta name="description" content="${escapeHtml(identity.description)}" />`,
    `<meta name="theme-color" content="${escapeHtml(identity.themeColor)}" />`,
    `<link rel="icon" href="${escapeHtml(identity.favicon)}" />`,
    identity.paletteCss ? `<style data-business-theme="page">:root{${identity.paletteCss}}</style>` : '',
  ].join('');

  return html
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, '')
    .replace(/<meta\s+name="theme-color"[^>]*\/>/, '')
    .replace(/<link\s+rel="icon"[^>]*\/>/, '')
    .replace('</head>', `${tags}</head>`);
}

export { pageIdentity, injectIdentity, forgetBusinessIdentity, invalidatePlatformIdentity, PLACEHOLDER_FAVICON };
