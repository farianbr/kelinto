import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/DeviceCatalog.js';
import '../models/Service.js';
import '../models/Product.js';
import '../models/Business.js';
import { slugFor } from '../services/deviceCatalogService.js';
import { DEVICE_TREE, SERVICES } from './service-business.data.js';
import { SERVICE_PARTS } from './service-parts.data.js';

/**
 * A repair shop's starting lists: the devices it takes in, and the labour it
 * sells (Sales § Devices, § Services).
 *
 * **Upsert, never wipe.** Both collections are pointed at by live records - a
 * ticket names a device, an estimate line references a service - so deleting and
 * re-inserting would re-key them and orphan every reference. Existing rows are
 * left exactly as the staff member edited them: a service they re-priced stays
 * re-priced, a device they retired stays retired. Only genuinely missing entries
 * are added, which makes this safe to run on a database with real work in it and
 * safe to run twice.
 *
 * **Service businesses only.** A parts wholesaler takes nothing in and sells no
 * labour, so seeding it a device tree would put two nav sections' worth of
 * fixtures into a business whose feature flags hide both. The loop below skips
 * on `businessType`, which is the same test the flags default from.
 *
 * **Parts are seeded here too, as of 2026-09-21.** This used to say they were
 * somebody else's job; nobody had that job, so CellShoppe ran with three
 * suppliers and zero products - an empty Inventory screen, and a purchase-order
 * seeder that skipped the business for having nothing to order. A repair shop
 * does keep stock; it keeps a short shelf rather than a catalogue, which is
 * what `service-parts.data.js` is.
 */

/**
 * Insert one node and its children, depth first.
 *
 * The parent has to exist before a child can name it, which is the whole reason
 * this recurses rather than building a flat list: `path` is denormalised from
 * the parent's, so a child inserted first would carry an empty one.
 */
async function insertBranch(node, { parent = null, kind = 'deviceType', business = null } = {}) {
  // Qualified by the parent, because the same NAME appears in several places:
  // Apple is a brand under Phone, Laptop, Tablet and Watch, and a model is often
  // named after its own series. See `slugFor`.
  const slug = node.slug ? node.slug : slugFor(node.name, parent);

  const path = { ...(parent?.path ?? {}) };
  path[kind] = slug;

  let doc = await db().DeviceCatalog.findOne({ slug }).lean();
  let added = 0;

  if (!doc) {
    doc = (
      await db().DeviceCatalog.create({
        kind,
        name: node.name,
        slug,
        /**
         * Stamped, not left null.
         *
         * Separation is by database, but `businessScope` is set on every request
         * and the read filters `business: <id>` - so a row with `business: null`
         * is invisible under **every** business rather than visible under all of
         * them. That is the same rule `run.js` states when it back-stamps the
         * unscoped collections, and the same reason it lists every one of them.
         */
        business,
        parent: parent?._id ?? null,
        path,
        icon: node.icon || undefined,
        order: node.order ?? 0,
        aliases: (node.aliases ?? []).map((alias) => alias.toLowerCase()),
        isActive: true,
      })
    ).toObject();
    added += 1;
  }

  const childKind = { deviceType: 'brand', brand: 'series', series: 'model' }[kind];
  if (childKind) {
    for (const child of node.children ?? []) {
      added += await insertBranch(child, { parent: doc, kind: childKind, business });
    }
  }

  return added;
}

async function seedDevices({ quiet = false, business = null } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  let added = 0;
  for (const root of DEVICE_TREE) added += await insertBranch(root, { business });

  const total = await db().DeviceCatalog.countDocuments({});
  log(`    devices:  ${added} added, ${total} in the tree`);
  return { added, total };
}

async function seedServices({ quiet = false, business = null } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const existing = await db().Service.find({}).select('name').lean();
  const have = new Set(existing.map((service) => service.name));

  const missing = SERVICES.filter((service) => !have.has(service.name)).map((service) => ({
    name: service.name,
    description: service.description,
    // Stamped for the same reason the device nodes are - see insertBranch.
    business,
    category: service.category,
    // Dollars in the data file, integer cents in the database, like every other
    // amount in this system.
    priceCents: Math.round((service.price ?? 0) * 100),
    // `undefined` rather than 0 when the data file omits it: an unknown cost and
    // a zero cost produce very different margins, and the screen says so.
    costCents: service.cost === undefined ? undefined : Math.round(service.cost * 100),
    durationMinutes: service.durationMinutes ?? 0,
    warrantyDays: service.warrantyDays ?? 0,
    deviceTypes: service.deviceTypes ?? [],
    taxable: service.taxable !== false,
    isActive: true,
    order: service.order ?? 0,
  }));

  if (missing.length) await db().Service.insertMany(missing);

  log(`    services: ${missing.length} added, ${have.size} already present`);
  return { added: missing.length, existing: have.size };
}

/**
 * The shelf: the parts this shop keeps in stock.
 *
 * Upsert by SKU, never wipe, for the same reason the other two lists are:
 * a ticket line and a purchase-order line point at these by id, and
 * re-inserting would orphan both. A part somebody has re-priced or counted
 * stays exactly as they left it.
 *
 * `slug` and `sku` are unique across the collection, and each business owns
 * its own database, so the `CS-` prefix is for a human reading a row rather
 * than for uniqueness.
 */
async function seedParts({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const existing = await db().Product.find({}).select('sku').lean();
  const have = new Set(existing.map((product) => product.sku));

  const missing = SERVICE_PARTS.filter((part) => !have.has(part.sku)).map((part) => ({
    sku: part.sku,
    name: part.name,
    slug: part.sku.toLowerCase(),
    // What the part is for, in the words the counter uses. The catalogue
    // taxonomy is a wholesaler concern and this shop has none.
    description: `Replacement ${part.partTypeLabel.toLowerCase()} for ${part.deviceLabel}.`,
    partType: part.partType,
    partTypeLabel: part.partTypeLabel,
    grade: part.grade,
    price: part.price,
    cost: part.cost,
    stock: part.stock,
    minStock: part.minStock,
    isActive: true,
  }));

  if (missing.length) await db().Product.insertMany(missing);

  log(`    parts: ${missing.length} added, ${have.size} already present`);
  return { added: missing.length, existing: have.size };
}

/** Both lists, for the business the current context names. */
async function seedServiceBusiness(options = {}) {
  const devices = await seedDevices(options);
  const services = await seedServices(options);
  // `seedParts` takes no `business`: `Product` is scoped by the database it
  // lives in rather than by a stamped id - see the model.
  const parts = await seedParts(options);
  return { devices, services, parts };
}

// CLI entry: `npm run seed:service-business`
if (process.argv[1] && process.argv[1].endsWith('service-business.js')) {
  (async () => {
    console.log('\n  Seeding service business devices and services…\n');
    await connectDb();

    const businesses = await db()
      .Business.find({ deletedAt: null })
      .select('name code businessType')
      .lean();

    /**
     * No businesses at all means a single-database install, so seed whatever
     * the URI names - the same fallback every other business-scoped seed makes.
     */
    const targets = businesses.length ? businesses : [null];
    const results = [];

    for (const business of targets) {
      if (business && business.businessType === 'product') {
        console.log(`  ${business.name} (${business.code}) - product business, skipped`);
        continue;
      }

      if (business) console.log(`  ${business.name} (${business.code})`);
      // The id is what gets stamped on every row - see `insertBranch`.
      const work = () => seedServiceBusiness({ business: business?._id ?? null });

      if (business) {
        results.push(
          await runInBusiness(
            {
              businessId: String(business._id),
              code: business.code,
              connection: dbFor(business.code),
            },
            work,
          ),
        );
      } else {
        results.push(await work());
      }
    }

    console.log(`\n  Done. ${results.length} business(es) seeded.\n`);
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error('\n  Seed failed:', error.message, '\n');
    process.exit(1);
  });
}

export { seedDevices, seedServices, seedParts, seedServiceBusiness };
export default seedServiceBusiness;
