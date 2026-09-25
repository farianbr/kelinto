import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { matchAdminRoute } from '@/lib/adminRoutes';
import { getBusinessName, subscribeBusiness } from '@/store/businessStore';

/**
 * The browser tab's title, per route (Instructions 3.1).
 *
 * Every page shipped the one static title from `index.html`, so a browser with
 * six Cellvix tabs open showed six identical labels - and the tab strip is the
 * only navigation a person has once the window is behind something else. It is
 * also what a bookmark and a history entry are named by, so "Cellvix" was the
 * name of every page anybody had ever saved.
 *
 * **Titles come from the route table, not from each page.** `ADMIN_ROUTES`
 * already carries a `title` for all 65 admin screens and already knows how to
 * resolve `/admin/clients/abc123` back to `/admin/clients/:id` - teaching every
 * page to set its own would have meant 65 near-identical effects that could
 * drift from the breadcrumb beside them. The other three surfaces get their own
 * small maps below for the same reason.
 *
 * **A record's own name wins where a page knows it.** A list is "Clients"; one
 * client is that person. `title` overrides the route's label so a detail screen
 * can name its record, which is the case where a tab strip earns the most
 * four open invoices are otherwise four tabs reading "Invoice".
 *
 * ```js
 * useDocumentTitle();                     // the route's own title
 * useDocumentTitle(invoice?.number);      // this record, once it loads
 * ```
 */

/**
 * What each surface is called, and the suffix its pages carry.
 *
 * `admin` and `supplier` are built from the business being worked in rather
 * than fixed. A tenant switched to CellShoppe read "Invoices - Cellvix Admin"
 * in the tab strip, and the tab strip is the one place a second open window
 * says which shop it belongs to. `shop` keeps the wholesaler's own name
 * because the storefront is always Cellvix, and `superadmin` wears the
 * platform's name because it sits above every business rather than inside one.
 */
const SUFFIX = {
  superadmin: 'Kelinto Console',
  shop: 'Cellvix',
};

/** The business-scoped surfaces, and what each is called after the name. */
const SCOPED_SUFFIX = {
  admin: 'Admin',
  supplier: 'Suppliers',
};

/**
 * The three surfaces `ADMIN_ROUTES` does not cover.
 *
 * Small enough to be a literal map: these are fixed route sets that change when
 * somebody adds a screen, and a missing entry falls back to the surface name
 * rather than to nothing.
 */
const SUPPLIER_TITLES = {
  '/supplier': 'Dashboard',
  '/supplier/orders': 'Purchase orders',
  '/supplier/proformas': 'Proforma invoices',
  '/supplier/deliveries': 'Deliveries',
  '/supplier/profile': 'Profile',
  '/supplier/login': 'Sign in',
};

const SUPERADMIN_TITLES = {
  '/superadmin': 'Overview',
  '/superadmin/tenants': 'Tenants',
  '/superadmin/businesses': 'Businesses',
  '/superadmin/domains': 'Domains',
  '/superadmin/plans': 'Plans',
  '/superadmin/support': 'Support',
  '/superadmin/access': 'Access log',
  '/superadmin/login': 'Sign in',
};

/**
 * A console record page, named for its kind: `/superadmin/tenants/<id>/owners`
 * reads "Tenant". The record's own name is on the page; an id in a browser tab
 * helps nobody pick the right tab.
 */
const SUPERADMIN_RECORDS = [
  ['/superadmin/tenants/', 'Tenant'],
  ['/superadmin/businesses/', 'Business'],
  ['/superadmin/plans/', 'Plan'],
  ['/superadmin/support/', 'Conversation'],
];

/**
 * The storefront.
 *
 * `/` is the one route that carries the plain business name with no page label
 * in front of it - a tab reading "Home - Cellvix" on the site's front door reads
 * like a subsection of itself. The catalogue moved to `/shop` and takes a label
 * like every other page.
 */
const SHOP_TITLES = {
  '/': null,
  '/shop': 'Shop all parts',
  '/clearance': 'Stock clearance',
  '/cart': 'Cart',
  '/checkout': 'Checkout',
  '/payment-failed': 'Payment failed',
  '/about': 'About',
  '/contact': 'Contact',
  '/offers': 'Combo deals',
  '/blog': 'Blog',
  '/faq': 'FAQ',
  '/login': 'Sign in',
  '/register': 'Create an account',
  '/forgot-password': 'Reset your password',
  '/reset-password': 'Choose a new password',
  '/account': 'Your account',
  '/account/orders': 'Your orders',
  '/account/invoices': 'Your invoices',
  '/account/credit': 'Credit',
  '/account/activity': 'Activity',
  '/account/referrals': 'Referrals',
  '/account/quick-order': 'Quick order',
  '/account/addresses': 'Addresses',
  '/account/payment-methods': 'Payment methods',
  '/account/company': 'Company details',
};

/** Which surface a pathname belongs to. */
function surfaceOf(pathname) {
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/supplier')) return 'supplier';
  if (pathname.startsWith('/superadmin')) return 'superadmin';
  return 'shop';
}

/**
 * The page's own label, before the suffix - `null` for a page that should carry
 * the bare business name.
 */
function labelFor(pathname, surface) {
  const clean = pathname.replace(/\/+$/, '') || '/';

  if (surface === 'admin') {
    const match = matchAdminRoute(clean);
    return match?.title ?? match?.label ?? 'Admin';
  }

  if (surface === 'superadmin') {
    return SUPERADMIN_TITLES[clean] ?? SUPERADMIN_RECORDS.find(([prefix]) => clean.startsWith(prefix))?.[1] ?? null;
  }
  if (surface === 'supplier') {
    if (SUPPLIER_TITLES[clean]) return SUPPLIER_TITLES[clean];
    // `/supplier/orders/<id>` - the record's own number arrives as `title`
    // from the page; without it, name the section rather than the id.
    if (clean.startsWith('/supplier/orders/')) return 'Purchase order';
    return null;
  }

  // The storefront's two record routes, whose pages pass their own `title`.
  if (clean.startsWith('/product/')) return 'Product';
  if (clean.startsWith('/blog/')) return 'Blog';
  if (clean.startsWith('/thank-you/')) return 'Order confirmed';
  return SHOP_TITLES[clean] ?? null;
}

/**
 * Sets `document.title` for as long as this component is mounted.
 *
 * `title` names the record this screen is showing and wins over the route's
 * label. Pass `undefined` while it is still loading - the route's own label is
 * shown meanwhile, which is a better placeholder than a tab that says
 * "undefined" for a beat.
 */
export function useDocumentTitle(title) {
  const { pathname } = useLocation();

  /*
    Subscribed rather than read inside the effect: switching business does not
    change the route or the record, so an effect keyed only on those would keep
    the previous shop's name in the tab until the next navigation.
  */
  const businessName = useSyncExternalStore(subscribeBusiness, getBusinessName, getBusinessName);

  useEffect(() => {
    const surface = surfaceOf(pathname);
    const label = title || labelFor(pathname, surface);
    const scoped = SCOPED_SUFFIX[surface];
    const suffix = scoped ? `${businessName || 'Cellvix'} ${scoped}` : SUFFIX[surface];

    // A plain hyphen, not an em dash: a tab strip truncates hard, and the
    // separator is doing structural work rather than punctuating a sentence.
    document.title = label ? `${label} - ${suffix}` : suffix;
  }, [pathname, title, businessName]);
}

export default useDocumentTitle;
