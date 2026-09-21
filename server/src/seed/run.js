import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { controlModels, db } from '../db/models.js';
import '../models/Taxonomy.js';
import '../models/Product.js';
import '../models/User.js';
import '../models/Order.js';
import '../models/Invoice.js';
import '../models/CreditTransaction.js';
import '../models/BlogPost.js';
import '../models/Faq.js';
import '../models/Offer.js';
import '../models/Supplier.js';

import '../models/PurchaseOrder.js';
import '../models/Expense.js';
import '../models/ExpenseCategory.js';
import '../models/StockMovement.js';
import { buildTaxonomyDocs, buildProducts } from './generate.js';
import { BLOG_POSTS, GENERAL_FAQS, PRODUCT_FAQS, buildOffers } from './content.data.js';
import { EXPENSE_CATEGORIES } from './expense-categories.js';
import {
  SUPPLIERS,
  buildPurchaseOrders,
  buildExpenses,
  buildSupplierReturns,
  buildSupplierServices,
  costFor,
} from './purchase.data.js';
import { seedPurchaseBids } from './purchase-bids.js';
import '../models/Settings.js';
import '../models/Quote.js';
import '../models/Rma.js';
import { buildQuotes, buildRmas, buildWebQuotes } from './sales.data.js';
import '../models/Ticket.js';
import '../models/ContactMessage.js';
import '../models/Cart.js';
import '../models/Notification.js';
import { AuditLog } from '../models/AuditLog.js';
import '../models/SupplierReturn.js';
import '../models/SupplierService.js';
import '../models/Appointment.js';
import { buildRepairs } from './repairs.data.js';
import {
  SHOPPE_APPOINTMENTS,
  SHOPPE_CUSTOMERS,
  SHOPPE_EXPENSES,
  SHOPPE_STAFF,
  SHOPPE_SUPPLIERS,
  SHOPPE_WEB_QUOTES,
} from './cellshoppe.data.js';
import '../models/Role.js';
import Business from '../models/Business.js';
// Registers the schema so `controlModels()` can bind it - the seed writes a
// tenant, which is a control-plane record.
import '../models/Tenant.js';
import { ensureBuiltInRoles, ensureDefaultBusiness, nextBusinessCode } from '../services/accessService.js';
import { dbFor } from '../db/connections.js';
import { runInBusiness } from '../db/context.js';

import { ensureReferralCode } from '../services/referralService.js';

/**
 * Run a block of seeding inside one business's database.
 *
 * Every model the block touches - directly, or through a service several layers
 * down - resolves to this business's connection, because that is what
 * `runInBusiness` puts in async-local context. It is the same mechanism the
 * request pipeline uses; a script simply has to open the context itself, since
 * there is no middleware to do it.
 *
 * Each business writes into its own database, so the two businesses this seed
 * builds never share a collection.
 */
function inBusiness(business, fn) {
  return runInBusiness(
    { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
    fn,
  );
}

const DEMO_PASSWORD = 'Cellvix123!';

/** Mirrors blogService: read time is derived from the body, never authored. */
const readMinutes = (body) =>
  Math.max(1, Math.round(body.trim().split(/\s+/).filter(Boolean).length / 220));

const DEMO_USERS = [
  {
    businessName: 'Northline Device Repair',
    contactName: 'Dana Whitfield',
    email: 'buyer@cellvix.ca',
    phone: '+1 (416) 555-0142',
    status: 'approved',
    role: 'buyer',
    taxId: 'RT0001-88213',
    businessType: 'Repair shop',
    website: 'northlinerepair.ca',
    creditLimit: 2_500_000,
    balance: 431_250,
    terms: 'net30',
    addresses: [
      {
        label: 'Warehouse',
        contactName: 'Dana Whitfield',
        company: 'Northline Device Repair',
        line1: '184 Bathurst St, Unit 3',
        city: 'Toronto',
        region: 'ON',
        postal: 'M5V 2R7',
        country: 'Canada',
        phone: '+1 (416) 555-0142',
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
      {
        label: 'Storefront',
        contactName: 'Priya Raman',
        company: 'Northline Device Repair',
        line1: '2210 Yonge St',
        city: 'Toronto',
        region: 'ON',
        postal: 'M4S 2C6',
        country: 'Canada',
        isDefaultShipping: false,
        isDefaultBilling: false,
      },
    ],
    paymentMethods: [
      { type: 'card', brand: 'Visa', last4: '4242', expMonth: 11, expYear: 2029, isDefault: true },
      { type: 'terms', isDefault: false },
    ],
    accountRep: { name: 'Marc Deveau', email: 'marc@cellvix.ca', phone: '+1 (416) 555-0110' },
  },
  {
    // Referred by Northline (wired up after the users are saved, since it needs
    // Northline's id). Gives the referrals screen a real pairing rather than
    // only ever being seen in its empty state.
    referredByEmail: 'buyer@cellvix.ca',
    businessName: 'Pixel Point Mobile',
    contactName: 'Sam Okafor',
    email: 'pending@cellvix.ca',
    phone: '+1 (604) 555-0188',
    status: 'pending',
    role: 'buyer',
    businessType: 'Retailer',
  },
  {
    businessName: 'Cellvix',
    contactName: 'Cellvix Admin',
    email: 'admin@cellvix.ca',
    phone: '+1 (416) 555-0100',
    status: 'approved',
    role: 'admin',
  },
  // One staff account per built-in role (§7.6), so the Users and Roles screens
  // have something real to render and each permission level can be tried by
  // signing in rather than by reading the code.
  {
    businessName: 'Cellvix',
    contactName: 'Priya Raman',
    email: 'priya@cellvix.ca',
    phone: '+1 (416) 555-0141',
    status: 'approved',
    role: 'staff',
    staffRoleSlug: 'account-manager',
  },
  {
    businessName: 'Cellvix',
    contactName: 'Marcus Webb',
    email: 'marcus@cellvix.ca',
    phone: '+1 (416) 555-0142',
    status: 'approved',
    role: 'staff',
    staffRoleSlug: 'warehouse',
  },
  {
    businessName: 'Cellvix',
    contactName: 'Dana Okafor',
    email: 'dana@cellvix.ca',
    phone: '+1 (416) 555-0143',
    status: 'approved',
    role: 'staff',
    staffRoleSlug: 'front-desk',
  },
  // Extra pending accounts so the admin approval queue is not empty.
  {
    businessName: 'Maritime Mobile Works',
    contactName: 'Elise Gagnon',
    email: 'elise@maritimemobile.ca',
    phone: '+1 (902) 555-0119',
    status: 'pending',
    role: 'buyer',
    businessType: 'Repair shop',
  },
  {
    businessName: 'Prairie Tech Supply',
    contactName: 'Jordan Reyes',
    email: 'jordan@prairietech.ca',
    phone: '+1 (306) 555-0164',
    status: 'pending',
    role: 'buyer',
    businessType: 'Distributor',
  },
  {
    businessName: 'Westcoast Screen Co.',
    contactName: 'Amrit Sandhu',
    email: 'amrit@westcoastscreen.ca',
    phone: '+1 (778) 555-0177',
    status: 'approved',
    role: 'buyer',
    creditLimit: 1_000_000,
    balance: 0,
    terms: 'net15',
    // The one opted-out account, so the Unsubscribes register is not only ever
    // seen empty and a campaign's "skipped" count is exercised for real.
    unsubscribed: true,
  },
];

/**
 * The order book.
 *
 * `account` names whose order it is: `'primary'` is `buyer@cellvix.ca`, whose
 * history the account screens and the demo login are written around, and
 * anything else rotates through the other approved buyers. Every order used to
 * belong to the primary buyer, which left the admin Orders list a single-column
 * screen - no way to see the customer filter do anything, and every seeded
 * return came from the same account.
 *
 * The early rungs of the status ladder are represented on purpose: a board
 * where everything is `delivered` teaches nothing about the screen, and the
 * fulfilment actions only appear on an order that still has somewhere to go.
 */
const ORDER_HISTORY = [
  { daysAgo: 1, status: 'placed', itemCount: 3, account: 'other' },
  { daysAgo: 3, status: 'processing', itemCount: 4, account: 'primary' },
  { daysAgo: 5, status: 'processing', itemCount: 2, account: 'other' },
  { daysAgo: 8, status: 'shipped', itemCount: 5, account: 'other' },
  { daysAgo: 11, status: 'out_for_delivery', itemCount: 2, account: 'primary' },
  { daysAgo: 14, status: 'shipped', itemCount: 3, account: 'other' },
  { daysAgo: 19, status: 'delivered', itemCount: 4, account: 'other' },
  { daysAgo: 24, status: 'delivered', itemCount: 6, account: 'primary' },
  { daysAgo: 33, status: 'delivered', itemCount: 2, account: 'other' },
  { daysAgo: 41, status: 'cancelled', itemCount: 3, account: 'other' },
  { daysAgo: 47, status: 'delivered', itemCount: 3, account: 'primary' },
  { daysAgo: 55, status: 'delivered', itemCount: 5, account: 'other' },
  { daysAgo: 68, status: 'delivered', itemCount: 5, account: 'primary' },
  { daysAgo: 82, status: 'delivered', itemCount: 4, account: 'other' },
];

const STATUS_SEQUENCE = ['placed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

const CARRIERS = [
  { carrier: 'Purolator', url: 'https://www.purolator.com/en/shipping/tracker' },
  { carrier: 'Canada Post', url: 'https://www.canadapost-postescanada.ca/track-reperage' },
  { carrier: 'FedEx Canada', url: 'https://www.fedex.com/fedextrack' },
];

/**
 * Wipes and rebuilds every collection. Safe to run repeatedly.
 *
 * **This writes into more than one database.** Business
 * records go to the business's own database and the control plane keeps
 * tenants, plans, super admins and the `Business` documents themselves - so the
 * seed cannot be a flat sequence of `insertMany` calls against one connection
 * any more. `inBusiness()` below is what puts each block in the right place, and
 * with the split off every one of those contexts resolves to the same
 * connection and the behaviour is exactly what it was.
 */
async function seedDatabase({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  /**
   * Drop each business database outright, rather than clearing collections.
   *
   * A collection-by-collection wipe can only clear collections the seed knows
   * about, so anything left by an older version of the seed - or by a migration
   * that has since been removed - survives forever. Dropping the database is
   * the only wipe that is actually complete, and under the split it is cheap
   * because each business has its own.
   *
   * With the split off there is one database holding everything including the
   * control plane, so dropping it would take the `Business` documents with it
   * and the seed would have nothing to rebuild against. That case keeps the
   * collection-by-collection wipe below.
   */
  {
    const businesses = await Business.find({}).select('code name').lean();
    for (const business of businesses) {
      await dbFor(business.code).dropDatabase();
      log(`  dropped ${business.name} (${business.code})`);
    }
  }

  await Promise.all([
    db().Taxonomy.deleteMany({}),
    db().Product.deleteMany({}),
    db().User.deleteMany({}),
    db().Order.deleteMany({}),
    db().Invoice.deleteMany({}),
    db().CreditTransaction.deleteMany({}),
    db().BlogPost.deleteMany({}),
    db().Faq.deleteMany({}),
    db().Offer.deleteMany({}),
    // Phase 5. These reference products by id, so leaving them behind while
    // the catalogue is rebuilt would leave purchase orders pointing at parts
    // that no longer exist.
    db().Supplier.deleteMany({}),
    db().PurchaseOrder.deleteMany({}),
    db().Expense.deleteMany({}),
    db().ExpenseCategory.deleteMany({}),
    db().StockMovement.deleteMany({}),
    // Phase 6. Dropped and recreated from defaults so a reseed cannot leave a
    // half-edited settings document behind; `db().Settings.load()` rebuilds it.
    db().Settings.deleteMany({}),

    // Phase 7. Quotes reference products and RMAs reference orders, so both
    // have to go when the catalogue is rebuilt.
    db().Quote.deleteMany({}),
    db().Rma.deleteMany({}),

    // Phase 8. Staff users reference both, so they are rebuilt with the users.
    db().Role.deleteMany({}),
    Business.deleteMany({}),

    /**
     * The collections this used to leave standing.
     *
     * Every one of them holds a reference to a user, a product or an order, so
     * leaving them behind while those are rebuilt orphans the lot: a cart
     * pointing at deleted products, a notification linking to an order that no
     * longer exists, an audit entry describing a record nobody can open.
     *
     * It is also where the smoke suite's residue accumulated. `npm run smoke`
     * creates accounts to exercise the approval flow and does not clean them
     * up, so a database that had been smoke-tested a few times was carrying
     * ten `smoke-…@example.test` users and their notifications - visible in
     * the admin panel, and indistinguishable from demo data to anyone reading
     * the screen.
     */
    db().Ticket.deleteMany({}),
    db().ContactMessage.deleteMany({}),
    db().Cart.deleteMany({}),
    db().Notification.deleteMany({}),
    AuditLog.deleteMany({}),
    db().SupplierReturn.deleteMany({}),
    db().SupplierService.deleteMany({}),
    db().Appointment.deleteMany({}),
  ]);

  // ---- roles & businesses ----------------------------------------------------
  // The business first: roles are per-business and cannot be written until
  // there is a business database to write them into. `ensureBuiltInRoles` is
  // therefore called inside each business's own context further down, not here
  // - called here it wrote Cellvix's four roles into the control database and
  // left every seeded staff account pointing at a role its own business did not
  // have.
  const defaultBusiness = await ensureDefaultBusiness();

  /**
   * The tenant that owns both businesses (SAAS_PLATFORM §1).
   *
   * **A tenant is an account, not a business.** Cellvix and CellShoppe are two
   * businesses under one subscription, which is the case the whole slot model
   * exists for - and the case the seed used to leave unbuilt: both businesses
   * were created with no tenant at all, so the console's slot arithmetic read
   * zero of three used and the tenant-status gate had nothing to act on.
   *
   * Upserted by slug so a re-seed keeps whatever a super admin has since
   * changed about the account - its plan, its slot grant, its status.
   */
  const tenant = await controlModels().Tenant.findOneAndUpdate(
    { slug: 'cellvix-group' },
    {
      $setOnInsert: {
        name: 'Cellvix Group',
        slug: 'cellvix-group',
        status: 'active',
        contactName: 'Cellvix Admin',
        contactEmail: 'admin@cellvix.ca',
        // Three, so there is a free slot to demonstrate adding a business with.
        slots: 3,
      },
    },
    { upsert: true, new: true },
  );

  // `ensureDefaultBusiness` predates tenancy and creates Cellvix with no owner,
  // so the link is made here rather than there - that function also runs on a
  // bare boot, where no tenant exists to point at.
  if (!defaultBusiness.tenant) {
    defaultBusiness.tenant = tenant._id;
    defaultBusiness.slotGrantedAt = defaultBusiness.slotGrantedAt ?? new Date();
    await defaultBusiness.save();
  }

  /**
   * The second business, and the whole reason business *type* exists.
   *
   * **CellShoppe is service-based**, so its panel renders Tickets and Quotes
   * where Cellvix renders Orders and Returns, and it has no storefront at all
   * (SAAS_PLATFORM §1.1). Seeding both is what makes the switcher demonstrate
   * something rather than list one row - and what proves the feature resolver
   * actually reads the type rather than always answering with Cellvix's set.
   */
  const serviceBusiness = await Business.create({
    name: 'CellShoppe Phone & Laptop Fix',
    code: await nextBusinessCode(),
    // The subdomain this business answers on (SAAS_PLATFORM §4.2). Without it
    // a host can never resolve to this business and it is reachable only
    // through the admin switcher.
    slug: 'cellshoppe',
    businessType: 'service',
    status: 'active',
    // Indigo, not the old 'info' blue it carried: identity colours are kept
    // clear of the semantic ones so an accent is never read as a status
    // (shared/businessPalette.js).
    colorToken: 'indigo',
    // Owned by the same tenant as Cellvix - one account, two businesses, which
    // is what the switcher and the slot model exist for.
    tenant: tenant._id,
    slotGrantedAt: new Date(),
    address: {
      street: '1180 Kingsway',
      city: 'Vancouver',
      region: 'BC',
      postal: 'V5V 3C8',
      country: 'Canada',
    },
    phone: '+1 (604) 555-0175',
    email: 'shop@cellshoppe.ca',
    manager: 'Priya Raman',
    isDefault: false,
  });

  const rolesBySlug = new Map((await db().Role.find().lean()).map((r) => [r.slug, r]));
  log(
    `  roles: ${rolesBySlug.size} · businesses: ${defaultBusiness.code} (${defaultBusiness.businessType})` +
      ` · ${serviceBusiness.code} (${serviceBusiness.businessType})`,
  );

  /**
   * **Everything from here runs inside Cellvix's own database.**
   *
   * The wrap is deliberately not re-indented. Several hundred lines moving one
   * level would show as a wholly rewritten file in a diff, burying the handful
   * of lines that carry the actual change - and this restructure is exactly the
   * kind that needs to stay readable afterwards.
   *
   * The CellShoppe block further down opens its own context and closes it
   * again, so the two businesses' records never land in the same database even
   * though they are seeded from one function.
   */
  return inBusiness(defaultBusiness, async () => {

  // Roles are per-business and live in this database. Before the users, because
  // a staff account cannot be created without a role to hold.
  await ensureBuiltInRoles();

  // ---- taxonomy -----------------------------------------------------------
  const taxonomyDocs = buildTaxonomyDocs();
  const bySlug = new Map();

  // Insert level by level so each node's parent id already exists.
  for (const kind of ['deviceType', 'brand', 'series', 'model']) {
    const levelDocs = taxonomyDocs
      .filter((doc) => doc.kind === kind)
      .map(({ parentSlug, ...doc }) => ({
        ...doc,
        parent: parentSlug ? bySlug.get(parentSlug)._id : null,
      }));

    const inserted = await db().Taxonomy.insertMany(levelDocs);
    for (const doc of inserted) bySlug.set(doc.slug, doc);
  }
  log(`  taxonomy: ${bySlug.size} nodes`);

  // ---- products -----------------------------------------------------------
  // Above what the generator produces, so the trim below it never runs: it
  // strides through a flat list and would take single grades out of the middle
  // of a ladder. See the note in generate.js.
  const products = buildProducts({ targetCount: 2000 });
  const insertedProducts = await db().Product.insertMany(products);
  log(`  products: ${insertedProducts.length}`);

  // Cache counts on the tree so the sidebar and mega menu can show them without
  // an aggregation on every request.
  const counts = await db().Product.aggregate([
    { $match: { isActive: true } },
    {
      $facet: {
        deviceType: [{ $group: { _id: '$deviceTypeSlug', n: { $sum: 1 } } }],
        brand: [{ $group: { _id: '$brandSlug', n: { $sum: 1 } } }],
        series: [{ $group: { _id: '$seriesSlug', n: { $sum: 1 } } }],
        model: [{ $group: { _id: '$modelSlug', n: { $sum: 1 } } }],
      },
    },
  ]);

  const countOps = [];
  for (const group of Object.values(counts[0])) {
    for (const { _id, n } of group) {
      if (!_id) continue;
      countOps.push({ updateOne: { filter: { slug: _id }, update: { $set: { productCount: n } } } });
    }
  }
  if (countOps.length) await db().Taxonomy.bulkWrite(countOps);

  // ---- users --------------------------------------------------------------
  const users = [];
  for (const data of DEMO_USERS) {
    const { staffRoleSlug, unsubscribed, referredByEmail, ...fields } = data;

    /**
     * An admin belongs to the **tenant**, so it is written to the control plane
     * and carries `tenant` rather than `business` (SAAS_PLATFORM §1).
     *
     * That is what makes one login reach every business the tenant owns: the
     * header switcher changes which business database the panel reads, and the
     * account doing the reading is the same one either way. Staff and buyers
     * are written here, into this business's own database, because they belong
     * to the shop rather than to the account that owns it.
     */
    const isTenantAdmin = data.role === 'admin';
    const Model = isTenantAdmin ? controlModels().User : db().User;
    const user = new Model(isTenantAdmin ? { ...fields, tenant: tenant?._id ?? null } : fields);
    await user.setPassword(DEMO_PASSWORD);
    if (data.status === 'approved') user.approvedAt = new Date(Date.now() - 90 * 86_400_000);

    // CASL consent (§6.13). Buyers register through a form that records this;
    // seeded buyers get the same record so the marketing screens have a real
    // population to work with. Without it every campaign resolves to an empty
    // audience and the screens look broken when they are in fact correct
    // consent is closed by default, and a seeded account is still an account.
    //
    // Staff and admin are Cellvix, not customers, and are never in an
    // audience, so they get no consent record at all.
    if (data.role === 'buyer') {
      user.marketingConsent = {
        granted: true,
        source: 'registration',
        at: new Date(Date.now() - 120 * 86_400_000),
      };
      // One account opts out, so the Unsubscribes register and the "skipped"
      // count on a campaign send both have something real to show. A screen
      // whose empty state is the only state it is ever seen in is a screen
      // nobody has actually checked.
      if (unsubscribed) user.unsubscribedAt = new Date(Date.now() - 14 * 86_400_000);
    }

    // Staff are Cellvix people: they hold a role and stand in an business. An
    // admin holds neither - it bypasses the role system by design (§7.6).
    if (staffRoleSlug) {
      user.staffRole = rolesBySlug.get(staffRoleSlug)?._id ?? null;
      user.business = defaultBusiness._id;
    }

    // Referral code, minted on approval exactly as `approveUser` does it
    // (§6.13) - a pending business does not get one.
    if (data.status === 'approved' && data.role === 'buyer') {
      await ensureReferralCode(user);
    }

    users.push(await user.save());
  }

  // Referral attribution, once every account exists - it points at another
  // user's id, so it cannot be set while that user is still being created.
  // Set here and never again: attribution is fixed at registration (§6.13).
  for (const data of DEMO_USERS) {
    if (!data.referredByEmail) continue;
    const referred = users.find((row) => row.email === data.email);
    const referrer = users.find((row) => row.email === data.referredByEmail);
    if (!referred || !referrer) continue;
    referred.referredBy = referrer._id;
    await referred.save();
  }

  const staffIds = users.filter((u) => u.role === 'staff').map((u) => u._id);
  if (staffIds.length) {
    await Business.updateOne({ _id: defaultBusiness._id }, { $set: { staff: staffIds } });
  }
  log(`  users: ${users.length} (staff: ${staffIds.length})`);

  // ---- orders + invoices ---------------------------------------------------
  const primaryBuyer = users.find((u) => u.email === 'buyer@cellvix.ca');

  /**
   * The other approved buyers an order can belong to.
   *
   * An account needs an address before it can be shipped to - the order stores
   * a delivery address copied off the account, and one without an address would
   * produce an order nobody could dispatch. Falls back to the primary buyer if
   * no other approved account has one, so the seed still works on a cut-down
   * user list.
   */
  const otherBuyers = users.filter(
    (user) =>
      user.role === 'buyer' &&
      user.status === 'approved' &&
      user.email !== 'buyer@cellvix.ca' &&
      user.addresses?.length,
  );

  const inStock = insertedProducts.filter((p) => p.stock > 0);
  const orders = [];
  const invoices = [];

  let otherCursor = 0;

  ORDER_HISTORY.forEach((spec, index) => {
    const buyer =
      spec.account === 'primary' || !otherBuyers.length
        ? primaryBuyer
        : otherBuyers[otherCursor++ % otherBuyers.length];

    const placedAt = new Date(Date.now() - spec.daysAgo * 86_400_000);
    const picks = Array.from({ length: spec.itemCount }, (_, i) => {
      // Deterministic spread through the catalogue, not random.
      return inStock[(index * 37 + i * 53) % inStock.length];
    });

    const items = picks.map((product, i) => {
      const qty = 1 + ((index + i) % 5);
      return {
        product: product._id,
        sku: product.sku,
        name: product.name,
        slug: product.slug,
        grade: product.grade,
        // Carried so order history renders the same part illustration as the
        // grid - without these the account page falls back to a generic drawing.
        partType: product.partType,
        partTypeLabel: product.partTypeLabel,
        qty,
        unitPrice: product.price,
        lineTotal: product.price * qty,
        // Cost snapshotted at order time (§9.4), so the reports have a real
        // margin to compute rather than treating every seeded line as pure
        // profit. Same grade-aware ratio the purchase seed uses, so a part's
        // sale cost and its purchase cost tell the same story.
        unitCost: costFor(product),
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const shipping = subtotal > 50_000 ? 0 : 1895;
    const tax = Math.round((subtotal + shipping) * 0.13); // placeholder HST, see PROGRESS.md Q4
    const total = subtotal + shipping + tax;

    /**
     * The rungs this order actually climbed.
     *
     * `cancelled` is not on the ladder - it is an exit that can happen from
     * anywhere - so an order that stopped there is given the rungs it reached
     * before it did, plus the cancellation itself. Without this its
     * `indexOf` is -1 and the order lands with an empty timeline, which the
     * tracking stepper renders as an order that never happened.
     */
    const reached =
      spec.status === 'cancelled'
        ? ['placed', 'processing', 'cancelled']
        : STATUS_SEQUENCE.slice(0, STATUS_SEQUENCE.indexOf(spec.status) + 1);

    const timeline = reached.map((status, i) => ({
      status,
      at: new Date(placedAt.getTime() + i * 26 * 3_600_000),
      note:
        status === 'placed'
          ? 'Order received and confirmed.'
          : status === 'processing'
            ? 'Picking and quality-checking parts at the Toronto warehouse.'
            : status === 'shipped'
              ? 'Handed to the carrier.'
              : status === 'out_for_delivery'
                ? 'On the delivery vehicle.'
                : status === 'cancelled'
                  ? 'Cancelled at the customer’s request before dispatch.'
                  : 'Signed for at the delivery address.',
    }));

    const carrier = CARRIERS[index % CARRIERS.length];
    const shipped = reached.includes('shipped');

    orders.push({
      orderNumber: `CVX-2026-${String(10_042 + index).padStart(5, '0')}`,
      user: buyer._id,
      items,
      subtotal,
      shipping,
      tax,
      total,
      status: spec.status,
      timeline,
      createdAt: placedAt,
      shippingAddress: {
        contactName: buyer.contactName,
        company: buyer.businessName,
        line1: buyer.addresses[0].line1,
        city: buyer.addresses[0].city,
        region: buyer.addresses[0].region,
        postal: buyer.addresses[0].postal,
        country: 'Canada',
        phone: buyer.phone,
      },
      billingAddress: {
        contactName: buyer.contactName,
        company: buyer.businessName,
        line1: buyer.addresses[0].line1,
        city: buyer.addresses[0].city,
        region: buyer.addresses[0].region,
        postal: buyer.addresses[0].postal,
        country: 'Canada',
      },
      deliveryMethod: { code: 'ground', label: 'Ground - 2 to 4 business days', cost: shipping, etaDays: 3 },
      poNumber: `PO-${4400 + index}`,
      payment: {
        method: index % 2 === 0 ? 'terms' : 'card',
        status: spec.status === 'delivered' ? 'paid' : 'pending',
        mockRef: `mock_${placedAt.getTime()}`,
        paidAt: spec.status === 'delivered' ? placedAt : undefined,
      },
      tracking: shipped
        ? { carrier: carrier.carrier, number: `CVX${9_100_000 + index * 7311}`, url: carrier.url }
        : undefined,
    });
  });

  const insertedOrders = await db().Order.insertMany(orders);
  log(`  orders: ${insertedOrders.length}`);

  insertedOrders.forEach((order, index) => {
    // A cancelled order is never billed. It used to be impossible to reach
    // here - every seeded order was delivered or on its way - and raising an
    // invoice for goods that were never sent would put money on the books
    // that nobody owes.
    if (order.status === 'cancelled') return;

    const issuedAt = order.createdAt;
    const dueDate = new Date(issuedAt.getTime() + 30 * 86_400_000);
    const paid = order.status === 'delivered';
    const overdue = !paid && dueDate < new Date();

    // A few days after the invoice went out, and never later than today.
    const settledAt = new Date(issuedAt.getTime() + (4 + (index % 9)) * 86_400_000);
    const paidAt = settledAt > new Date() ? new Date() : settledAt;

    invoices.push({
      number: `INV-2026-${String(10_042 + index).padStart(5, '0')}`,
      order: order._id,
      // The order's own buyer, not the loop variable left over from building
      // the orders above - that pointed at whoever happened to be assigned
      // last, so every invoice would have been billed to one account once the
      // order book stopped belonging to a single buyer.
      user: order.user,
      amount: order.total,
      amountPaid: paid ? order.total : 0,
      issuedAt,
      dueDate,
      terms: 'net30',
      status: paid ? 'paid' : overdue ? 'overdue' : 'unpaid',
      /**
       * Paid **somewhere between the issue date and now** - never on the due
       * date.
       *
       * Dating the payment `dueDate` was wrong twice. A Net-30 invoice raised
       * last week has a due date next month, so the seed wrote a payment
       * dated in the future: the account activity feed showed money arriving
       * on a day that has not happened. And it implied every customer pays
       * on the exact deadline, which made the collections figures meaningless.
       *
       * Clamped to `now` so a recently-issued invoice cannot produce a
       * future-dated payment however the window falls.
       */
      payments: paid
        ? [
            {
              amount: order.total,
              at: paidAt,
              method: 'EFT',
              reference: `EFT-${88_400 + index}`,
            },
          ]
        : [],
    });
  });

  await db().Invoice.insertMany(invoices);
  log(`  invoices: ${invoices.length}`);

  // ---- store credit --------------------------------------------------------
  // Seeded as a ledger, not as a number on the user, because that is how the
  // running system produces a balance: three movements that add up. The cached
  // balance on the account is written to match, exactly as storeCreditService
  // would have left it.
  const creditRows = [
    {
      amount: 25_000,
      type: 'recharge',
      note: 'Account top-up',
      daysAgo: 26,
      paymentRef: 'mock_card_TOPUP-seed',
    },
    {
      amount: 8_450,
      type: 'refund',
      note: `Refund for ${insertedOrders[2]?.orderNumber ?? 'a returned part'}`,
      order: insertedOrders[2]?._id,
      orderNumber: insertedOrders[2]?.orderNumber,
      daysAgo: 12,
    },
    {
      amount: -14_200,
      type: 'redemption',
      note: `Applied to ${insertedOrders[0]?.orderNumber ?? 'an order'}`,
      order: insertedOrders[0]?._id,
      orderNumber: insertedOrders[0]?.orderNumber,
      daysAgo: 4,
    },
  ];

  let creditRunning = 0;
  const creditDocs = creditRows.map((row) => {
    creditRunning += row.amount;
    return {
      user: primaryBuyer._id,
      amount: row.amount,
      balanceAfter: creditRunning,
      type: row.type,
      note: row.note,
      order: row.order,
      orderNumber: row.orderNumber,
      paymentRef: row.paymentRef,
      createdAt: new Date(Date.now() - row.daysAgo * 86_400_000),
    };
  });

  await db().CreditTransaction.insertMany(creditDocs);
  await db().User.updateOne({ _id: primaryBuyer._id }, { $set: { storeCredit: creditRunning } });
  log(`  store credit: ${creditDocs.length} movements, balance ${creditRunning}c`);

  // ---- editorial content ---------------------------------------------------
  const posts = await db().BlogPost.insertMany(
    BLOG_POSTS.map((post) => ({ ...post, readMinutes: readMinutes(post.body) })),
  );
  log(`  blog posts: ${posts.length}`);

  const faqs = await db().Faq.insertMany([
    ...GENERAL_FAQS.map((faq) => ({ ...faq, scope: 'general', isPublished: true })),
    ...PRODUCT_FAQS.map((faq) => ({ ...faq, scope: 'product', isPublished: true })),
  ]);
  log(`  faqs: ${faqs.length}`);

  const offers = await db().Offer.insertMany(buildOffers(insertedProducts));
  log(`  offers: ${offers.length}`);

  // ---- purchase (phase 5) -------------------------------------------------
  // Suppliers, purchase orders, the stock the received ones put on the shelf,
  // and the expenses. Written after the catalogue because every PO line and
  // every movement points at a product id.

  const categories = await db().ExpenseCategory.insertMany(EXPENSE_CATEGORIES);
  const categoriesBySlug = new Map(categories.map((category) => [category.slug, category]));
  log(`  expense categories: ${categories.length}`);

  const suppliers = await db().Supplier.insertMany(SUPPLIERS);
  const suppliersByCode = new Map(suppliers.map((supplier) => [supplier.code, supplier]));
  log(`  suppliers: ${suppliers.length}`);

  const year = new Date().getFullYear();
  const { orders: poDocs, movements: poMovements } = buildPurchaseOrders({
    products: insertedProducts,
    suppliersByCode,
    year,
  });

  // Received stock is added to what the catalogue generator already put on the
  // shelf, and `qtyAfter` is written from the running total rather than from
  // the receipt alone - a movement whose `qtyAfter` disagrees with the product
  // is precisely the reconciliation failure the ledger exists to make visible.
  const runningStock = new Map(
    insertedProducts.map((product) => [product._id.toString(), product.stock]),
  );

  const movementDocs = poMovements.map((movement) => {
    const key = movement.product.toString();
    const after = (runningStock.get(key) ?? 0) + movement.qtyChange;
    runningStock.set(key, after);
    return {
      product: movement.product,
      type: movement.type,
      qtyChange: movement.qtyChange,
      qtyAfter: after,
      unitCost: movement.unitCost,
      reference: movement.reference,
      createdAt: movement.createdAt,
      updatedAt: movement.createdAt,
    };
  });

  const insertedPos = await db().PurchaseOrder.insertMany(
    poDocs.map(({ _paid, _method, ...po }) => po),
  );
  log(`  purchase orders: ${insertedPos.length}`);

  // Point each movement at the purchase order that produced it, now that the
  // POs have ids, and give every received part its cost - a receipt is the
  // moment the true cost is known, which is what `receivePurchaseOrder` does.
  const poByNumber = new Map(insertedPos.map((po) => [po.poNumber, po]));
  for (const movement of movementDocs) {
    const po = poByNumber.get(movement.reference.label);
    if (po) movement.reference = { ...movement.reference, id: po._id };
  }

  if (movementDocs.length) await db().StockMovement.insertMany(movementDocs);
  log(`  stock movements: ${movementDocs.length}`);

  await Promise.all(
    [...runningStock.entries()].map(([id, stock]) => db().Product.updateOne({ _id: id }, { stock })),
  );

  const receivedCosts = new Map();
  for (const po of insertedPos) {
    for (const item of po.items) {
      if (item.qtyReceived > 0) receivedCosts.set(item.product.toString(), item.unitCost);
    }
  }
  await Promise.all(
    [...receivedCosts.entries()].map(([id, cost]) => db().Product.updateOne({ _id: id }, { cost })),
  );

  // The expenses a paid purchase order generated. Same shape the running code
  // writes, so the P&L cannot tell a seeded row from a real one.
  const purchaseCategory = categoriesBySlug.get('inventory-purchases');
  const poExpenses = [];
  let expenseSequence = 1;

  for (const [index, plan] of poDocs.entries()) {
    if (!plan._paid) continue;
    const po = insertedPos[index];
    const supplier = suppliers.find((row) => String(row._id) === String(po.supplier));

    poExpenses.push({
      number: `EXP-${year}-${String(expenseSequence).padStart(5, '0')}`,
      date: po.receivedDate ?? po.orderDate,
      description: `Purchase Order ${po.poNumber} - ${supplier?.name ?? 'supplier'}`,
      category: purchaseCategory._id,
      payee: supplier?.name,
      method: plan._method,
      status: 'paid',
      amount: po.total,
      tax: po.tax,
      taxIncluded: true,
      reference: po.poNumber,
      purchaseOrder: po._id,
    });
    expenseSequence += 1;
  }

  const insertedPoExpenses = poExpenses.length ? await db().Expense.insertMany(poExpenses) : [];

  // Close the loop the running code closes: a paid PO carries the expense its
  // payment created, so the two can never be counted twice.
  await Promise.all(
    insertedPoExpenses.map((expense) =>
      db().PurchaseOrder.updateOne(
        { _id: expense.purchaseOrder },
        {
          payment: {
            status: 'paid',
            method: expense.method,
            reference: expense.reference,
            paidAt: expense.date,
            expense: expense._id,
          },
        },
      ),
    ),
  );

  const manualExpenses = await db().Expense.insertMany(
    buildExpenses({ categoriesBySlug, year, startSequence: expenseSequence }),
  );
  log(`  expenses: ${insertedPoExpenses.length + manualExpenses.length}`);

  /**
   * Supplier returns and supplier services (§6.8b, §6.8c).
   *
   * Both screens had no seeded rows at all, so each was only ever seen in its
   * empty state. The returns are built from real purchase-order lines - you
   * cannot send back a part you never bought, which is the rule
   * `supplierReturnService` enforces - and the services reference real expense
   * categories, since that is what the P&L groups them by.
   */
  const supplierReturns = await db().SupplierReturn.insertMany(
    buildSupplierReturns({ purchaseOrders: insertedPos, year }),
  );
  log(`  supplier returns: ${supplierReturns.length}`);

  const supplierServices = await db().SupplierService.insertMany(
    buildSupplierServices({ categoriesBySlug, suppliersByCode }),
  );
  log(`  supplier services: ${supplierServices.length}`);

  // Supplier card figures, recomputed from the orders exactly as
  // `purchaseService.refreshSupplierTotals` does - never incremented.
  await Promise.all(
    suppliers.map(async (supplier) => {
      const [row] = await db().PurchaseOrder.aggregate([
        {
          $match: {
            supplier: new mongoose.Types.ObjectId(String(supplier._id)),
            status: { $nin: ['draft', 'cancelled'] },
          },
        },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ]);
      await db().Supplier.updateOne(
        { _id: supplier._id },
        { ordersCount: row?.count ?? 0, totalSpent: row?.total ?? 0 },
      );
    }),
  );

  // A default supplier, a reorder point and a cost per product, so Inventory
  // and the reports have something to show in those columns from the first run.
  //
  // Written for every product, not only the ones a purchase order touched: a
  // catalogue where most parts have no cost would make every margin figure in
  // phase 6 read as "mostly uncosted", which is true of the data but useless as
  // a demo. The receipts above still overwrite it with the real landed cost for
  // the parts that were actually delivered.
  await Promise.all(
    insertedProducts.map((product, index) =>
      db().Product.updateOne(
        { _id: product._id },
        {
          supplier: suppliers[index % 4]._id,
          minStock: [10, 15, 20, 25, 30][index % 5],
          ...(receivedCosts.has(product._id.toString()) ? {} : { cost: costFor(product) }),
        },
      ),
    ),
  );

  /**
   * The supplier process flow (§6.8a) - tags, portal logins and bid orders.
   *
   * Last of the purchase block, because it needs all of it: suppliers to tag
   * and invite, products to ask about, and a `cost` on each one to base a
   * plausible bid on. Confirming runs through `purchaseBidService`, so the
   * priced order is a real one and the supplier totals recomputed above are
   * refreshed again by the service itself.
   */
  const bidResult = await seedPurchaseBids({ quiet: true });
  log(
    `  bid purchase orders: ${bidResult.orders}` +
      ` (${bidResult.tagged} suppliers tagged, ${bidResult.credentialed} given portal access` +
      `${bidResult.confirmed ? `, confirmed ${bidResult.confirmed}` : ''})`,
  );

  // The settings singleton, recreated from its seeded defaults - per-province
  // tax rates included, which the tax report reads (§9.5).
  const settings = await db().Settings.load();

  // ---- quotes & returns (phase 7) -----------------------------------------
  // Quotes are priced off the catalogue at a negotiated discount; returns are
  // built from real order lines, so a seeded RMA can never name a part that was
  // not actually sold - which is the rule `rmaService.createRma` enforces.

  const approvedBuyers = users.filter(
    (user) => user.status === 'approved' && user.role === 'buyer',
  );

  const quotes = await db().Quote.insertMany(
    buildQuotes({
      products: insertedProducts,
      users: approvedBuyers,
      rate: db().Settings.rateFor(settings, 'ON'),
    }),
  );
  log(`  quotes: ${quotes.length}`);

  /**
   * Repairs, as whole chains rather than as loose records.
   *
   * A repair is up to three linked records, and the lineage strip on all three
   * screens reads the links. Seeding tickets on their own left every one an
   * orphan: nothing in the demo database exercised quote → ticket → invoice,
   * so the one thing those screens are built around could only be seen by
   * clicking a conversion through by hand.
   *
   * Built first and inserted in dependency order, because each row has to
   * carry the *ids* of its neighbours and only the database can issue those.
   * The builder returns them matched by number; the linking below is what
   * turns that into references.
   */
  /**
   * Built with the parts catalogue and the quote sequence from Cellvix, but the
   * **people come from CellShoppe** - see where this is consumed below.
   *
   * The customers and staff are deliberately not passed here: this call runs in
   * Cellvix's context, so anything it reads from `users` belongs to the wrong
   * business. They are supplied inside the CellShoppe block, where they exist.
   */
  const repairSeed = {
    products: insertedProducts,
    taxRate: Math.round(db().Settings.rateFor(settings, 'ON') * 100),
    // Continue the `QT-` series the goods quotes above just used.
    quoteSeq: quotes.length + 1,
  };

  /**
   * **Every repair record belongs to CellShoppe**, the service business.
   *
   * This is what makes the switcher mean something: tickets, their quotes and
   * their invoices are the service pipeline, and stamping them here is why
   * switching to CellShoppe changes the *figures* and not only which nav rows
   * render. Cellvix's own orders, returns and invoices stay on Cellvix below.
   */
  const serviceBusinessId = serviceBusiness._id;

  /**
   * **Everything below runs inside CellShoppe's own database.**
   *
   * The block is self-contained - it builds from `repairs.*` and references no
   * Cellvix order, product or customer - which is what makes wrapping it a
   * matter of context rather than of untangling ids across two databases.
   *
   * `business: serviceBusinessId` stays on each record even though the database
   * now implies it: the field is what the admin panel filters on today, and
   * dropping it here would make the records invisible until the flip removes
   * that filter everywhere at once.
   */
  // Declared outside the wrap so the summary below can read them: the counts
  // are built at the end of `seedDatabase`, which is Cellvix's context, and
  // these are the only CellShoppe figures it reports.
  let repairTicketCount = 0;
  let repairQuoteCount = 0;
  let repairInvoiceCount = 0;

  await inBusiness(serviceBusiness, async () => {
  /**
   * Roles and settings are per-business: each database holds its own.
   *
   * A business seeded without them has staff accounts with no role to hold and
   * a panel whose every settings read rebuilds a document from defaults on the
   * fly - which works, but leaves the database looking half-seeded to anybody
   * inspecting it. `load()` is an upsert, so this is idempotent.
   */
  await ensureBuiltInRoles();
  const shoppeSettings = await db().Settings.load();

  /**
   * CellShoppe's own population.
   *
   * **Its records used to reference Cellvix's people.** `buildRepairs` was
   * handed Cellvix's buyers and staff and the resulting tickets were written
   * into CellShoppe's database, so every `customer` id on them pointed into a
   * database CellShoppe cannot read - twelve tickets whose customer column was
   * structurally empty. A business owns its customers, so it seeds its own.
   */
  const shoppeRoles = await db().Role.find().select('slug').lean();
  const shoppeRoleBySlug = new Map(shoppeRoles.map((role) => [role.slug, role._id]));

  const shoppeCustomers = [];
  for (const spec of SHOPPE_CUSTOMERS) {
    const customer = new (db().User)({ ...spec, business: serviceBusiness._id });
    await customer.setPassword(DEMO_PASSWORD);
    customer.approvedAt = new Date(Date.now() - 60 * 86_400_000);
    // Walk-in consumers, so they carry consent like any seeded buyer - the
    // marketing screens need a real audience here too.
    customer.marketingConsent = {
      granted: true,
      source: 'registration',
      at: new Date(Date.now() - 90 * 86_400_000),
    };

    /**
     * A referral code, exactly as the Cellvix loop above mints one.
     *
     * These customers are seeded already approved, and `approveUser` is what
     * normally mints the code - so skipping it here left all eight of them
     * reading "Not issued" on a panel whose whole subject is the code. The
     * Cellvix loop has always called this; this one never did.
     */
    if (customer.status === 'approved') await ensureReferralCode(customer);

    await customer.save();
    shoppeCustomers.push(customer);
  }

  const shoppeStaff = [];
  for (const spec of SHOPPE_STAFF) {
    const { staffRoleSlug, ...fields } = spec;
    const member = new (db().User)({
      ...fields,
      business: serviceBusiness._id,
      staffRole: shoppeRoleBySlug.get(staffRoleSlug) ?? null,
    });
    await member.setPassword(DEMO_PASSWORD);
    await member.save();
    shoppeStaff.push(member);
  }
  log(`  CellShoppe people: ${shoppeCustomers.length} customers, ${shoppeStaff.length} staff`);

  const shoppeSuppliers = await db().Supplier.insertMany(SHOPPE_SUPPLIERS);

  // Categories first: an expense references one, and the model requires it.
  const shoppeCategories = await db().ExpenseCategory.insertMany(
    [...new Set(SHOPPE_EXPENSES.map((row) => row.category))].map((name) => ({
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      isActive: true,
    })),
  );
  const shoppeCategoryByName = new Map(shoppeCategories.map((row) => [row.name, row._id]));

  const shoppeExpenses = await db().Expense.insertMany(
    SHOPPE_EXPENSES.map((row, index) => ({
      number: `EXP-${new Date().getFullYear()}-${String(index + 1).padStart(5, '0')}`,
      date: new Date(Date.now() - row.daysAgo * 86_400_000),
      description: row.label,
      category: shoppeCategoryByName.get(row.category),
      amount: row.amount,
      status: 'paid',
      business: serviceBusiness._id,
    })),
  );
  log(`  CellShoppe purchase: ${shoppeSuppliers.length} suppliers, ${shoppeExpenses.length} expenses`);

  /**
   * Booked slots - the screen that exists *because* this is a service business.
   *
   * `scheduling.appointments` is on for a service type and off for a product
   * one (§1.1), so an empty calendar here is the most visible sign the business
   * was never really populated.
   */
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const shoppeAppointments = await db().Appointment.insertMany(
    SHOPPE_APPOINTMENTS.map((row) => {
      const startAt = new Date(startOfToday);
      startAt.setDate(startAt.getDate() + row.inDays);
      startAt.setHours(row.hour, 0, 0, 0);

      const customer = shoppeCustomers[row.customer % shoppeCustomers.length];

      return {
        kind: 'pickup',
        title: row.service,
        startAt,
        endAt: new Date(startAt.getTime() + row.minutes * 60_000),
        // Today's slots have already happened or are happening; later ones are
        // still booked. A board where every row reads the same teaches nothing.
        status: row.inDays === 0 ? 'done' : 'scheduled',
        customerName: customer.contactName,
        business: serviceBusiness._id,
      };
    }),
  );

  const shoppeWebQuotes = await db().ContactMessage.insertMany(
    SHOPPE_WEB_QUOTES.map((row) => ({
      name: row.name,
      email: row.email,
      phone: row.phone,
      message: row.message,
      status: 'new',
      createdAt: new Date(Date.now() - row.daysAgo * 86_400_000),
      business: serviceBusiness._id,
    })),
  );
  log(
    `  CellShoppe front desk: ${shoppeAppointments.length} appointments, ${shoppeWebQuotes.length} web quotes`,
  );

  /**
   * The repair pipeline, built with **CellShoppe's own** customers and staff.
   *
   * This used to be built in Cellvix's block and handed Cellvix's buyers, so
   * every ticket written here carried a `customer` id pointing into a database
   * CellShoppe cannot read. Building it here - where its people exist - is what
   * makes the customer column on a ticket resolve to a name.
   */
  const repairs = buildRepairs({
    ...repairSeed,
    users: shoppeCustomers,
    staff: shoppeStaff,
    taxRate: Math.round(db().Settings.rateFor(shoppeSettings, 'BC') * 100),
  });

  /**
   * **No admin here.** CellShoppe has staff and customers of its own, but its
   * administrator is the *tenant's*, and lives in the control plane - one login
   * reaching every business the tenant owns, switched between with the header
   * control (SAAS_PLATFORM §1).
   *
   * This block did seed a second admin, `admin@cellshoppe.ca`, and that was
   * wrong: it forced a tenant running two shops to hold two logins and made the
   * business switcher unusable, because the account on the other side did not
   * exist. Deleted rather than left as a second way in.
   */

  // Tickets first: a quote points at the ticket it became, and an invoice
  // points back at the ticket it bills, so the ticket is the one both ends
  // need an id for.
  const insertedRepairTickets = await db().Ticket.insertMany(
    repairs.tickets.map(({ quoteNumber, invoiceNumber, ...ticket }) => ({
      ...ticket,
      business: serviceBusinessId,
    })),
  );
  const ticketIdByNumber = new Map(
    insertedRepairTickets.map((ticket) => [ticket.ticketNumber, ticket._id]),
  );

  // Repair quotes, each already converted, carrying the id of its ticket.
  const repairQuotes = await db().Quote.insertMany(
    repairs.quotes.map(({ convertedTicketNumber, ...quote }) => ({
      ...quote,
      source: 'admin',
      business: serviceBusinessId,
      convertedTicket: ticketIdByNumber.get(convertedTicketNumber) ?? null,
    })),
  );

  // Repair invoices, each carrying the id of the ticket it bills.
  const repairInvoices = await db().Invoice.insertMany(
    repairs.invoices.map(({ ticketNumber, ...invoice }) => ({
      ...invoice,
      business: serviceBusinessId,
      ticket: ticketIdByNumber.get(ticketNumber) ?? null,
    })),
  );

  // The back-references, now that every id exists: `db().Ticket.quote` and
  // `db().Ticket.invoice` are the halves the lineage strip reads, and writing them
  // here is the same pair of edges `convertQuoteToTicket` and
  // `convertToInvoice` write at runtime.
  const quoteIdByTicket = new Map(
    repairQuotes.map((quote) => [String(quote.convertedTicket), quote._id]),
  );
  const invoiceIdByTicket = new Map(
    repairInvoices.map((invoice) => [String(invoice.ticket), invoice._id]),
  );

  const links = insertedRepairTickets
    .map((ticket) => {
      const set = {};
      const quoteId = quoteIdByTicket.get(String(ticket._id));
      const invoiceId = invoiceIdByTicket.get(String(ticket._id));
      if (quoteId) set.quote = quoteId;
      if (invoiceId) set.invoice = invoiceId;

      return Object.keys(set).length
        ? { updateOne: { filter: { _id: ticket._id }, update: { $set: set } } }
        : null;
    })
    .filter(Boolean);

  if (links.length) await db().Ticket.bulkWrite(links);

  log(
    `  repairs: ${insertedRepairTickets.length} tickets` +
      ` (${repairQuotes.length} from a quote, ${repairInvoices.length} invoiced)`,
  );

  repairTicketCount = insertedRepairTickets.length;
  repairQuoteCount = repairQuotes.length;
  repairInvoiceCount = repairInvoices.length;
  });
  // End of CellShoppe's database. Everything after this is Cellvix's again.

  /**
   * Web quotes - storefront enquiries, before anybody has priced them.
   *
   * The Web Quote screen is the queue a staff member raises a real quote *from*,
   * and it had no seeded rows at all: the only thing that ever landed in
   * `contactmessages` was whatever someone had typed into the contact form by
   * hand while testing.
   */
  const webQuotes = await db().ContactMessage.insertMany(buildWebQuotes({ users }));
  log(`  web quotes: ${webQuotes.length}`);

  /**
   * Cellvix's own workshop tickets and its pickup calendar.
   *
   * **A product business with `sales.tickets` switched on** (§3.1, the one
   * documented override): Cellvix builds and tests returned stock before it
   * goes back on the shelf, and books collections with its wholesale accounts.
   * Both screens render for this business and both were empty, which reads as a
   * broken panel rather than as a business that does not do this.
   *
   * Deliberately small. These are a wholesaler's *internal* jobs, not a repair
   * shop's queue - a dozen would misrepresent what Cellvix does.
   */
  const cellvixTickets = await db().Ticket.insertMany(
    [
      { customer: 0, issue: 'Test returned OLED batch before restock', status: 'processing', priority: 'normal' },
      { customer: 1, issue: 'Verify charging ports flagged on inbound QC', status: 'diagnosis', priority: 'high' },
      { customer: 2, issue: 'Reseat connectors on customer-reported dead units', status: 'ready_to_repair', priority: 'normal' },
      { customer: 0, issue: 'Confirm battery health on returned stock', status: 'ready_to_pickup', priority: 'low' },
    ].map((row, index) => {
      const account = approvedBuyers[row.customer % approvedBuyers.length];
      return {
        ticketNumber: `TKT-${new Date().getFullYear()}-${String(index + 1).padStart(5, '0')}`,
        customerName: account.contactName || account.businessName || account.email,
        customerEmail: account.email,
        customerPhone: account.phone ?? '+1 (416) 555-0100',
        user: account._id,
        issue: row.issue,
        status: row.status,
        priority: row.priority,
        // An internal workshop job is raised at the counter by our own staff.
        source: 'counter',
        business: defaultBusiness._id,
        createdAt: new Date(Date.now() - (index + 2) * 86_400_000),
      };
    }),
  );

  const cellvixAppointments = await db().Appointment.insertMany(
    [
      { title: 'Northline pickup - pallet of screens', inDays: 0, hour: 9 },
      { title: 'Westcoast collection - battery order', inDays: 1, hour: 11 },
      { title: 'Courier drop - Maritime Mobile', inDays: 2, hour: 14 },
      { title: 'Northline pickup - weekly standing order', inDays: 5, hour: 9 },
    ].map((row) => {
      const startAt = new Date();
      startAt.setHours(0, 0, 0, 0);
      startAt.setDate(startAt.getDate() + row.inDays);
      startAt.setHours(row.hour, 0, 0, 0);

      return {
        kind: 'pickup',
        title: row.title,
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        status: row.inDays === 0 ? 'done' : 'scheduled',
        business: defaultBusiness._id,
      };
    }),
  );
  log(
    `  workshop tickets: ${cellvixTickets.length} · pickups booked: ${cellvixAppointments.length}`,
  );

  const rmas = await db().Rma.insertMany(buildRmas({ orders: insertedOrders }));
  log(`  returns: ${rmas.length}`);

  /**
   * Stamp every unassigned record onto Cellvix.
   *
   * **One pass at the end rather than a `business:` on eight `insertMany`
   * calls.** The builders in `sales.data.js`, `purchase.data.js` and
   * `generate.js` do not know about businesses and should not have to - they
   * build records, and which business owns one is a fact about this seed rather
   * than about the shape of an order.
   *
   * `business: null` is the filter, so this cannot touch the repair records
   * already stamped for CellShoppe above: they have a business and are skipped.
   * That also makes it idempotent - a second run finds nothing to do.
   *
   * **Every collection that carries the field is listed.** One left out is a
   * set of rows that belong to no business, and `businessFilter` matches
   * exactly - so they would be invisible under every business rather than
   * visible under all of them.
   */
  const cellvixId = defaultBusiness._id;
  const stamped = await Promise.all(
    // Read off the context, not imported: these have to be Cellvix's models, and
    // a module-level import would be bound to the default connection.
    [
      db().Order,
      db().Invoice,
      db().Quote,
      db().Rma,
      db().Ticket,
      db().PurchaseOrder,
      db().Expense,
      db().StockMovement,
      db().Appointment,
    ].map((Model) =>
      Model.updateMany(
        { $or: [{ business: null }, { business: { $exists: false } }] },
        { $set: { business: cellvixId } },
      ),
    ),
  );
  log(
    `  business assignment: ${stamped.reduce((sum, r) => sum + (r.modifiedCount ?? 0), 0)} records → ${defaultBusiness.name}`,
  );

  // Returned out of the business context and then out of `seedDatabase`
  // the counts are built from variables scoped inside the wrap.
  return {
    taxonomy: bySlug.size,
    products: insertedProducts.length,
    users: users.length,
    orders: insertedOrders.length,
    invoices: invoices.length,
    storeCreditMovements: creditDocs.length,
    posts: posts.length,
    faqs: faqs.length,
    offers: offers.length,
    suppliers: suppliers.length,
    purchaseOrders: insertedPos.length,
    expenseCategories: categories.length,
    expenses: insertedPoExpenses.length + manualExpenses.length,
    stockMovements: movementDocs.length,
    supplierReturns: supplierReturns.length,
    supplierServices: supplierServices.length,
    bidPurchaseOrders: bidResult.orders,
    quotes: quotes.length + repairQuoteCount,
    tickets: repairTicketCount,
    repairInvoices: repairInvoiceCount,
    webQuotes: webQuotes.length,
    returns: rmas.length,
  };

  });
}

/**
 * True when nothing has been seeded yet - drives the empty-database warning on boot.
 *
 * **Counted inside a business, not in the control database.** Called from
 * `index.js` there is no request and therefore no async-local context, so `db()`
 * answers with the control connection - which holds tenants, plans and super
 * admins and, by design, never a single product. The count was therefore always
 * zero and the warning fired on every healthy boot, telling an operator to run a
 * seed that WIPES data while 773 products sat in the business database beside
 * it. A warning that is always wrong is worse than none: it trains whoever reads
 * the logs to ignore the one time it is right.
 *
 * The default business is the one the warning is about, because it is the one an
 * unrouted request is served from.
 */
async function isDatabaseEmpty() {
  const business = await controlModels()
    .Business.findOne({ isDefault: true, deletedAt: null })
    .select('_id code')
    .lean();

  // No default business is a louder problem than an empty one, and `index.js`
  // refuses to start over it. Nothing useful to say here.
  if (!business?.code) return false;

  return (await inBusiness(business, () => db().Product.estimatedDocumentCount())) === 0;
}

// CLI entry: `npm run seed`
if (process.argv[1] && process.argv[1].endsWith('run.js')) {
  (async () => {
    console.log('\n  Seeding Cellvix…\n');
    await connectDb();
    const result = await seedDatabase();
    console.log('\n  Done.', result);
    console.log(`\n  Demo logins (password: ${DEMO_PASSWORD})`);
    console.log('    buyer@cellvix.ca    approved buyer, Net 30, order history');
    console.log('    pending@cellvix.ca  pending approval');
    console.log('    admin@cellvix.ca    admin');
    // The portal is a separate session against a separate collection (§6.8a),
    // so its logins are listed apart - reading them as a fourth kind of user
    // account is exactly the confusion the split exists to prevent.
    console.log(`\n  Supplier portal at /supplier (same password)`);
    console.log('    orders@northbridgeparts.example     quoted most, won one');
    console.log('    sales@kaiyuan-components.example    the best complete quote');
    console.log('    hello@pacificcell.example           batteries and charging ports');
    console.log('    procurement@atlasoem.example        declined one request');
    console.log('    sales@rivettools.example            deactivated - cannot sign in\n');
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { seedDatabase, isDatabaseEmpty };
