import { ADMIN_NAV } from '@shared/schemas/admin';

/**
 * Route metadata for the admin panel.
 *
 * Breadcrumbs are built from this, never parsed from the URL (ERP rework
 * §4b.2) - parsing is how you end up with `Purchase-orders` on screen. Every
 * entry declares a `label`, an optional `parent` key, and the build `phase`
 * that ships it. Anything with a phase above 1 renders `StubPage` for now.
 *
 * `section` names the nav group so the sidebar can keep the right parent open
 * on a detail route the nav itself never lists.
 */

/** The six sidebar groups, as breadcrumb ancestors. Not routes themselves. */
const GROUPS = {
  sales: { label: 'Sales' },
  purchase: { label: 'Purchase' },
  reports: { label: 'Reports' },
  marketing: { label: 'Marketing' },
  business: { label: 'Business' },
  settings: { label: 'Settings' },
};

/** Settings categories sit between `Settings` and a settings page (§4b.5). */
export const SETTINGS_CATEGORIES = [
  {
    key: 'business',
    label: 'Business & Organization',
    description: 'Who this business is on an invoice, an email and the storefront footer.',
  },
  {
    key: 'financial',
    label: 'Financial',
    description: 'Tax, invoicing, warranty, shipping, payment methods and inventory defaults.',
  },
  {
    key: 'users',
    label: 'Users & Access Control',
    description: 'Staff accounts and the roles that decide what each one can open.',
  },
  {
    key: 'scheduling',
    label: 'Scheduling & Booking',
    description: 'The weekly board and the appointment grid.',
  },
  {
    key: 'communications',
    label: 'Communications & Notifications',
    description: 'Automatic emails, reminders and the message templates behind them.',
  },
  {
    key: 'system',
    label: 'System & Audit Logs',
    description: 'Who changed what, and every sign-in attempt.',
  },
  {
    key: 'integrations',
    label: 'Integrations & API',
    description: 'Provider keys and third-party connections.',
  },
];

/**
 * One entry per screen, keyed by route path. `:param` segments are matched
 * positionally by `matchAdminRoute`.
 *
 * `phase` is the build phase from ERP rework §10. It drives the stub notice, so
 * a phase bump here is the only edit needed when a screen goes live.
 *
 * `built` says the screen actually exists, which `phase` alone cannot: phase 11
 * is ~16 screens landing across several passes, so its routes carry the same
 * phase number while some are real and some are still stubs. Anything reading
 * "is there a screen here" - the settings summary's cards - reads this flag.
 */
export const ADMIN_ROUTES = {
  // The full ERP dashboard - things-to-do cards, six KPIs, revenue chart - is
  // phase 3. The existing overview holds the route until then, so this entry
  // describes what is actually on screen rather than what is planned.
  '/admin': {
    label: 'Home',
    icon: 'Home',
    section: 'home',
    phase: 1,
    title: 'Dashboard',
    description: 'Approvals waiting, orders moving, receivables outstanding and stock running low.',
  },

  // Sales
  // "Customers" in the UI, `/admin/clients` in the URL. The route is not
  // renamed with the label: it is linked to from the dashboard, the bell, the
  // approvals redirect and saved bookmarks, and a cosmetic rename is not worth
  // breaking those. `clients` also stays the permission area name.
  '/admin/clients': {
    label: 'Customers',
    parent: 'sales',
    icon: 'Users',
    section: 'sales',
    phase: 1,
    title: 'Customers',
    description: 'Every business account, its credit terms and what it has ordered.',
  },
  // Approvals keeps its own screen until phase 2 folds it into Clients as a
  // status filter. It is time-critical, so it does not lose a home in the
  // meantime.
  '/admin/approvals': {
    label: 'Approvals',
    parent: '/admin/clients',
    icon: 'ShieldCheck',
    section: 'sales',
    phase: 1,
    title: 'Approvals',
    description: 'Businesses waiting on a decision before they can see pricing or order.',
  },
  '/admin/clients/:id': {
    label: 'Customer',
    parent: '/admin/clients',
    icon: 'Users',
    section: 'sales',
    phase: 1,
    title: 'Customer profile',
    description: 'Orders, invoices, quotes, RMAs and credit for one account.',
  },
  '/admin/clients/:id/edit': {
    label: 'Edit',
    parent: '/admin/clients/:id',
    icon: 'Users',
    section: 'sales',
    phase: 1,
    title: 'Edit customer',
    description: 'Update the contact details and address on this account.',
  },
  '/admin/tickets': {
    label: 'Tickets',
    parent: 'sales',
    icon: 'ClipboardList',
    section: 'sales',
    phase: 1,
    title: 'Tickets',
    description: 'Track every repair from intake to completion.',
  },
  '/admin/tickets/:id': {
    label: 'Ticket',
    parent: '/admin/tickets',
    icon: 'ClipboardList',
    section: 'sales',
    phase: 1,
    built: true,
    title: 'Ticket',
    description: 'The job, its stage, what has been paid and what it comes to.',
  },
  '/admin/tickets/new': {
    label: 'New ticket',
    parent: '/admin/tickets',
    icon: 'ClipboardList',
    section: 'sales',
    phase: 1,
    title: 'New repair ticket',
    description: 'Capture the whole job - device, condition, services, parts and pricing.',
  },
  '/admin/tickets/:id': {
    label: 'Ticket',
    parent: '/admin/tickets',
    icon: 'ClipboardList',
    section: 'sales',
    phase: 1,
    title: 'Ticket detail',
    description: 'The device, the fault, who is on it and what has happened so far.',
  },
  '/admin/web-quotes': {
    label: 'Web Quote',
    parent: 'sales',
    icon: 'Globe',
    section: 'sales',
    phase: 1,
    title: 'Web quotes',
    description: 'Enquiries from the website, before anybody has priced them.',
  },
  '/admin/rma': {
    label: 'Returns',
    parent: 'sales',
    icon: 'RotateCcw',
    section: 'sales',
    phase: 7,
    title: 'Returns',
    description: 'Items coming back, from request through inspection to resolution.',
  },
  '/admin/rma/:id': {
    label: 'Return',
    parent: '/admin/rma',
    icon: 'RotateCcw',
    section: 'sales',
    phase: 7,
    title: 'RMA detail',
    description: 'Per-item disposition, inspection notes and the resolution.',
  },
  '/admin/orders': {
    label: 'Orders',
    parent: 'sales',
    icon: 'Package',
    section: 'sales',
    phase: 1,
    title: 'Orders',
    description: 'Every order placed, its fulfilment status and tracking.',
  },
  '/admin/orders/:orderNumber': {
    label: 'Order',
    parent: '/admin/orders',
    icon: 'Package',
    section: 'sales',
    phase: 12,
    built: true,
    title: 'Order detail',
    description: 'Lines, totals, payment and the status timeline.',
  },
  '/admin/invoices': {
    label: 'Invoices',
    parent: 'sales',
    icon: 'FileText',
    section: 'sales',
    phase: 1,
    title: 'Invoices',
    description: 'Issued, paid, outstanding and overdue - plus recording a payment.',
  },
  '/admin/invoices/create': {
    label: 'New invoice',
    parent: '/admin/invoices',
    icon: 'FileText',
    section: 'sales',
    phase: 12,
    built: true,
    title: 'New invoice',
    description: 'Bill a repair: devices, services, parts and travel.',
  },
  '/admin/invoices/:number': {
    label: 'Invoice',
    parent: '/admin/invoices',
    icon: 'FileText',
    section: 'sales',
    phase: 12,
    built: true,
    title: 'Invoice detail',
    description: 'Lines, payments and the document itself.',
  },
  '/admin/quotes': {
    label: 'Quotes',
    parent: 'sales',
    icon: 'FileSignature',
    section: 'sales',
    phase: 7,
    title: 'Quotes',
    description: 'Price quotes built for an account, and what became of them.',
  },
  '/admin/services': {
    tabOrder: 5,
    label: 'Services',
    parent: 'sales',
    icon: 'Wrench',
    section: 'sales',
    phase: 7,
    /**
     * Also in Financial settings - both as a tab and as a card on the hub.
     *
     * The price list IS configuration: it is the master list a quote and a
     * ticket pick their labour from. Unlike Discount Codes and Referrals,
     * which moved out of Marketing entirely, this keeps its Sales nav row -
     * the counter reaches it several times a day, and it was not asked to
     * move. So `parent` stays `sales`, which keeps the breadcrumb honest, and
     * `settingsTab` lends it to the Financial row and grid.
     */
    settingsTab: 'financial',
    title: 'Services',
    description: 'The labour a quote or a ticket is priced from.',
  },
  '/admin/quotes/create': {
    label: 'New estimate',
    parent: '/admin/quotes',
    icon: 'FileSignature',
    section: 'sales',
    phase: 7,
    title: 'Create estimate',
    description: 'Prepare a service quote for a customer who has not left their device.',
  },
  '/admin/quotes/:id/edit': {
    label: 'Edit estimate',
    parent: '/admin/quotes',
    icon: 'FileSignature',
    section: 'sales',
    phase: 7,
    title: 'Edit estimate',
    description: 'Change what this estimate promises, before it becomes a ticket.',
  },
  '/admin/quotes/:id': {
    label: 'Quote',
    parent: '/admin/quotes',
    icon: 'FileSignature',
    section: 'sales',
    phase: 7,
    title: 'Quote detail',
    description: 'Line items, expiry and conversion to an order.',
  },

  // Purchase
  '/admin/suppliers': {
    label: 'Suppliers',
    parent: 'purchase',
    icon: 'Truck',
    section: 'purchase',
    phase: 5,
    title: 'Suppliers',
    description: 'The businesses you buy stock from.',
  },
  '/admin/suppliers/:id': {
    label: 'Supplier',
    parent: '/admin/suppliers',
    icon: 'Truck',
    section: 'purchase',
    phase: 5,
    title: 'Supplier profile',
    description: 'Terms, linked products, purchase history and price history.',
  },
  '/admin/purchase-orders': {
    label: 'Purchase Orders',
    parent: 'purchase',
    icon: 'ClipboardList',
    section: 'purchase',
    phase: 5,
    title: 'Purchase orders',
    description: 'Stock on order, who is pricing it, and what is still outstanding.',
  },
  '/admin/purchase-orders/create': {
    label: 'New purchase order',
    parent: '/admin/purchase-orders',
    icon: 'ClipboardList',
    section: 'purchase',
    phase: 5,
    title: 'New purchase order',
    description: 'List what you need, then choose which suppliers to ask for a price.',
  },
  '/admin/purchase-orders/:id': {
    label: 'Purchase order',
    parent: '/admin/purchase-orders',
    icon: 'ClipboardList',
    section: 'purchase',
    phase: 5,
    title: 'Purchase order detail',
    description: 'Suppliers asked, their prices, receiving and the automation stages.',
  },
  '/admin/supplier-returns': {
    label: 'RMA / Returns',
    parent: 'purchase',
    icon: 'RotateCcw',
    section: 'purchase',
    phase: 5,
    title: 'Returns to suppliers',
    description: 'Faulty and wrong stock going back, and the credit claimed for it.',
  },
  '/admin/supplier-returns/:id': {
    label: 'Return',
    parent: '/admin/supplier-returns',
    icon: 'RotateCcw',
    section: 'purchase',
    phase: 5,
    title: 'Supplier return',
    description: 'What is going back, where it is, and what the supplier credited.',
  },
  '/admin/supplier-services': {
    label: 'Service Products',
    parent: 'purchase',
    icon: 'Wrench',
    section: 'purchase',
    phase: 5,
    title: 'Service products',
    description: 'Things bought in that are not stock - outsourced repair, freight, disposal.',
  },
  '/admin/supplier-subscriptions': {
    label: 'Subscription Plans',
    parent: 'purchase',
    icon: 'CalendarClock',
    section: 'purchase',
    phase: 5,
    title: 'Subscription plans',
    description: 'Recurring supplier costs, what they renew and what they add up to.',
  },
  '/admin/expenses': {
    label: 'Expenses',
    parent: 'purchase',
    icon: 'Receipt',
    section: 'purchase',
    phase: 5,
    title: 'Expenses',
    description: 'Money out - categorised, taxed and feeding the P&L.',
  },
  '/admin/inventory': {
    label: 'Inventory',
    parent: 'purchase',
    icon: 'Boxes',
    section: 'purchase',
    phase: 1,
    title: 'Inventory',
    description: 'The product catalogue, stock on hand and wholesale pricing.',
  },
  '/admin/inventory/:id': {
    label: 'Product',
    parent: '/admin/inventory',
    icon: 'Boxes',
    section: 'purchase',
    phase: 5,
    title: 'Product detail',
    description: 'Fields, taxonomy, benchmarks, stock movements and suppliers.',
  },

  // Reports
  '/admin/reports/business': {
    label: 'Business Overview',
    parent: 'reports',
    icon: 'LineChart',
    section: 'reports',
    phase: 6,
    title: 'Business overview',
    description: 'The printable period report: invoiced, spent, earned and owed.',
  },
  '/admin/reports': {
    label: 'Reports',
    parent: 'reports',
    icon: 'PieChart',
    section: 'reports',
    phase: 6,
    title: 'Reports',
    description: 'Summary, P&L, sales, expense, inventory, tax and staff analytics.',
  },

  // Marketing
  '/admin/marketing/calls': {
    label: 'Call',
    parent: 'marketing',
    icon: 'Phone',
    section: 'marketing',
    phase: 9,
    title: 'Calls',
    description: 'Log a call against an account and keep the contact history in one place.',
  },
  '/admin/marketing/email': {
    label: 'Email',
    parent: 'marketing',
    icon: 'Mail',
    section: 'marketing',
    phase: 9,
    title: 'Email campaigns',
    description: 'Bulk email to consenting accounts, with templates and unsubscribes.',
  },
  '/admin/marketing/sms': {
    label: 'SMS',
    parent: 'marketing',
    icon: 'MessageSquare',
    section: 'marketing',
    phase: 9,
    title: 'SMS',
    description: 'Compose and log SMS to an account.',
  },
  '/admin/marketing/whatsapp': {
    label: 'WhatsApp',
    parent: 'marketing',
    icon: 'MessageCircle',
    section: 'marketing',
    phase: 9,
    title: 'WhatsApp',
    description: 'Compose and log WhatsApp messages to an account.',
  },
  /**
   * Referrals - moved out of Marketing on 2026-09-21, alongside Discount
   * Codes, at the client's request.
   *
   * **The commission rate stays admin-only, wherever the screen sits.**
   * `PATCH /admin/referrals/rate` is `adminOnly`, not `settings: full`,
   * because the percentage multiplies every future payout - §6.13's reasoning
   * does not change because the card moved categories. A `settings: full` role
   * can open this screen and read the ledger; only an admin can move the rate.
   */
  '/admin/marketing/referrals': {
    tabOrder: 7,
    label: 'Referrals',
    parent: 'settings:financial',
    icon: 'Gift',
    section: 'settings',
    phase: 10,
    built: true,
    feature: 'marketing.referrals',
    title: 'Referral commission',
    description: 'The commission rate, who referred whom, and the store credit it has earned.',
  },
  /**
   * Discount Codes - moved out of Marketing on 2026-09-21, at the client's
   * request.
   *
   * A promo code is configuration an admin sets once, not a campaign they
   * send, so it sits with the rest of what Financial settings decides. The URL
   * is unchanged: every link ever shared points at it, and `Offer` is still
   * the only record behind a discount - `pricingService` remains the one place
   * a discount is decided, and this is one screen reached from a new place,
   * not a second discount surface.
   */
  '/admin/marketing/offers': {
    tabOrder: 6,
    label: 'Discount Codes',
    parent: 'settings:financial',
    icon: 'Percent',
    section: 'settings',
    phase: 1,
    built: true,
    feature: 'marketing.offers',
    title: 'Discount codes',
    description: 'Promo codes, combo bundles and the offers a price can carry.',
  },
  /**
   * New and edit offer - a page, not a modal (2026-09-21).
   *
   * No `tabOrder` and no `settingsTab`: a form reached FROM a tab is not itself
   * a tab, and listing it would put "New offer" in the row beside the screens
   * it is opened from. `parent` gives it the breadcrumb back to the list.
   */
  '/admin/marketing/offers/new': {
    label: 'New offer',
    parent: '/admin/marketing/offers',
    icon: 'Percent',
    section: 'settings',
    phase: 1,
    built: true,
    feature: 'marketing.offers',
    title: 'New offer',
    description: 'A promo code, a combo bundle or a deal.',
  },
  '/admin/marketing/offers/:id': {
    label: 'Edit offer',
    parent: '/admin/marketing/offers',
    icon: 'Percent',
    section: 'settings',
    phase: 1,
    built: true,
    feature: 'marketing.offers',
    title: 'Edit offer',
    description: 'A promo code, a combo bundle or a deal.',
  },
  '/admin/marketing/blog': {
    label: 'Blog',
    // The URL stays under `marketing`; the NAV groups it under SEO. The two
    // are allowed to differ - `section` is what the sidebar highlights on.
    parent: 'seo',
    icon: 'Newspaper',
    section: 'seo',
    phase: 1,
    title: 'Blog',
    description: 'Posts published to the storefront.',
  },
  '/admin/marketing/faq': {
    label: 'FAQ',
    parent: 'seo',
    icon: 'HelpCircle',
    section: 'seo',
    phase: 1,
    title: 'FAQ',
    description: 'Questions and answers published to the storefront.',
  },
  '/admin/marketing/articles': {
    label: 'Articles',
    parent: 'seo',
    icon: 'FileText',
    section: 'seo',
    phase: 1,
    title: 'Product articles',
    description: 'Long-form copy rendered on a product page.',
  },
  '/admin/marketing/reviews': {
    label: 'Reviews',
    parent: 'seo',
    icon: 'Star',
    section: 'seo',
    phase: 1,
    title: 'Product reviews',
    description: 'What buyers said, and the lever to hide one.',
  },
  '/admin/marketing/articles/:productId': {
    label: 'Edit article',
    parent: '/admin/marketing/articles',
    icon: 'Pencil',
    section: 'seo',
    phase: 1,
    title: 'Edit article',
    description: 'The article shown on this product page.',
  },

  // Business
  '/admin/businesses': {
    label: 'Businesses',
    parent: 'business',
    icon: 'Store',
    section: 'business',
    phase: 8,
    title: 'Businesses',
    description: 'Physical stores, their staff and their contact details.',
  },
  '/admin/businesses/add': {
    label: 'Add business',
    parent: '/admin/businesses',
    icon: 'PlusCircle',
    section: 'business',
    phase: 8,
    title: 'Add business',
    description: 'Identity, location, management and hours - with a live preview.',
  },
  '/admin/businesses/:id/edit': {
    label: 'Edit business',
    parent: '/admin/businesses',
    icon: 'Pencil',
    section: 'business',
    phase: 8,
    title: 'Edit business',
    description: 'Identity, location, management and hours - with a live preview.',
  },
  '/admin/businesses/:id': {
    label: 'Business',
    parent: '/admin/businesses',
    icon: 'Store',
    section: 'business',
    phase: 8,
    title: 'Business detail',
    description: 'One store, its staff and its details.',
  },

  // Settings - summary and the seven category landings share one screen.
  '/admin/settings': {
    label: 'Summary',
    parent: 'settings',
    icon: 'LayoutGrid',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Settings',
    description: 'Everything to configure your shop, grouped by area.',
  },
  '/admin/settings/business-info': {
    label: 'Business Info',
    parent: 'settings:business',
    icon: 'Building2',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Business info',
    description: 'Company name, contact details, GST/HST number and logo.',
  },
  '/admin/settings/sale': {
    tabOrder: 1,
    label: 'Sale Settings',
    parent: 'settings:financial',
    icon: 'Coins',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Sale settings',
    description: 'Regional defaults, invoice numbering, warranty by grade and shipping.',
  },
  '/admin/settings/invoice-labels': {
    tabOrder: 2,
    label: 'Invoice Statuses',
    parent: 'settings:financial',
    icon: 'Tag',
    section: 'settings',
    phase: 12,
    built: true,
    title: 'Invoice statuses',
    // Both halves live here now, as tabs: the manual list somebody sets by
    // hand, and the timed messages that go out on their own.
    description:
      'The statuses an admin sets on an invoice, and the timed messages invoices send.',
  },
  '/admin/settings/devices': {
    tabOrder: 12,
    label: 'Devices taken in',
    parent: 'settings:financial',
    icon: 'Smartphone',
    section: 'settings',
    phase: 11,
    built: true,
    // Same contract the kiosk card below states: the server already answers 404
    // on every `/admin/devices` route without this flag, so a card drawn
    // without it is a tile that opens onto nothing. A parts wholesaler takes no
    // hardware across a counter and has no list of it to keep.
    feature: 'sales.devices',
    title: 'Devices this shop takes in',
    description: 'The list behind the device pickers on a ticket, an estimate and the kiosk.',
  },
  '/admin/settings/kiosk': {
    tabOrder: 13,
    label: 'Kiosk',
    parent: 'settings:financial',
    icon: 'Tablet',
    section: 'settings',
    phase: 11,
    built: true,
    // Only a business with the flag has a kiosk at all, and the summary grid
    // reads this to decide whether to draw the card. Without it a parts
    // wholesaler would be offered a tablet for customers to check devices in
    // at, over a counter it does not have.
    feature: 'sales.kiosk',
    title: 'Self-service check-in',
    description: 'The counter tablet: whether it is live, its PIN, and what it says.',
  },
  '/admin/settings/taxonomy': {
    tabOrder: 4,
    // "Device & Models", not "Taxonomy": the second is what the model is
    // called in the code and means nothing to the person looking for the list
    // of phones. The page's own title has said devices, brands and models all
    // along.
    label: 'Device & Models',
    parent: 'settings:financial',
    // Not `Smartphone`: "Devices taken in" already carries that one, and the
    // two sit next to each other in the Financial row.
    icon: 'TabletSmartphone',
    section: 'settings',
    phase: 11,
    built: true,
    /**
     * The catalogue tree, so it belongs to a business that HAS a catalogue.
     *
     * Ungated, this sat in the Financial row of every business beside
     * "Devices taken in" - two screens with near-identical names, one of
     * them permanently reading "0 entries · Nothing here" on a repair shop.
     * Reported as "what is the difference, just keep one", which is the right
     * reaction to a menu offering both.
     *
     * They are NOT the same list, and merging them would break the one that
     * works: `Taxonomy` is the storefront filter and every read of it counts
     * products and prunes any branch counting zero, while `DeviceCatalog` is
     * what a shop takes across the counter - mostly devices it stocks no
     * parts for, which that pruning rule would delete outright. See the
     * docstring on `models/DeviceCatalog.js`.
     *
     * So the fix is the gate rather than the merge. `storefront.public` is
     * the exact complement of the `sales.devices` flag on the other screen:
     * product businesses get this one, service businesses get that one, and
     * a `both` business genuinely has two lists because it genuinely does
     * both jobs.
     */
    feature: 'storefront.public',
    title: 'Devices, brands, models & aliases',
    description: 'The master list behind every device picker and the search box.',
  },
  /**
   * Add a device model - a page, not a modal.
   *
   * No `tabOrder`: a form reached FROM a tab is not itself a tab, and listing
   * it would put "Add Model" in the row beside the screens it is opened from.
   * `parent` gives it the breadcrumb back to the list.
   */
  '/admin/settings/taxonomy/add': {
    label: 'Add Model',
    parent: '/admin/settings/taxonomy',
    icon: 'TabletSmartphone',
    section: 'settings',
    phase: 11,
    built: true,
    // Same gate as the list it belongs to - a child of a hidden screen that
    // stays reachable is a hidden screen with a back door.
    feature: 'storefront.public',
    title: 'Add device model',
    description: 'A new entry for the searchable device picker.',
  },
  '/admin/settings/taxonomy/import': {
    label: 'Import CSV',
    parent: '/admin/settings/taxonomy',
    icon: 'TabletSmartphone',
    section: 'settings',
    phase: 11,
    built: true,
    feature: 'storefront.public',
    title: 'Import device models',
    description: 'Bulk-add or update the device master list.',
  },
  '/admin/settings/shipping': {
    tabOrder: 11,
    label: 'Shipping Rates',
    parent: 'settings:financial',
    icon: 'Truck',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Shipping rates',
    description: 'Flat rate, free-over threshold and per-province surcharges.',
  },
  '/admin/settings/payment-methods': {
    tabOrder: 8,
    label: 'Payment Methods',
    parent: 'settings:financial',
    icon: 'CreditCard',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Payment methods',
    description: 'The list behind every payment and expense form.',
  },
  '/admin/settings/expense-categories': {
    tabOrder: 9,
    label: 'Expense Categories',
    parent: 'settings:financial',
    icon: 'Receipt',
    section: 'settings',
    phase: 5,
    title: 'Expense categories',
    description: 'How money out is grouped in the P&L and the expense report.',
  },
  '/admin/settings/inventory': {
    tabOrder: 10,
    label: 'Inventory Settings',
    parent: 'settings:financial',
    icon: 'Boxes',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Inventory defaults',
    // Describes the page as it is. It used to promise "general categories,
    // groups" as well, and neither is here: expense categories are their own
    // screen under Financial, and product groups were never built. A page
    // header that names sections the page does not have sends a staff member
    // scrolling for something that is not below.
    description:
      'The markup and margin a new product is pre-filled with, and when stock counts as low.',
  },
  '/admin/settings/agreements': {
    tabOrder: 14,
    label: 'Supplier Agreements',
    // Filed under Financial beside Expense Categories, which is where the rest
    // of the purchasing configuration lives.
    parent: 'settings:financial',
    icon: 'FileSignature',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Supplier agreements',
    description: 'The documents a supplier signs before they can quote or invoice.',
  },
  '/admin/settings/users': {
    label: 'Users',
    parent: 'settings:users',
    icon: 'UsersRound',
    section: 'settings',
    phase: 8,
    title: 'Staff accounts',
    description: 'Who can sign in to the panel, and as what.',
  },
  '/admin/settings/roles': {
    label: 'Roles & Access',
    parent: 'settings:users',
    icon: 'ShieldCheck',
    section: 'settings',
    phase: 8,
    title: 'Roles and access',
    description: 'Named roles carrying per-area access. Admin always wins.',
  },
  '/admin/settings/calendar': {
    label: 'Calendar',
    parent: 'settings:scheduling',
    icon: 'CalendarDays',
    section: 'settings',
    phase: 11,
    built: true,
    // The board reads `GET /admin/appointments`, which is gated on this flag -
    // so without it the screen draws its whole chrome around a 404 and reads as
    // an empty week rather than as a feature this business does not have.
    feature: 'scheduling.appointments',
    title: 'Calendar',
    description: 'The weekly board, by staff and by status.',
  },
  '/admin/settings/appointments': {
    label: 'Appointments',
    parent: 'settings:scheduling',
    icon: 'CalendarClock',
    section: 'settings',
    phase: 11,
    built: true,
    // Reads the same gated route as the Calendar board above.
    feature: 'scheduling.appointments',
    title: 'Appointments',
    description: 'The booking grid.',
  },
  '/admin/settings/email': {
    label: 'Email Settings',
    parent: 'settings:communications',
    icon: 'Mail',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Email settings',
    description: 'Which emails send automatically, and the reminder schedule.',
  },
  '/admin/settings/templates': {
    label: 'Message Templates',
    parent: 'settings:communications',
    icon: 'MessageSquare',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Message templates',
    description: 'One message per document and status, per channel.',
  },
  '/admin/settings/activity-log': {
    label: 'Activity Log',
    parent: 'settings:system',
    icon: 'ClipboardList',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Activity log',
    description: 'Every admin mutation: who, what, when and from where.',
  },
  '/admin/settings/security-log': {
    label: 'Security Log',
    parent: 'settings:system',
    icon: 'ShieldAlert',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Security log',
    // Not "and CSRF rejections", which §6.15 lists: this codebase has no CSRF
    // middleware, so promising a category the log can never contain would have
    // a staff member reading an empty result as "no attacks" rather than "not
    // measured". It goes back in when the check does.
    description: 'Sign-ins, failed attempts, lockouts and staff access changes.',
  },
  '/admin/settings/api-keys': {
    label: 'API Keys',
    parent: 'settings:integrations',
    icon: 'KeyRound',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'API keys',
    description: 'Provider credentials. Write-only - a stored secret never comes back.',
  },
  '/admin/settings/third-party': {
    label: 'Third-Party Apps',
    parent: 'settings:integrations',
    icon: 'Plug',
    section: 'settings',
    phase: 11,
    built: true,
    title: 'Third-party apps',
    description: 'Ready-made connections to Google and friends.',
  },

  '/admin/profile': {
    label: 'My Profile',
    icon: 'CircleUser',
    section: 'home',
    phase: 12,
    title: 'My profile',
    description: 'Your account, your role and your recent activity.',
  },
};

/**
 * Resolve a pathname to its metadata entry. Static paths win outright; a
 * `:param` segment matches anything, so `/admin/clients/abc123` finds
 * `/admin/clients/:id` without the caller knowing the shape.
 */
export function matchAdminRoute(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/admin';
  if (ADMIN_ROUTES[clean]) return { path: clean, ...ADMIN_ROUTES[clean] };

  const parts = clean.split('/');
  for (const [path, meta] of Object.entries(ADMIN_ROUTES)) {
    const candidate = path.split('/');
    if (candidate.length !== parts.length) continue;
    if (candidate.every((seg, i) => seg.startsWith(':') || seg === parts[i])) {
      return { path, ...meta };
    }
  }
  return null;
}

/**
 * Walk a route's ancestry to a breadcrumb trail, root first. `Home` is always
 * the first crumb (§4b.3) and is added by the component, not here.
 *
 * A `parent` is one of: a nav group key (`sales`), a settings category
 * (`settings:financial`), or another route path.
 */
export function adminBreadcrumbTrail(pathname, { recordLabel } = {}) {
  const meta = matchAdminRoute(pathname);
  if (!meta) return [];

  const trail = [];
  let cursor = meta;
  let guard = 0;

  const segments = pathname.replace(/\/+$/, '').split('/');

  while (cursor && guard < 10) {
    guard += 1;

    /**
     * An ancestor crumb links to the **actual** URL, not to its pattern.
     *
     * `/admin/clients/:id/edit` sits under `/admin/clients/:id`, and pushing
     * that key straight into `to` produced a crumb pointing at the literal
     * string `:id` - a dead link on every record. Because an ancestor is always
     * a prefix of the current path, its real URL is simply the first N segments
     * of the one being viewed.
     */
    const depth = cursor.path.split('/').length;
    const to = cursor.path.includes('/:') ? segments.slice(0, depth).join('/') : cursor.path;

    trail.unshift({ label: cursor.label, to });

    const { parent } = cursor;
    if (!parent) break;

    if (parent.startsWith('settings:')) {
      // A settings page sits under its category, which sits under the summary.
      // The summary is a real screen and carries the `Settings` label itself,
      // so the group heading is skipped here - otherwise the trail says
      // "Settings > Settings".
      const category = SETTINGS_CATEGORIES.find((c) => c.key === parent.slice(9));
      if (category) {
        trail.unshift({ label: category.label, to: `/admin/settings?cat=${category.key}` });
      }
      trail.unshift({ label: 'Settings', to: '/admin/settings' });
      break;
    }

    if (GROUPS[parent]) {
      // A group is a heading, not a screen - there is nowhere for it to link,
      // so it renders unlinked.
      trail.unshift({ label: GROUPS[parent].label, to: null });
      break;
    }

    cursor = ADMIN_ROUTES[parent] ? { ...ADMIN_ROUTES[parent], path: parent } : null;
  }

  /**
   * Detail pages name the record, not the type (§4b.6) - but the record is
   * named on **its own** crumb rather than always on the last one.
   *
   * On `/admin/clients/:id` those are the same crumb. On a child of it, such as
   * `/admin/clients/:id/edit`, they are not: naming the last crumb turned "Edit"
   * into the business name and left the parent reading a generic "Customer", so
   * the trail said `Customers > Customer > Northline` for a page that is an edit
   * form. The record crumb is the deepest one whose route pattern *ends* in a
   * parameter; if there is none, the last crumb is the record, as before.
   */
  if (recordLabel && trail.length) {
    let cursorPath = meta.path;
    let index = trail.length - 1;

    while (index >= 0 && !/\/:[^/]+$/.test(cursorPath)) {
      const parent = ADMIN_ROUTES[cursorPath]?.parent;
      if (!parent?.startsWith('/admin')) break;
      cursorPath = parent;
      index -= 1;
    }

    if (index >= 0 && /\/:[^/]+$/.test(cursorPath)) trail[index].label = recordLabel;
    else trail[trail.length - 1].label = recordLabel;
  }
  // The last crumb is the current page and is never a link (§4b.4).
  if (trail.length) trail[trail.length - 1].to = null;

  return trail;
}

/**
 * Which sidebar group to keep open, and which child to highlight.
 *
 * Longest match wins. `/admin/settings` is a prefix of every settings page, so
 * a plain `startsWith` would light up `Summary` while the user is on Roles;
 * and a detail route the nav never lists (`/admin/clients/:id`) still has to
 * highlight its list parent.
 *
 * `search` is not optional decoration. Two groups - Settings (`?cat=`) and
 * Reports (`?tab=`) - are a single path with a query string per child, so a
 * caller that passes only the pathname cannot tell Users & Access from Summary
 * and lights up the wrong row on every one of them.
 */
export function activeNavKeys(pathname, search = '') {
  const meta = matchAdminRoute(pathname);
  const section = meta?.section ?? 'home';
  const group = ADMIN_NAV.find((item) => item.key === section);
  const params = new URLSearchParams(search);

  // Settings' children are `?cat=` views of one path, so path matching cannot
  // separate them. The category comes from the URL when the user is on the
  // hub itself, and from `parent` when they are on a settings page that owns a
  // route of its own (`/admin/settings/users` belongs to `settings:users`).
  if (section === 'settings') {
    const category =
      (meta?.parent?.startsWith('settings:') ? meta.parent.slice(9) : null) ?? params.get('cat');
    const settingsChild = category
      ? group?.children?.find((c) => c.to.endsWith(`?cat=${category}`))
      : group?.children?.find((c) => c.to === '/admin/settings');
    return { group: section, child: settingsChild?.key ?? null };
  }

  let child = null;
  let bestLength = -1;

  for (const candidate of group?.children ?? []) {
    const [base, query] = candidate.to.split('?');
    const matches = pathname === base || pathname.startsWith(`${base}/`);
    if (!matches) continue;

    // A child that names a query parameter only wins when the URL carries the
    // same value - this is what separates the seven `/admin/reports?tab=` rows.
    // A child flagged `isDefault` also answers for the bare path, because the
    // page it points at drops the parameter rather than restating the default.
    if (query) {
      const expected = new URLSearchParams(query);
      const agrees = [...expected].every(
        ([key, value]) =>
          params.get(key) === value || (candidate.isDefault && params.get(key) === null),
      );
      if (!agrees) continue;
    }

    // Longest path wins, and among equal paths a query-bearing child beats the
    // bare one - otherwise `/admin/reports?tab=pl` would settle on whichever
    // `/admin/reports` row the list happened to reach first.
    const weight = base.length + (query ? 1 : 0);
    if (weight > bestLength) {
      child = candidate;
      bestLength = weight;
    }
  }

  // A route with no nav row of its own falls back to its breadcrumb parent
  // Approvals highlights Clients, a product detail highlights Inventory.
  if (!child && meta?.parent?.startsWith('/admin')) {
    child =
      group?.children?.find((candidate) => candidate.to.split('?')[0] === meta.parent) ?? null;
  }

  return { group: section, child: child?.key ?? null };
}
