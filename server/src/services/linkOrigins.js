import env from '../config/env.js';
import { currentBusinessId } from '../db/context.js';
import { businessConfig } from '../middleware/businessConfigCache.js';

/**
 * Which origin a link the SERVER builds should point at, by who it is for.
 *
 * Every emailed link, the customer portal and the "Pay now" on an invoice used
 * to be built on `env.publicOrigin`, one address for the whole installation.
 * That held while every host served every page. It stops holding once the
 * hosts split (`PANEL_HOST`, `SUPERADMIN_HOST`): the platform apex becomes
 * Kelinto's landing page, the panel host serves only the panel, and a
 * business's storefront answers on its own address. A customer's "Open your
 * account" link built on the apex then opened the landing page, and a
 * supplier's order link missed the panel host the portal lives on.
 *
 * So each link says who it is for:
 *   - `storefrontOrigin()` - a CUSTOMER or a SUPPLIER: the business's own
 *     website address, custom domain first, then `<slug>.<platform>`. That is
 *     where `/account`, `/portal`, `/unsubscribe`, every website page and the
 *     supplier portal (`/supplier`, one portal per business) live.
 *   - `staffPanelOrigin()` - STAFF: the business's own panel domain when it
 *     has one, else the shared panel host.
 *   - `panelOrigin()` - the shared ERP host, for links that belong to no one
 *     business (a support session, a tenant owner's invitation).
 * Both fall back to `env.publicOrigin` when nothing more specific is
 * configured, which is exactly the old behaviour - so an installation with no
 * split changes nothing.
 */

/**
 * The storefront origin of one business's config (`businessConfig`), or null
 * when it has no address at all. The one place this rule lives.
 *
 * A custom domain is the default once it is live; before that it may not
 * resolve yet, so the subdomain that already works is used instead.
 */
function originOfStorefront(business) {
  if (!business || business.deletedAt) return null;
  if (business.domain && business.domainLive) return env.originFor(business.domain);
  if (business.slug && env.storefrontDomain) {
    return env.originFor(`${business.slug}.${env.storefrontDomain}`);
  }
  if (business.domain) return env.originFor(business.domain);
  return null;
}

/** The storefront origin of a business (the current one by default). */
async function storefrontOrigin(businessId = currentBusinessId()) {
  if (!businessId) return env.publicOrigin;
  return originOfStorefront(await businessConfig(businessId)) ?? env.publicOrigin;
}

/** The shared ERP host, for a link that belongs to no one business. */
function panelOrigin() {
  return env.PANEL_HOST ? env.originFor(env.PANEL_HOST) : env.publicOrigin;
}

/**
 * Where a business's STAFF sign in: its own panel domain once it is live
 * (`Business.panelDomain`, `panelDomainLiveAt`), else the shared panel host. A CellShoppe low-stock
 * alert should open app.cellshoppe.ca, the address its staff actually use.
 */
async function staffPanelOrigin(businessId = currentBusinessId()) {
  if (businessId) {
    const business = await businessConfig(businessId);
    if (business?.panelDomainLive && !business.deletedAt) return env.originFor(business.panelDomain);
  }
  return panelOrigin();
}

export { originOfStorefront, storefrontOrigin, panelOrigin, staffPanelOrigin };
export default { originOfStorefront, storefrontOrigin, panelOrigin, staffPanelOrigin };
