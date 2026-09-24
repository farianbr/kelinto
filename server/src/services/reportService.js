import { db } from '../db/models.js';
import '../models/Order.js';
import '../models/Invoice.js';
import '../models/Product.js';
import '../models/Expense.js';
import '../models/PurchaseOrder.js';
import '../models/StockMovement.js';
import '../models/Supplier.js';
import '../models/CreditTransaction.js';
import '../models/Settings.js';
import { DEFAULT_LOW_STOCK_THRESHOLD, reorderPoint } from './lowStockService.js';
import ApiError from '../utils/ApiError.js';

/**
 * Reports (ERP rework §6.11–6.12, phase 6).
 *
 * Six rules from §9 govern every figure in this file, and CellShoppe's own
 * reports are the anti-pattern each one is written against:
 *
 *   1. **Two named metrics, never one word.** `invoiced` is the value of
 *      invoices issued in the range, by invoice date. `collected` is payments
 *      received in the range, by payment date. They are different numbers and
 *      every tile says which it is - "Revenue" meaning one on one screen and
 *      the other on the next is how a report loses a staff member's trust.
 *   2. **Refunds are their own line**, never a negative folded into revenue.
 *   3. **A signed figure renders once.** A loss is `Net profit −$350.70`, not a
 *      positive number under a "Net loss" heading.
 *   4. **Cost of goods comes from the order line's own snapshot**, so margin
 *      survives a later cost change.
 *   5. **Tax is per province, read from Settings**, never a hard-coded rate.
 *   6. **Reports are read-only.** Nothing in this file writes.
 *
 * A seventh rule is local to this file and matters just as much: **a figure
 * that cannot be computed honestly says so.** Orders placed before cost was
 * tracked carry no `unitCost`, so every margin figure also reports how many
 * lines it could not cost. Printing a 100% margin because the cost was missing
 * is worse than printing nothing.
 */

// ---- range ------------------------------------------------------------------

/**
 * Inclusive whole days in `YYYY-MM-DD`. `to` is pushed to end-of-day here, on
 * the server, so a range of "today to today" is a real twenty-four hours
 * exactly as `adminService.resolveRange` does it, because two different
 * definitions of a range across two screens is its own kind of bug.
 */
function resolveRange({ from, to } = {}) {
  const now = new Date();

  const end = to ? new Date(`${to}T00:00:00`) : now;
  if (to) end.setHours(23, 59, 59, 999);

  const start = from ? new Date(`${from}T00:00:00`) : new Date(now.getTime() - 30 * 86_400_000);

  // A backwards range is a typo, not an intent.
  if (start > end) return { start: end, end: start };
  return { start, end };
}

// ---- shared aggregates ------------------------------------------------------

/**
 * Cost of goods and gross profit for orders in the range.
 *
 * Walks lines rather than aggregating in Mongo because the interesting output
 * is not just a total: it is a total **plus how much of it could be costed**.
 * `costedLines` and `uncostedLines` travel with every figure derived from this,
 * so a screen can say "margin excludes 12 lines with no recorded cost" instead
 * of quietly reporting them as pure profit.
 */
function costOfGoods(orders) {
  let cost = 0;
  let revenue = 0;
  let costedLines = 0;
  let uncostedLines = 0;
  let uncostedRevenue = 0;

  for (const order of orders) {
    for (const item of order.items ?? []) {
      revenue += item.lineTotal ?? 0;
      if (item.unitCost > 0) {
        cost += item.unitCost * item.qty;
        costedLines += 1;
      } else {
        uncostedLines += 1;
        uncostedRevenue += item.lineTotal ?? 0;
      }
    }
  }

  return { cost, revenue, costedLines, uncostedLines, uncostedRevenue };
}

/**
 * Service income for invoices in the range: repairs and every other charge
 * raised without an order.
 *
 * **The P&L used to read orders only**, so a business that repairs devices
 * reported none of that work as revenue: a ticket's invoice, or an itemised
 * charge raised at the counter, was invoiced and collected but never earned.
 * Those are the invoices with no `order` - an order's own invoice is already
 * counted through the order, and a store-credit receipt is a movement of money
 * rather than a sale. A voided invoice is left out, as a cancelled order is.
 *
 * Split the way the work was priced:
 *   - `labour`: service lines.
 *   - `parts`: part lines, costed from the `unitCost` snapshotted when the
 *     invoice was raised. A line without one (typed by hand, or raised before
 *     2026-09-24) is reported as uncosted rather than as pure margin.
 *   - `other`: whatever the total holds beyond its lines - an out-of-area fee,
 *     or the whole of a flat charge with no lines at all.
 * Revenue is always net of tax: `amount - taxCents` is what the business keeps.
 */
async function serviceIncomeIn(start, end) {
  const invoices = await db()
    .Invoice.find({
      issuedAt: { $gte: start, $lte: end },
      order: null,
      kind: { $ne: 'receipt' },
      'payments.method': { $ne: 'void' },
    })
    .select('amount taxCents discountCents devices')
    .lean();

  const out = {
    invoices: invoices.length,
    labour: 0,
    parts: 0,
    other: 0,
    discounts: 0,
    net: 0,
    cost: 0,
    tax: 0,
    labourLines: 0,
    partLines: 0,
    costedLines: 0,
    uncostedLines: 0,
    uncostedRevenue: 0,
  };

  const lineTotal = (line) => (line.priceCents ?? 0) * (line.qty ?? 1);

  for (const invoice of invoices) {
    let labour = 0;
    let parts = 0;
    for (const device of invoice.devices ?? []) {
      for (const line of device.services ?? []) {
        labour += lineTotal(line);
        out.labourLines += 1;
      }
      for (const line of device.parts ?? []) {
        parts += lineTotal(line);
        out.partLines += 1;
        if (line.unitCost > 0) {
          out.cost += line.unitCost * (line.qty ?? 1);
          out.costedLines += 1;
        } else {
          out.uncostedLines += 1;
          out.uncostedRevenue += lineTotal(line);
        }
      }
    }

    const tax = invoice.taxCents ?? 0;
    const discount = invoice.discountCents ?? 0;
    const net = (invoice.amount ?? 0) - tax;

    out.labour += labour;
    out.parts += parts;
    out.discounts += discount;
    out.other += net - (labour + parts - discount);
    out.net += net;
    out.tax += tax;
  }

  return out;
}

/** Orders that count as sales. Cancelled orders are not revenue. */
function salesQuery(start, end) {
  return { createdAt: { $gte: start, $lte: end }, status: { $ne: 'cancelled' } };
}

/**
 * Invoiced - by invoice date. Never mixed with collected.
 */
async function invoicedIn(start, end) {
  const [row] = await db().Invoice.aggregate([
    { $match: { issuedAt: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

/**
 * Collected - by payment date, which lives on the payment row rather than the
 * invoice. An invoice issued in March and paid in May is March's `invoiced` and
 * May's `collected`, and unwinding the payments array is the only way to say so.
 */
async function collectedIn(start, end) {
  const rows = await db().Invoice.aggregate([
    { $unwind: '$payments' },
    { $match: { 'payments.at': { $gte: start, $lte: end } } },
    {
      $group: {
        _id: { $ifNull: ['$payments.method', 'unspecified'] },
        total: { $sum: '$payments.amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  return {
    total: rows.reduce((sum, row) => sum + row.total, 0),
    count: rows.reduce((sum, row) => sum + row.count, 0),
    byMethod: rows.map((row) => ({ method: row._id, amount: row.total, count: row.count })),
  };
}

/** Expenses in the range, with the category breakdown every tab wants. */
async function expensesIn(start, end) {
  const expenses = await db().Expense.find({ date: { $gte: start, $lte: end } })
    .sort({ date: -1 })
    .populate('category', 'name colorToken')
    .populate('purchaseOrder', 'poNumber')
    .lean();

  const byCategory = new Map();
  const byMethod = new Map();
  let total = 0;
  let tax = 0;

  for (const expense of expenses) {
    total += expense.amount;
    tax += expense.tax ?? 0;

    const categoryName = expense.category?.name ?? 'Uncategorised';
    const category = byCategory.get(categoryName) ?? { label: categoryName, amount: 0, count: 0 };
    category.amount += expense.amount;
    category.count += 1;
    byCategory.set(categoryName, category);

    const methodName = expense.method || 'Unspecified';
    const method = byMethod.get(methodName) ?? { label: methodName, amount: 0, count: 0 };
    method.amount += expense.amount;
    method.count += 1;
    byMethod.set(methodName, method);
  }

  return {
    expenses,
    total,
    tax,
    count: expenses.length,
    byCategory: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
    byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
  };
}

/**
 * Refunds, from the `CreditTransaction` ledger rather than `db().Order.refundedTotal`.
 *
 * The same dating bug phase 3 found and fixed: an order carries a *running*
 * refund total with no date of its own, so dating it by `updatedAt` moves a
 * June refund into August the moment somebody edits the order's status.
 */
async function refundsIn(start, end) {
  // A refund posts a POSITIVE row (credit added to the buyer), so this total is
  // already the money going out - no sign flip, and it is reported on its own
  // line rather than pushed into a revenue figure (§9.2).
  const [row] = await db().CreditTransaction.aggregate([
    { $match: { type: 'refund', createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

/** Inventory is a position, not a flow - "as of today", whatever the range. */
async function inventoryPosition(settings) {
  // Read off the settings document this caller already loaded rather than
  // through `lowStockService.lowStockThreshold()` - same field, one fewer
  // round-trip. The classification itself is the shared one.
  const fallback = settings?.operations?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  const products = await db().Product.find({})
    .select('name sku stock minStock price cost partTypeLabel brandName')
    .lean();

  let stockValue = 0;
  const alerts = [];
  const counts = { items: products.length, in: 0, low: 0, out: 0 };

  for (const product of products) {
    const threshold = reorderPoint(product, fallback);
    stockValue += product.stock * (product.cost > 0 ? product.cost : product.price);

    if (product.stock <= 0) counts.out += 1;
    else if (product.stock <= threshold) {
      counts.low += 1;
      alerts.push({
        id: product._id.toString(),
        name: product.name,
        sku: product.sku,
        stock: product.stock,
        minStock: threshold,
      });
    } else counts.in += 1;
  }

  return {
    ...counts,
    stockValue,
    alerts: alerts.sort((a, b) => a.stock - b.stock).slice(0, 12),
    products,
  };
}

/** Outstanding receivables - also a position. Overdue is derived, never stored. */
async function receivables() {
  const now = new Date();
  const invoices = await db().Invoice.find({ status: { $ne: 'paid' } })
    .sort({ dueDate: 1 })
    .populate('user', 'businessName')
    .lean();

  let outstanding = 0;
  let overdueAmount = 0;
  let overdueCount = 0;

  const rows = invoices.map((invoice) => {
    const balance = invoice.amount - invoice.amountPaid;
    const overdue = Boolean(invoice.dueDate && new Date(invoice.dueDate) < now);

    outstanding += balance;
    if (overdue) {
      overdueAmount += balance;
      overdueCount += 1;
    }

    return {
      number: invoice.number,
      businessName: invoice.user?.businessName ?? '-',
      amount: invoice.amount,
      balance,
      dueDate: invoice.dueDate,
      status: overdue ? 'overdue' : invoice.status,
    };
  });

  const total = await db().Invoice.estimatedDocumentCount();

  return {
    outstanding,
    overdueAmount,
    overdueCount,
    totalInvoices: total,
    top: rows.sort((a, b) => b.balance - a.balance).slice(0, 8),
  };
}

// ---- tabs -------------------------------------------------------------------

/**
 * `?tab=summary` - the seven headline figures plus the four panels.
 */
async function summary(start, end, settings) {
  const [invoiced, collected, expenseData, orders, inventory, ar, refunds, service] = await Promise.all([
    invoicedIn(start, end),
    collectedIn(start, end),
    expensesIn(start, end),
    db().Order.find(salesQuery(start, end)).select('items tax total').lean(),
    inventoryPosition(settings),
    receivables(),
    refundsIn(start, end),
    serviceIncomeIn(start, end),
  ]);

  const cogs = costOfGoods(orders);
  const taxCollected =
    orders.reduce((sum, order) => sum + (order.tax ?? 0), 0) + service.tax;

  // Goods sold through orders plus the work billed without one (repairs and
  // counter charges), so a business that does both reports both.
  const revenue = cogs.revenue + service.net;
  const costOfGoodsSold = cogs.cost + service.cost;
  const grossProfit = revenue - costOfGoodsSold;

  return {
    kpis: {
      invoiced: invoiced.total,
      collected: collected.total,
      grossProfit,
      costOfGoods: costOfGoodsSold,
      expenses: expenseData.total,
      taxCollected,
      outstanding: ar.outstanding,
    },
    // Travels with every margin figure so a screen can qualify it rather than
    // reporting uncosted lines as pure profit.
    costCoverage: {
      costedLines: cogs.costedLines + service.costedLines,
      uncostedLines: cogs.uncostedLines + service.uncostedLines,
      uncostedRevenue: cogs.uncostedRevenue + service.uncostedRevenue,
    },
    refunds,
    // Staff attribution arrives in phase 8 - there is no staff concept to
    // report on yet, and inventing one would be a lie the staff member acts on.
    staff: { available: false, rows: [] },
    receivables: ar,
    profitAndLoss: {
      revenue,
      costOfGoods: costOfGoodsSold,
      grossProfit,
      expenses: expenseData.total,
      netProfit: grossProfit - expenseData.total,
    },
    inventory: {
      items: inventory.items,
      stockValue: inventory.stockValue,
      outOfStock: inventory.out,
      lowStock: inventory.low,
      alerts: inventory.alerts,
    },
  };
}

/**
 * `?tab=pl` - the P&L statement, in accounting order.
 */
async function profitAndLoss(start, end) {
  const [orders, expenseData, collected, service] = await Promise.all([
    db().Order.find(salesQuery(start, end)).select('items tax shipping discount total').lean(),
    expensesIn(start, end),
    collectedIn(start, end),
    serviceIncomeIn(start, end),
  ]);

  const cogs = costOfGoods(orders);
  const shippingRevenue = orders.reduce((sum, order) => sum + (order.shipping ?? 0), 0);
  // Discounts from both sides: an order's, and a repair invoice's.
  const discounts = orders.reduce((sum, order) => sum + (order.discount ?? 0), 0) + service.discounts;
  const taxCollected = orders.reduce((sum, order) => sum + (order.tax ?? 0), 0) + service.tax;

  // Net revenue is what was actually charged: list value of goods and of
  // repair work, less what came off it, plus shipping and service fees.
  // Discounts are reported on their own line as well, because a margin that
  // quietly absorbs them hides why it moved.
  const serviceRevenue = service.labour + service.parts + service.other;
  const netRevenue = cogs.revenue + serviceRevenue - discounts + shippingRevenue;
  const costOfGoodsSold = cogs.cost + service.cost;
  const grossProfit = netRevenue - costOfGoodsSold;

  // Per-category margin. `partTypeLabel` is the wholesale read of a category
  // it is what the storefront filters on and what a staff member thinks in.
  const byCategory = new Map();
  for (const order of orders) {
    for (const item of order.items ?? []) {
      const label = item.partTypeLabel || item.partType || 'Uncategorised';
      const row = byCategory.get(label) ?? {
        label,
        orders: 0,
        revenue: 0,
        cost: 0,
        uncostedLines: 0,
      };
      row.revenue += item.lineTotal ?? 0;
      if (item.unitCost > 0) row.cost += item.unitCost * item.qty;
      else row.uncostedLines += 1;
      row.orders += 1;
      byCategory.set(label, row);
    }
  }

  // Repair work as two category rows beside the part types, so the table says
  // how the margin on labour compares with the margin on goods.
  if (service.labourLines) {
    byCategory.set('Repair labour', {
      label: 'Repair labour',
      orders: service.labourLines,
      revenue: service.labour,
      cost: 0,
      uncostedLines: 0,
    });
  }
  if (service.partLines) {
    byCategory.set('Repair parts', {
      label: 'Repair parts',
      orders: service.partLines,
      revenue: service.parts,
      cost: service.cost,
      uncostedLines: service.uncostedLines,
    });
  }

  return {
    kpis: {
      productRevenue: cogs.revenue,
      serviceRevenue,
      shippingRevenue,
      netRevenue,
      costOfGoods: costOfGoodsSold,
      grossProfit,
      expenses: expenseData.total,
      // Signed once. A loss is a negative net profit, not a positive "net loss".
      netProfit: grossProfit - expenseData.total,
      collected: collected.total,
    },
    costCoverage: {
      costedLines: cogs.costedLines + service.costedLines,
      uncostedLines: cogs.uncostedLines + service.uncostedLines,
      uncostedRevenue: cogs.uncostedRevenue + service.uncostedRevenue,
    },
    statement: {
      productRevenue: cogs.revenue,
      repairLabour: service.labour,
      repairParts: service.parts,
      otherServiceIncome: service.other,
      shippingRevenue,
      discounts,
      netRevenue,
      costOfGoods: costOfGoodsSold,
      grossProfit,
      operatingExpenses: expenseData.byCategory,
      totalExpenses: expenseData.total,
      netProfit: grossProfit - expenseData.total,
      taxCollected,
    },
    byCategory: [...byCategory.values()]
      .map((row) => ({
        ...row,
        margin: row.revenue > 0 ? Math.round(((row.revenue - row.cost) / row.revenue) * 100) : null,
      }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

/**
 * `?tab=sales` - invoiced by invoice date, collected by payment date, kept
 * visibly apart with the caption that says which is which.
 */
async function sales(start, end) {
  const [invoices, collected, ar] = await Promise.all([
    db().Invoice.find({ issuedAt: { $gte: start, $lte: end } })
      .sort({ issuedAt: -1 })
      .populate('user', 'businessName')
      .populate('order', 'orderNumber')
      .lean(),
    collectedIn(start, end),
    receivables(),
  ]);

  const now = new Date();
  const counts = { all: invoices.length, paid: 0, unpaid: 0, partial: 0, overdue: 0 };
  let total = 0;
  let paid = 0;

  const rows = invoices.map((invoice) => {
    const balance = invoice.amount - invoice.amountPaid;
    const overdue = invoice.status !== 'paid' && invoice.dueDate && new Date(invoice.dueDate) < now;
    const status = overdue ? 'overdue' : invoice.status;

    total += invoice.amount;
    paid += invoice.amountPaid;
    counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
    if (overdue) counts.overdue += 1;

    return {
      number: invoice.number,
      orderNumber: invoice.order?.orderNumber ?? null,
      businessName: invoice.user?.businessName ?? '-',
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      terms: invoice.terms,
      amount: invoice.amount,
      amountPaid: invoice.amountPaid,
      balance,
      status,
    };
  });

  return {
    kpis: {
      invoices: invoices.length,
      total,
      paid,
      unpaid: total - paid,
      partial: counts.partial ?? 0,
    },
    counts,
    // Deliberately its own block with its own caption: the KPIs above are
    // invoiced totals by invoice date, this is money collected in the range.
    collected,
    invoices: rows,
    receivables: ar,
  };
}

/** `?tab=expense` - total spent, entries, GST/HST paid, and the breakdowns. */
async function expenseTab(start, end) {
  const data = await expensesIn(start, end);

  return {
    kpis: { total: data.total, entries: data.count, taxPaid: data.tax },
    byCategory: data.byCategory,
    byMethod: data.byMethod,
    expenses: data.expenses.map((expense) => ({
      id: expense._id.toString(),
      number: expense.number,
      date: expense.date,
      description: expense.description,
      category: expense.category?.name ?? '-',
      payee: expense.payee ?? null,
      method: expense.method ?? null,
      status: expense.status,
      amount: expense.amount,
      tax: expense.tax ?? 0,
      purchaseOrder: expense.purchaseOrder
        ? {
            id: (expense.purchaseOrder._id ?? expense.purchaseOrder).toString(),
            poNumber: expense.purchaseOrder.poNumber ?? null,
          }
        : null,
    })),
  };
}

/**
 * `?tab=inventory` - the position, plus what moved during the range.
 *
 * The tiles are "as of today" and the movement panel is the period. Both are
 * labelled, because a stock figure sitting under a date range otherwise reads
 * as belonging to it.
 */
async function inventoryTab(start, end, settings) {
  const [position, movements] = await Promise.all([
    inventoryPosition(settings),
    db().StockMovement.find({ createdAt: { $gte: start, $lte: end } })
      .sort({ createdAt: -1 })
      .limit(300)
      .populate('product', 'name sku')
      .lean(),
  ]);

  const fallback = settings?.operations?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

  return {
    kpis: {
      items: position.items,
      stockValue: position.stockValue,
      inStock: position.in,
      lowStock: position.low,
      outOfStock: position.out,
    },
    products: position.products
      .map((product) => {
        const threshold = reorderPoint(product, fallback);
        return {
          id: product._id.toString(),
          name: product.name,
          sku: product.sku,
          category: product.partTypeLabel ?? '-',
          stock: product.stock,
          minStock: product.minStock ?? 0,
          cost: product.cost ?? 0,
          value: product.stock * (product.cost > 0 ? product.cost : product.price),
          status: product.stock <= 0 ? 'out' : product.stock <= threshold ? 'low' : 'in',
        };
      })
      .sort((a, b) => b.value - a.value),
    movements: movements.map((movement) => ({
      id: movement._id.toString(),
      product: movement.product?.name ?? '-',
      sku: movement.product?.sku ?? null,
      type: movement.type,
      qtyChange: movement.qtyChange,
      qtyAfter: movement.qtyAfter,
      reference: movement.reference?.label ?? null,
      at: movement.createdAt,
    })),
  };
}

/**
 * `?tab=tax` - the GST/HST register, per province.
 *
 * **The divergence from CellShoppe that matters** (§6.12): a flat 5% is wrong
 * for a business shipping across Canada, so the register carries the rate that
 * actually applied and By Province is a primary output. Rates come from
 * `Settings`, never from code.
 *
 * The rate on a historical order is **derived from the order itself** - its own
 * tax over its own taxable base - rather than looked up in today's Settings. A
 * rate change must not retroactively restate what was charged last quarter. The
 * Settings rate is what a province *should* charge, and the two are shown apart.
 */
async function taxTab(start, end, settings) {
  const [orders, expenseData] = await Promise.all([
    db().Order.find(salesQuery(start, end))
      .select('orderNumber createdAt subtotal discount shipping tax total user shippingAddress')
      .populate('user', 'businessName')
      .lean(),
    expensesIn(start, end),
  ]);

  const byProvince = new Map();
  let subtotal = 0;
  let discounts = 0;
  let shipping = 0;
  let taxCollected = 0;
  let gross = 0;

  const register = orders.map((order) => {
    const province = order.shippingAddress?.region ?? '-';
    const taxable = (order.subtotal ?? 0) - (order.discount ?? 0) + (order.shipping ?? 0);
    // The rate actually charged, recovered from the order's own numbers.
    const rate = taxable > 0 ? (order.tax ?? 0) / taxable : 0;

    subtotal += order.subtotal ?? 0;
    discounts += order.discount ?? 0;
    shipping += order.shipping ?? 0;
    taxCollected += order.tax ?? 0;
    gross += order.total ?? 0;

    const row = byProvince.get(province) ?? { province, count: 0, tax: 0, taxable: 0 };
    row.count += 1;
    row.tax += order.tax ?? 0;
    row.taxable += taxable;
    byProvince.set(province, row);

    return {
      orderNumber: order.orderNumber,
      date: order.createdAt,
      businessName: order.user?.businessName ?? '-',
      province,
      subtotal: order.subtotal ?? 0,
      shipping: order.shipping ?? 0,
      discount: order.discount ?? 0,
      rate,
      tax: order.tax ?? 0,
      total: order.total ?? 0,
    };
  });

  return {
    kpis: {
      collected: taxCollected,
      paid: expenseData.tax,
      // Signed once: a negative means a refund or credit is due, and the client
      // says so rather than printing a positive under a "refund" label.
      net: taxCollected - expenseData.tax,
    },
    totals: {
      invoices: orders.length,
      subtotal,
      discounts,
      shipping,
      taxCollected,
      gross,
    },
    register,
    byProvince: [...byProvince.values()]
      .map((row) => ({
        province: row.province,
        count: row.count,
        tax: row.tax,
        // The average rate actually charged, and the rate Settings says should
        // apply. They differ when a rate changed mid-range, and seeing both is
        // how a staff member finds out.
        avgRate: row.taxable > 0 ? row.tax / row.taxable : 0,
        settingsRate: db().Settings.rateFor(settings, row.province),
      }))
      .sort((a, b) => b.tax - a.tax),
  };
}

/**
 * `?tab=staff` - UI only until phase 8 (§6b, invariant 17).
 *
 * There is no staff concept to report on: `Role`, staff accounts and the
 * attribution that would make this meaningful all arrive in phase 8. The tab
 * returns `available: false` and the screen says so plainly rather than
 * rendering an empty table that reads as "no staff sold anything".
 */
async function staffTab(start, end) {
  const [orders, invoiced] = await Promise.all([
    db().Order.countDocuments(salesQuery(start, end)),
    invoicedIn(start, end),
  ]);

  return {
    available: false,
    reason:
      'Staff accounts and per-order attribution arrive in phase 8. These totals are the whole business, not one person.',
    kpis: {
      totalInvoiced: invoiced.total,
      totalInvoices: invoiced.count,
      ordersClosed: orders,
      activeStaff: null,
    },
    rows: [],
  };
}

/**
 * `?tab=supplier-prices` - what each supplier charged per item.
 *
 * Sourced entirely from purchase-order lines, so there is no separate price
 * list to keep honest. One row per item/supplier pair, and the cheapest
 * supplier for each item is flagged - that flag is the whole point of the tab.
 *
 * Drafts are excluded: a price nobody has committed to is a quote, not
 * evidence of what a supplier charges.
 */
async function supplierPrices() {
  const [orders, suppliers] = await Promise.all([
    db().PurchaseOrder.find({ status: { $nin: ['draft', 'cancelled'] } })
      .select('supplier orderDate items')
      .lean(),
    db().Supplier.find({}).select('name').lean(),
  ]);

  const names = new Map(suppliers.map((supplier) => [supplier._id.toString(), supplier.name]));
  const pairs = new Map();

  for (const order of orders) {
    const supplierId = order.supplier?.toString();
    for (const item of order.items ?? []) {
      const key = `${item.sku}::${supplierId}`;
      const row = pairs.get(key) ?? {
        sku: item.sku,
        name: item.name,
        supplierId,
        supplier: names.get(supplierId) ?? '-',
        lowest: item.unitCost,
        highest: item.unitCost,
        totalCost: 0,
        times: 0,
        lastPurchased: order.orderDate,
      };

      row.lowest = Math.min(row.lowest, item.unitCost);
      row.highest = Math.max(row.highest, item.unitCost);
      row.totalCost += item.unitCost;
      row.times += 1;
      if (order.orderDate > row.lastPurchased) row.lastPurchased = order.orderDate;

      pairs.set(key, row);
    }
  }

  const rows = [...pairs.values()].map((row) => ({
    ...row,
    average: Math.round(row.totalCost / row.times),
  }));

  // Cheapest per item, by the lowest price that supplier has ever charged.
  const bestBySku = new Map();
  for (const row of rows) {
    const best = bestBySku.get(row.sku);
    if (!best || row.lowest < best.lowest) bestBySku.set(row.sku, row);
  }

  return {
    rows: rows
      .map((row) => ({
        ...row,
        cheapest: bestBySku.get(row.sku) === row,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.lowest - b.lowest),
    // Named so the screen can explain an empty table rather than implying no
    // supplier has ever been paid.
    sourceOrders: orders.length,
  };
}

/**
 * `/admin/reports/business` - the printable period report (§6.11).
 *
 * `brand` narrows it to one brand, which is the wholesale read of CellShoppe's
 * "device model" filter.
 */
async function business(start, end, settings, { brand } = {}) {
  const [invoiced, collected, expenseData, orders, refunds] = await Promise.all([
    invoicedIn(start, end),
    collectedIn(start, end),
    expensesIn(start, end),
    db().Order.find(salesQuery(start, end)).select('items tax total status createdAt').lean(),
    refundsIn(start, end),
  ]);

  // Brand filtering happens on the LINES, not the order: an order can carry
  // parts for several brands, and dropping the whole order would misreport
  // every other brand on it.
  //
  // An order line does not denormalise `brandSlug`, so the brand is resolved
  // through the product ids rather than guessed from the line's name - a
  // substring match on a part name would silently sweep in every product whose
  // description happens to contain the word.
  let filtered = orders;
  if (brand) {
    const inBrand = await db().Product.find({ brandSlug: String(brand) }).select('_id').lean();
    const ids = new Set(inBrand.map((product) => product._id.toString()));

    filtered = orders.map((order) => ({
      ...order,
      items: (order.items ?? []).filter((item) => ids.has(String(item.product))),
    }));
  }

  const cogs = costOfGoods(filtered);
  const taxCollected = filtered.reduce((sum, order) => sum + (order.tax ?? 0), 0);

  // Units sold - shipped in the period, by part type.
  const soldByCategory = new Map();
  let unitsSold = 0;
  for (const order of filtered) {
    for (const item of order.items ?? []) {
      const label = item.partTypeLabel || item.partType || 'Uncategorised';
      const row = soldByCategory.get(label) ?? { label, units: 0, value: 0, times: 0 };
      row.units += item.qty;
      row.value += item.lineTotal ?? 0;
      row.times += 1;
      unitsSold += item.qty;
      soldByCategory.set(label, row);
    }
  }

  // Units bought - stock actually received from purchase orders in the period,
  // which is what the ledger records. A PO raised and not delivered is not
  // stock bought.
  const received = await db().StockMovement.find({
    type: 'purchase',
    createdAt: { $gte: start, $lte: end },
  })
    .populate('product', 'name sku')
    .lean();

  const boughtByItem = new Map();
  let unitsPurchased = 0;
  let purchaseSpend = 0;

  for (const movement of received) {
    const label = movement.product?.name ?? 'Unknown part';
    const row = boughtByItem.get(label) ?? { label, sku: movement.product?.sku ?? null, units: 0, spend: 0 };
    row.units += movement.qtyChange;
    row.spend += (movement.unitCost ?? 0) * movement.qtyChange;
    unitsPurchased += movement.qtyChange;
    purchaseSpend += (movement.unitCost ?? 0) * movement.qtyChange;
    boughtByItem.set(label, row);
  }

  // Sales by brand and model - the wholesale read of "repairs by model".
  const byBrand = new Map();
  for (const order of filtered) {
    for (const item of order.items ?? []) {
      const label = item.modelName || item.name || 'Unknown';
      const row = byBrand.get(label) ?? { label, units: 0, value: 0 };
      row.units += item.qty;
      row.value += item.lineTotal ?? 0;
      byBrand.set(label, row);
    }
  }

  return {
    kpis: {
      invoiced: invoiced.total,
      expenses: expenseData.total,
      // Signed once: a loss renders as a negative net profit.
      netProfit: cogs.revenue - cogs.cost - expenseData.total,
      unitsPurchased,
      purchaseSpend,
      unitsSold,
    },
    costCoverage: {
      costedLines: cogs.costedLines,
      uncostedLines: cogs.uncostedLines,
      uncostedRevenue: cogs.uncostedRevenue,
    },
    collected,
    refunds,
    topCategories: [...soldByCategory.values()].sort((a, b) => b.value - a.value).slice(0, 8),
    salesPerCategory: [...soldByCategory.values()].sort((a, b) => b.value - a.value),
    unitsBought: [...boughtByItem.values()].sort((a, b) => b.spend - a.spend),
    byModel: [...byBrand.values()].sort((a, b) => b.value - a.value).slice(0, 12),
    tax: {
      collected: taxCollected,
      paid: expenseData.tax,
      net: taxCollected - expenseData.tax,
    },
  };
}

// ---- entry point ------------------------------------------------------------

const TABS = {
  summary,
  pl: profitAndLoss,
  sales,
  expense: expenseTab,
  inventory: inventoryTab,
  tax: taxTab,
  staff: staffTab,
  'supplier-prices': supplierPrices,
  business,
};

/**
 * `GET /admin/reports/:tab?from=&to=`.
 *
 * Read-only, always (§9.6). Every tab receives the same resolved range and the
 * same settings document, so two tabs can never disagree about what "this
 * month" means or what rate a province charges.
 */
async function report(tab, query = {}) {
  const handler = TABS[tab];
  if (!handler) throw ApiError.notFound(`No report named "${tab}".`, 'REPORT_NOT_FOUND');

  const { start, end } = resolveRange(query);
  const settings = await db().Settings.load();

  // One signature for every handler - `(start, end, settings, query)` - so the
  // dispatcher never has to know which tab wants what.
  const data = await handler(start, end, settings, query);

  return {
    tab,
    range: {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    },
    ...data,
  };
}

const REPORT_TABS = Object.keys(TABS);

export { report, REPORT_TABS };
