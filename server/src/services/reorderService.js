import { db } from '../db/models.js';
import '../models/Product.js';
import { classify, lowStockThreshold, reorderPoint } from './lowStockService.js';

/**
 * The reorder queue - what needs buying, computed once.
 *
 * **One question, asked in three places.** The Inventory screen, the
 * notification bell and the create-PO screen all want to know the same thing
 * *what needs buying* - and before this file existed each worked it out
 * separately. The bell in particular listed every empty shelf as its own alert,
 * which is a list of facts where a staff member needed a decision: a hundred rows
 * saying "X is out of stock" and nothing saying what to do about it. So the
 * queue is computed here, and the bell renders one row from its counts.
 *
 * **This file reads; it never writes.** Raising the order is the create screen's
 * job, seeded from this queue and saved by a person - there is no
 * generate-a-draft path, because a purchase order that exists before anybody
 * has seen a line of it is a record somebody has to go and delete. Which is
 * what the first cut of this did, and what replacing it fixed.
 *
 * Two rules:
 *
 * **1. The classifier is `lowStockService`'s, not a second opinion.** `stock`
 * against `minStock`, falling back to this business's configured threshold when
 * no reorder point is set. The bell used to apply a *different* rule - treating
 * an unset `minStock` as "never low" while the Inventory screen treated it as a
 * fallback - so the badge and the screen it linked to disagreed about how many
 * products needed attention. One rule, one number, and since the threshold
 * moved into Settings that number is the one its owner set rather than a
 * literal repeated in four files.
 *
 * **2. Quantities are suggestions, and every screen says so.** Nothing in the
 * data model records how much of a part we want on hand, only the point below
 * which it is low, so a reorder quantity is inferred: `REORDER_MULTIPLE` × the
 * threshold, less what is on the shelf. That is a guess, and it is offered as
 * an editable line on a form rather than written into a record.
 */

/**
 * A reorder buys up to this multiple of the reorder point.
 *
 * Two, because one would order exactly enough to sit *on* the threshold - low
 * stock again the moment a single unit sells. There is no science in the
 * number and no pretending otherwise; it is a starting quantity a buyer edits.
 */
const REORDER_MULTIPLE = 2;

/**
 * How many to buy: enough to clear the reorder point with headroom.
 *
 * Floored at one so a product whose threshold is zero and whose shelf is empty
 * still appears on the draft with a quantity somebody can edit, rather than a
 * line for zero units that reads as an error.
 */
function suggestQty(product, threshold) {
  const point = reorderPoint(product, threshold);
  return Math.max(1, Math.ceil(point * REORDER_MULTIPLE) - Math.max(0, product.stock));
}

/**
 * Everything at or below its reorder point, worst first.
 *
 * Only `isActive` products: one that is not listed cannot be sold, so it is not
 * work - the same exclusion the Inventory pills make, for the same reason.
 * Ordered out-before-low and then by how far under the line each one is, so the
 * top of the list is the most urgent rather than the alphabetically first.
 */
async function getReorderQueue({ scope = {} } = {}) {
  // Resolved once and threaded down: `classify` runs per product, and reading
  // settings inside it would be a round-trip per row of the catalogue.
  const threshold = await lowStockThreshold();

  const products = await db()
    .Product.find({ ...scope, isActive: { $ne: false } })
    // `barcode` is carried for the create screen, whose line rows show it
    // beside the SKU - a prefilled row that left it blank would look like a
    // product missing data rather than one chosen for you.
    .select('name sku barcode stock minStock cost partType partTypeLabel supplier')
    .populate('supplier', 'name')
    .lean();

  const flagged = products
    .map((product) => ({ product, status: classify(product, threshold) }))
    .filter((row) => row.status !== 'in');

  const items = flagged
    .map(({ product, status }) => ({
      id: product._id.toString(),
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? null,
      stock: product.stock ?? 0,
      minStock: product.minStock ?? 0,
      status,
      partType: product.partType ?? null,
      partTypeLabel: product.partTypeLabel ?? product.partType ?? null,
      // What we last paid, carried so the draft can show an expected spend.
      // Never a price the order is placed at - that comes from a supplier's
      // bid, as it does everywhere else in this flow.
      //
      // Exposed under both names on purpose: `lastCost` is what it *means* and
      // is what the reorder bar's estimate reads, while `cost` is the field
      // name `InventoryPicker` expects, so a prefilled create-page row seeds
      // its unit cost without the page having to reshape every item first.
      lastCost: product.cost ?? 0,
      cost: product.cost ?? 0,
      suggestedQty: suggestQty(product, threshold),
      supplier: product.supplier?.name
        ? { id: product.supplier._id.toString(), name: product.supplier.name }
        : null,
    }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'out' ? -1 : 1;
      // Furthest below its own reorder point first, so a product 90% short
      // outranks one a unit under.
      const aGap = reorderPoint(a, threshold) - a.stock;
      const bGap = reorderPoint(b, threshold) - b.stock;
      return bGap - aGap;
    });

  const out = items.filter((item) => item.status === 'out').length;

  return {
    items,
    counts: { out, low: items.length - out, total: items.length },
    // What the lines would cost at the price we last paid. An estimate, and
    // the screens that show it say so - the real number arrives with the bids.
    estimatedCost: items.reduce((sum, item) => sum + item.lastCost * item.suggestedQty, 0),
  };
}

export { getReorderQueue, REORDER_MULTIPLE };
