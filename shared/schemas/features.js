/**
 * The feature registry (SAAS_PLATFORM §3.1, §5.1).
 *
 * **The canonical list of every switchable capability, and the only place a
 * feature key is defined.** A key names a *capability*, never a screen's file
 * path, so a screen can move without breaking a tenant's configuration.
 *
 * Each entry carries a **default per business type** rather than a single
 * `default`, because §1.1's table *is* that column: a parts wholesaler should
 * never be shown a Ticket queue, and a repair shop should never be shown
 * Returns. `both` is **derived** as the union (`defaultFor` below), never
 * stored - a third hand-maintained column drifts the first time a key is added
 * to one of the other two and not to it, and the failure is silent.
 *
 * ## Rules this file exists to hold
 *
 * 1. **Off means invisible, not broken.** A disabled feature loses its nav
 *    entry, its `+ Create` entry, its command-palette entries and its
 *    notification sources. Server-side, its routes answer **404 - not 403**,
 *    because a tenant without a feature should not learn it exists.
 * 2. **A flag never hides data that already exists.** Turning `sales.quotes`
 *    off stops new quotes and removes the screen; it does not delete `Quote`
 *    documents and it does not remove quotes from an invoice's history.
 * 3. **Money and ledger features are not flaggable.** `pricingService`,
 *    `storeCreditService`, the `CreditTransaction` ledger and `AuditLog` run
 *    for every tenant always - a tenant that can switch off its own audit trail
 *    is a tenant that cannot be audited. Those carry `locked: true`.
 * 4. **Introducing this layer is a no-op for the running product.** Cellvix is
 *    a `product` business, and its resolved set must be byte-identical to
 *    today's nav - including `sales.tickets`, which Cellvix has built and which
 *    therefore ships on as a per-business override even though the product
 *    default is off. The type's default is the starting point for a *new*
 *    business, not a retroactive edit to a running one. `CELLVIX_OVERRIDES`
 *    below is that one exception, written down rather than remembered.
 *
 * **Nothing reads this to deny anything yet.** There is no control plane and no
 * `Business` model (§5.5 is explicit that both stay out until Cellvix ships),
 * so `resolveFeatures()` returns the Cellvix set and `requireFeature` always
 * passes. What this buys now is that the shape is fixed before forty call sites
 * depend on it.
 */

/** The three business types. A business is one of these; it is never untyped. */
const BUSINESS_TYPES = ['product', 'service', 'both'];

/**
 * Every feature, in nav order.
 *
 * `nav` names the `ADMIN_NAV` key this gates, so the sidebar can find its flag
 * without a second mapping table that would drift. A feature with no `nav` row
 * is a behaviour rather than a screen.
 */
const FEATURES = [
  // ---- sales ---------------------------------------------------------------
  {
    key: 'sales.clients',
    label: 'Customers',
    description: 'Customer records, approvals, credit and store credit.',
    area: 'sales',
    nav: 'clients',
    // Every business has customers. There is no shape of business this is off
    // for, which is why it is on for both types rather than merely defaulted on.
    defaults: { product: true, service: true },
  },
  {
    key: 'sales.orders',
    label: 'Orders',
    description: 'Goods sold and fulfilled - the product pipeline.',
    area: 'sales',
    nav: 'orders',
    // A service business sells work, not goods. It runs Quote → Ticket →
    // Invoice instead, which is the mirror of this pipeline, not a subset.
    defaults: { product: true, service: false },
  },
  {
    key: 'sales.tickets',
    label: 'Tickets',
    description: 'Work to be done - the service pipeline.',
    area: 'sales',
    nav: 'tickets',
    defaults: { product: false, service: true },
  },
  {
    key: 'sales.rma',
    label: 'Returns',
    description: 'Goods coming back off a completed sale.',
    area: 'sales',
    nav: 'rma',
    // Needs an `Order` to exist, so it follows `sales.orders`. A return and a
    // ticket are opposite directions of travel, never the same record.
    defaults: { product: true, service: false },
  },
  {
    key: 'sales.quotes',
    label: 'Quotes',
    description: 'Priced offers, converted to an order or a ticket.',
    area: 'sales',
    nav: 'quotes',
    defaults: { product: false, service: true },
  },
  {
    key: 'sales.devices',
    label: 'Devices',
    description: 'The devices this shop takes in, for the ticket and quote pickers.',
    area: 'sales',
    // No nav row: this is reference data a staff member sets up once, so it lives
    // in Settings beside the parts taxonomy rather than in the daily Sales list.
    // The flag still gates the screen and its routes.
    /**
     * Service businesses only.
     *
     * **Not `Taxonomy`**, which is the catalogue's tree: every read of that one
     * counts products and prunes any branch with none, so a repair shop's
     * device list would prune itself away entirely. A shop also takes in
     * hardware it will never stock a part for. See `models/DeviceCatalog.js`.
     *
     * A product business has no use for it: nothing is handed across its
     * counter to be worked on.
     */
    defaults: { product: false, service: true },
  },
  {
    key: 'sales.kiosk',
    label: 'Kiosk',
    description: 'The self-service check-in tablet a customer fills in at the counter.',
    area: 'sales',
    /**
     * No nav row, because the kiosk is not a screen inside the panel.
     *
     * It runs at `/kiosk`, outside `AdminShell`, on its own cookie and with no
     * staff account behind it. What belongs in the sidebar is the screen that
     * configures it, which lives in Settings beside the device tree.
     *
     * The flag gates that settings screen and the launch shortcut. It does
     * **not** gate `/kiosk/config` and `/kiosk/unlock`: those are public by
     * design so a locked tablet can draw its own lock screen, and
     * `kiosk.isEnabled` in Settings is what actually refuses an unlock. Two
     * switches, and they mean different things - the flag says this business
     * may have a kiosk at all, the setting says the tablet in the window is
     * live today.
     *
     * Service businesses only: a customer hands a device across a counter. A
     * parts wholesaler has nobody standing there with something to check in.
     */
    defaults: { product: false, service: true },
  },
  {
    key: 'sales.services',
    label: 'Services',
    description: 'The price list a quote or a ticket picks its labour from.',
    area: 'sales',
    nav: 'services',
    /**
     * Service businesses only, by default.
     *
     * A parts wholesaler sells `Product` rows and has no labour to price. A
     * repair shop cannot quote without this: it is what the "Search a service"
     * picker on the quote and ticket forms reads, and with the flag off those
     * pickers fall back to free-typed lines - which still works, and is exactly
     * what a product business doing the occasional repair wants.
     */
    defaults: { product: false, service: true },
  },
  {
    key: 'sales.webquotes',
    label: 'Web Quote',
    description: 'Enquiries arriving from the website contact form.',
    area: 'sales',
    nav: 'web-quotes',
    defaults: { product: true, service: true },
  },
  {
    key: 'sales.invoices',
    label: 'Invoices',
    description: 'What is owed, what is paid, and the documents for both.',
    area: 'sales',
    nav: 'invoices',
    // Rule 3: an invoice is the money record. A business that cannot invoice
    // cannot be paid, and one that could switch invoicing off could hide income.
    locked: true,
    defaults: { product: true, service: true },
  },

  // ---- purchase ------------------------------------------------------------
  {
    key: 'purchase.suppliers',
    label: 'Suppliers',
    description: 'Who you buy from, their tags and their portal access.',
    area: 'purchase',
    nav: 'suppliers',
    defaults: { product: true, service: true },
  },
  {
    key: 'purchase.orders',
    label: 'Purchase Orders',
    description: 'Stock on order, supplier bidding, receiving and payment.',
    area: 'purchase',
    nav: 'pos',
    // Supplier bidding is part of this, not a section of its own - the `RFQ`
    // key that used to sit beside it went away with the record on 2026-09-11.
    // A service business buying supplies asks one supplier or five; that is a
    // way of using a purchase order, not a feature to switch off.
    defaults: { product: true, service: true },
  },
  {
    key: 'purchase.returns',
    label: 'Supplier returns',
    description: 'Stock going back out to a supplier, and the credit claimed.',
    area: 'purchase',
    nav: 'supplier-returns',
    // Off for Cellvix today - the business does not return stock to suppliers,
    // and the nav row carries `hidden: true` for that reason. The default here
    // is what a NEW business of each type would start with.
    defaults: { product: true, service: false },
  },
  {
    key: 'purchase.services',
    label: 'Bought-in services',
    description: 'Supplier subscriptions and service products.',
    area: 'purchase',
    nav: 'supplier-services',
    defaults: { product: true, service: true },
  },
  {
    key: 'purchase.expenses',
    label: 'Expenses',
    description: 'Money out, categorised, feeding the P&L.',
    area: 'purchase',
    nav: 'expenses',
    defaults: { product: true, service: true },
  },
  {
    key: 'purchase.inventory',
    label: 'Inventory',
    description: 'Stock on hand, the ledger behind it, and reorder levels.',
    area: 'purchase',
    nav: 'inventory',
    defaults: { product: true, service: true },
  },

  // ---- reports -------------------------------------------------------------
  {
    key: 'reports.pl',
    label: 'Profit & Loss',
    description: 'Revenue against expenses.',
    area: 'reports',
    nav: 'pl',
    defaults: { product: true, service: true },
  },
  {
    key: 'reports.tax',
    label: 'Tax report',
    description: 'GST/HST collected and paid, per province.',
    area: 'reports',
    nav: 'r-tax',
    // Rule 3: a tax position is not a feature somebody may switch off.
    locked: true,
    defaults: { product: true, service: true },
  },
  {
    key: 'reports.staff',
    label: 'Staff performance',
    description: 'Who sold or serviced what.',
    area: 'reports',
    nav: 'r-staff',
    defaults: { product: true, service: true },
  },

  // ---- marketing -----------------------------------------------------------
  {
    key: 'marketing.email',
    label: 'Email',
    description: 'One-to-one email and campaigns.',
    area: 'marketing',
    nav: 'email',
    defaults: { product: true, service: true },
  },
  {
    key: 'marketing.sms',
    label: 'SMS',
    description: 'Text messages and campaigns.',
    area: 'marketing',
    nav: 'sms',
    defaults: { product: true, service: true },
  },
  {
    key: 'marketing.whatsapp',
    label: 'WhatsApp',
    description: 'WhatsApp messages and campaigns.',
    area: 'marketing',
    nav: 'whatsapp',
    defaults: { product: true, service: true },
  },
  {
    key: 'marketing.calls',
    label: 'Calls',
    description: 'Logged calls against a customer record.',
    area: 'marketing',
    nav: 'calls',
    defaults: { product: true, service: true },
  },
  {
    key: 'marketing.referrals',
    label: 'Referrals',
    description: 'Customer referral codes and their payouts.',
    area: 'marketing',
    // No nav row since 2026-09-21: the screen moved to Settings → Financial.
    // The key still names the capability and still gates the route - a feature
    // names what a business may do, not where the menu puts it.
    defaults: { product: true, service: true },
  },
  {
    key: 'marketing.offers',
    label: 'Offers',
    description: 'Discounts, combos and promo codes.',
    area: 'marketing',
    // No nav row since 2026-09-21 - see the note on `marketing.referrals`.
    // Reached as Discount Codes in Settings → Financial.
    defaults: { product: true, service: true },
  },
  {
    key: 'marketing.blog',
    label: 'Blog',
    description: 'Editorial posts on the website.',
    area: 'marketing',
    nav: 'blog',
    // **Follows the storefront.** A blog post is published TO the public site,
    // so a service business with no storefront has nowhere to put one and
    // nothing to rank - which is why SEO switches off with it (§1.1). A repair
    // shop that starts selling accessories turns the storefront on and gets
    // both back as an override; it is not migrated to another type.
    defaults: { product: true, service: false },
  },
  {
    key: 'marketing.faq',
    label: 'FAQ',
    description: 'Questions and answers on the website.',
    area: 'marketing',
    nav: 'faq',
    // With the blog, and for the same reason: it is storefront content.
    defaults: { product: true, service: false },
  },
  {
    key: 'marketing.articles',
    label: 'Product articles',
    description: 'Long-form copy on a product page, authored per product.',
    area: 'marketing',
    nav: 'articles',
    // With the blog and the FAQ: an article is published TO the storefront and
    // is attached to a PRODUCT, so a service business has neither the page to
    // put it on nor the catalogue to attach it to.
    defaults: { product: true, service: false },
  },

  // ---- outlets and scheduling ---------------------------------------------
  {
    key: 'outlet.multi',
    label: 'Multiple outlets',
    description: 'More than one physical location inside this business.',
    area: 'outlet',
    nav: 'outlet',
    defaults: { product: true, service: true },
  },
  {
    key: 'scheduling.appointments',
    label: 'Appointments',
    description: 'Booked slots against a calendar.',
    area: 'settings',
    nav: 's-sched',
    // A wholesaler takes orders, not bookings; a repair shop takes both.
    defaults: { product: false, service: true },
  },

  // ---- storefront ----------------------------------------------------------
  {
    key: 'storefront.public',
    label: 'Public website',
    description: 'The catalogue, the filters and the product pages.',
    area: 'sales',
    defaults: { product: true, service: false },
  },
  {
    key: 'storefront.checkout',
    label: 'Online checkout',
    description: 'Customers placing their own orders.',
    area: 'sales',
    defaults: { product: true, service: false },
  },

  // ---- money, always on ----------------------------------------------------
  {
    key: 'billing.storecredit',
    label: 'Store credit',
    description: 'The store-credit balance and its ledger.',
    area: 'sales',
    // Rule 3. `storeCreditService` is the only place a balance moves, and a
    // ledger somebody can switch off is a ledger that cannot be reconciled.
    locked: true,
    defaults: { product: true, service: true },
  },
  {
    key: 'billing.credit',
    label: 'Line of credit',
    description: 'What the business lends a customer, and its terms.',
    area: 'sales',
    locked: true,
    defaults: { product: true, service: true },
  },
];

const FEATURE_BY_KEY = new Map(FEATURES.map((feature) => [feature.key, feature]));

/**
 * The default state of one feature for one business type.
 *
 * **`both` is the union**, derived here rather than stored: a key that is on
 * for either single type is on for `both`. That is what makes `both` a clean
 * union rather than a compromise, and it is why there is no third column to
 * forget to update.
 */
function defaultFor(feature, businessType) {
  if (feature.locked) return true;
  if (businessType === 'both') {
    return Boolean(feature.defaults.product || feature.defaults.service);
  }
  return Boolean(feature.defaults[businessType]);
}

/** Every feature's default state for a business type, as `{ key: boolean }`. */
function defaultsForType(businessType) {
  const set = {};
  for (const feature of FEATURES) set[feature.key] = defaultFor(feature, businessType);
  return set;
}

/**
 * Cellvix's per-business overrides.
 *
 * **Every entry here is a service-shaped feature Cellvix has built anyway**, and
 * that is exactly what an override is for. Cellvix is a `product` business, so
 * the type defaults switch these off - but the ticket queue, the quote list and
 * the scheduling settings are built, seeded and in use, and §3.2 rule 6 says
 * introducing flags must not change one pixel of the running product. The
 * type's default describes what a *new* product business starts with; it is not
 * a retroactive edit to one that already runs.
 *
 * That is also the argument against "fixing" the defaults instead: making
 * `sales.quotes` product-on would be writing the registry around what tenant #1
 * happens to have, which is precisely how a tenant's requirement later gets
 * read as a bug (§0.1). The defaults describe the *type*; the overrides
 * describe *this business*.
 *
 * When the control plane exists this moves into the business record. Until
 * then it lives here, written down rather than remembered.
 */
const CELLVIX_OVERRIDES = {
  'sales.tickets': true,
  // Cellvix quotes wholesale orders before they are placed - a product business
  // doing something the service column assumes, which is what an override is.
  'sales.quotes': true,
  // The scheduling settings screen ships in the panel today.
  'scheduling.appointments': true,
  // Cellvix does not return stock to suppliers. The nav row already carries
  // `hidden: true`; this is the same fact said in the registry's own terms, so
  // the two cannot disagree once the nav reads from here.
  'purchase.returns': false,
};

/** The business type Cellvix runs as. One tenant, one business, no switcher. */
const CELLVIX_BUSINESS_TYPE = 'product';

/**
 * The effective feature set for a business.
 *
 * ```
 * business-type defaults → plan defaults → per-business overrides → effective
 * ```
 *
 * Later wins, and an override always beats the type - a product business that
 * starts doing repairs gets `sales.tickets` switched on and keeps its type.
 * Nobody is migrated between types to gain a section.
 *
 * Plan defaults are the middle step and do not exist yet; there is no control
 * plane to hold them (§5.5). The signature has the seat for them so adding one
 * later is not a change to every caller.
 */
function resolveFeatures({
  businessType = CELLVIX_BUSINESS_TYPE,
  planDefaults = null,
  overrides = null,
} = {}) {
  const resolved = defaultsForType(businessType);

  if (planDefaults) {
    for (const [key, on] of Object.entries(planDefaults)) {
      if (FEATURE_BY_KEY.has(key)) resolved[key] = Boolean(on);
    }
  }

  if (overrides) {
    for (const [key, on] of Object.entries(overrides)) {
      if (FEATURE_BY_KEY.has(key)) resolved[key] = Boolean(on);
    }
  }

  // Rule 3, enforced rather than trusted: a locked feature is on whatever any
  // layer above said. An override that tried to switch off the audit trail is
  // not a configuration, it is a bug.
  for (const feature of FEATURES) {
    if (feature.locked) resolved[feature.key] = true;
  }

  return resolved;
}

/**
 * What Cellvix actually runs with today.
 *
 * The one call every current caller makes. It must stay byte-identical to
 * today's nav - `features.test` in the smoke suite is what proves it.
 */
function cellvixFeatures() {
  return resolveFeatures({
    businessType: CELLVIX_BUSINESS_TYPE,
    overrides: CELLVIX_OVERRIDES,
  });
}

/** Is this feature on in a resolved set? An unknown key is **on**, never off. */
function featureEnabled(features, key) {
  // An unknown key means a caller named a feature this registry does not
  // define - a typo, or a screen gated on a key nobody added. Answering "off"
  // would hide a working screen and look exactly like a deliberate setting.
  // Answering "on" leaves the screen up and leaves the mistake visible.
  if (!FEATURE_BY_KEY.has(key)) return true;
  return features?.[key] !== false;
}

/** The feature gating one `ADMIN_NAV` key, or `null` when a row is not gated. */
function featureForNav(navKey) {
  return FEATURES.find((feature) => feature.nav === navKey) ?? null;
}

export {
  BUSINESS_TYPES,
  CELLVIX_BUSINESS_TYPE,
  CELLVIX_OVERRIDES,
  FEATURES,
  FEATURE_BY_KEY,
  cellvixFeatures,
  defaultFor,
  defaultsForType,
  featureEnabled,
  featureForNav,
  resolveFeatures,
};
export default FEATURES;
