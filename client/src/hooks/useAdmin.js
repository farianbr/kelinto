import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from './useAuth';

/**
 * `range` is `{ from, to }` as inclusive `YYYY-MM-DD` days, or omitted for the
 * server's default window. It is part of the query key, so the sidebar's
 * unranged badges and the dashboard's ranged figures are cached separately
 * rather than overwriting each other.
 */
export function useAdminStats(range) {
  const { canUseAdmin } = useAuth();
  const params = {};
  if (range?.from) params.from = range.from;
  if (range?.to) params.to = range.to;

  return useQuery({
    queryKey: ['admin', 'stats', params],
    queryFn: () => api.get('/admin/stats', params),
    enabled: canUseAdmin,
    staleTime: 30 * 1000,
  });
}

export function useAdminUsers(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => api.get('/admin/users', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
    /**
     * Keep the previous response on screen while a new one loads.
     *
     * The status pills and the search box are part of the query key, so
     * changing one used to drop `data` to `undefined` for the length of the
     * round trip. Everything derived from it went with it - the counts on the
     * pills, the `Review N` button, the KPI figures - so the toolbar visibly
     * lost controls and then got them back, and the rows below jumped as the
     * header reflowed. Holding the last result means only the table body
     * changes, which is the only thing that actually did.
     */
    placeholderData: (previous) => previous,
  });
}

export function useAdminUser(id) {
  return useQuery({
    queryKey: ['admin', 'users', id],
    queryFn: () => api.get(`/admin/users/${id}`),
    enabled: Boolean(id),
  });
}

/** One account's store-credit statement, for the customer drawer. */
export function useAdminStoreCredit(id) {
  return useQuery({
    queryKey: ['admin', 'store-credit', id],
    queryFn: () => api.get(`/admin/users/${id}/store-credit`),
    enabled: Boolean(id),
  });
}

export function useAdminProducts(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'products', params],
    queryFn: () => api.get('/admin/products', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

export function useAdminOrders(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'orders', params],
    queryFn: () => api.get('/admin/orders', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

/**
 * One order, by number - the detail screen (phase 12).
 *
 * Keyed on the order number rather than an id, matching the route and the
 * endpoint: that is the identifier a packing slip and a customer email carry.
 */
export function useAdminOrder(orderNumber) {
  return useQuery({
    queryKey: ['admin', 'orders', 'one', orderNumber],
    queryFn: () => api.get(`/admin/orders/${orderNumber}`),
    enabled: Boolean(orderNumber),
  });
}

export function useAdminBlog(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'blog', params],
    queryFn: () => api.get('/admin/blog', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

/** The list payload omits `body`; the editor needs it, so it fetches one post. */
export function useAdminBlogPost(id) {
  return useQuery({
    queryKey: ['admin', 'blog', 'post', id],
    queryFn: () => api.get(`/admin/blog/${id}`),
    select: (payload) => payload.post,
    enabled: Boolean(id),
  });
}

export function useAdminFaqs(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'faqs', params],
    queryFn: () => api.get('/admin/faqs', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

/**
 * The SEO articles list: PRODUCTS, each with whatever article state it has.
 *
 * Driven from products rather than from articles because the staff member question
 * is "which parts still need one", and a list of articles cannot answer it.
 */
export function useAdminProductArticles(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'product-articles', params],
    queryFn: () => api.get('/admin/product-articles', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

/** Reviews, for moderation. Published on submission; this is the hide lever. */
export function useAdminReviews(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'reviews', params],
    queryFn: () => api.get('/admin/reviews', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

/** The editor: the product being written about, and its article if it has one. */
export function useAdminProductArticle(productId) {
  return useQuery({
    queryKey: ['admin', 'product-articles', 'one', productId],
    queryFn: () => api.get(`/admin/product-articles/${productId}`),
    enabled: Boolean(productId),
  });
}

export function useAdminOffers(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'offers', params],
    queryFn: () => api.get('/admin/offers', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

export function useAdminInvoices(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'invoices', params],
    queryFn: () => api.get('/admin/invoices', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

export function useAdminInvoice(number) {
  return useQuery({
    queryKey: ['admin', 'invoices', 'one', number],
    queryFn: () => api.get(`/admin/invoices/${number}`),
    enabled: Boolean(number),
  });
}

/** The Activity tab: orders, invoices, payments and credit movements, merged. */
export function useAdminUserActivity(id, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'users', id, 'activity'],
    queryFn: () => api.get(`/admin/users/${id}/activity`),
    enabled: Boolean(id) && enabled,
  });
}

/**
 * Every payment this customer has made.
 *
 * Its own query rather than a field on the profile: the profile caps invoices
 * at ten, and this reads across all of them. Fetched only on its own tab -
 * nothing else on the screen shows a payment row.
 */
export function useAdminUserPayments(id, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'users', id, 'payments'],
    queryFn: () => api.get(`/admin/users/${id}/payments`),
    enabled: Boolean(id) && enabled,
  });
}

/**
 * The customer's portal link.
 *
 * **Never fetched on render.** The URL is the credential and reading it is
 * audited, so an automatic fetch would write an audit row every time somebody
 * opened a profile and make the trail useless for its one purpose - answering
 * who had the link. It runs when an admin asks, and `rotate` is the revoke.
 */
export function useCustomerPortalLink(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rotate = false } = {}) =>
      api.get(`/admin/users/${id}/portal-link`, rotate ? { rotate: '1' } : undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users', id] }),
  });
}

/**
 * Mail the customer their own portal link.
 *
 * The server mints the link rather than taking one from here: the address it
 * sends to and the token it sends should come from one read of one record.
 */
export function useEmailCustomerPortalLink(id) {
  return useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/portal-link/email`),
  });
}

// ---- purchase (phase 5) -----------------------------------------------------

export function useAdminSuppliers(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'suppliers', params],
    queryFn: () => api.get('/admin/suppliers', params),
    enabled: canUseAdmin,
    staleTime: 30 * 1000,
  });
}

export function useAdminSupplier(id) {
  return useQuery({
    queryKey: ['admin', 'suppliers', 'one', id],
    queryFn: () => api.get(`/admin/suppliers/${id}`),
    enabled: Boolean(id),
  });
}

// ---- supplier bidding on a purchase order (§6.8a) ---------------------------

/** Every bid on one purchase order, with the comparison already ranked. */
export function useAdminPoBids(id) {
  return useQuery({
    queryKey: ['admin', 'purchase-orders', 'bids', id],
    queryFn: () => api.get(`/admin/purchase-orders/${id}/bids`),
    enabled: Boolean(id),
  });
}

/**
 * The supplier picker: who is tagged with these component types.
 *
 * Disabled until at least one type is chosen, because the endpoint answers with
 * nothing rather than everything - an empty filter must not put a hundred
 * suppliers in front of somebody who has not said what they are buying yet.
 */
export function useSuppliersForComponentTypes(componentTypes = []) {
  const { canUseAdmin } = useAuth();
  const types = componentTypes.filter(Boolean);

  return useQuery({
    queryKey: ['admin', 'purchase-orders', 'suppliers', types],
    queryFn: () => api.get('/admin/purchase-orders/suppliers', { componentTypes: types }),
    enabled: canUseAdmin && types.length > 0,
    staleTime: 60 * 1000,
  });
}

export function useAdminPurchaseOrders(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'purchase-orders', params],
    queryFn: () => api.get('/admin/purchase-orders', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

export function useAdminPurchaseOrder(id) {
  return useQuery({
    queryKey: ['admin', 'purchase-orders', 'one', id],
    queryFn: () => api.get(`/admin/purchase-orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useAdminExpenses(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'expenses', params],
    queryFn: () => api.get('/admin/expenses', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

/** Categories carry their usage count, so the UI can explain a refused delete
 *  before the staff member clicks it rather than after. */
/**
 * The repair service catalogue.
 *
 * Two callers with different needs, which is why the filters are arguments
 * rather than baked in: the settings screen lists everything including retired
 * rows, and the quote and ticket pickers want only what can be sold today,
 * narrowed to the device in front of them.
 *
 * Cached for a minute like the other reference lists - a price list changes a
 * few times a year, and refetching it on every keystroke in a picker would be
 * a request per character.
 */
/**
 * Repair estimates - the service side of the quotes list.
 *
 * A separate query from `useAdminQuotes` because they are separate models. The
 * quotes screen runs whichever of the two its business actually has, decided by
 * the `sales.services` feature flag: under database-per-business the two kinds
 * can never both exist, so this is a branch in the UI rather than a merge.
 */
export function useAdminServiceQuotes(params = {}) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'service-quotes', params],
    queryFn: () => api.get('/admin/service-quotes', params),
    enabled: canUseAdmin,
  });
}

export function useAdminServiceQuote(id) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'service-quotes', id],
    queryFn: () => api.get(`/admin/service-quotes/${id}`),
    enabled: canUseAdmin && Boolean(id),
  });
}

/**
 * The devices this shop takes in.
 *
 * Nested, and NOT the catalogue taxonomy - that tree counts products and
 * prunes any branch with none, which erases a repair list. Cached for a minute
 * like the other reference lists: a device tree changes when a new handset
 * launches, not per keystroke in a picker.
 */
export function useAdminDevices(params = {}) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'devices', params],
    queryFn: () => api.get('/admin/devices', params),
    enabled: canUseAdmin,
    staleTime: 60 * 1000,
  });
}
export function useAdminServices(params = {}) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'services', params],
    queryFn: () => api.get('/admin/services', params),
    enabled: canUseAdmin,
    staleTime: 60 * 1000,
  });
}

/**
 * The manual invoice status list.
 *
 * Pass `status: 'all'` on the settings screen, which is the only place a
 * retired label should appear - offering one in a picker puts it back on an
 * invoice. Everywhere else the default (active only) is what you want.
 */
export function useAdminInvoiceLabels(params = {}) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'invoice-labels', params],
    queryFn: () => api.get('/admin/invoice-labels', params),
    enabled: canUseAdmin,
    staleTime: 60 * 1000,
  });
}

export function useAdminExpenseCategories() {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'expense-categories'],
    queryFn: () => api.get('/admin/expenses/categories'),
    enabled: canUseAdmin,
    staleTime: 60 * 1000,
  });
}

/**
 * `enabled` is explicit because the purchase-order form needs the whole
 * catalogue to populate its product picker and nothing else on that screen
 * does - fetching 400+ rows to render a list of purchase orders is waste.
 */
export function useAdminInventory(params, enabled = true) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'inventory', params],
    queryFn: () => api.get('/admin/inventory', params),
    enabled: canUseAdmin && enabled,
    staleTime: 15 * 1000,
  });
}

export function useAdminInventoryItem(id) {
  return useQuery({
    queryKey: ['admin', 'inventory', 'one', id],
    queryFn: () => api.get(`/admin/inventory/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Everything at or below its reorder point, with the counts the bell shows.
 *
 * The same endpoint behind the notification's summary row and the Inventory
 * screen's reorder bar, deliberately: two screens computing "what needs buying"
 * separately is how a badge and the page it opens end up disagreeing.
 */
/**
 * The agreement templates authored in admin.
 *
 * Carries `supplierCount` and `signedCount` per template, so the screen can
 * say what publishing a revision would affect rather than leaving it to be
 * discovered after the click.
 */
export function useAdminAgreements(includeInactive = false) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'agreements', includeInactive],
    queryFn: () => api.get('/admin/agreements', includeInactive ? { all: '1' } : undefined),
    enabled: canUseAdmin,
  });
}

/** One supplier’s signed agreement, for their profile. */
export function useSupplierAgreement(supplierId) {
  return useQuery({
    queryKey: ['admin', 'suppliers', supplierId, 'agreement'],
    queryFn: () => api.get(`/admin/suppliers/${supplierId}/agreement`),
    enabled: Boolean(supplierId),
  });
}

/** One agreement, with the roster of suppliers holding it. */
export function useAdminAgreement(id) {
  return useQuery({
    queryKey: ['admin', 'agreements', 'one', id],
    queryFn: () => api.get(`/admin/agreements/${id}`),
    enabled: Boolean(id),
  });
}

export function useReorderQueue(enabled = true) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'inventory', 'reorder'],
    queryFn: () => api.get('/admin/inventory/reorder'),
    enabled: canUseAdmin && enabled,
    staleTime: 15 * 1000,
  });
}

// ---- quotes & RMA (phase 7) -------------------------------------------------

/**
 * Web quotes: enquiries the storefront contact form sent in.
 *
 * `undefined` params means the caller does not want the list yet - the
 * customer profile only fetches on its own tab.
 */
export function useAdminWebQuotes(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'web-quotes', params],
    queryFn: () => api.get('/admin/web-quotes', params),
    enabled: canUseAdmin && params !== undefined,
    staleTime: 15 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useAdminQuotes(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'quotes', params],
    queryFn: () => api.get('/admin/quotes', params),
    // `undefined` params means the caller does not want the list yet - the
    // customer profile only fetches on its Quotes tab. Without this the hook
    // would fetch every quote in the system to render nothing.
    enabled: canUseAdmin && params !== undefined,
    staleTime: 15 * 1000,
  });
}

/** Carries the live price comparison alongside the quote, so a screen can show
 *  the catalogue moving under a promise while it is still open. */
export function useAdminQuote(id) {
  return useQuery({
    queryKey: ['admin', 'quotes', 'one', id],
    queryFn: () => api.get(`/admin/quotes/${id}`),
    enabled: Boolean(id),
  });
}

export function useAdminRmas(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'rma', params],
    queryFn: () => api.get('/admin/rma', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

export function useAdminRma(id) {
  return useQuery({
    queryKey: ['admin', 'rma', 'one', id],
    queryFn: () => api.get(`/admin/rma/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Repair tickets. `params` carries the status pill, the search, the priority
 * and technician filters and the page - all of it in the key, so paging back
 * to a page already seen is instant.
 */
export function useAdminTickets(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'tickets', params],
    queryFn: () => api.get('/admin/tickets', params),
    // `undefined` params means the caller does not want the list yet - the
    // customer profile only fetches on its Tickets tab. Without this the hook
    // would fetch *every* ticket in the shop to render nothing.
    enabled: canUseAdmin && params !== undefined,
    staleTime: 15 * 1000,
    // A list that reflows under the staff member while they read a row is worse
    // than one a few seconds stale, but a page of tickets is a live board
    // keeping the previous page on screen during a refetch is the compromise.
    placeholderData: (previous) => previous,
  });
}

export function useAdminTicket(id) {
  return useQuery({
    queryKey: ['admin', 'tickets', 'one', id],
    queryFn: () => api.get(`/admin/tickets/${id}`),
    enabled: Boolean(id),
  });
}

// ---- reports (phase 6) ------------------------------------------------------

/**
 * One report tab. `range` is `{ from, to }` as inclusive `YYYY-MM-DD` days and
 * is part of the query key, so two tabs at two ranges cache separately.
 *
 * `staleTime` is longer than a list's: a report is a considered read of a
 * period, not a live board, and refetching it under the staff member while they are
 * reading a column is worse than showing a figure a minute old.
 */
export function useAdminReport(tab, range, extra) {
  const { canUseAdmin } = useAuth();
  const params = { ...extra };
  if (range?.from) params.from = range.from;
  if (range?.to) params.to = range.to;

  return useQuery({
    queryKey: ['admin', 'reports', tab, params],
    queryFn: () => api.get(`/admin/reports/${tab}`, params),
    enabled: canUseAdmin && Boolean(tab),
    staleTime: 60 * 1000,
  });
}

/**
 * Admin mutations.
 *
 * Approving a business changes what that account can see everywhere, so the
 * whole admin cache is invalidated rather than surgically patched - these are
 * low-frequency, high-consequence actions.
 */
// ---- phase 8: businesses, roles and staff --------------------------------------

export function useAdminBusinesses(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'businesses', params],
    queryFn: () => api.get('/admin/businesses', params),
    enabled: canUseAdmin,
    staleTime: 30 * 1000,
  });
}

export function useAdminBusiness(id) {
  return useQuery({
    queryKey: ['admin', 'businesses', id],
    queryFn: () => api.get(`/admin/businesses/${id}`),
    enabled: Boolean(id),
  });
}

/** The next `#000001` code, so the Add form can show it before saving. */
export function useNextBusinessCode(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'businesses', 'next-code'],
    queryFn: () => api.get('/admin/businesses/next-code'),
    enabled,
    staleTime: 0,
  });
}

/** Admin-only endpoints - a staff session gets a 403, so it never asks. */
export function useAdminRoles() {
  const { isAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get('/admin/roles'),
    enabled: isAdmin,
    staleTime: 30 * 1000,
  });
}

export function useAdminStaff(params) {
  const { isAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'staff', params],
    queryFn: () => api.get('/admin/staff', params),
    enabled: isAdmin,
    staleTime: 15 * 1000,
  });
}

// ---- phase 9: marketing -----------------------------------------------------

/**
 * Channel states and the counts above each marketing screen.
 *
 * `channels` is the one source of truth for which providers are connected
 * (§6b) - the notices on the SMS, WhatsApp and Calls screens read it rather
 * than each hard-coding its own wording.
 */
export function useMarketingSummary() {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'marketing', 'summary'],
    queryFn: () => api.get('/admin/marketing/summary'),
    enabled: canUseAdmin,
    staleTime: 30 * 1000,
  });
}

/**
 * The history panel. `channel` scopes it; `user` narrows it to one account.
 *
 * Passing `undefined` skips the fetch, which is how a caller that only wants
 * the history on one tab avoids paying for it on every other one.
 */
export function useMarketingMessages(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'marketing', 'messages', params ?? null],
    queryFn: () => api.get('/admin/marketing/messages', params),
    enabled: canUseAdmin && params !== undefined,
    staleTime: 10 * 1000,
  });
}

export function useMarketingTemplates(channel) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'marketing', 'templates', channel ?? 'all'],
    queryFn: () => api.get('/admin/marketing/templates', channel ? { channel } : {}),
    enabled: canUseAdmin,
    staleTime: 60 * 1000,
  });
}

export function useMarketingCampaigns(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'marketing', 'campaigns', params],
    queryFn: () => api.get('/admin/marketing/campaigns', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
  });
}

/**
 * One campaign, with its audience recounted server-side on every read
 * consent moves between saves, and the count shown is the one the staff member uses
 * to decide whether to send.
 */
export function useMarketingCampaign(id) {
  return useQuery({
    queryKey: ['admin', 'marketing', 'campaigns', id],
    queryFn: () => api.get(`/admin/marketing/campaigns/${id}`),
    enabled: Boolean(id),
  });
}

export function useMarketingUnsubscribes(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'marketing', 'unsubscribes', params],
    queryFn: () => api.get('/admin/marketing/unsubscribes', params),
    enabled: canUseAdmin,
    staleTime: 30 * 1000,
  });
}

// ---- phase 10: referral commission ------------------------------------------

/**
 * Referrals and the commission rate.
 *
 * Admin-only - a staff session gets a 403, so it never asks (§6.13). This pays
 * real money on an automatic trigger, which is a decision for whoever owns the
 * money rather than anyone holding `marketing: full`.
 */
export function useAdminReferrals(params) {
  const { isAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'referrals', params],
    queryFn: () => api.get('/admin/referrals', params),
    enabled: isAdmin,
    staleTime: 30 * 1000,
  });
}

// ---- phase 11a: settings ----------------------------------------------------

/**
 * The settings singleton.
 *
 * One query behind every settings screen: the document is small, it is read by
 * six forms, and a per-screen query would mean six caches that can disagree
 * about the same field.
 *
 * `staleTime` is longer than the panel's default because settings change on the
 * order of months, not minutes - and every mutation invalidates `['admin']`
 * anyway, so an edit still lands immediately.
 */
/** Returns going back to a supplier (Purchase § RMA / Returns). */
export function useSupplierReturns(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'supplier-returns', params],
    queryFn: () => api.get('/admin/supplier-returns', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
    placeholderData: (previous) => previous,
  });
}

/** Bought-in services and supplier subscriptions. `kind` picks which screen. */
export function useSupplierServices(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'supplier-services', params],
    queryFn: () => api.get('/admin/supplier-services', params),
    enabled: canUseAdmin,
    staleTime: 15 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useSupplierReturn(id) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'supplier-returns', id],
    queryFn: () => api.get(`/admin/supplier-returns/${id}`),
    enabled: canUseAdmin && Boolean(id),
  });
}

export function useAdminSettings() {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get('/admin/settings'),
    enabled: canUseAdmin,
    staleTime: 5 * 60 * 1000,
  });
}

// ---- phase 12c: notifications (§7.3) ----------------------------------------

/**
 * The bell's contents.
 *
 * **Polled, as §7.3 specifies** - "polled on an interval to start, upgraded to
 * SSE only if that proves necessary". One minute is the interval: the four
 * standing conditions are recomputed on every read, so a shorter one buys
 * freshness nobody can act on while multiplying a query that touches invoices,
 * products and purchase orders.
 *
 * `refetchIntervalInBackground` is left at its default of false on purpose. A
 * panel sitting in an unfocused tab overnight should not spend the night
 * re-running that query, and the refetch on focus catches it up the instant
 * somebody comes back.
 */
export function useNotifications() {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'notifications'],
    queryFn: () => api.get('/admin/notifications'),
    enabled: canUseAdmin,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

/**
 * Marking read and clearing.
 *
 * Both invalidate rather than optimistically patching the cache: the derived
 * half of the list is recomputed server-side and a local edit cannot model it,
 * so guessing would show a badge that disagrees with the next poll.
 */
export function useNotificationActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] });

  return {
    markRead: useMutation({
      mutationFn: (ids) => api.post('/admin/notifications/read', ids ? { ids } : {}),
      onSuccess: invalidate,
    }),
    clearAll: useMutation({
      mutationFn: () => api.post('/admin/notifications/clear'),
      onSuccess: invalidate,
    }),
  };
}

// ---- phase 11b: the audit trail ---------------------------------------------

/**
 * One page of the activity or security log.
 *
 * `kind` picks the endpoint rather than being sent as a parameter - the server
 * decides which log a route reads, so a client cannot ask the activity route
 * for security rows.
 *
 * The security log is admin-only, so a staff session never asks for it: it
 * would only ever receive a 403.
 */
export function useAuditLog(kind, params) {
  const { canUseAdmin, isAdmin } = useAuth();
  const allowed = kind === 'security' ? isAdmin : canUseAdmin;

  return useQuery({
    queryKey: ['admin', 'audit', kind, params],
    queryFn: () => api.get(`/admin/audit/${kind}`, params),
    enabled: allowed,
    // Short: a log is read to find out what just happened, and a stale page
    // is the one thing it must not show.
    staleTime: 10 * 1000,
    placeholderData: (previous) => previous,
  });
}

// ---- phase 11c: provider credentials ----------------------------------------

/**
 * Which providers are configured, and a masked preview of each field.
 *
 * **Never the values.** The server has no route that returns a stored secret
 * (§6.15), so there is nothing to fetch and nothing to cache: what comes back
 * is `configured`, `source` and a preview like `••••••••1234`.
 *
 * Admin-only - a staff session would only ever get a 403, so it never asks.
 */
export function useAdminCredentials() {
  const { isAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'credentials'],
    queryFn: () => api.get('/admin/credentials'),
    enabled: isAdmin,
    staleTime: 60 * 1000,
  });
}

// ---- phase 11d: taxonomy & invoice status rules -----------------------------

export function useAdminTaxonomy(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'taxonomy', params],
    queryFn: () => api.get('/admin/taxonomy', params),
    enabled: canUseAdmin,
    staleTime: 30 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useAdminInvoiceRules() {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'invoice-rules'],
    queryFn: () => api.get('/admin/invoice-rules'),
    enabled: canUseAdmin,
    staleTime: 60 * 1000,
  });
}

// ---- phase 11e: scheduling board (UI only, §6b U1–U2) -----------------------

/**
 * The scheduling board's data. Ships empty and there is no write hook - the
 * screens render their chrome and say plainly that nothing is wired.
 */
export function useAdminAppointments(params) {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'appointments', params],
    queryFn: () => api.get('/admin/appointments', params),
    enabled: canUseAdmin,
    staleTime: 60 * 1000,
  });
}

// ---- phase 12: global search & profile --------------------------------------

/**
 * Record search behind Ctrl+K (§7.1).
 *
 * Results are **permission-filtered server-side** from the caller's role, so
 * there is nothing to pass here and nothing this hook could ask for that the
 * session is not entitled to.
 *
 * Disabled under two characters, matching the server's own floor - otherwise
 * every palette open fires a request that returns nothing.
 */
export function useAdminSearch(term) {
  const { canUseAdmin } = useAuth();
  const q = (term ?? '').trim();

  return useQuery({
    queryKey: ['admin', 'search', q],
    queryFn: () => api.get('/admin/search', { q }),
    enabled: canUseAdmin && q.length >= 2,
    staleTime: 15 * 1000,
    placeholderData: (previous) => previous,
  });
}

/** The signed-in staff member's own profile and recent activity. */
export function useAdminProfile() {
  const { canUseAdmin } = useAuth();
  return useQuery({
    queryKey: ['admin', 'profile'],
    queryFn: () => api.get('/admin/profile'),
    enabled: canUseAdmin,
    staleTime: 60 * 1000,
  });
}

export function useAdminMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  // Editorial writes are the admin's copy of a page the storefront also caches.
  // Invalidating both is what makes a publish show up without a hard refresh.
  const invalidateContent = (publicKey) => () => {
    invalidate();
    queryClient.invalidateQueries({ queryKey: [publicKey] });
  };

  return {
    createUser: useMutation({
      mutationFn: (body) => api.post('/admin/users', body),
      onSuccess: invalidate,
    }),
    updateUser: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/users/${id}`, body),
      onSuccess: invalidate,
    }),
    createSupplierReturn: useMutation({
      mutationFn: (body) => api.post('/admin/supplier-returns', body),
      onSuccess: invalidate,
    }),
    setSupplierReturnStatus: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/supplier-returns/${id}/status`, body),
      onSuccess: invalidate,
    }),
    recordSupplierCredit: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/supplier-returns/${id}/credit`, body),
      onSuccess: invalidate,
    }),
    deleteSupplierReturn: useMutation({
      mutationFn: (id) => api.delete(`/admin/supplier-returns/${id}`),
      onSuccess: invalidate,
    }),

    createSupplierService: useMutation({
      mutationFn: (body) => api.post('/admin/supplier-services', body),
      onSuccess: invalidate,
    }),
    updateSupplierService: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/supplier-services/${id}`, body),
      onSuccess: invalidate,
    }),
    recordSupplierCharge: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/supplier-services/${id}/charges`, body),
      onSuccess: invalidate,
    }),
    cancelSupplierService: useMutation({
      mutationFn: ({ id, cancelled }) =>
        api.patch(`/admin/supplier-services/${id}/cancel`, { cancelled }),
      onSuccess: invalidate,
    }),
    deleteSupplierService: useMutation({
      mutationFn: (id) => api.delete(`/admin/supplier-services/${id}`),
      onSuccess: invalidate,
    }),

    setContactConsent: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/users/${id}/consent`, body),
      onSuccess: invalidate,
    }),
    setTier: useMutation({
      mutationFn: ({ id, tier }) => api.patch(`/admin/users/${id}/tier`, { tier }),
      onSuccess: invalidate,
    }),
    addInternalNote: useMutation({
      mutationFn: ({ id, body }) => api.post(`/admin/users/${id}/notes`, { body }),
      onSuccess: invalidate,
    }),
    deleteInternalNote: useMutation({
      mutationFn: ({ id, noteId }) => api.delete(`/admin/users/${id}/notes/${noteId}`),
      onSuccess: invalidate,
    }),
    approveUser: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/users/${id}/approve`, body),
      onSuccess: invalidate,
    }),
    rejectUser: useMutation({
      mutationFn: ({ id, reason }) => api.patch(`/admin/users/${id}/reject`, { reason }),
      onSuccess: invalidate,
    }),
    setUserStatus: useMutation({
      mutationFn: ({ id, status }) => api.patch(`/admin/users/${id}/status`, { status }),
      onSuccess: invalidate,
    }),
    setCredit: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/users/${id}/credit`, body),
      onSuccess: invalidate,
    }),
    allocateStoreCredit: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/users/${id}/store-credit`, body),
      onSuccess: (_payload, variables) => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['admin', 'store-credit', variables.id] });
      },
    }),
    // An order raised by hand. It takes stock and raises an invoice exactly as
    // a checkout does, so the storefront's own order list moved too.
    createOrder: useMutation({
      mutationFn: (body) => api.post('/admin/orders', body),
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['products'] });
      },
    }),
    refundOrder: useMutation({
      mutationFn: ({ orderNumber, ...body }) =>
        api.post(`/admin/orders/${orderNumber}/refund`, body),
      onSuccess: invalidate,
    }),

    // Partial by design: this resolves to `{ updated, skipped }`, and the caller
    // is expected to show the skips rather than report a clean success.
    bulkOrderStatus: useMutation({
      mutationFn: (body) => api.patch('/admin/orders/bulk-status', body),
      onSuccess: invalidate,
    }),

    // A standalone invoice - no order behind it. On terms it draws on the line
    // of credit, so the client's own account view moved as well.
    createInvoice: useMutation({
      mutationFn: (body) => api.post('/admin/invoices', body),
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      },
    }),
    recordInvoicePayment: useMutation({
      mutationFn: ({ number, ...body }) => api.post(`/admin/invoices/${number}/payments`, body),
      onSuccess: invalidate,
    }),
    // A gratuity. `PATCH`, not `POST`, because setting it replaces rather than
    // accumulates: a tip is one number on one transaction, and 0 clears it.
    recordInvoiceTip: useMutation({
      mutationFn: ({ number, ...body }) => api.patch(`/admin/invoices/${number}/tip`, body),
      onSuccess: invalidate,
    }),
    voidInvoice: useMutation({
      mutationFn: ({ number, reason }) => api.post(`/admin/invoices/${number}/void`, { reason }),
      onSuccess: invalidate,
    }),
    // Resolves to `{ delivered, to }`. The caller reads `delivered` rather than
    // treating a 200 as proof the customer has the document - the transport can
    // accept the request and still refuse the message.
    // Cash at the counter against the line of credit. Resolves to the invoices
    // it actually landed on, so the UI can name them rather than say "done".
    recordCreditPayment: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/users/${id}/credit-payment`, body),
      onSuccess: invalidate,
    }),
    reverseInvoicePayment: useMutation({
      mutationFn: ({ number, index, ...body }) =>
        api.post(`/admin/invoices/${number}/payments/${index}/reverse`, body),
      onSuccess: invalidate,
    }),
    emailInvoice: useMutation({
      mutationFn: ({ number }) => api.post(`/admin/invoices/${number}/email`, {}),
      onSuccess: invalidate,
    }),
    updateInvoice: useMutation({
      mutationFn: ({ number, ...body }) => api.patch(`/admin/invoices/${number}`, body),
      onSuccess: invalidate,
    }),
    deleteInvoice: useMutation({
      mutationFn: ({ number }) => api.delete(`/admin/invoices/${number}`),
      onSuccess: invalidate,
    }),

    createProduct: useMutation({
      mutationFn: (body) => api.post('/admin/products', body),
      onSuccess: () => {
        invalidate();
        // The storefront's catalogue and category tree both moved.
        queryClient.invalidateQueries({ queryKey: ['products'] });
        queryClient.invalidateQueries({ queryKey: ['taxonomy'] });
      },
    }),
    updateProduct: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/products/${id}`, body),
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['products'] });
      },
    }),
    toggleProduct: useMutation({
      mutationFn: (id) => api.delete(`/admin/products/${id}`),
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['products'] });
      },
    }),

    updateOrderStatus: useMutation({
      mutationFn: ({ orderNumber, ...body }) =>
        api.patch(`/admin/orders/${orderNumber}/status`, body),
      onSuccess: () => {
        invalidate();
        // The buyer-side tracking page reads the same order.
        queryClient.invalidateQueries({ queryKey: ['orders'] });
      },
    }),

    createPost: useMutation({
      mutationFn: (body) => api.post('/admin/blog', body),
      onSuccess: invalidateContent('blog'),
    }),
    updatePost: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/blog/${id}`, body),
      onSuccess: invalidateContent('blog'),
    }),
    deletePost: useMutation({
      mutationFn: (id) => api.delete(`/admin/blog/${id}`),
      onSuccess: invalidateContent('blog'),
    }),
    // ONE mutation for create and update. The editor opens against a product
    // whether or not an article exists, so the client never has to know which
    // it is doing - the server upserts on the product id.
    saveProductArticle: useMutation({
      mutationFn: ({ productId, ...body }) => api.patch(`/admin/product-articles/${productId}`, body),
      onSuccess: invalidateContent('product'),
    }),
    // Hiding a review must reach the storefront, not just the admin table -
    // the product page caches its own copy of the list.
    setReviewHidden: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/reviews/${id}/hidden`, body),
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['product'] });
        queryClient.invalidateQueries({ queryKey: ['reviews'] });
      },
    }),
    deleteProductArticle: useMutation({
      mutationFn: (productId) => api.delete(`/admin/product-articles/${productId}`),
      onSuccess: invalidateContent('product'),
    }),

    createFaq: useMutation({
      mutationFn: (body) => api.post('/admin/faqs', body),
      onSuccess: () => {
        invalidateContent('faq')();
        // Product-scoped entries render inside the product detail payload.
        queryClient.invalidateQueries({ queryKey: ['product'] });
      },
    }),
    updateFaq: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/faqs/${id}`, body),
      onSuccess: () => {
        invalidateContent('faq')();
        queryClient.invalidateQueries({ queryKey: ['product'] });
      },
    }),
    deleteFaq: useMutation({
      mutationFn: (id) => api.delete(`/admin/faqs/${id}`),
      onSuccess: () => {
        invalidateContent('faq')();
        queryClient.invalidateQueries({ queryKey: ['product'] });
      },
    }),

    createOffer: useMutation({
      mutationFn: (body) => api.post('/admin/offers', body),
      onSuccess: invalidateContent('offers'),
    }),
    updateOffer: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/offers/${id}`, body),
      onSuccess: invalidateContent('offers'),
    }),
    deleteOffer: useMutation({
      mutationFn: (id) => api.delete(`/admin/offers/${id}`),
      onSuccess: invalidateContent('offers'),
    }),

    // ---- purchase (phase 5) -------------------------------------------------

    createSupplier: useMutation({
      mutationFn: (body) => api.post('/admin/suppliers', body),
      onSuccess: invalidate,
    }),
    updateSupplier: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/suppliers/${id}`, body),
      onSuccess: invalidate,
    }),
    toggleSupplier: useMutation({
      mutationFn: (id) => api.delete(`/admin/suppliers/${id}`),
      onSuccess: invalidate,
    }),

    /**
     * Email this supplier their portal link and a fresh password.
     *
     * Resolves to `{ delivered, error }` rather than throwing on a mail
     * failure - the credential is reset either way, and the screen has to be
     * able to say "reset, but the email did not send" instead of claiming a
     * success that never left the building.
     */
    inviteSupplierPortal: useMutation({
      mutationFn: (id) => api.post(`/admin/suppliers/${id}/portal-invite`, {}),
      onSuccess: invalidate,
    }),

    // ---- supplier bidding on a purchase order (§6.8a) -----------------------

    invitePoSuppliers: useMutation({
      mutationFn: ({ id, supplierIds }) =>
        api.post(`/admin/purchase-orders/${id}/bids`, { supplierIds }),
      onSuccess: invalidate,
    }),
    removePoSupplier: useMutation({
      mutationFn: ({ id, supplierId }) =>
        api.delete(`/admin/purchase-orders/${id}/bids/${supplierId}`),
      onSuccess: invalidate,
    }),
    // Resolves to `{ mailed, total }`: one bad address must not stop the rest
    // going out, so the caller shows who was not reached rather than reporting
    // a clean success.
    sendPurchaseOrder: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/purchase-orders/${id}/send`, body),
      onSuccess: invalidate,
    }),
    negotiatePoBid: useMutation({
      mutationFn: ({ id, supplierId, ...body }) =>
        api.post(`/admin/purchase-orders/${id}/bids/${supplierId}/negotiate`, body),
      onSuccess: invalidate,
    }),
    // Prices the order's lines from the winning bid, so every PO list moves too.
    confirmPoSupplier: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/purchase-orders/${id}/confirm`, body),
      onSuccess: invalidate,
    }),

    // Accepting rewrites the order's lines to match the proforma, so the order
    // itself is invalidated alongside the bid board - the header totals and the
    // items table are both reading numbers this just changed.
    acceptProforma: useMutation({
      mutationFn: ({ id, supplierId }) =>
        api.post(`/admin/purchase-orders/${id}/bids/${supplierId}/proforma/accept`, {}),
      onSuccess: invalidate,
    }),
    requestProformaRevision: useMutation({
      mutationFn: ({ id, supplierId, note }) =>
        api.post(`/admin/purchase-orders/${id}/bids/${supplierId}/proforma/revision`, { note }),
      onSuccess: invalidate,
    }),

    createPurchaseOrder: useMutation({
      mutationFn: (body) => api.post('/admin/purchase-orders', body),
      onSuccess: invalidate,
    }),
    updatePurchaseOrder: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/purchase-orders/${id}`, body),
      onSuccess: invalidate,
    }),
    setPurchaseOrderStatus: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/purchase-orders/${id}/status`, body),
      onSuccess: invalidate,
    }),

    // Partial by design, like the bulk order action: this resolves to
    // `{ received, skipped }` and the caller shows the skips rather than
    // reporting a clean success.
    receivePurchaseOrder: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/purchase-orders/${id}/receive`, body),
      onSuccess: () => {
        invalidate();
        // Receiving moved stock, so the storefront's in-stock flags moved too.
        queryClient.invalidateQueries({ queryKey: ['products'] });
      },
    }),
    // Creates the expense row. Refused if this PO has already been paid.
    recordPurchasePayment: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/purchase-orders/${id}/payment`, body),
      onSuccess: invalidate,
    }),

    createExpense: useMutation({
      mutationFn: (body) => api.post('/admin/expenses', body),
      onSuccess: invalidate,
    }),
    updateExpense: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/expenses/${id}`, body),
      onSuccess: invalidate,
    }),
    deleteExpense: useMutation({
      mutationFn: (id) => api.delete(`/admin/expenses/${id}`),
      onSuccess: invalidate,
    }),

    createServiceQuote: useMutation({
      mutationFn: (body) => api.post('/admin/service-quotes', body),
      onSuccess: invalidate,
    }),
    updateServiceQuote: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/service-quotes/${id}`, body),
      onSuccess: invalidate,
    }),
    setServiceQuoteStatus: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/service-quotes/${id}/status`, body),
      onSuccess: invalidate,
    }),
    deleteServiceQuote: useMutation({
      mutationFn: (id) => api.delete(`/admin/service-quotes/${id}`),
      onSuccess: invalidate,
    }),
    // Resolves to `{ quote, ticket }` - the caller navigates to the ticket,
    // which is where the work now lives.
    convertServiceQuote: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/service-quotes/${id}/convert`, body),
      onSuccess: invalidate,
    }),

    createDevice: useMutation({
      mutationFn: (body) => api.post('/admin/devices', body),
      onSuccess: invalidate,
    }),
    updateDevice: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/devices/${id}`, body),
      onSuccess: invalidate,
    }),
    // Refused for a node with children or one any ticket or estimate names.
    deleteDevice: useMutation({
      mutationFn: (id) => api.delete(`/admin/devices/${id}`),
      onSuccess: invalidate,
    }),
    createService: useMutation({
      mutationFn: (body) => api.post('/admin/services', body),
      onSuccess: invalidate,
    }),
    updateService: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/services/${id}`, body),
      onSuccess: invalidate,
    }),
    // Refused by the server for a service any quote or ticket points at; the
    // error names the count and says to deactivate instead.
    deleteService: useMutation({
      mutationFn: (id) => api.delete(`/admin/services/${id}`),
      onSuccess: invalidate,
    }),
    /**
     * Refund money off an invoice, to cash or to store credit.
     *
     * Resolves to `{ refunded, toStoreCredit, refundable, status, balance,
     * storeCreditBalance }`. The amount is capped server-side against the
     * invoice own payment rows, so a stale form cannot over-refund.
     */
    /**
     * Chase an unpaid invoice. Refused server-side on a settled one.
     *
     * Resolves to `{ delivered, to, balance, overdue }` - `delivered` is what the
     * transport said, not what was attempted, so the caller can tell "reminded"
     * from "tried to remind".
     */
    remindInvoice: useMutation({
      mutationFn: ({ number, ...body }) => api.post(`/admin/invoices/${number}/remind`, body),
      onSuccess: invalidate,
    }),
    refundInvoice: useMutation({
      mutationFn: ({ number, ...body }) => api.post(`/admin/invoices/${number}/refund`, body),
      onSuccess: invalidate,
    }),
    createInvoiceLabel: useMutation({
      mutationFn: (body) => api.post('/admin/invoice-labels', body),
      onSuccess: invalidate,
    }),
    updateInvoiceLabel: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/invoice-labels/${id}`, body),
      onSuccess: invalidate,
    }),
    // Refused while any invoice carries it - the error names the count and says
    // to retire it instead, which keeps those invoices readable.
    deleteInvoiceLabel: useMutation({
      mutationFn: (id) => api.delete(`/admin/invoice-labels/${id}`),
      onSuccess: invalidate,
    }),
    /**
     * Set or clear the manual status on one invoice.
     *
     * Resolves to `{ emailed }` - whether the warranty email actually went out,
     * which is a side effect the person clicking cannot otherwise see. Pass
     * `labelId: null` to clear.
     */
    setInvoiceLabel: useMutation({
      mutationFn: ({ number, labelId }) =>
        api.patch(`/admin/invoices/${number}/label`, { labelId }),
      onSuccess: invalidate,
    }),
    createExpenseCategory: useMutation({
      mutationFn: (body) => api.post('/admin/expenses/categories', body),
      onSuccess: invalidate,
    }),
    updateExpenseCategory: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/expenses/categories/${id}`, body),
      onSuccess: invalidate,
    }),
    // Resolves to `{ deactivated }` - a category in use is deactivated, and the
    // caller is expected to say which of the two happened.
    deleteExpenseCategory: useMutation({
      mutationFn: (id) => api.delete(`/admin/expenses/categories/${id}`),
      onSuccess: invalidate,
    }),

    updateInventoryOps: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/inventory/${id}/ops`, body),
      onSuccess: invalidate,
    }),
    adjustStock: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/inventory/${id}/adjust`, body),
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['products'] });
      },
    }),

    // ---- quotes & RMA (phase 7) --------------------------------------------

    createQuote: useMutation({
      mutationFn: (body) => api.post('/admin/quotes', body),
      onSuccess: invalidate,
    }),
    updateQuote: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/quotes/${id}`, body),
      onSuccess: invalidate,
    }),
    setWebQuoteStatus: useMutation({
      mutationFn: ({ id, status }) => api.patch(`/admin/web-quotes/${id}/status`, { status }),
      onSuccess: invalidate,
    }),
    setQuoteStatus: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/quotes/${id}/status`, body),
      onSuccess: invalidate,
    }),
    /**
     * Conversion. Rejects with `QUOTE_PRICE_DRIFT` and the comparison in
     * `error.fields.drift` when catalogue prices have moved - the caller shows
     * that and retries with `acknowledgeDrift`, which is the admin's decision
     * to honour the quoted price anyway.
     */
    convertQuote: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/quotes/${id}/convert`, body),
      onSuccess: () => {
        invalidate();
        // A conversion writes an order, an invoice and moves stock.
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['products'] });
      },
    }),
    deleteQuote: useMutation({
      mutationFn: (id) => api.delete(`/admin/quotes/${id}`),
      onSuccess: invalidate,
    }),

    createTicket: useMutation({
      mutationFn: (body) => api.post('/admin/tickets', body),
      onSuccess: invalidate,
    }),
    updateTicket: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/tickets/${id}`, body),
      onSuccess: invalidate,
    }),
    /** Status is its own call because only it writes the ticket timeline. */
    markTicketReviewed: useMutation({
      mutationFn: (id) => api.patch(`/admin/tickets/${id}/reviewed`, {}),
      onSuccess: invalidate,
    }),
    setTicketStatus: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/tickets/${id}/status`, body),
      onSuccess: invalidate,
    }),
    deleteTicket: useMutation({
      mutationFn: (id) => api.delete(`/admin/tickets/${id}`),
      onSuccess: invalidate,
    }),

    /** Money taken before the invoice exists. Carried onto it on conversion. */
    recordTicketDeposit: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/tickets/${id}/deposits`, body),
      onSuccess: invalidate,
    }),
    removeTicketDeposit: useMutation({
      mutationFn: ({ id, depositId }) =>
        api.delete(`/admin/tickets/${id}/deposits/${depositId}`),
      onSuccess: invalidate,
    }),
    /** The finished repair becomes the invoice that bills it. */
    convertTicketToInvoice: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/tickets/${id}/convert`, body),
      onSuccess: invalidate,
    }),
    /** The other direction: an accepted estimate becomes the ticket. */
    convertQuoteToTicket: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/quotes/${id}/convert-ticket`, body),
      onSuccess: invalidate,
    }),

    createRma: useMutation({
      mutationFn: (body) => api.post('/admin/rma', body),
      onSuccess: invalidate,
    }),
    setRmaStatus: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/rma/${id}/status`, body),
      onSuccess: invalidate,
    }),
    inspectRma: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/rma/${id}/inspect`, body),
      onSuccess: invalidate,
    }),
    /** Resolves to `{ restocked, refund }` - the caller says what actually
     *  moved rather than reporting a bare success. */
    resolveRma: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/rma/${id}/resolve`, body),
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['products'] });
      },
    }),

    // ---- phase 8 ----------------------------------------------------------
    createBusiness: useMutation({
      mutationFn: (body) => api.post('/admin/businesses', body),
      onSuccess: invalidate,
    }),
    updateBusiness: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/businesses/${id}`, body),
      onSuccess: invalidate,
    }),
    setDefaultBusiness: useMutation({
      mutationFn: (id) => api.patch(`/admin/businesses/${id}/default`),
      onSuccess: invalidate,
    }),
    deleteBusiness: useMutation({
      mutationFn: (id) => api.delete(`/admin/businesses/${id}`),
      onSuccess: invalidate,
    }),

    createRole: useMutation({
      mutationFn: (body) => api.post('/admin/roles', body),
      onSuccess: invalidate,
    }),
    updateRole: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/roles/${id}`, body),
      // A role edit changes what the editor themselves may see, so the session
      // is refetched alongside the admin caches.
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      },
    }),
    deleteRole: useMutation({
      mutationFn: (id) => api.delete(`/admin/roles/${id}`),
      onSuccess: invalidate,
    }),

    createStaff: useMutation({
      mutationFn: (body) => api.post('/admin/staff', body),
      onSuccess: invalidate,
    }),
    updateStaff: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/staff/${id}`, body),
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      },
    }),
    deleteStaff: useMutation({
      mutationFn: (id) => api.delete(`/admin/staff/${id}`),
      onSuccess: invalidate,
    }),

    // ---- phase 9 ----------------------------------------------------------
    // Every compose resolves to `{ message, notice }`. `notice` is non-null
    // when the channel could not actually send, and the screen must render it
    // instead of a confirmation - §6b rule 4, no fake success.
    sendMessage: useMutation({
      mutationFn: ({ channel, ...body }) => api.post(`/admin/marketing/${channel}`, body),
      onSuccess: invalidate,
    }),

    createTemplate: useMutation({
      mutationFn: (body) => api.post('/admin/marketing/templates', body),
      onSuccess: invalidate,
    }),
    updateTemplate: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/marketing/templates/${id}`, body),
      onSuccess: invalidate,
    }),
    deleteTemplate: useMutation({
      mutationFn: (id) => api.delete(`/admin/marketing/templates/${id}`),
      onSuccess: invalidate,
    }),

    createCampaign: useMutation({
      mutationFn: (body) => api.post('/admin/marketing/campaigns', body),
      onSuccess: invalidate,
    }),
    updateCampaign: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/marketing/campaigns/${id}`, body),
      onSuccess: invalidate,
    }),
    deleteCampaign: useMutation({
      mutationFn: (id) => api.delete(`/admin/marketing/campaigns/${id}`),
      onSuccess: invalidate,
    }),
    // Resolves to `{ campaign, result }`, where `result` carries sent / queued
    // / failed / skipped. The screen reports those four numbers rather than a
    // single "sent" - a partial run says so.
    sendCampaign: useMutation({
      mutationFn: (id) => api.post(`/admin/marketing/campaigns/${id}/send`),
      onSuccess: invalidate,
    }),

    resubscribe: useMutation({
      mutationFn: (id) => api.post(`/admin/marketing/unsubscribes/${id}/resubscribe`),
      onSuccess: invalidate,
    }),

    // ---- phase 10 ---------------------------------------------------------
    // The only writable thing in the whole referral feature. Accruals are
    // produced by payments and reversed by refunds - there is no mutation that
    // writes one by hand, and attribution is set once at registration.
    setReferralRate: useMutation({
      mutationFn: (percent) => api.patch('/admin/referrals/rate', { percent }),
      onSuccess: invalidate,
    }),

    // ---- phase 11a: settings ------------------------------------------------
    // One mutation per section, mirroring the routes. There is no whole-document
    // write: a form posts back the copy it loaded on open, so a wholesale save
    // would let one screen silently revert a field another screen just changed.
    saveBusinessInfo: useMutation({
      mutationFn: (body) => api.patch('/admin/settings/business', body),
      onSuccess: invalidate,
    }),
    saveSaleSettings: useMutation({
      mutationFn: (body) => api.patch('/admin/settings/sale', body),
      onSuccess: invalidate,
    }),
    saveShippingSettings: useMutation({
      mutationFn: (body) => api.patch('/admin/settings/shipping', body),
      onSuccess: invalidate,
    }),
    savePaymentMethods: useMutation({
      mutationFn: (body) => api.patch('/admin/settings/payment-methods', body),
      onSuccess: invalidate,
    }),
    createAgreement: useMutation({
      mutationFn: (body) => api.post('/admin/agreements', body),
      onSuccess: invalidate,
    }),
    updateAgreement: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/agreements/${id}`, body),
      onSuccess: invalidate,
    }),
    // Publishing moves every supplier onto the new wording, which is what makes
    // their existing signature stale - so it invalidates broadly.
    publishAgreement: useMutation({
      mutationFn: ({ id, ...body }) => api.post(`/admin/agreements/${id}/publish`, body),
      onSuccess: invalidate,
    }),
    saveInventorySettings: useMutation({
      mutationFn: (body) => api.patch('/admin/settings/inventory', body),
      onSuccess: invalidate,
    }),
    // ---- phase 11c: provider credentials -----------------------------------
    // Write-only. The response carries previews and `configured` flags, never
    // the values that were just sent - so nothing here caches a secret.
    saveCredentials: useMutation({
      mutationFn: ({ provider, ...values }) => api.patch(`/admin/credentials/${provider}`, values),
      onSuccess: invalidate,
    }),
    clearCredentials: useMutation({
      mutationFn: (provider) => api.delete(`/admin/credentials/${provider}`),
      onSuccess: invalidate,
    }),

    // ---- phase 11d: taxonomy & invoice status rules ------------------------
    // Taxonomy writes invalidate the public tree as well: the sidebar, mega
    // menu and tab wizard all render from it, so an alias or a deactivation has
    // to show up on the storefront without a hard refresh.
    saveTaxonomyNode: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/taxonomy/${id}`, body),
      onSuccess: invalidateContent('taxonomy'),
    }),
    deleteTaxonomyNode: useMutation({
      mutationFn: (id) => api.delete(`/admin/taxonomy/${id}`),
      onSuccess: invalidateContent('taxonomy'),
    }),

    createInvoiceRule: useMutation({
      mutationFn: (body) => api.post('/admin/invoice-rules', body),
      onSuccess: invalidate,
    }),
    saveInvoiceRule: useMutation({
      mutationFn: ({ id, ...body }) => api.patch(`/admin/invoice-rules/${id}`, body),
      onSuccess: invalidate,
    }),
    deleteInvoiceRule: useMutation({
      mutationFn: (id) => api.delete(`/admin/invoice-rules/${id}`),
      onSuccess: invalidate,
    }),
    saveCommunications: useMutation({
      mutationFn: (body) => api.patch('/admin/settings/communications', body),
      onSuccess: invalidate,
    }),
    runInvoiceRules: useMutation({
      mutationFn: (dryRun) => api.post(`/admin/invoice-rules/run?dryRun=${dryRun ? 'true' : 'false'}`),
      onSuccess: invalidate,
    }),
  };
}
