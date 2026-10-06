import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { currentContext, runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Product.js';
import { getCategory, invalidateCatalog } from '../services/catalogService.js';
import { phoneProductFor } from '../services/phoneStockService.js';
import { applyStockMovement } from '../services/purchaseService.js';
import { listKeys } from '../services/storageService.js';
import { libraryKey, libraryPrefix } from '../utils/photoLibrary.js';

/**
 * Pre-owned phones from the client's photographs (2026-10-02).
 *
 * The client supplied one photo per handset, kept in the business's photo
 * library in R2 (`businesses/<code>/library/phones/`, `utils/photoLibrary.js`),
 * and the file name says everything about it: "(Good) Apple iPhone 15 Pro Max
 * 256GB – Black Titanium.webp" is a Good-condition iPhone 15 Pro Max, 256 GB, in
 * Black Titanium. Each file becomes one product in the Phones type with one in
 * stock (phones are products with stock since 2026-10-02; this made one
 * `PreownedDevice` per photo for a few hours before that), on the website with
 * that photo as its picture.
 *
 * ## The taxonomy
 *
 * Every phone is placed through `phoneStockService.phoneProductFor`, the same
 * call a kiosk buyback makes, so the Phones category tree gets Phone › Apple ›
 * iPhone 15 › iPhone 15 Pro Max, creating any series or model the tree lacks.
 * Storage and colour are the Phones type's features and the condition is one
 * of its grades, all defined in Settings › Taxonomy and offered as website
 * filters beside the tree.
 *
 * ## Prices
 *
 * Demo figures, like every seeded price: a Good-condition price per model at
 * its smallest storage, plus a step per storage size, then a condition factor.
 * Cost is what a buyback at roughly 70% of the selling price would have paid.
 *
 * ADDITIVE and idempotent: a photo already on a phone is skipped, so re-running
 * adds only files uploaded to that folder since. Never wipes. Seeds every
 * business, each in its own database.
 */

/** "(Good) Apple iPhone 15 Pro Max 256GB – Black Titanium.webp", the en dash optional. */
const NAME_PATTERN = /^\((Excellent|Good|Fair)\)\s+(Apple)\s+(iPhone\s+(\d+)e?(?:\s+(?:Plus|Pro Max|Pro))?)\s+(\d+(?:GB|TB))\s+(?:–\s+)?(.+)\.(?:jpe?g|png|webp)$/i;

/** Good condition, smallest storage, in dollars. */
const BASE_PRICE = {
  'iPhone 14': 499,
  'iPhone 14 Plus': 579,
  'iPhone 14 Pro': 699,
  'iPhone 14 Pro Max': 789,
  'iPhone 15': 649,
  'iPhone 15 Plus': 729,
  'iPhone 15 Pro': 849,
  'iPhone 15 Pro Max': 959,
  'iPhone 16': 799,
  'iPhone 16 Plus': 889,
  'iPhone 16 Pro': 1029,
  'iPhone 16 Pro Max': 1149,
  'iPhone 16e': 619,
};

/** What each storage size adds over 128 GB, in dollars. */
const STORAGE_STEP = { '128GB': 0, '256GB': 100, '512GB': 230, '1TB': 380 };

const GRADE_FACTOR = { EXCELLENT: 1.08, GOOD: 1, FAIR: 0.88 };

const DESCRIPTIONS = {
  EXCELLENT:
    'Light signs of use at most. Screen, cameras, Face ID, speakers and charging all tested and working. Unlocked for any carrier.',
  GOOD: 'Minor scratches on the frame or back, nothing on the screen in normal use. Every function tested and working. Unlocked for any carrier.',
  FAIR: 'Visible wear on the body and possibly light marks on the screen. Every function tested and working. Unlocked for any carrier.',
};

/** Dollars to whole cents, ending in 9 the way a shelf price does. */
const shelfCents = (dollars) => (Math.round(dollars / 10) * 10 - 1) * 100;

/**
 * Every photo in one business's phones folder, read from its name. Unreadable
 * names are reported, not guessed.
 */
async function readPhotos(code) {
  const prefix = libraryPrefix(code, 'phones');
  const files = (await listKeys(prefix))
    .map((key) => key.slice(prefix.length))
    .filter((file) => /\.(jpe?g|png|webp)$/i.test(file));
  const phones = [];
  const unread = [];
  for (const file of files) {
    const match = NAME_PATTERN.exec(file);
    if (!match) {
      unread.push(file);
      continue;
    }
    const [, condition, brand, model, number, storage, colour] = match;
    phones.push({
      file,
      // The Phones type's grade values (EXCELLENT, GOOD, FAIR).
      grade: condition.toUpperCase(),
      brand,
      series: `iPhone ${number}`,
      model: model.replace(/\s+/g, ' '),
      // "256 GB", the way the website prints a size; the step table reads the bare form.
      storage: storage.toUpperCase().replace(/(\d)(GB|TB)/, '$1 $2'),
      size: storage.toUpperCase(),
      colour: colour.trim(),
    });
  }

  // A model's base price is for its smallest storage (the 15 and 16 Pro Max start at 256 GB).
  const smallest = new Map();
  for (const phone of phones) {
    const step = STORAGE_STEP[phone.size] ?? 0;
    smallest.set(phone.model, Math.min(smallest.get(phone.model) ?? Infinity, step));
  }
  for (const phone of phones) {
    const base = BASE_PRICE[phone.model] ?? 599;
    const dollars = (base + (STORAGE_STEP[phone.size] ?? 0) - smallest.get(phone.model)) * GRADE_FACTOR[phone.grade];
    phone.priceCents = shelfCents(dollars);
    phone.costCents = Math.round((phone.priceCents * 0.7) / 100) * 100;
  }

  return { phones, unread };
}

/**
 * One product per photo, with one in stock, in the Phones type (2026-10-02:
 * phones are products with stock, one product per model, storage, colour and
 * grade). The photo is the product's picture.
 *
 * A photo already on a product is skipped, whatever extension it was listed
 * under (the supplied JPGs were re-encoded to WebP on 2026-10-02); only that
 * one picture is brought to the file now in the folder.
 */
async function seedPhones({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const code = currentContext()?.code;
  if (!code) throw new Error('seedPhones runs inside a business.');
  const { phones, unread } = await readPhotos(code);
  if (!phones.length && !unread.length) {
    log(`  no photos found in R2 under ${libraryPrefix(code, 'phones')}, nothing to add`);
    return { added: 0, skipped: 0, unread: 0 };
  }
  for (const file of unread) log(`  could not read "${file}", skipped`);

  // Reading the type makes sure Phones is a product type with its grades and features.
  await getCategory('phones');

  let added = 0;
  let skipped = 0;
  // One tree lookup per model, not per handset: 570 photos are 13 models.
  const placed = new Map();

  for (const phone of phones) {
    // The R2 key, as every stored picture is; the server adds the address.
    const photo = libraryKey(code, 'phones', phone.file);
    const base = phone.file.replace(/\.(jpe?g|png|webp)$/i, '');
    const samePhoto = ['jpg', 'jpeg', 'png', 'webp'].map((ext) => libraryKey(code, 'phones', `${base}.${ext}`));

    const existing = await db().Product.findOne({ image: { $in: samePhoto } }).select('image').lean();
    if (existing) {
      if (existing.image !== photo) await db().Product.updateOne({ _id: existing._id }, { $set: { image: photo } });
      skipped += 1;
      continue;
    }

    const { product, created, placed: slugs } = await phoneProductFor(
      {
        category: 'Phone',
        brand: phone.brand,
        series: phone.series,
        model: phone.model,
        storage: phone.storage,
        colour: phone.colour,
        grade: phone.grade,
        priceCents: phone.priceCents,
        costCents: phone.costCents,
        images: [photo],
        description: DESCRIPTIONS[phone.grade],
      },
      { placed: placed.get(phone.model) ?? null },
    );
    placed.set(phone.model, slugs);
    if (!created) {
      skipped += 1;
      continue;
    }
    await applyStockMovement({
      product: product._id,
      type: 'adjustment',
      qtyChange: 1,
      unitCost: phone.costCents,
      note: 'Seeded from its photo',
    });
    added += 1;
  }

  invalidateCatalog();
  log(`  ${added} phone products added, ${skipped} already there${unread.length ? `, ${unread.length} unreadable` : ''}`);
  return { added, skipped, unread: unread.length };
}

/** CLI entry: `npm run seed:demo -- phones`. */
if (process.argv[1] && process.argv[1].endsWith('phones.js')) {
  (async () => {
    console.log('\n  Phone products from their photos…\n');
    await connectDb();

    const businesses = await db().Business.find({ deletedAt: null }).select('name code').lean();
    if (!businesses.length) throw new Error('No businesses found. Run `npm run seed` first.');

    for (const business of businesses) {
      console.log(`  ${business.name} (${business.code})`);
      await runInBusiness(
        { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
        () => seedPhones(),
      );
    }

    console.log('\n  Done.\n');
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { seedPhones, readPhotos };
