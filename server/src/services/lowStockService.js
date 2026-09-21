import { db } from '../db/models.js';
import '../models/Settings.js';

/**
 * What "low stock" means, in one place.
 *
 * ## Why this file exists
 *
 * The number lived in four places. `adminService` and `purchaseService` each
 * declared `const LOW_STOCK_THRESHOLD = 50`, `reorderService` declared a third
 * copy with a comment reading *"Duplicated as a constant rather than imported
 * if you change one, change both"*, and `reportService` did the one correct
 * thing and read `operations.lowStockThreshold` from Settings. So the setting
 * was **already live** and already disagreed with three of its four readers:
 * an owner who set the threshold to 20 moved the P&L report's inventory
 * position and nothing else, leaving the dashboard, the Inventory pills, the
 * reorder queue and the bell all still answering 50.
 *
 * That is the exact failure `models/Settings.js` opens by warning about -
 * hard-coding a number and "moving it to Settings later" is how a system ends
 * up with two sources of truth. It ended up with four.
 *
 * ## The rule, stated once
 *
 * A product is low when its stock is at or below its **reorder point**, and its
 * reorder point is its own `minStock` when it has one, or this business's
 * configured threshold when it does not. `minStock: 0` means *no reorder point
 * set*, which reads as "fall back", never as "never low" - the bell used to
 * read it the other way and disagreed with the screen it linked to.
 *
 * ## Why the threshold is passed in rather than read here
 *
 * `classify` is called per product, inside loops over the whole catalogue.
 * Reading settings inside it would be a database round-trip per row. Callers
 * resolve the threshold once with `lowStockThreshold()` and hand it down, which
 * is also what makes the sync callers (`shapeInventoryRow`) possible.
 */

/**
 * The fallback reorder point, for a business that has not set one.
 *
 * Matches the schema default in `models/Settings.js`, and is the answer when a
 * settings document predates the field - a `default` only fires on insert, and
 * every existing business already has its row.
 */
const DEFAULT_LOW_STOCK_THRESHOLD = 50;

/** This business's configured fallback reorder point. */
async function lowStockThreshold() {
  const settings = await db().Settings.load();
  return settings?.operations?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
}

/**
 * One product's reorder point: its own, or the business fallback.
 *
 * `minStock` is compared `> 0` rather than checked for null because the field
 * defaults to `0`, so "unset" and "zero" are the same stored value.
 */
function reorderPoint(product, threshold = DEFAULT_LOW_STOCK_THRESHOLD) {
  return product.minStock > 0 ? product.minStock : threshold;
}

/**
 * `out` | `low` | `in`, by the rule above.
 *
 * Out wins over low: a shelf with nothing on it is not "low", and a screen that
 * counted it as both put the same product in two pills.
 */
function classify(product, threshold = DEFAULT_LOW_STOCK_THRESHOLD) {
  if (product.stock <= 0) return 'out';
  return product.stock <= reorderPoint(product, threshold) ? 'low' : 'in';
}

export { DEFAULT_LOW_STOCK_THRESHOLD, classify, lowStockThreshold, reorderPoint };
export default { DEFAULT_LOW_STOCK_THRESHOLD, classify, lowStockThreshold, reorderPoint };
