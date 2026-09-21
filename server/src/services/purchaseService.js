import mongoose from 'mongoose';

import { db } from '../db/models.js';
import '../models/Supplier.js';
import '../models/PurchaseOrder.js';
import '../models/Expense.js';
import '../models/ExpenseCategory.js';
import '../models/StockMovement.js';
import '../models/Product.js';
import ApiError from '../utils/ApiError.js';
import { likeRegex } from '../utils/regex.js';
import { classify, lowStockThreshold } from './lowStockService.js';
import * as supplierPortalService from './supplierPortalService.js';

/**
 * Purchase - suppliers, purchase orders, expenses and the stock ledger
 * (ERP rework §6.7–6.10, phase 5).
 *
 * Three rules hold this file together, and every function below is an
 * application of one of them:
 *
 *   1. **Money is recomputed here, never accepted.** A client sends quantities
 *      and a negotiated unit cost; every subtotal, tax line and total is
 *      derived server-side, the same way `pricingService` owns a sale.
 *   2. **Stock only moves through `applyStockMovement`.** `db().Product.stock` has
 *      no history of its own, so a write that skips the ledger is a quantity
 *      nobody can ever explain. This is `storeCreditService`'s rule, applied to
 *      inventory.
 *   3. **A derived status is never stored as a decision.** A purchase order is
 *      `partial` or `received` because of what has arrived, recomputed on every
 *      receipt - exactly as an invoice's status is recomputed from its payments.
 */

// ---- numbering --------------------------------------------------------------

/**
 * `PO-2026-00001`, `EXP-2026-00001` - sequential per year, matching the
 * `CVX-`/`INV-` convention already in `orderService` (§8).
 *
 * Same last-row-wins approach as order numbering: a race would need two rows
 * created in the same millisecond by two staff, and the unique index is the
 * backstop if it ever happens.
 */
async function nextNumber(Model, field, prefix) {
  const year = new Date().getFullYear();
  const full = `${prefix}-${year}-`;
  const last = await Model.findOne({ [field]: new RegExp(`^${full}`) })
    .sort({ [field]: -1 })
    .select(field)
    .lean();

  const sequence = last ? Number(last[field].slice(full.length)) + 1 : 1;
  return `${full}${String(sequence).padStart(5, '0')}`;
}

/** A `YYYY-MM-DD` day, or the fallback. Never a client-supplied timestamp. */
function toDate(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function endOfDay(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value ?? ''));
}

// ---- the stock ledger -------------------------------------------------------

/**
 * The one place `db().Product.stock` changes.
 *
 * Increments the product and writes the movement that explains it, returning
 * the quantity the change produced. `qtyAfter` is read back from the updated
 * document rather than computed from a stale copy, so two concurrent receipts
 * cannot both record the same "after".
 *
 * Stock is never taken below zero: a negative quantity on hand is not a real
 * position, and an adjustment that would go there is refused rather than
 * silently floored - the staff member meant something specific and should be told
 * which part of it could not happen.
 */
async function applyStockMovement({
  product,
  type,
  qtyChange,
  unitCost,
  reference,
  note,
  createdBy,
  business,
}) {
  const doc = await db().Product.findById(product).select('_id stock name sku');
  if (!doc) throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');

  if (qtyChange < 0 && doc.stock + qtyChange < 0) {
    throw ApiError.badRequest(
      `${doc.sku} has ${doc.stock} on hand - that adjustment would take it below zero.`,
      'STOCK_BELOW_ZERO',
    );
  }

  const updated = await db().Product.findByIdAndUpdate(
    doc._id,
    { $inc: { stock: qtyChange } },
    { new: true, select: 'stock' },
  );

  await db().StockMovement.create({
    product: doc._id,
    business: business ?? undefined,
    type,
    qtyChange,
    qtyAfter: updated.stock,
    unitCost,
    reference,
    note,
    createdBy,
  });

  return updated.stock;
}

// ---- suppliers --------------------------------------------------------------

/**
 * `lastOrderAt` is passed in rather than read off the document, because unlike
 * `ordersCount` and `totalSpent` it is not denormalised onto `Supplier` - it
 * comes from an aggregation over the purchase orders (see `listSuppliers`).
 * Callers that have no reason to run that aggregation omit it and the field is
 * `null`, which the list renders as "Never" - the same thing it renders for a
 * supplier that genuinely has never been ordered from.
 */
function shapeSupplier(supplier, lastOrderAt = null) {
  return {
    id: supplier._id.toString(),
    name: supplier.name,
    code: supplier.code ?? null,
    email: supplier.email ?? null,
    phone: supplier.phone ?? null,
    contactName: supplier.contactName ?? null,
    website: supplier.website ?? null,
    address: supplier.address ?? null,
    paymentTerms: supplier.paymentTerms,
    // The agreements they must sign before they can quote. Empty means none is
    // required, which is a real answer rather than a missing one.
    agreementTemplates: (supplier.agreementTemplates ?? []).map((id) => id.toString()),
    notes: supplier.notes ?? null,
    isActive: supplier.isActive,
    // `at` rides along because it is the half of a consent record that makes it
    // evidence: the edit form shows when the answer was taken, so nobody has to
    // guess whether ticks they are looking at were set last week or at import.
    contactConsent: {
      sms: supplier.contactConsent?.sms ?? false,
      whatsapp: supplier.contactConsent?.whatsapp ?? false,
      email: supplier.contactConsent?.email ?? false,
      call: supplier.contactConsent?.call ?? false,
      at: supplier.contactConsent?.at ?? null,
    },
    // What this supplier sells, as component-type slugs. The request-for-quote
    // picker filters on these (§6.8a).
    componentTypes: supplier.componentTypes ?? [],
    // Portal state, never the credential itself. `portalInviteAt` is what the
    // Suppliers screen reads to decide between "Send portal link" and "Resend"
    // - a supplier who has never been invited cannot answer a request, and the
    // button should say which of the two it is doing.
    portalInviteAt: supplier.portalInviteAt ?? null,
    portalLastLoginAt: supplier.portalLastLoginAt ?? null,
    ordersCount: supplier.ordersCount ?? 0,
    totalSpent: supplier.totalSpent ?? 0,
    lastOrderAt: lastOrderAt ?? null,
  };
}

async function listSuppliers({ q, status } = {}) {
  const query = {};
  if (status === 'active') query.isActive = true;
  if (status === 'inactive') query.isActive = false;

  if (q) {
    const rx = likeRegex(q);
    query.$or = [{ name: rx }, { code: rx }, { contactName: rx }, { email: rx }];
  }

  const [suppliers, total, active, lastOrders, spend] = await Promise.all([
    db().Supplier.find(query).sort({ name: 1 }).limit(300).lean(),

    // Counts come from the whole collection, not the filtered set - the same
    // rule the invoice pills follow, for the same reason.
    db().Supplier.countDocuments({}),
    db().Supplier.countDocuments({ isActive: true }),

    // Newest order date per supplier. Drafts and cancellations are excluded on
    // the same grounds the spend chart excludes them: a draft is a plan, and
    // "last ordered Aug 16" is a claim that something was actually sent.
    db().PurchaseOrder.aggregate([
      { $match: { status: { $nin: ['draft', 'cancelled'] } } },
      { $group: { _id: '$supplier', lastOrderAt: { $max: '$orderDate' } } },
    ]),

    // The header's Total Orders / Total Spent. Summed from the purchase orders
    // rather than from the suppliers' denormalised counters: those are
    // per-supplier running totals, and adding them up would double-count
    // anything a future backfill touches twice.
    db().PurchaseOrder.aggregate([
      { $match: { status: { $nin: ['draft', 'cancelled'] } } },
      { $group: { _id: null, orders: { $sum: 1 }, spent: { $sum: '$total' } } },
    ]),
  ]);

  const lastOrderBySupplier = new Map(
    lastOrders.map((row) => [String(row._id), row.lastOrderAt]),
  );

  return {
    suppliers: suppliers.map((supplier) =>
      shapeSupplier(supplier, lastOrderBySupplier.get(String(supplier._id)) ?? null),
    ),
    counts: { all: total, active, inactive: total - active },
    totals: { orders: spend[0]?.orders ?? 0, spent: spend[0]?.spent ?? 0 },
  };
}

async function getSupplier(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');

  const supplier = await db().Supplier.findById(id).lean();
  if (!supplier) throw ApiError.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');

  const [orders, products, spendRows] = await Promise.all([
    db().PurchaseOrder.find({ supplier: id })
      .sort({ orderDate: -1 })
      .limit(50)
      .populate('supplier', 'name email')
      .lean(),
    db().Product.find({ supplier: id })
      .sort({ name: 1 })
      .limit(100)
      .select('name sku price cost stock minStock')
      .lean(),
    // Spend by month, from sent, partial and received POs only - a draft is a
    // plan, not money, and charting it would overstate what this supplier has
    // actually cost.
    db().PurchaseOrder.aggregate([
      {
        $match: {
          supplier: new mongoose.Types.ObjectId(String(id)),
          status: { $nin: ['draft', 'cancelled'] },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$orderDate' } },
          total: { $sum: '$total' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 24 },
    ]),
  ]);

  // The profile's Last Order tile. Derived from the orders already loaded above
  // rather than by re-running the list's aggregation - same rule it follows
  // (drafts and cancellations are not an order having been placed), one fewer
  // round trip.
  const lastOrderAt =
    orders
      .filter((order) => !['draft', 'cancelled'].includes(order.status))
      .reduce((latest, order) => {
        const at = order.orderDate ? new Date(order.orderDate) : null;
        return at && (!latest || at > latest) ? at : latest;
      }, null) ?? null;

  return {
    supplier: shapeSupplier(supplier, lastOrderAt),
    orders: orders.map(shapePurchaseOrder),
    products: products.map((product) => ({
      id: product._id.toString(),
      name: product.name,
      sku: product.sku,
      price: product.price,
      cost: product.cost ?? 0,
      stock: product.stock,
      minStock: product.minStock ?? 0,
    })),
    spend: spendRows.map((row) => ({ label: row._id, total: row.total, count: row.count })),
  };
}

/**
 * Stamp a consent answer with when it was recorded and on what basis.
 *
 * The client sends four booleans; it does not send `at` or `source`, because a
 * consent record whose provenance the client can write is not evidence of
 * anything. An absent `contactConsent` means the form did not touch the ticks,
 * which must leave whatever was there alone rather than writing four falses.
 */
function withConsentStamp(body, source = 'admin') {
  if (!body.contactConsent) return body;
  return {
    ...body,
    contactConsent: { ...body.contactConsent, at: new Date(), source },
  };
}

/**
 * A new supplier, with portal access mailed out if we have an address.
 *
 * **The invitation is part of adding a supplier, not a second step somebody has
 * to remember** (§6.8a). A supplier who was never sent their link cannot answer
 * a request for quote, and nothing on the Suppliers screen would say why - so
 * the credential is minted and emailed on create, and `portalInvited` in the
 * response tells the screen whether it actually went.
 *
 * An inactive supplier gets no invite: an application from the storefront
 * arrives inactive by design and must not be handed a login before anybody has
 * reviewed it. Activating them and pressing **Resend portal link** is the path.
 *
 * The mail never fails the create - `invitePortal` resolves either way, and the
 * supplier is already written by then. The same rule registration follows.
 */
async function createSupplier(body) {
  const supplier = await db().Supplier.create({
    ...withConsentStamp(body),
    code: body.code || undefined,
    // Blank entries are dropped: a picker can send '' for an empty row, and an
    // empty string fails the ObjectId cast.
    agreementTemplates: (body.agreementTemplates ?? []).filter(Boolean),
  });

  let portalInvited = false;
  let portalError = null;
  if (supplier.email && supplier.isActive) {
    try {
      const invite = await supplierPortalService.invitePortal(supplier._id);
      portalInvited = invite.delivered;
      portalError = invite.error;
    } catch (error) {
      portalError = error.message;
    }
  }

  const saved = await db().Supplier.findById(supplier._id).lean();
  return { supplier: shapeSupplier(saved), portalInvited, portalError };
}

async function updateSupplier(id, body) {
  if (!isObjectId(id)) throw ApiError.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');

  const supplier = await db().Supplier.findByIdAndUpdate(
    id,
    {
      ...withConsentStamp(body),
      // An omitted field means the caller did not touch it and the current list
      // stands; an empty array means "no agreement required", which is a
      // deliberate answer and must be able to clear the list.
      ...(body.agreementTemplates === undefined
        ? {}
        : { agreementTemplates: body.agreementTemplates.filter(Boolean) }),
    },
    { new: true, runValidators: true },
  );
  if (!supplier) throw ApiError.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');
  return { supplier: shapeSupplier(supplier.toObject()) };
}

/**
 * Deactivate rather than delete - purchase orders reference a supplier by id,
 * exactly as orders reference a product, and a deleted row would leave a PO
 * whose origin nobody can name. Toggles, so the card's icon button can undo it.
 */
async function toggleSupplier(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');

  const supplier = await db().Supplier.findById(id);
  if (!supplier) throw ApiError.notFound('Supplier not found.', 'SUPPLIER_NOT_FOUND');

  supplier.isActive = !supplier.isActive;
  await supplier.save();
  return { supplier: shapeSupplier(supplier.toObject()) };
}

/**
 * Recompute a supplier's card figures from its purchase orders.
 *
 * Called after every PO write. Recomputing beats incrementing: an incremented
 * cache drifts the first time a PO is cancelled, and nothing ever notices.
 * Drafts and cancellations are excluded for the same reason the spend chart
 * excludes them.
 */
async function refreshSupplierTotals(supplierId) {
  // A purchase order has no supplier until one is confirmed, so every caller
  // that runs before that point passes nothing. Returning early beats making
  // each of them remember to check.
  if (!supplierId || !isObjectId(supplierId)) return;

  const [row] = await db().PurchaseOrder.aggregate([
    {
      $match: {
        supplier: new mongoose.Types.ObjectId(String(supplierId)),
        status: { $nin: ['draft', 'cancelled'] },
      },
    },
    { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
  ]);

  await db().Supplier.findByIdAndUpdate(supplierId, {
    ordersCount: row?.count ?? 0,
    totalSpent: row?.total ?? 0,
  });
}

// ---- purchase orders --------------------------------------------------------

/**
 * Overdue is **derived, never stored** - a purchase order becomes late by the
 * passage of time, the same way an invoice becomes overdue (§6.5). A received
 * or cancelled PO is never late, however far past its expected date it sits.
 */
function shapePurchaseOrder(po) {
  const outstanding = (po.items ?? []).reduce(
    (sum, item) => sum + Math.max(0, item.qtyOrdered - (item.qtyReceived ?? 0)),
    0,
  );
  const open = !['received', 'cancelled'].includes(po.status);
  const overdue = Boolean(open && po.expectedDate && new Date(po.expectedDate) < new Date());

  return {
    id: po._id.toString(),
    poNumber: po.poNumber,
    title: po.title ?? null,
    // The CONFIRMED supplier, which is null until one is picked. A PO out for
    // pricing genuinely has nobody it is with, and `-` is the honest answer
    // rather than a name borrowed from whoever happens to be bidding.
    supplier: po.supplier?.name
      ? { id: po.supplier._id.toString(), name: po.supplier.name, email: po.supplier.email ?? null }
      : { id: po.supplier?.toString() ?? null, name: '-', email: null },
    componentTypes: po.componentTypes ?? [],
    bidCount: (po.bids ?? []).length,
    // How many suppliers actually priced it. Counted on `quotedAt` rather than
    // on status, because confirming moves the winner to `confirmed` and the
    // rest to `lost` - a decided order counted by status reported that nobody
    // had answered. See the fuller note in `purchaseBidService.getBidBoard`.
    quoteCount: (po.bids ?? []).filter((bid) => bid.quotedAt).length,
    confirmedBid: po.confirmedBid?.toString() ?? null,
    confirmedAt: po.confirmedAt ?? null,
    closesAt: po.closesAt ?? null,
    closed: Boolean(po.closesAt && new Date(po.closesAt) < new Date()),
    status: po.status,
    orderDate: po.orderDate,
    expectedDate: po.expectedDate ?? null,
    receivedDate: po.receivedDate ?? null,
    overdue,
    items: (po.items ?? []).map((item) => ({
      product: item.product?.toString() ?? null,
      sku: item.sku,
      name: item.name,
      qtyOrdered: item.qtyOrdered,
      qtyReceived: item.qtyReceived ?? 0,
      unitCost: item.unitCost,
      lineTotal: item.lineTotal,
    })),
    itemCount: (po.items ?? []).length,
    qtyOutstanding: outstanding,
    subtotal: po.subtotal ?? 0,
    tax: po.tax ?? 0,
    shipping: po.shipping ?? 0,
    total: po.total ?? 0,
    payment: {
      status: po.payment?.status ?? 'unpaid',
      method: po.payment?.method ?? null,
      reference: po.payment?.reference ?? null,
      paidAt: po.payment?.paidAt ?? null,
      expense: po.payment?.expense?.toString() ?? null,
    },
    timeline: (po.timeline ?? []).map((entry) => ({
      status: entry.status,
      at: entry.at,
      note: entry.note ?? null,
    })),
    notes: po.notes ?? null,
  };
}

/**
 * Totals from the lines. The client sends quantities and a negotiated unit
 * cost; every figure below is arithmetic the server does (invariant 8).
 */
function recomputeTotals(po) {
  po.items.forEach((item) => {
    item.lineTotal = item.qtyOrdered * item.unitCost;
  });
  po.subtotal = po.items.reduce((sum, item) => sum + item.lineTotal, 0);
  po.total = po.subtotal + (po.tax ?? 0) + (po.shipping ?? 0);
  return po;
}

/**
 * Status from receiving, not from a client.
 *
 * **Only the receiving half of the life cycle is derived.** Everything up to
 * and including `confirmed` is a decision somebody made - a draft is being
 * written, a sent order is out with suppliers, a negotiating one is mid
 * conversation, a confirmed one is placed - and none of those can be read off
 * the quantities, because all four have received nothing. Deriving them would
 * mean `received <= 0` stamping every one of them back to `sent`, which is how
 * a negotiation in progress silently loses its stage.
 *
 * Past that point it is a reading of the lines: a PO with a short line is
 * `partial`, and only one with every line complete is `received`. Same shape as
 * `recomputeInvoice` in `adminService`, for the same reason: a header that
 * disagrees with its rows is a header nobody can trust.
 */
const PO_PRE_RECEIVING = ['draft', 'sent', 'negotiating', 'confirmed', 'cancelled'];

function recomputeStatus(po) {
  const received = po.items.reduce((sum, item) => sum + (item.qtyReceived ?? 0), 0);

  // A stage nothing has been received against keeps whatever it was set to.
  if (received <= 0 && PO_PRE_RECEIVING.includes(po.status)) return po;
  if (po.status === 'cancelled') return po;

  const ordered = po.items.reduce((sum, item) => sum + item.qtyOrdered, 0);

  if (received <= 0) po.status = 'confirmed';
  else if (received >= ordered) po.status = 'received';
  else po.status = 'partial';

  po.receivedDate = po.status === 'received' ? (po.receivedDate ?? new Date()) : null;
  return po;
}

async function listPurchaseOrders({ q, status, supplier, from, to } = {}) {
  const query = {};

  if (status === 'overdue') {
    query.status = { $nin: ['received', 'cancelled'] };
    query.expectedDate = { $lt: new Date() };
  } else if (status && status !== 'all') {
    query.status = String(status);
  }

  if (supplier && isObjectId(supplier)) query.supplier = supplier;

  if (from || to) {
    query.orderDate = {};
    if (from) query.orderDate.$gte = toDate(from);
    if (to) query.orderDate.$lte = endOfDay(to);
  }

  if (q) {
    const rx = likeRegex(q);
    // Staff have either the PO in front of them or the supplier's name, so
    // both resolve - the same courtesy the invoice search extends.
    const suppliers = await db().Supplier.find({ $or: [{ name: rx }, { code: rx }] })
      .select('_id')
      .lean();
    query.$or = [{ poNumber: rx }, { supplier: { $in: suppliers.map((s) => s._id) } }];
  }

  const orders = await db().PurchaseOrder.find(query)
    .sort({ orderDate: -1 })
    .limit(200)
    .populate('supplier', 'name email')
    .lean();

  const [statusRows, pendingRow] = await Promise.all([
    db().PurchaseOrder.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    // Pending value is money committed and not yet landed - the number a
    // staff member uses to answer "what is on the water". A cancelled PO is not
    // committed and a received one has arrived, so neither counts.
    db().PurchaseOrder.aggregate([
      { $match: { status: { $in: ['draft', 'sent', 'partial'] } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
  ]);

  const counts = Object.fromEntries(statusRows.map((row) => [row._id, row.count]));
  counts.all = statusRows.reduce((sum, row) => sum + row.count, 0);

  return {
    orders: orders.map(shapePurchaseOrder),
    counts,
    totals: { pendingValue: pendingRow[0]?.total ?? 0 },
  };
}

async function getPurchaseOrder(id) {
  const query = isObjectId(id) ? { _id: id } : { poNumber: String(id) };
  const po = await db().PurchaseOrder.findOne(query)
    .populate('supplier', 'name email phone paymentTerms')
    .lean();
  if (!po) throw ApiError.notFound('Purchase order not found.', 'PO_NOT_FOUND');

  // The lines' Linked Inventory column: what each ordered part holds in stock
  // *now*. Read live rather than snapshotted onto the line, because the number
  // a staff member is checking against is today's shelf, not the one that was
  // there when the order was raised.
  const productIds = (po.items ?? []).map((item) => item.product).filter(Boolean);

  const [movements, linked] = await Promise.all([
    db().StockMovement.find({
      'reference.kind': 'purchase_order',
      'reference.id': po._id,
    })
      .sort({ createdAt: -1 })
      .populate('product', 'name sku')
      .lean(),

    productIds.length
      ? db().Product.find({ _id: { $in: productIds } }).select('name sku stock').lean()
      : [],
  ]);

  const stockByProduct = new Map(
    linked.map((product) => [
      product._id.toString(),
      { id: product._id.toString(), name: product.name, sku: product.sku, stock: product.stock },
    ]),
  );

  const order = shapePurchaseOrder(po);

  return {
    order: {
      ...order,
      items: order.items.map((item) => ({
        ...item,
        // `null` when the line was never linked to a catalogue product - a real
        // state, and the one the client renders as "not linked".
        inventory: item.product ? (stockByProduct.get(item.product) ?? null) : null,
      })),
    },
    movements: movements.map((movement) => ({
      id: movement._id.toString(),
      product: movement.product
        ? {
            id: movement.product._id.toString(),
            name: movement.product.name,
            sku: movement.product.sku,
          }
        : null,
      qtyChange: movement.qtyChange,
      qtyAfter: movement.qtyAfter,
      at: movement.createdAt,
      note: movement.note ?? null,
    })),
  };
}

/**
 * Create a purchase order.
 *
 * Line names and SKUs are snapshotted from the catalogue at creation, the way
 * an order line is - a PO raised in March must still read correctly when the
 * product is renamed in June.
 */
/**
 * Raise a purchase order.
 *
 * **No supplier is named yet** - the order is raised to ask several of them
 * what it costs, and `confirmSupplier` picks the one it is placed with. The
 * suppliers ticked at this stage become `bids` in the `invited` state; nothing
 * reaches them until the order is sent.
 */
async function createPurchaseOrder(body, createdBy) {
  const ids = body.items.map((item) => item.product).filter(isObjectId);
  const products = await db().Product.find({ _id: { $in: ids } })
    .select('name sku partType')
    .lean();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  const items = body.items.map((item) => {
    const product = byId.get(String(item.product));
    if (!product) {
      throw ApiError.badRequest('One of those products no longer exists.', 'PRODUCT_NOT_FOUND');
    }
    return {
      product: product._id,
      sku: product.sku,
      name: product.name,
      qtyOrdered: item.qtyOrdered,
      qtyReceived: 0,
      // Zero until a supplier is confirmed. A cost typed on the create form is
      // an expectation, not the price the order is placed at.
      unitCost: item.unitCost ?? 0,
      lineTotal: item.qtyOrdered * (item.unitCost ?? 0),
    };
  });

  const bids = await buildBids(body.suppliers ?? []);

  // What the suppliers were chosen by. Falls back to the component types the
  // lines actually carry, so an order raised without ticking any still records
  // what it covers.
  const componentTypes = body.componentTypes?.length
    ? body.componentTypes
    : [...new Set(products.map((product) => product.partType).filter(Boolean))];

  const po = new (db().PurchaseOrder)({
    poNumber: await nextNumber(db().PurchaseOrder, 'poNumber', 'PO'),
    title: body.title,
    status: 'draft',
    componentTypes,
    orderDate: toDate(body.orderDate, new Date()),
    expectedDate: toDate(body.expectedDate),
    closesAt: toDate(body.closesAt),
    items,
    bids,
    tax: body.tax ?? 0,
    shipping: body.shipping ?? 0,
    notes: body.notes,
    createdBy,
    timeline: [{ status: 'draft', at: new Date(), note: 'Purchase order created.' }],
  });

  recomputeTotals(po);
  await po.save();

  return { order: shapePurchaseOrder(po.toObject()) };
}

/** Turns a list of supplier ids into `invited` bids, skipping any that are gone. */
async function buildBids(supplierIds) {
  const ids = [...new Set((supplierIds ?? []).map(String))].filter(isObjectId);
  if (!ids.length) return [];

  const suppliers = await db().Supplier.find({ _id: { $in: ids }, isActive: true })
    .select('name')
    .lean();

  return suppliers.map((supplier) => ({
    supplier: supplier._id,
    supplierName: supplier.name,
    status: 'invited',
  }));
}

/** Edits stop at `draft` - once a PO has been sent, the supplier is working
 *  from a document this one no longer matches. */
async function updatePurchaseOrder(id, body) {
  const query = isObjectId(id) ? { _id: id } : { poNumber: String(id) };
  const po = await db().PurchaseOrder.findOne(query);
  if (!po) throw ApiError.notFound('Purchase order not found.', 'PO_NOT_FOUND');

  if (po.status !== 'draft') {
    throw ApiError.badRequest(
      `${po.poNumber} has already been sent - cancel it and raise a new one rather than editing it.`,
      'PO_NOT_EDITABLE',
    );
  }

  const ids = body.items.map((item) => item.product).filter(isObjectId);
  const products = await db().Product.find({ _id: { $in: ids } })
    .select('name sku partType')
    .lean();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  po.title = body.title;
  po.orderDate = toDate(body.orderDate, po.orderDate);
  po.expectedDate = toDate(body.expectedDate);
  po.closesAt = toDate(body.closesAt);
  po.tax = body.tax ?? 0;
  po.shipping = body.shipping ?? 0;
  po.notes = body.notes;
  if (body.componentTypes?.length) po.componentTypes = body.componentTypes;
  po.items = body.items.map((item) => {
    const product = byId.get(String(item.product));
    if (!product) {
      throw ApiError.badRequest('One of those products no longer exists.', 'PRODUCT_NOT_FOUND');
    }
    return {
      product: product._id,
      sku: product.sku,
      name: product.name,
      qtyOrdered: item.qtyOrdered,
      qtyReceived: 0,
      unitCost: item.unitCost ?? 0,
      lineTotal: item.qtyOrdered * (item.unitCost ?? 0),
    };
  });

  // Suppliers on a draft are replaced wholesale, but a bid that already carries
  // a price is kept: re-saving the form after adding a line must not throw away
  // an answer that has already come back.
  if (body.suppliers) {
    const wanted = new Set(body.suppliers.map(String));
    const keep = (po.bids ?? []).filter((bid) => wanted.has(String(bid.supplier)));
    const kept = new Set(keep.map((bid) => String(bid.supplier)));
    const added = await buildBids(body.suppliers.filter((id) => !kept.has(String(id))));
    po.bids = [...keep, ...added];
  }

  recomputeTotals(po);
  await po.save();

  return { order: shapePurchaseOrder(po.toObject()) };
}

/**
 * Cancel a purchase order.
 *
 * **Sending is no longer reachable here.** It lives in
 * `purchaseBidService.sendPurchaseOrder`, which also mails every supplier the
 * order is being put to - two routes that both set `sent` would mean one of
 * them silently skipping the mail, and an order nobody was told about looks
 * identical to one they ignored.
 *
 * Cancelling a PO that has already taken delivery is refused: that stock is on
 * the shelf, and cancelling the paperwork behind it would leave a quantity with
 * no document to explain it. Receive the rest, or leave it partial.
 */
async function setPurchaseOrderStatus(id, { status, note }) {
  const query = isObjectId(id) ? { _id: id } : { poNumber: String(id) };
  const po = await db().PurchaseOrder.findOne(query);
  if (!po) throw ApiError.notFound('Purchase order not found.', 'PO_NOT_FOUND');

  if (status === 'sent') {
    throw ApiError.badRequest(
      'Send this order from its suppliers panel, so the suppliers on it are actually told.',
      'PO_SEND_VIA_BIDS',
    );
  } else {
    if (po.status === 'cancelled') {
      throw ApiError.badRequest(`${po.poNumber} is already cancelled.`, 'PO_ALREADY_CANCELLED');
    }
    const received = po.items.reduce((sum, item) => sum + (item.qtyReceived ?? 0), 0);
    if (received > 0) {
      throw ApiError.badRequest(
        `${po.poNumber} has already taken delivery of ${received} unit(s) - that stock is on the shelf, and cancelling would leave it unexplained.`,
        'PO_PARTIALLY_RECEIVED',
      );
    }
    po.status = 'cancelled';
  }

  po.timeline.push({ status: po.status, at: new Date(), note });
  await po.save();
  await refreshSupplierTotals(po.supplier);

  return { order: shapePurchaseOrder(po.toObject()) };
}

/**
 * Receive a delivery (§6.8, automation contract).
 *
 * The client sends what arrived **in this delivery**, per SKU. The server adds
 * it to what has already arrived, refuses an over-receipt line by line, moves
 * stock through the ledger, and re-derives the status. Nothing about a status
 * or a running total is accepted from the request.
 *
 * Partial by design, in the same sense the bulk order action is: one line that
 * cannot be received must not fail the rest of the delivery, so each is
 * attempted independently and the response names what moved and what did not,
 * with a reason per skip. Silently receiving nineteen of twenty lines is how a
 * staff member comes to trust a button that is lying to them.
 */
async function receivePurchaseOrder(id, { lines, note }, receivedBy) {
  const query = isObjectId(id) ? { _id: id } : { poNumber: String(id) };
  const po = await db().PurchaseOrder.findOne(query);
  if (!po) throw ApiError.notFound('Purchase order not found.', 'PO_NOT_FOUND');

  if (po.status === 'draft') {
    throw ApiError.badRequest(`${po.poNumber} has not been sent to the supplier yet.`, 'PO_NOT_SENT');
  }
  if (po.status === 'cancelled') {
    throw ApiError.badRequest(`${po.poNumber} is cancelled.`, 'PO_CANCELLED');
  }
  if (po.status === 'received') {
    throw ApiError.badRequest(`${po.poNumber} is already fully received.`, 'PO_ALREADY_RECEIVED');
  }

  const received = [];
  const skipped = [];

  for (const line of lines) {
    if (line.qty <= 0) continue;

    const item = po.items.find((candidate) => candidate.sku === line.sku);
    if (!item) {
      skipped.push({ sku: line.sku, reason: 'That SKU is not on this purchase order.' });
      continue;
    }

    const outstanding = item.qtyOrdered - (item.qtyReceived ?? 0);
    if (outstanding <= 0) {
      skipped.push({ sku: line.sku, reason: 'Already fully received.' });
      continue;
    }
    if (line.qty > outstanding) {
      // Over-receipt is refused rather than clamped: receiving more than was
      // ordered is either a supplier error or a typo, and quietly accepting it
      // puts a quantity on the shelf that no document accounts for.
      skipped.push({
        sku: line.sku,
        reason: `Only ${outstanding} outstanding - receiving ${line.qty} would exceed the order.`,
      });
      continue;
    }

    let qtyAfter;
    try {
      qtyAfter = await applyStockMovement({
        product: item.product,
        type: 'purchase',
        qtyChange: line.qty,
        unitCost: item.unitCost,
        reference: { kind: 'purchase_order', id: po._id, label: po.poNumber },
        note,
        createdBy: receivedBy,
      });
    } catch (error) {
      skipped.push({ sku: line.sku, reason: error.message });
      continue;
    }

    item.qtyReceived = (item.qtyReceived ?? 0) + line.qty;
    received.push({ sku: line.sku, name: item.name, qty: line.qty, qtyAfter });

    // A receipt is the moment the true cost of this part is known, so the
    // catalogue's cost follows it. `price` is untouched - what Cellvix pays and
    // what a client pays are two decisions, and only one of them belongs to the
    // supplier.
    await db().Product.findByIdAndUpdate(item.product, { cost: item.unitCost });
  }

  if (received.length) {
    recomputeStatus(po);
    po.timeline.push({
      status: po.status,
      at: new Date(),
      note: note ?? `Received ${received.reduce((sum, row) => sum + row.qty, 0)} unit(s).`,
    });
    await po.save();
  }

  return { order: shapePurchaseOrder(po.toObject()), received, skipped };
}

/**
 * Record a PO payment - which creates the `Expense` row (§6.8).
 *
 * Written once and only once: a PO already carrying `payment.expense` is
 * refused, because the alternative is a staff member double-clicking their way
 * into a P&L that counts the same money twice.
 *
 * The expense amount is `po.total`, read from the order and never from the
 * request - the same rule that stops a client sending a price.
 */
async function recordPurchasePayment(id, { method, reference, paidAt, category }, createdBy) {
  const query = isObjectId(id) ? { _id: id } : { poNumber: String(id) };
  const po = await db().PurchaseOrder.findOne(query).populate('supplier', 'name');
  if (!po) throw ApiError.notFound('Purchase order not found.', 'PO_NOT_FOUND');

  if (po.status === 'draft') {
    throw ApiError.badRequest(`${po.poNumber} has not been sent to the supplier yet.`, 'PO_NOT_SENT');
  }
  if (po.status === 'cancelled') {
    throw ApiError.badRequest(`${po.poNumber} is cancelled.`, 'PO_CANCELLED');
  }
  if (po.payment?.expense) {
    throw ApiError.badRequest(
      `${po.poNumber} is already recorded as paid - see the expense it created.`,
      'PO_ALREADY_PAID',
    );
  }

  const categoryDoc = await resolvePurchaseCategory(category);

  const when = toDate(paidAt, new Date());

  const expense = await db().Expense.create({
    number: await nextNumber(db().Expense, 'number', 'EXP'),
    date: when,
    description: `Purchase Order ${po.poNumber} - ${po.supplier?.name ?? 'supplier'}`,
    category: categoryDoc._id,
    payee: po.supplier?.name,
    method,
    status: 'paid',
    amount: po.total,
    tax: po.tax ?? 0,
    taxIncluded: true,
    reference: reference ?? po.poNumber,
    purchaseOrder: po._id,
    createdBy,
  });

  po.payment = { status: 'paid', method, reference, paidAt: when, expense: expense._id };
  po.timeline.push({
    status: po.status,
    at: new Date(),
    note: `Payment recorded - ${expense.number}.`,
  });
  await po.save();

  const populated = await db().Expense.findById(expense._id)
    .populate('category', 'name colorToken')
    .populate('purchaseOrder', 'poNumber')
    .lean();

  return { order: shapePurchaseOrder(po.toObject()), expense: shapeExpense(populated) };
}

/**
 * Where a PO payment is filed.
 *
 * The staff member's choice wins; otherwise the seeded stock category, and failing
 * that the first active one. A PO payment with nowhere to file it is refused
 * rather than filed nowhere - an expense with no category is invisible to
 * every report that groups by one.
 */
async function resolvePurchaseCategory(category) {
  if (category && isObjectId(category)) {
    const chosen = await db().ExpenseCategory.findById(category).lean();
    if (chosen) return chosen;
  }

  const stock = await db().ExpenseCategory.findOne({ slug: 'inventory-purchases' }).lean();
  if (stock) return stock;

  const first = await db().ExpenseCategory.findOne({ isActive: true }).sort({ order: 1 }).lean();
  if (first) return first;

  throw ApiError.badRequest(
    'No expense category exists to file this against - add one first.',
    'NO_EXPENSE_CATEGORY',
  );
}

// ---- expenses ---------------------------------------------------------------

function shapeExpense(expense) {
  return {
    id: expense._id.toString(),
    number: expense.number,
    date: expense.date,
    description: expense.description,
    category: expense.category?.name
      ? {
          id: expense.category._id.toString(),
          name: expense.category.name,
          colorToken: expense.category.colorToken ?? 'ink',
        }
      : { id: expense.category?.toString() ?? null, name: '-', colorToken: 'ink' },
    payee: expense.payee ?? null,
    method: expense.method ?? null,
    status: expense.status,
    amount: expense.amount,
    tax: expense.tax ?? 0,
    taxIncluded: expense.taxIncluded,
    reference: expense.reference ?? null,
    // A PO-generated row is labelled and links back, so a staff member can tell
    // what they entered from what the system entered for them (§6.9).
    purchaseOrder: expense.purchaseOrder
      ? {
          id: (expense.purchaseOrder._id ?? expense.purchaseOrder).toString(),
          poNumber: expense.purchaseOrder.poNumber ?? null,
        }
      : null,
    notes: expense.notes ?? null,
  };
}

async function listExpenses({ q, category, status, from, to } = {}) {
  const query = {};

  if (status && status !== 'all') query.status = String(status);
  if (category && isObjectId(category)) query.category = category;

  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = toDate(from);
    if (to) query.date.$lte = endOfDay(to);
  }

  if (q) {
    const rx = likeRegex(q);
    query.$or = [{ description: rx }, { payee: rx }, { reference: rx }, { number: rx }];
  }

  const expenses = await db().Expense.find(query)
    .sort({ date: -1 })
    .limit(300)
    .populate('category', 'name colorToken')
    .populate('purchaseOrder', 'poNumber')
    .lean();

  const shaped = expenses.map(shapeExpense);

  // The KPI row describes the **filtered** set, because that is what is on
  // screen - a total that ignored the date filter would contradict the rows
  // beneath it. The status counts are the exception and come from the whole
  // collection, for the pill rule (§6.5).
  const statusRows = await db().Expense.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);

  const counts = Object.fromEntries(statusRows.map((row) => [row._id, row.count]));
  counts.all = statusRows.reduce((sum, row) => sum + row.count, 0);

  return {
    expenses: shaped,
    counts,
    totals: {
      total: shaped.reduce((sum, expense) => sum + expense.amount, 0),
      entries: shaped.length,
      pending: shaped
        .filter((expense) => expense.status === 'pending')
        .reduce((sum, expense) => sum + expense.amount, 0),
      tax: shaped.reduce((sum, expense) => sum + expense.tax, 0),
    },
  };
}

async function createExpense(body, createdBy) {
  const category = await db().ExpenseCategory.findById(body.category).lean();
  if (!category) throw ApiError.badRequest('Pick a category.', 'CATEGORY_NOT_FOUND');

  const expense = await db().Expense.create({
    ...body,
    number: await nextNumber(db().Expense, 'number', 'EXP'),
    date: toDate(body.date, new Date()),
    createdBy,
  });

  const populated = await db().Expense.findById(expense._id)
    .populate('category', 'name colorToken')
    .lean();

  return { expense: shapeExpense(populated) };
}

/**
 * A PO-generated expense is owned by its purchase order and cannot be edited
 * here - the two would drift, and the P&L would be reading a number the PO no
 * longer agrees with.
 */
async function updateExpense(id, body) {
  if (!isObjectId(id)) throw ApiError.notFound('Expense not found.', 'EXPENSE_NOT_FOUND');

  const expense = await db().Expense.findById(id);
  if (!expense) throw ApiError.notFound('Expense not found.', 'EXPENSE_NOT_FOUND');

  if (expense.purchaseOrder) {
    throw ApiError.badRequest(
      'This expense belongs to a purchase order - edit it there.',
      'EXPENSE_FROM_PO',
    );
  }

  const category = await db().ExpenseCategory.findById(body.category).lean();
  if (!category) throw ApiError.badRequest('Pick a category.', 'CATEGORY_NOT_FOUND');

  Object.assign(expense, body, { date: toDate(body.date, expense.date) });
  await expense.save();

  const populated = await db().Expense.findById(expense._id)
    .populate('category', 'name colorToken')
    .lean();

  return { expense: shapeExpense(populated) };
}

async function deleteExpense(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Expense not found.', 'EXPENSE_NOT_FOUND');

  const expense = await db().Expense.findById(id);
  if (!expense) throw ApiError.notFound('Expense not found.', 'EXPENSE_NOT_FOUND');

  if (expense.purchaseOrder) {
    throw ApiError.badRequest(
      'This expense belongs to a purchase order - delete it there, or it comes back the moment the PO is read.',
      'EXPENSE_FROM_PO',
    );
  }

  await expense.deleteOne();
  return { ok: true };
}

// ---- expense categories -----------------------------------------------------

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function shapeCategory(category, usage = 0) {
  return {
    id: category._id.toString(),
    name: category.name,
    slug: category.slug,
    colorToken: category.colorToken ?? 'ink',
    gstApplicable: category.gstApplicable,
    isActive: category.isActive,
    order: category.order ?? 0,
    usage,
  };
}

/** Usage comes back with the list so the UI can explain why a delete will be
 *  refused **before** the staff member clicks it, rather than after. */
async function listExpenseCategories() {
  const [categories, usageRows] = await Promise.all([
    db().ExpenseCategory.find({}).sort({ order: 1, name: 1 }).lean(),
    db().Expense.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
  ]);

  const usage = new Map(usageRows.map((row) => [String(row._id), row.count]));
  return {
    categories: categories.map((category) =>
      shapeCategory(category, usage.get(category._id.toString()) ?? 0),
    ),
  };
}

async function createExpenseCategory(body) {
  const slug = slugify(body.name);
  const clash = await db().ExpenseCategory.findOne({ slug }).lean();
  if (clash) throw ApiError.conflict('A category by that name already exists.', 'CATEGORY_EXISTS');

  const category = await db().ExpenseCategory.create({ ...body, slug });
  return { category: shapeCategory(category.toObject()) };
}

async function updateExpenseCategory(id, body) {
  if (!isObjectId(id)) throw ApiError.notFound('Category not found.', 'CATEGORY_NOT_FOUND');

  const category = await db().ExpenseCategory.findById(id);
  if (!category) throw ApiError.notFound('Category not found.', 'CATEGORY_NOT_FOUND');

  const slug = slugify(body.name);
  const clash = await db().ExpenseCategory.findOne({ slug, _id: { $ne: category._id } }).lean();
  if (clash) throw ApiError.conflict('A category by that name already exists.', 'CATEGORY_EXISTS');

  Object.assign(category, body, { slug });
  await category.save();
  return { category: shapeCategory(category.toObject()) };
}

/**
 * A category in use is deactivated, never deleted (§6.9) - deleting one would
 * silently re-bucket every historical expense that pointed at it, and the P&L
 * would change shape for a reason nobody could find later. The response says
 * which of the two happened rather than reporting a delete either way.
 */
async function deleteExpenseCategory(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Category not found.', 'CATEGORY_NOT_FOUND');

  const category = await db().ExpenseCategory.findById(id);
  if (!category) throw ApiError.notFound('Category not found.', 'CATEGORY_NOT_FOUND');

  const usage = await db().Expense.countDocuments({ category: category._id });
  if (usage > 0) {
    category.isActive = false;
    await category.save();
    return {
      category: shapeCategory(category.toObject(), usage),
      deactivated: true,
      message: `${category.name} is used by ${usage} expense(s), so it has been deactivated rather than deleted.`,
    };
  }

  await category.deleteOne();
  return { ok: true, deactivated: false };
}

// ---- inventory --------------------------------------------------------------

/**
 * A row on the Inventory screen (§6.10).
 *
 * Exact quantities, reorder points and costs - all of which are admin-only. The
 * storefront's binary in stock / out of stock is produced by
 * `productService.serialize`, which is an allowlist and is untouched by
 * anything here.
 *
 * `minStock` of zero means "no reorder point set", which reads as never low
 * rather than always low; a product with no point falls back to the same
 * threshold the dashboard uses, so the two screens agree on what "low" means.
 * That rule and that number both live in `lowStockService` now - the threshold
 * is the one its owner set in Settings, and `threshold` is passed in because
 * this runs per row and must not read settings inside a loop.
 */
function shapeInventoryRow(product, threshold) {
  const stockStatus = classify(product, threshold);

  return {
    id: product._id.toString(),
    name: product.name,
    sku: product.sku,
    slug: product.slug,
    image: product.image ?? null,
    grade: product.grade,
    partTypeLabel: product.partTypeLabel ?? product.partType,
    brandName: product.brandName ?? null,
    modelName: product.modelName ?? null,
    stock: product.stock,
    minStock: product.minStock ?? 0,
    stockStatus,
    price: product.price,
    cost: product.cost ?? 0,
    // Valued at cost, not at retail: inventory is worth what it cost to
    // acquire, and valuing it at price books a profit that has not happened
    // yet. Falls back to price when no cost is recorded, so the tile is not
    // silently zero for a catalogue that predates cost tracking.
    totalValue: product.stock * (product.cost > 0 ? product.cost : product.price),
    location: product.location ?? null,
    barcode: product.barcode ?? null,
    supplier: product.supplier?.name
      ? { id: product.supplier._id.toString(), name: product.supplier.name }
      : null,
    isActive: product.isActive,
  };
}

async function listInventory({ q, stock, brand, grade } = {}) {
  // Resolved once for both the rows and the pills below, so the two cannot
  // classify the same product differently.
  const threshold = await lowStockThreshold();

  const query = {};
  if (brand) query.brandSlug = String(brand);
  if (grade) query.grade = String(grade);

  if (q) {
    const rx = likeRegex(q);
    query.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
  }

  const products = await db().Product.find(query)
    .sort({ name: 1 })
    .limit(500)
    .populate('supplier', 'name')
    .lean();

  let rows = products.map((product) => shapeInventoryRow(product, threshold));
  if (stock === 'attention') {
    // The set the sidebar badge counts: anything not comfortably in stock, and
    // still listed. Clicking that badge now lands on exactly its own number.
    rows = rows.filter((row) => row.stockStatus !== 'in' && row.isActive !== false);
  } else if (stock && stock !== 'all') {
    rows = rows.filter((row) => row.stockStatus === stock);
  }

  // The pills and the KPI row describe the whole catalogue, not the filtered
  // set: a pill reading "Low stock 0" because you are already filtered to
  // Out of stock tells the staff member nothing (the invoice-pill rule, §6.5).
  //
  // `isActive` is carried so the stock pills can exclude hidden products. A
  // product that is not listed cannot be sold, so it is not work - counting it
  // as low stock put three phantom rows between this screen's total and the
  // sidebar badge's, and a badge that reconciles with nothing is a badge the
  // staff member learns to ignore.
  const all = await db().Product.find({}).select('stock minStock price cost isActive').lean();
  const sellable = all.filter((product) => product.isActive !== false);

  // `all` counts the catalogue, because that is what the All pill selects.
  // The condition pills count only what is sellable, for the reason above.
  const counts = { all: all.length, in: 0, low: 0, out: 0 };
  for (const product of sellable) counts[classify(product, threshold)] += 1;
  counts.attention = counts.low + counts.out;

  let totalStock = 0;
  let totalValue = 0;
  for (const product of all) {
    totalStock += product.stock;
    totalValue += product.stock * (product.cost > 0 ? product.cost : product.price);
  }

  return {
    products: rows,
    counts,
    totals: {
      items: all.length,
      stock: totalStock,
      lowStock: counts.low,
      outOfStock: counts.out,
      value: totalValue,
    },
  };
}

async function getInventoryItem(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');

  const product = await db().Product.findById(id).populate('supplier', 'name email phone').lean();
  if (!product) throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');

  const [movements, purchaseOrders] = await Promise.all([
    db().StockMovement.find({ product: id }).sort({ createdAt: -1 }).limit(50).lean(),
    db().PurchaseOrder.find({ 'items.product': id })
      .sort({ orderDate: -1 })
      .limit(20)
      .populate('supplier', 'name')
      .lean(),
  ]);

  return {
    product: {
      ...shapeInventoryRow(product, await lowStockThreshold()),
      description: product.description ?? null,
      compareAtPrice: product.compareAtPrice ?? null,
      competitors: product.competitors ?? [],
      deviceTypeName: product.deviceTypeName ?? null,
      seriesName: product.seriesName ?? null,
      partType: product.partType,
    },
    movements: movements.map((movement) => ({
      id: movement._id.toString(),
      type: movement.type,
      qtyChange: movement.qtyChange,
      qtyAfter: movement.qtyAfter,
      unitCost: movement.unitCost ?? null,
      reference: movement.reference ?? null,
      note: movement.note ?? null,
      at: movement.createdAt,
    })),
    // Price history in the sense that matters for purchasing: what this part
    // has cost, per delivery. A retail price history needs a change log the
    // catalogue does not keep yet.
    purchases: purchaseOrders.map((po) => {
      const line = po.items.find((item) => String(item.product) === String(id));
      return {
        id: po._id.toString(),
        poNumber: po.poNumber,
        supplier: po.supplier?.name ?? '-',
        orderDate: po.orderDate,
        status: po.status,
        qtyOrdered: line?.qtyOrdered ?? 0,
        qtyReceived: line?.qtyReceived ?? 0,
        unitCost: line?.unitCost ?? 0,
      };
    }),
  };
}

/** The ERP fields (§6.10). Kept apart from `updateProduct` so the catalogue
 *  form and the operations form cannot overwrite each other's fields. */
async function updateInventoryOps(id, body) {
  if (!isObjectId(id)) throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');

  const patch = {
    minStock: body.minStock ?? 0,
    cost: body.cost ?? 0,
    location: body.location ?? null,
    barcode: body.barcode ?? null,
    supplier: body.supplier && isObjectId(body.supplier) ? body.supplier : null,
  };

  const product = await db().Product.findByIdAndUpdate(id, patch, { new: true })
    .populate('supplier', 'name')
    .lean();
  if (!product) throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');

  return { product: shapeInventoryRow(product, await lowStockThreshold()) };
}

/** A manual correction. Goes through the ledger like every other movement. */
async function adjustStock(id, { qtyChange, type, note }, createdBy) {
  if (!isObjectId(id)) throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');

  const qtyAfter = await applyStockMovement({
    product: id,
    type,
    qtyChange,
    reference: { kind: 'manual', label: 'Manual adjustment' },
    note,
    createdBy,
  });

  const product = await db().Product.findById(id).populate('supplier', 'name').lean();
  return { product: shapeInventoryRow(product, await lowStockThreshold()), qtyAfter };
}

async function listStockMovements({ product, type, from, to } = {}) {
  const query = {};
  if (product && isObjectId(product)) query.product = product;
  if (type && type !== 'all') query.type = String(type);
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = toDate(from);
    if (to) query.createdAt.$lte = endOfDay(to);
  }

  const movements = await db().StockMovement.find(query)
    .sort({ createdAt: -1 })
    .limit(300)
    .populate('product', 'name sku')
    .lean();

  return {
    movements: movements.map((movement) => ({
      id: movement._id.toString(),
      product: movement.product
        ? {
            id: movement.product._id.toString(),
            name: movement.product.name,
            sku: movement.product.sku,
          }
        : null,
      type: movement.type,
      qtyChange: movement.qtyChange,
      qtyAfter: movement.qtyAfter,
      unitCost: movement.unitCost ?? null,
      reference: movement.reference ?? null,
      note: movement.note ?? null,
      at: movement.createdAt,
    })),
  };
}

export { applyStockMovement, listSuppliers, getSupplier, createSupplier, updateSupplier, toggleSupplier, listPurchaseOrders, getPurchaseOrder, createPurchaseOrder, updatePurchaseOrder, setPurchaseOrderStatus, receivePurchaseOrder, recordPurchasePayment, listExpenses, createExpense, updateExpense, deleteExpense, listExpenseCategories, createExpenseCategory, updateExpenseCategory, deleteExpenseCategory, listInventory, getInventoryItem, updateInventoryOps, adjustStock, listStockMovements };
