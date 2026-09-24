import { db } from '../db/models.js';
import '../models/Product.js';
import '../models/StockMovement.js';

/**
 * Take the catalogue parts a repair used off the shelf, and snapshot their cost.
 *
 * **A repair used to leave stock untouched.** A technician picked a screen
 * from the catalogue onto a ticket, the customer was billed for it, and the
 * part still counted as on hand, so Inventory overstated what was on the shelf
 * by every part ever fitted and the reorder point never fired for repair
 * stock. Orders have always moved stock; the repair side never did.
 *
 * Runs at the moment a repair is BILLED - converting a ticket into its invoice,
 * or an admin raising an itemised invoice with parts on it - because both
 * happen exactly once per job. Earlier, at intake, a part is only a quote: the
 * customer may decline it. And `ticket.invoice` already refuses a second
 * conversion, so a part can never come off twice.
 *
 * **Stock is floored at zero, not refused.** An order refuses to sell what is
 * not on hand, because nothing has left the building yet. A repair is the
 * opposite: the part is already inside the customer's phone, so refusing the
 * invoice would block billing for work that happened, over a count that was
 * simply wrong. What is on hand comes off, and any shortfall is written into
 * the movement's note so the count can be corrected - the same information a
 * refusal would have carried, without holding the money hostage.
 *
 * Returns the devices with `unitCost` set on each costed part line, so the
 * invoice carries the cost at the moment of sale exactly as an order line does
 * (`orderBuilder`), and the P&L never re-reads a cost that has since changed.
 * Typed lines with no `product` are passed through untouched: there is no
 * shelf to take them off and no cost to snapshot.
 *
 * Call it with the devices BEFORE the invoice is created (to stamp the costs),
 * and `commit` AFTER, so a failed invoice write moves no stock.
 */
async function costRepairParts(devices = []) {
  const ids = new Set();
  for (const device of devices) {
    for (const part of device.parts ?? []) if (part.product) ids.add(String(part.product));
  }
  if (!ids.size) return { devices, demand: new Map() };

  const products = await db()
    .Product.find({ _id: { $in: [...ids] } })
    .select('_id cost')
    .lean();
  const costById = new Map(products.map((product) => [String(product._id), product.cost ?? 0]));

  const demand = new Map();
  const costed = devices.map((device) => ({
    ...device,
    parts: (device.parts ?? []).map((part) => {
      if (!part.product) return part;
      const id = String(part.product);
      // A line pointing at a product that has since been deleted bills as
      // typed; there is nothing left to deduct from.
      if (!costById.has(id)) return part;
      demand.set(id, (demand.get(id) ?? 0) + (part.qty ?? 1));
      const cost = costById.get(id);
      return cost > 0 ? { ...part, unitCost: cost } : part;
    }),
  }));

  return { devices: costed, demand };
}

/**
 * Apply the deduction worked out by `costRepairParts`, one movement per product.
 *
 * `reference` is the document that billed the parts, so the stock ledger links
 * back to it: `{ kind: 'ticket' | 'invoice', id, label }`.
 */
async function commitRepairParts(demand, { reference, business, createdBy } = {}) {
  for (const [productId, wanted] of demand) {
    const product = await db().Product.findById(productId).select('_id stock').lean();
    if (!product) continue;

    const before = Math.max(0, product.stock ?? 0);
    const take = Math.min(wanted, before);
    let taken = 0;
    let after = before;

    if (take > 0) {
      // Conditional on the stock still being there, so two repairs billed at
      // once cannot both take the last unit and drive the count negative.
      const updated = await db().Product.findOneAndUpdate(
        { _id: product._id, stock: { $gte: take } },
        { $inc: { stock: -take } },
        { new: true, select: 'stock' },
      );
      if (updated) {
        taken = take;
        after = updated.stock;
      }
    }

    const short = wanted - taken;
    await db().StockMovement.create({
      product: product._id,
      business: business ?? undefined,
      type: 'sale',
      qtyChange: -taken,
      qtyAfter: after,
      reference,
      note:
        short > 0
          ? `Fitted ${wanted} on a repair, ${short} more than stock showed on hand. Count this part.`
          : `Fitted on a repair.`,
      createdBy: createdBy ?? undefined,
    });
  }
}

/** What a set of devices takes off the shelf, per product id. */
function partsDemand(devices = []) {
  const demand = new Map();
  for (const device of devices) {
    for (const part of device.parts ?? []) {
      if (!part.product) continue;
      const id = String(part.product);
      demand.set(id, (demand.get(id) ?? 0) + (part.qty ?? 1));
    }
  }
  return demand;
}

/**
 * Put parts back on the shelf: an invoice that took them was deleted, or an
 * edit removed a line. The reverse of `commitRepairParts`, one movement each.
 */
async function returnRepairParts(demand, { reference, business, createdBy, note } = {}) {
  for (const [productId, qty] of demand) {
    if (!(qty > 0)) continue;
    const updated = await db().Product.findByIdAndUpdate(
      productId,
      { $inc: { stock: qty } },
      { new: true, select: 'stock' },
    );
    // A product deleted since has no shelf to return to.
    if (!updated) continue;
    await db().StockMovement.create({
      product: updated._id,
      business: business ?? undefined,
      type: 'return',
      qtyChange: qty,
      qtyAfter: updated.stock,
      reference,
      note: note ?? 'Back on the shelf: taken off a repair invoice.',
      createdBy: createdBy ?? undefined,
    });
  }
}

/**
 * Re-cost an edited invoice's parts and move only the difference.
 *
 * An edit that adds a second screen takes one more screen off the shelf; one
 * that removes a battery puts the battery back. Parts on both sides of the
 * edit do not move. Returns the new devices with costs stamped, as
 * `costRepairParts` does, plus a `commit` to run once the invoice has saved.
 *
 * `returnRemoved: false` is for an invoice whose parts never came off the
 * shelf in the first place: removing a line from it returns nothing.
 */
async function adjustRepairParts(oldDevices, newDevices, { returnRemoved = true, ...opts } = {}) {
  const before = partsDemand(oldDevices);
  const { devices, demand: after } = await costRepairParts(newDevices);

  const added = new Map();
  const removed = new Map();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(id) ?? 0) - (before.get(id) ?? 0);
    if (delta > 0) added.set(id, delta);
    if (delta < 0) removed.set(id, -delta);
  }

  const commit = async () => {
    await commitRepairParts(added, opts);
    if (returnRemoved) {
      await returnRepairParts(removed, { ...opts, note: 'Back on the shelf: removed from a repair invoice.' });
    }
  };

  return { devices, commit };
}

export { costRepairParts, commitRepairParts, returnRepairParts, adjustRepairParts, partsDemand };
export default { costRepairParts, commitRepairParts, returnRepairParts, adjustRepairParts, partsDemand };
