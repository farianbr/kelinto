import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Product.js';
import '../models/Service.js';
import '../models/Order.js';
import '../models/Taxonomy.js';
import { photoFile } from '../../../shared/partPhotos.js';
import { servicePhotoFileFor } from '../../../shared/catalog.js';
import { copyKey, hasKey, isConfigured, listKeys } from '../services/storageService.js';
import {
  LEGACY_STOCK_PREFIX,
  LIBRARY_SETS,
  isLegacyStockKey,
  legacyStockKey,
  libraryKey,
} from '../utils/photoLibrary.js';

/**
 * The seeded photos, into each business's own photo library in R2.
 *
 * They started in the app's own folders (`/product-photos/...`,
 * `/service-photos/...`), moved to R2 as Kelinto's under `kelinto/stock/` on
 * 2026-10-06, and the same day were ruled the business's own (client: "assets
 * uploaded by businesses should be under their business in R2"). Now they are
 * `businesses/<code>/library/{parts,phones,services}/<file>`
 * (`utils/photoLibrary.js`).
 *
 * Per business, this:
 *
 *  1. rewrites every reference to an old site path or a `kelinto/stock/` key
 *     (product `image` / `images`, service and taxonomy `image`, order lines)
 *     to the business's own key;
 *  2. writes the photo onto records that only ever had one by lookup: a part
 *     with no `image` whose brand and component type have a photo, a service
 *     with none whose name has one, and an order line with none whose product
 *     now has one. Nothing derives a picture at render time any more, so
 *     without this those would lose theirs;
 *  3. copies each file it now points at from `kelinto/stock/` into the
 *     business's folder, once. The DEFAULT business takes the whole set, the
 *     phones not yet listed included, because the photos were its own (CellShoppe
 *     supplied them) and `seed:demo -- phones` reads that folder.
 *
 * Copies before it writes: a record is only pointed at a file that is there.
 * Idempotent: a second run finds nothing to rewrite and every file in place.
 * `kelinto/stock/` itself is left alone; delete it in the R2 dashboard once the
 * pictures are seen to render.
 *
 * `npm run backfill -- stock-media --dry-run` reports without copying or writing.
 */

const SITE_FOLDERS = [
  ['/product-photos/parts/', 'parts'],
  ['/product-photos/phones/', 'phones'],
  ['/service-photos/', 'services'],
];

const OLD = /^(\/(product-photos|service-photos)\/|kelinto\/stock\/)/;

/** `{ set, file }` for an old site path or a `kelinto/stock/` key, else null. */
function parseOld(value) {
  if (typeof value !== 'string') return null;
  for (const [folder, set] of SITE_FOLDERS) {
    if (value.startsWith(folder)) {
      let file = value.slice(folder.length);
      try {
        file = decodeURIComponent(file);
      } catch {
        // Not encoded after all; keep it as written.
      }
      return { set, file };
    }
  }
  if (isLegacyStockKey(value)) {
    const [, , set, file] = value.split('/');
    return { set, file };
  }
  return null;
}

const blank = (value) => value == null || value === '';

/**
 * One business. `plan` collects destination key -> source key for every file a
 * record will point at; nothing is written until the copies have landed.
 */
async function moveBusiness({ code, isDefault, dryRun, log }) {
  const m = db();
  const plan = new Map();
  const want = (set, file) => {
    const to = libraryKey(code, set, file);
    plan.set(to, legacyStockKey(set, file));
    return to;
  };
  const moved = (value) => {
    const old = parseOld(value);
    return old ? want(old.set, old.file) : value;
  };

  // ---- work out every change -------------------------------------------------
  const writes = [];
  // Records gaining a picture they only had by lookup: written only if the
  // file is really there, so a missing source never makes a hidden product
  // visible with a broken image.
  const fills = [];

  const products = await m.Product.collection
    .find({ $or: [{ image: OLD }, { images: OLD }, { image: { $in: [null, ''] } }] })
    .project({ image: 1, images: 1, brandSlug: 1, partType: 1 })
    .toArray();
  const productImage = new Map();
  for (const row of products) {
    if (blank(row.image)) {
      const file = photoFile(row.brandSlug, row.partType);
      if (!file) continue;
      const key = want('parts', file);
      productImage.set(String(row._id), key);
      fills.push({ model: m.Product, id: row._id, key, set: { image: key, images: (row.images ?? []).map(moved) } });
      continue;
    }
    const image = moved(row.image);
    productImage.set(String(row._id), image);
    writes.push({ model: m.Product, id: row._id, set: { image, images: (row.images ?? []).map(moved) } });
  }

  const services = await m.Service.collection
    .find({ $or: [{ image: OLD }, { image: { $in: [null, ''] } }] })
    .project({ image: 1, name: 1 })
    .toArray();
  for (const row of services) {
    if (blank(row.image)) {
      const file = servicePhotoFileFor(row.name);
      if (file) {
        const key = want('services', file);
        fills.push({ model: m.Service, id: row._id, key, set: { image: key } });
      }
      continue;
    }
    writes.push({ model: m.Service, id: row._id, set: { image: moved(row.image) } });
  }

  const taxonomy = await m.Taxonomy.collection.find({ image: OLD }).project({ image: 1 }).toArray();
  for (const row of taxonomy) writes.push({ model: m.Taxonomy, id: row._id, set: { image: moved(row.image) } });

  // Order lines snapshot the picture they were sold with; a line sold on a
  // looked-up photo snapshotted nothing, and takes its product's now.
  const orders = await m.Order.collection
    .find({ $or: [{ 'items.image': OLD }, { 'items.image': { $in: [null, ''] } }, { 'items.image': { $exists: false } }] })
    .project({ items: 1 })
    .toArray();
  for (const row of orders) {
    let changed = false;
    const items = (row.items ?? []).map((item) => {
      if (parseOld(item.image)) {
        changed = true;
        return { ...item, image: moved(item.image) };
      }
      if (blank(item.image) && item.product && productImage.has(String(item.product))) {
        changed = true;
        return { ...item, image: productImage.get(String(item.product)) };
      }
      return item;
    });
    if (changed) writes.push({ model: m.Order, id: row._id, set: { items }, fromProducts: true });
  }

  // The default business owns the whole set, listed or not.
  if (isDefault) {
    for (const set of LIBRARY_SETS) {
      const prefix = `${LEGACY_STOCK_PREFIX}/${set}/`;
      for (const key of await listKeys(prefix)) want(set, key.slice(prefix.length));
    }
  }

  log(`    ${writes.length} records to repoint, ${fills.length} to give a picture, ${plan.size} files`);
  if (dryRun) return { writes: writes.length, fills: fills.length, files: plan.size };

  // ---- copy, then write -------------------------------------------------------
  let copied = 0;
  const missing = new Set();
  for (const [to, from] of plan) {
    if (await hasKey(to)) continue;
    if (!(await hasKey(from))) {
      missing.add(to);
      continue;
    }
    await copyKey(from, to);
    copied += 1;
  }
  for (const key of missing) log(`    missing in R2, not copied: ${plan.get(key)}`);

  for (const write of writes) {
    // An order line copying a product picture that could not be copied keeps none.
    if (write.fromProducts) {
      write.set.items = write.set.items.map((item) => (missing.has(item.image) ? { ...item, image: '' } : item));
    }
    await write.model.collection.updateOne({ _id: write.id }, { $set: write.set });
  }
  let filled = 0;
  for (const fill of fills) {
    if (missing.has(fill.key)) continue;
    await fill.model.collection.updateOne({ _id: fill.id }, { $set: fill.set });
    filled += 1;
  }

  log(`    ${copied} files copied, ${writes.length} records repointed, ${filled} given a picture`);
  return { copied, writes: writes.length, filled, missing: missing.size };
}

/** Every business, each in its own database, the soft-deleted Cellvix one included. */
async function backfillStockMedia({ quiet = false, dryRun = process.argv.includes('--dry-run') } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  if (!isConfigured()) throw new Error('R2 is not configured: the photos cannot be copied. Set the R2_ values in .env.');
  if (dryRun) log('  dry run: nothing is copied or written');

  const businesses = await db().Business.find({}).select('name code isDefault').lean();
  for (const business of businesses) {
    log(`  ${business.name} (${business.code})`);
    await runInBusiness(
      { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
      () => moveBusiness({ code: business.code, isDefault: Boolean(business.isDefault), dryRun, log }),
    );
  }
}

export { backfillStockMedia, moveBusiness, parseOld };
export default backfillStockMedia;
