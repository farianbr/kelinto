import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Buyback.js';
import '../models/PreownedDevice.js';
import '../models/Product.js';
import '../models/StockMovement.js';
import { getCategory } from '../services/catalogService.js';
import { phoneProductFor } from '../services/phoneStockService.js';
import { applyStockMovement } from '../services/purchaseService.js';

/**
 * Pre-owned phones become products with stock (client ruling, 2026-10-02:
 * "phones also have stocks", "stock per variant").
 *
 * Every phone still for sale or in stock (`PreownedDevice` in `in_stock` or
 * `listed`) is added as one unit to its product in the Phones type: the
 * product for its model, storage, colour and grade, made the first time that
 * variant is met (`phoneStockService.phoneProductFor`). A listed phone's
 * product is on the website; one only in stock is hidden until somebody lists
 * it. The stock goes in through the ledger (`applyStockMovement`), noting the
 * old stock number and the IMEI, and a buyback that made the phone is pointed
 * at the product.
 *
 * The moved unit is then deleted, which is what makes this idempotent: a
 * second run finds nothing left to move. Sold phones stay as they are, because
 * the orders that sold them still point at them.
 */

/** The four website grades a handset had, onto the Phones type's grades. */
const GRADE = { like_new: 'EXCELLENT', excellent: 'EXCELLENT', good: 'GOOD', fair: 'FAIR' };

async function movePhones({ log = console.log } = {}) {
  // Reading the type flips Phones to products and gives it its grades and features.
  await getCategory('phones');

  const units = await db()
    .PreownedDevice.find({ status: { $in: ['in_stock', 'listed'] } })
    .sort({ createdAt: 1 })
    .lean();
  if (!units.length) {
    log('    nothing to move');
    return { moved: 0, products: 0 };
  }

  const placed = new Map();
  const made = new Set();
  for (const unit of units) {
    const key = [unit.category, unit.brand, unit.series, unit.model].join('|');
    const { product, created, placed: slugs } = await phoneProductFor(
      {
        category: unit.category,
        brand: unit.brand,
        series: unit.series,
        model: unit.model,
        storage: unit.storage,
        colour: unit.colour,
        grade: GRADE[unit.grade] ?? 'GOOD',
        priceCents: unit.priceCents,
        costCents: unit.costCents,
        images: unit.photos ?? [],
        description: unit.description,
        isActive: unit.status === 'listed',
      },
      { placed: placed.get(key) ?? null },
    );
    placed.set(key, slugs);
    if (created) made.add(String(product._id));

    await applyStockMovement({
      product: product._id,
      type: 'adjustment',
      qtyChange: 1,
      unitCost: unit.costCents || undefined,
      note: `Moved from Pre-owned ${unit.stockNumber}${unit.imei ? ` · IMEI ${unit.imei}` : ''}`,
      business: unit.business ?? undefined,
    });
    if (unit.buyback) await db().Buyback.updateOne({ _id: unit.buyback }, { $set: { product: product._id } });
    await db().PreownedDevice.deleteOne({ _id: unit._id });
  }

  log(`    ${units.length} phones moved onto ${made.size} new products`);
  return { moved: units.length, products: made.size };
}

/** Every business, each in its own database. */
async function backfillPhonesToProducts({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const businesses = await db().Business.find({ deletedAt: null }).select('name code').lean();
  for (const business of businesses) {
    log(`  ${business.name} (${business.code})`);
    await runInBusiness(
      { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
      () => movePhones({ log }),
    );
  }
}

export { backfillPhonesToProducts, movePhones };
export default backfillPhonesToProducts;
