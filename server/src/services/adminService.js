import mongoose from 'mongoose';
import { db } from '../db/models.js';
import '../models/User.js';
import '../models/Product.js';
import '../models/Order.js';
import '../models/Invoice.js';
import '../models/CreditTransaction.js';
import { RMA_OPEN_STATUSES } from '../models/Rma.js';
import { TICKET_OPEN_STATUSES } from '../models/Ticket.js';
import '../models/Quote.js';
import '../models/ContactMessage.js';
import '../models/Taxonomy.js';
// Registers the schema `db().Settings` resolves. It worked without this only
// because something else happened to import it first, which is a load-order
// dependency rather than a guarantee.
import '../models/Settings.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import creditService from './creditService.js';
import storeCredit from './storeCreditService.js';
import referralService from './referralService.js';
import { generatePassword, sendWelcomeEmail } from './welcomeMail.js';
import { sendAccountApprovedEmail, sendAccountRejectedEmail } from './accountDecisionMail.js';
import { likeRegex } from '../utils/regex.js';
import { serializeOrder } from './orderService.js';
import orderBuilder from './orderBuilder.js';
import invoicePaymentService from './invoicePaymentService.js';
import { refundableOf, refundedTotalOf } from './invoiceRefundService.js';
import { activityFeed } from './activityService.js';
import { AuditLog } from '../models/AuditLog.js';
import { displayNameOf } from '../utils/displayName.js';
import { renderInvoiceHtml, resolveInvoiceBrand } from './invoiceDocument.js';
import { renderStatementHtml } from './statementDocument.js';
import { sendMail } from './mailer.js';
import { BUSINESS_INFO } from '../../../shared/business.js';
import { sendingBusiness } from './sendingBusiness.js';
import { lowStockThreshold } from './lowStockService.js';
import { invalidateTree } from './taxonomyService.js';
import {
  ORDER_STATUS_FLOW,
  ORDER_OPEN_STATUSES,
  ORDER_UNFULFILLED_STATUSES,
} from '../../../shared/schemas/admin.js';
import { formatDate, formatDateShort } from '../../../shared/dates.js';

/**
 * Resolve the dashboard's date range.
 *
 * `from` and `to` are inclusive whole days in `YYYY-MM-DD`. `to` is pushed to
 * the end of its day here, on the server, so a range of "today to today" is a
 * real twenty-four hours rather than an empty instant - the client sends dates,
 * not timestamps, and only one side should own that rule.
 *
 * Defaults to the last thirty days, which is what the endpoint returned before
 * it took a range at all.
 */
function resolveRange({ from, to } = {}) {
  const now = new Date();

  const end = to ? new Date(`${to}T00:00:00`) : now;
  if (to) end.setHours(23, 59, 59, 999);

  const start = from
    ? new Date(`${from}T00:00:00`)
    : new Date(now.getTime() - 30 * 86_400_000);

  // A backwards range is a typo, not an intent. Swap rather than return
  // nothing, because an empty dashboard reads as "no business" and is a lie.
  if (start > end) return { start: end, end: start };
  return { start, end };
}

/** Bucket size that keeps a trend readable: daily up to ~10 weeks, then weekly. */
function bucketFor(start, end) {
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  return days > 70 ? 'week' : 'day';
}

/**
 * Both units label by their first day: `27-Aug`. A week reads as its Monday.
 *
 * The year is appended only when the range spans more than one, because a
 * weekly walk snaps back to Monday and can start in the previous December
 * `29-Dec` to `28-Dec` for a calendar year is correct but reads as nonsense
 * without it.
 */
function bucketLabel(date, withYear) {
  return withYear ? formatDate(date) : formatDateShort(date);
}

/**
 * Fill every bucket in the range, including the empty ones.
 *
 * A trend drawn only from days that had orders compresses a quiet week into a
 * single point and makes the line lie about its own shape.
 */
function fillBuckets(rows, start, end, unit) {
  const byKey = new Map(rows.map((row) => [row._id, row]));
  const points = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  if (unit === 'week') {
    // Monday-first, matching DateRangeBar's presets on the client.
    const day = (cursor.getDay() + 6) % 7;
    cursor.setDate(cursor.getDate() - day);
  }

  // Snapping to Monday can pull the first bucket into the previous year, so the
  // check happens after the snap rather than on the requested range.
  const withYear = cursor.getFullYear() !== end.getFullYear();

  let guard = 0;
  while (cursor <= end && guard < 400) {
    guard += 1;
    const key =
      unit === 'week'
        ? `${cursor.getFullYear()}-W${String(isoWeek(cursor)).padStart(2, '0')}`
        : cursor.toISOString().slice(0, 10);

    points.push({
      label: bucketLabel(cursor, withYear),
      value: byKey.get(key)?.total ?? 0,
      count: byKey.get(key)?.count ?? 0,
    });

    cursor.setDate(cursor.getDate() + (unit === 'week' ? 7 : 1));
  }

  return points;
}

function isoWeek(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target - yearStart) / 86_400_000 + 1) / 7);
}

/**
 * Admin home: what needs attention today, not vanity metrics.
 *
 * **Two named money metrics, never one word** (ERP rework §9.1). `invoiced` is
 * the value of invoices issued in the range, by invoice date; `collected` is
 * payments actually received in the range, by payment date. They are different
 * numbers and the UI says which is which.
 *
 * **Refunds are their own line** (§9.2) - never a negative pushed into a
 * revenue figure.
 *
 * Today's response shape is preserved as a subset, so every existing consumer
 * keeps working while the new dashboard reads the richer fields.
 */
async function stats({ from, to } = {}) {
  const now = new Date();
  const { start, end } = resolveRange({ from, to });
  const unit = bucketFor(start, end);

  // The immediately preceding window of the same length, for the delta.
  const span = end - start;
  const priorStart = new Date(start.getTime() - span);

  const inRange = { $gte: start, $lte: end };

  // The fallback reorder point, resolved before the batch below because two of
  // its queries compare against it. One read, so the aggregation and the
  // low-stock list cannot classify the same product differently.
  const lowStockFallback = await lowStockThreshold();

  const [
    pendingUsers,
    approvedUsers,
    totalClients,
    openOrders,
    awaitingFulfilment,
    revenueRows,
    invoicedRows,
    collectedRows,
    priorCollectedRows,
    refundRows,
    outstandingRows,
    overdueCount,
    lowStock,
    outOfStock,
    productCount,
    inventoryValueRows,
    trendRows,
    topClientRows,
    recentOrders,
    pendingQueue,
    lowStockItems,
    openRmas,
    openTickets,
    recentInvoices,
    recentActivity,
  ] = await Promise.all([
    db().User.countDocuments({ status: 'pending' }),
    db().User.countDocuments({ status: 'approved', role: 'buyer' }),
    db().User.countDocuments({ role: 'buyer' }),

    db().Order.countDocuments({ status: { $in: ORDER_OPEN_STATUSES } }),
    db().Order.countDocuments({ status: { $in: ORDER_UNFULFILLED_STATUSES } }),

    // Order value in range. Kept for `revenue.last30Days`, which the old shape
    // promised and other screens may still read.
    db().Order.aggregate([
      { $match: { createdAt: inRange, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),

    // Invoiced: by invoice date.
    db().Invoice.aggregate([
      { $match: { issuedAt: inRange } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    // Collected: by payment date, which is a different question and usually a
    // different number.
    db().Invoice.aggregate([
      { $unwind: '$payments' },
      { $match: { 'payments.at': inRange } },
      { $group: { _id: null, total: { $sum: '$payments.amount' }, count: { $sum: 1 } } },
    ]),

    db().Invoice.aggregate([
      { $unwind: '$payments' },
      { $match: { 'payments.at': { $gte: priorStart, $lt: start } } },
      { $group: { _id: null, total: { $sum: '$payments.amount' } } },
    ]),

    // Refunds get their own tile and never push revenue negative (§9.2).
    //
    // Sourced from the credit ledger, not from `db().Order.refundedTotal`: an order
    // carries a running total with no date of its own, so dating it by
    // `updatedAt` would move a June refund into August the moment somebody
    // edited that order's status. Every refund posts a ledger row with its own
    // timestamp, and that is the honest date.
    db().CreditTransaction.aggregate([
      { $match: { type: 'refund', createdAt: inRange } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    // Receivables are a position, not a flow - always "as of now", never
    // filtered by the range, or the number stops meaning what it says.
    db().Invoice.aggregate([
      { $match: { status: { $ne: 'paid' } } },
      {
        $group: {
          _id: null,
          outstanding: { $sum: { $subtract: ['$amount', '$amountPaid'] } },
          // How MANY invoices make up that figure. The dashboard tile leads
          // with the money and needs the count beside it, and counting rows
          // here is free - the aggregation has already matched them.
          count: { $sum: 1 },
          overdue: {
            $sum: {
              $cond: [{ $lt: ['$dueDate', now] }, { $subtract: ['$amount', '$amountPaid'] }, 0],
            },
          },
        },
      },
    ]),
    db().Invoice.countDocuments({ status: { $ne: 'paid' }, dueDate: { $lt: now } }),

    // "Low" means BELOW THIS PRODUCT'S OWN REORDER POINT, falling back to the
    // flat threshold only where none is set. That is the definition the
    // inventory screen classifies by, and the two disagreeing is what made the
    // sidebar badge unverifiable: it counted every product under 50 and read
    // 189, while the screen counted each against its own `minStock` and showed
    // 112. A badge that cannot be reconciled with any screen teaches the
    // staff member to ignore every badge.
    //
    // `$expr` because the comparison is against a sibling field, which a plain
    // query cannot express.
    // An aggregation rather than a query: the comparison is against a sibling
    // field, and Mongoose cannot cast a `$cond` inside a query-level `$expr`.
    db().Product.aggregate([
      { $match: { isActive: true, stock: { $gt: 0 } } },
      {
        $match: {
          $expr: {
            $lte: [
              '$stock',
              {
                $cond: [
                  { $gt: [{ $ifNull: ['$minStock', 0] }, 0] },
                  '$minStock',
                  lowStockFallback,
                ],
              },
            ],
          },
        },
      },
      { $count: 'count' },
    ]),
    db().Product.countDocuments({ isActive: true, stock: { $lte: 0 } }),
    db().Product.countDocuments({ isActive: true }),

    db().Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, value: { $sum: { $multiply: ['$stock', '$price'] } } } },
    ]),

    db().Order.aggregate([
      { $match: { createdAt: inRange, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id:
            unit === 'week'
              ? {
                  $concat: [
                    { $toString: { $isoWeekYear: '$createdAt' } },
                    '-W',
                    {
                      $cond: [
                        { $lt: [{ $isoWeek: '$createdAt' }, 10] },
                        { $concat: ['0', { $toString: { $isoWeek: '$createdAt' } }] },
                        { $toString: { $isoWeek: '$createdAt' } },
                      ],
                    },
                  ],
                }
              : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: '$total' },
          count: { $sum: 1 },
        },
      },
    ]),

    // Top clients by invoiced value in range.
    db().Invoice.aggregate([
      { $match: { issuedAt: inRange } },
      { $group: { _id: '$user', total: { $sum: '$amount' }, invoices: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
      {
        $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'client' },
      },
      { $unwind: '$client' },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          businessName: '$client.businessName',
          // The same precedence `displayNameOf` applies - person, then company,
          // then email. Expressed in the pipeline because this row never
          // becomes a document the helper could be called on.
          displayName: {
            $let: {
              vars: {
                contact: { $trim: { input: { $ifNull: ['$client.contactName', ''] } } },
                business: { $trim: { input: { $ifNull: ['$client.businessName', ''] } } },
              },
              in: {
                $cond: [
                  { $ne: ['$$contact', ''] },
                  '$$contact',
                  {
                    $cond: [
                      { $ne: ['$$business', ''] },
                      '$$business',
                      { $ifNull: ['$client.email', '-'] },
                    ],
                  },
                ],
              },
            },
          },
          total: 1,
          invoices: 1,
        },
      },
    ]),

    // `contactName` too: `displayNameOf` needs it, and without it every order
    // row would fall through to the business name.
    db().Order.find({})
      .sort({ createdAt: -1 })
      .limit(6)
      .populate('user', 'businessName contactName email')
      .lean(),
    db().User.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(5).lean(),

    db().Product.find({ isActive: true, stock: { $lt: lowStockFallback } })
      .sort({ stock: 1 })
      .limit(6)
      .select('name sku stock price')
      .lean(),

    // Returns still needing attention. Deliberately unranged like the other
    // badge counters - a badge that moved when you changed the dashboard's
    // dates would be nonsense.
    db().Rma.countDocuments({ status: { $in: RMA_OPEN_STATUSES } }),
    db().Ticket.countDocuments({ status: { $in: TICKET_OPEN_STATUSES } }),

    // Newest invoices, unranged like the other "recent" lists: the panel
    // answers "what was billed lately", which a date filter would silently
    // empty on a range with no billing in it.
    db().Invoice.find({})
      .sort({ issuedAt: -1 })
      .limit(6)
      .populate('user', 'businessName contactName')
      .lean(),

    // What staff did, newest first. Read from the audit trail rather than
    // reconstructed from records: the trail already knows who acted and when,
    // and a second derivation would disagree with the audit screen.
    AuditLog.find({ kind: 'activity' })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
  ]);

  const collected = collectedRows[0]?.total ?? 0;
  const priorCollected = priorCollectedRows[0]?.total ?? 0;

  return {
    // The range the server actually used, echoed back so the UI can label the
    // period without re-deriving it and disagreeing.
    range: { from: start.toISOString(), to: end.toISOString(), bucket: unit },

    users: { pending: pendingUsers, approved: approvedUsers, total: totalClients },
    orders: {
      open: openOrders,
      awaitingFulfilment,
      last30Days: revenueRows[0]?.count ?? 0,
      inRange: revenueRows[0]?.count ?? 0,
    },

    revenue: {
      // Order value in range. `last30Days` is the old key and only means "last
      // thirty days" when no range was asked for; the new screens read
      // `orderValue`.
      last30Days: revenueRows[0]?.total ?? 0,
      orderValue: revenueRows[0]?.total ?? 0,
    },

    invoiced: { total: invoicedRows[0]?.total ?? 0, count: invoicedRows[0]?.count ?? 0 },
    collected: {
      total: collected,
      count: collectedRows[0]?.count ?? 0,
      // Percentage change against the preceding window of the same length.
      // Null rather than 0 when there is nothing to compare to - "no change"
      // and "no prior data" are different claims.
      deltaPercent: priorCollected > 0 ? ((collected - priorCollected) / priorCollected) * 100 : null,
    },
    refunds: { total: refundRows[0]?.total ?? 0, count: refundRows[0]?.count ?? 0 },

    receivables: {
      outstanding: outstandingRows[0]?.outstanding ?? 0,
      count: outstandingRows[0]?.count ?? 0,
      overdue: outstandingRows[0]?.overdue ?? 0,
      overdueCount,
    },

    inventory: {
      total: productCount,
      lowStock: lowStock[0]?.count ?? 0,
      outOfStock,
      value: inventoryValueRows[0]?.value ?? 0,
    },

    // The sidebar badge reads this by name. Open means every rung before
    // resolved or rejected - a return still needing somebody's attention.
    rma: { open: openRmas },

    // Open here excludes `ready_to_pickup`: the repair is done and the badge
    // should stop nagging, even though the device is still on the shelf.
    tickets: { open: openTickets },

    trend: fillBuckets(trendRows, start, end, unit),
    topClients: topClientRows,

    recentOrders: recentOrders.map((order) => ({
      ...serializeOrder(order),
      businessName: order.user?.businessName ?? null,
      displayName: displayNameOf(order.user),
    })),
    // Enough to render a row and link to the document. Labelled with
    // `displayNameOf`, never `businessName` - an account is identified by the
    // person, and a sole trader has no business name to show.
    recentInvoices: recentInvoices.map((invoice) => ({
      number: invoice.number,
      displayName: displayNameOf(invoice.user),
      amount: invoice.amount,
      amountPaid: invoice.amountPaid ?? 0,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
    })),

    // The audit row, flattened to what a feed line needs. `entity` travels
    // whole so the client can route the row to the record it describes without
    // parsing the description text.
    recentActivity: recentActivity.map((row) => ({
      id: row._id.toString(),
      action: row.action,
      description: row.description,
      actorName: row.actorName,
      entity: {
        kind: row.entity?.kind ?? null,
        id: row.entity?.id ?? '',
        label: row.entity?.label ?? '',
      },
      at: row.createdAt,
    })),

    pendingQueue: pendingQueue.map(shapeUser),
    lowStockItems: lowStockItems.map((product) => ({
      id: product._id.toString(),
      name: product.name,
      sku: product.sku,
      stock: product.stock,
      price: product.price,
    })),
  };
}

// ---- customers --------------------------------------------------------------

function shapeUser(user) {
  return {
    id: user._id.toString(),
    businessName: user.businessName,
    contactName: user.contactName,
    displayName: displayNameOf(user),
    email: user.email,
    phone: user.phone,
    status: user.status,
    role: user.role,
    businessType: user.businessType,
    website: user.website,
    taxId: user.taxId,
    creditLimit: user.creditLimit ?? 0,
    balance: user.balance ?? 0,
    storeCredit: user.storeCredit ?? 0,
    terms: user.terms,
    addresses: user.addresses ?? [],
    accountRep: user.accountRep ?? null,
    rejectionReason: user.rejectionReason,
    approvedAt: user.approvedAt,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    // Referral (§6.13). The code is what a staff member reads out to a customer
    // who asks how to refer somebody; `referredBy` is read-only everywhere,
    // because attribution is set once at registration and never edited.
    referralCode: user.referralCode ?? null,
    referredBy: user.referredBy ? String(user.referredBy) : null,

    tier: user.tier ?? 'standard',

    /**
     * Consent, master flag and channels together.
     *
     * `recorded` says whether anybody has ever answered the channel question
     * for this account. An account that predates the field has not declined
     * it has not been asked - and the UI has to be able to tell those apart,
     * because "no consent recorded" is a prompt to go and ask, while "declined"
     * is an answer to respect.
     */
    consent: {
      marketing: user.marketingConsent?.granted === true,
      unsubscribedAt: user.unsubscribedAt ?? null,
      recorded: Boolean(user.contactConsent?.at),
      at: user.contactConsent?.at ?? null,
      source: user.contactConsent?.source ?? null,
      channels: {
        sms: user.contactConsent?.sms === true,
        whatsapp: user.contactConsent?.whatsapp === true,
        email: user.contactConsent?.email === true,
        call: user.contactConsent?.call === true,
      },
    },

    /**
     * Which channel to reach them on, and where they came from.
     *
     * **Both are `null` when never recorded, not an empty string**, so the UI
     * can say "not asked yet" rather than rendering a blank that reads as a
     * missing value. `preferredContact` sits outside `consent` above because it
     * is not consent: it is a preference, and it is honoured only where consent
     * already allows the channel.
     */
    preferredContact: user.preferredContact ?? null,
    source: user.source ?? null,
  };
}

async function listUsers({ status, q } = {}) {
  const query = { role: 'buyer' };
  if (status && status !== 'all') query.status = String(status);

  if (q) {
    const rx = likeRegex(q);
    query.$or = [{ businessName: rx }, { contactName: rx }, { email: rx }];
  }

  // Pending first - the approvals queue is the point of this screen.
  const users = await db().User.find(query).sort({ status: 1, createdAt: -1 }).limit(200).lean();

  const ids = users.map((user) => user._id);

  /**
   * Per-account trading history, in two grouped queries rather than two per
   * row. The customers list shows lifetime value, invoice count and last order
   * date for every account on screen; fetched individually that is 200 round
   * trips for a 200-row page.
   *
   * **Lifetime value is what was invoiced, not what was ordered.** An order can
   * be cancelled, edited or never invoiced; the invoice is the document the
   * business is actually accountable for, and it is what the reports already
   * treat as the money figure (§9.1). Cancelled orders are excluded from the
   * order side for the same reason they are excluded from the trend.
   */
  const now = new Date();

  const [counts, invoiceRows, overdueRows, orderRows] = await Promise.all([
    db().User.aggregate([
      { $match: { role: 'buyer' } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    db().Invoice.aggregate([
      { $match: { user: { $in: ids } } },
      {
        $group: {
          _id: '$user',
          lifetimeValue: { $sum: '$amount' },
          invoiceCount: { $sum: 1 },
        },
      },
    ]),

    /**
     * Genuinely **overdue** money, which is not the same as `db().User.balance`.
     *
     * `balance` is what the account currently owes on its line of credit
     * an invoice raised yesterday on Net 30 is owed but perfectly in order.
     * Overdue is the unpaid remainder of invoices whose due date has passed,
     * which is the figure a staff member chases, and it matches the definition
     * `listInvoices` already uses for its `overdue` filter.
     */
    db().Invoice.aggregate([
      { $match: { user: { $in: ids }, status: { $ne: 'paid' }, dueDate: { $lt: now } } },
      {
        $group: {
          _id: '$user',
          overdue: { $sum: { $subtract: ['$amount', { $ifNull: ['$amountPaid', 0] }] } },
          overdueCount: { $sum: 1 },
        },
      },
    ]),
    db().Order.aggregate([
      { $match: { user: { $in: ids }, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$user',
          orderCount: { $sum: 1 },
          lastOrderedAt: { $max: '$createdAt' },
        },
      },
    ]),
  ]);

  const invoiceBy = new Map(invoiceRows.map((row) => [String(row._id), row]));
  const overdueBy = new Map(overdueRows.map((row) => [String(row._id), row]));
  const orderBy = new Map(orderRows.map((row) => [String(row._id), row]));

  return {
    users: users.map((user) => {
      const key = String(user._id);
      const invoiced = invoiceBy.get(key);
      const late = overdueBy.get(key);
      const ordered = orderBy.get(key);

      return {
        ...shapeUser(user),
        lifetimeValue: invoiced?.lifetimeValue ?? 0,
        invoiceCount: invoiced?.invoiceCount ?? 0,
        // Kept apart from `balance`, which shapeUser already returns: one is
        // owed, the other is late, and collapsing them would overstate arrears.
        overdue: late?.overdue ?? 0,
        overdueCount: late?.overdueCount ?? 0,
        orderCount: ordered?.orderCount ?? 0,
        lastOrderedAt: ordered?.lastOrderedAt ?? null,
      };
    }),
    counts: {
      ...Object.fromEntries(counts.map((row) => [row._id, row.count])),
      // The pseudo-status carries a count too, so its pill can show one like
      // every other pill rather than being the single bare label in the row.
      open: counts
        .filter((row) => ORDER_OPEN_STATUSES.includes(row._id))
        .reduce((total, row) => total + row.count, 0),
      unfulfilled: counts
        .filter((row) => ORDER_UNFULFILLED_STATUSES.includes(row._id))
        .reduce((total, row) => total + row.count, 0),
    },
  };
}

async function getUser(id) {
  const user = await db().User.findById(id).lean();
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  /**
   * The lists are capped at ten because the profile shows a roll-up, not a
   * ledger - but the header's tiles state *totals*, so those are counted
   * separately rather than taken from `orders.length`. A "Total revenue" that
   * silently stopped at the tenth invoice would be wrong on exactly the
   * accounts that matter most.
   *
   * Tickets carry an optional `user`: a repair can walk in off the street with
   * no account behind it, so this counts only the ones actually linked here.
   */
  const [
    orders,
    invoices,
    totals,
    orderCount,
    activeTickets,
    openQuotes,
    webQuotes,
    openRmas,
    referredCount,
  ] = await Promise.all([
    db().Order.find({ user: id }).sort({ createdAt: -1 }).limit(10).lean(),
    db().Invoice.find({ user: id }).sort({ issuedAt: -1 }).limit(10).lean(),

    db().Invoice.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(String(id)) } },
      {
        $group: {
          _id: null,
          invoiced: { $sum: '$amount' },
          collected: { $sum: { $ifNull: ['$amountPaid', 0] } },
          invoiceCount: { $sum: 1 },
        },
      },
    ]),

    db().Order.countDocuments({ user: id }),
    db().Ticket.countDocuments({ user: id, status: { $in: TICKET_OPEN_STATUSES } }),
    // Open = still awaiting a decision. `accepted` and `converted` have had
    // their answer, and `expired` / `rejected` are closed, so a tile counting
    // them would never fall back to zero.
    db().Quote.countDocuments({ user: id, status: { $in: ['draft', 'sent'] } }),
    // Website enquiries from this account. Counted here rather than on the tab,
    // because the tab only fetches when it is open and the badge has to be
    // right before anybody clicks it.
    db().ContactMessage.countDocuments({ user: id }),

    // Returns still needing somebody's attention, for the profile's Returns
    // tab. Open rather than total, matching every other count on the strip:
    // the number's job is to say how much work is here, and a resolved return
    // is not work.
    db().Rma.countDocuments({ user: id, status: { $in: RMA_OPEN_STATUSES } }),

    // How many accounts this one brought in. The referral panel showed the
    // code, the link and the commission earned but never this - and "is the
    // referral actually working" is the question somebody opens it to answer.
    db().User.countDocuments({ referredBy: id }),
  ]);

  const billed = totals[0] ?? { invoiced: 0, collected: 0, invoiceCount: 0 };

  return {
    user: shapeUser(user),
    /**
     * Header figures, summed over every record rather than the ten below.
     * `outstanding` is derived here so the tiles cannot disagree with each
     * other about what is still owed.
     */
    totals: {
      invoiced: billed.invoiced,
      collected: billed.collected,
      outstanding: billed.invoiced - billed.collected,
      invoiceCount: billed.invoiceCount,
      orderCount,
      activeTickets,
      openQuotes,
      webQuotes,
      openRmas,
      referredCount,
    },
    // Staff notes ride with the profile: they are the thing somebody reads
    // before picking up the phone, so a second request for them would just be
    // a spinner in front of the reason they opened the screen.
    ...listInternalNotes(user),
    orders: orders.map(serializeOrder),
    invoices: invoices.map((invoice) => ({
      number: invoice.number,
      amount: invoice.amount,
      amountPaid: invoice.amountPaid,
      balance: invoice.amount - invoice.amountPaid,
      // The profile's "last activity" reads this, and the Invoices roll-up
      // shows it - an invoice with no date on it cannot be placed in time.
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      status:
        invoice.status !== 'paid' && invoice.dueDate < new Date() ? 'overdue' : invoice.status,
    })),
  };
}

/**
 * Every payment this customer has made, newest first (§6.13).
 *
 * **There is no `Payment` collection** - a payment is a subdocument of the
 * invoice it settles - so this unwinds rather than queries, and the invoice
 * number comes back on each row because without it a list of amounts and dates
 * cannot be reconciled against anything.
 *
 * Its own call rather than a field on `getUser`: the profile caps invoices at
 * ten, and a payments list that silently stopped at the tenth invoice would be
 * wrong precisely on the accounts somebody opens this tab to check.
 *
 * **A reversed payment is returned, marked, not dropped.** It happened, the
 * customer may hold a receipt for it, and a row that vanishes is how somebody
 * ends up certain they paid twice. The reversal is a separate negative row, so
 * the two together net to nothing and both remain visible.
 */
async function userPayments(id) {
  const rows = await db().Invoice.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(id)) } },
    { $unwind: '$payments' },
    {
      $project: {
        _id: 0,
        invoice: '$number',
        amount: '$payments.amount',
        at: '$payments.at',
        method: '$payments.method',
        reference: '$payments.reference',
        reversedAt: '$payments.reversedAt',
      },
    },
    { $sort: { at: -1 } },
    // Enough that nobody's history is truncated in practice, capped so one
    // pathological account cannot return an unbounded document.
    { $limit: 500 },
  ]);

  return {
    payments: rows.map((row) => ({
      invoice: row.invoice,
      amount: row.amount ?? 0,
      at: row.at,
      method: row.method ?? null,
      reference: row.reference ?? null,
      reversedAt: row.reversedAt ?? null,
    })),
    // Reversed rows are excluded from the total and their negative counterparts
    // are not: netting twice would double-count the reversal.
    total: rows.reduce((sum, row) => (row.reversedAt ? sum : sum + (row.amount ?? 0)), 0),
  };
}

/**
 * Opens a client account from the admin side (§7.2's `+ Create > Client`).
 *
 * The counterpart to `authService.register`, and it differs from it in three
 * places that all trace back to *who is in the room*:
 *
 * - **It defaults to approved.** The admin creating the account is the
 *   approval; making them create a pending one and then approve it a moment
 *   later is a step that decides nothing. `status: 'pending'` is still offered,
 *   for an account being entered ahead of the paperwork.
 * - **Marketing consent defaults to false.** A business opening its own account
 *   gives implied consent under CASL s.10(9) - it asked for the relationship.
 *   An admin typing that business in has not been asked anything by anybody, so
 *   there is no implied basis to record and pretending otherwise is the kind of
 *   thing that is indefensible later. The source is stamped `admin` so it is
 *   obvious where the record came from.
 * - **It sets credit terms immediately** when the account starts approved, the
 *   same pairing `approveUser` enforces.
 */
async function createUser(data, adminId) {
  const email = String(data.email).toLowerCase().trim();

  const existing = await db().User.findOne({ email });
  if (existing) {
    throw ApiError.conflict('An account with that email already exists.', 'EMAIL_IN_USE');
  }

  const user = new (db().User)({
    businessName: data.businessName,
    contactName: data.contactName,
    email,
    phone: data.phone,
    role: 'buyer',
    status: data.status,
    businessType: data.businessType,
    website: data.website,
    taxId: data.taxId,
    // `|| undefined` rather than the raw value: the form sends an empty string
    // for "not asked yet", and an empty string is not one of the enum's values.
    preferredContact: data.preferredContact || undefined,
    source: data.source || undefined,
    creditLimit: data.creditLimit ?? 0,
    terms: data.terms ?? 'prepaid',
    addresses: data.address
      ? [
          {
            ...data.address,
            // The form asks for a country now, so the answer is kept rather
            // than overwritten. Still defaulted, because almost every account
            // is Canadian and an older payload carries no country at all.
            country: data.address.country || 'Canada',
            isDefaultShipping: true,
            isDefaultBilling: true,
          },
        ]
      : [],
  });

  /**
   * Consent is recorded only when the admin actually ticked something.
   *
   * An absent `contactConsent` means nobody asked, which the profile screen
   * shows as "nothing recorded yet" - a prompt to go and ask. Writing four
   * falses instead would claim the customer was asked and declined on every
   * channel, which is a different fact and one they never gave.
   */
  const channels = data.contactConsent;
  const anyChannel = channels && Object.values(channels).some(Boolean);

  if (channels) {
    user.contactConsent = { ...channels, at: new Date(), source: 'admin', by: adminId };
  }

  // Same master-switch rule `setContactConsent` follows: any channel on turns
  // marketing consent on, and it stays off when nothing was granted.
  user.marketingConsent = { granted: Boolean(anyChannel), source: 'admin', at: new Date() };

  /**
   * The password is generated here rather than typed by the admin, and it is
   * never persisted in the clear - `setPassword` hashes it, and the plaintext
   * lives only long enough to be put in the welcome email below.
   */
  const password = generatePassword();
  await user.setPassword(password);

  if (user.status === 'approved') {
    user.approvedAt = new Date();
    user.approvedBy = adminId;
    // Minted on approval, never at creation, for the reason `approveUser`
    // gives: a code that can refer people before its account is trusted is a
    // code worth abusing.
    await referralService.ensureReferralCode(user);
  }

  await user.save();

  /**
   * Fire-and-forget, like the invoice email: the account exists and is already
   * saved, so a dead SMTP host has to end in a log line rather than turning a
   * created customer into an error the admin sees. `sendWelcomeEmail` never
   * throws; without SMTP configured it returns `delivered: false`.
   *
   * `delivered` rides back on the response so the admin panel can say whether
   * the customer actually got their credentials, rather than implying it.
   */
  const mail = await sendWelcomeEmail({ user, password });

  return { ...shapeUser(user.toObject()), welcomeEmail: mail };
}

/**
 * Edits a customer's profile from the admin side.
 *
 * **What it deliberately does not touch.** Status, credit limit and terms are
 * not editable here even though they sit on the same document: each already has
 * its own endpoint that does more than write the field - `approveUser` stamps
 * who approved and mints a referral code, `rejectUser` requires a reason,
 * `setCredit` is the line of credit. An edit form that also wrote `status`
 * would be a second, quieter approval path with none of that, which is exactly
 * the split the shared `ApproveClientForm` exists to prevent. It never touches
 * `balance` or `storeCredit` either: those move through their services only.
 *
 * **Email is editable but re-checked**, because it is the sign-in identity
 * changing it to one already in use would lock two accounts out of themselves.
 *
 * Fields absent from the payload are left alone; a field sent empty is cleared,
 * which is how a staff member removes a tax ID they entered by mistake.
 */
async function updateUser(id, data) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');
  if (user.role === 'admin') {
    throw ApiError.badRequest('Admin accounts are not edited here.', 'NOT_A_CUSTOMER');
  }

  if (data.email) {
    const email = String(data.email).toLowerCase().trim();
    if (email !== user.email) {
      const clash = await db().User.findOne({ email, _id: { $ne: user._id } });
      if (clash) {
        throw ApiError.conflict('An account with that email already exists.', 'EMAIL_IN_USE');
      }
      user.email = email;
    }
  }

  for (const field of ['businessName', 'contactName', 'phone']) {
    if (data[field] != null) user[field] = data[field];
  }

  /**
   * Optional descriptors: an empty string is a deletion, not a value.
   *
   * `preferredContact` and `source` belong here rather than in the loop above
   * for exactly that reason. **Unset is a real state** - it means nobody has
   * asked which channel the customer wants, or nobody recorded where they came
   * from, and that is a different fact from having chosen email or walk-in. A
   * staff member clearing either has to be able to put the record back to it.
   */
  for (const field of ['businessType', 'website', 'taxId', 'preferredContact', 'source']) {
    if (data[field] != null) user[field] = data[field] || undefined;
  }

  /**
   * The address list is not replaced wholesale. An account can carry several,
   * and the form edits the default shipping one - overwriting the array would
   * silently drop the others.
   */
  if (data.address) {
    const index = user.addresses.findIndex((address) => address.isDefaultShipping);
    const next = { ...data.address, country: data.address.country || 'Canada' };

    if (index >= 0) {
      Object.assign(user.addresses[index], next);
    } else {
      user.addresses.push({ ...next, isDefaultShipping: true, isDefaultBilling: true });
    }
  }

  await user.save();
  return shapeUser(user.toObject());
}

/**
 * Records what a customer agreed to be contacted on (§6.13, CASL).
 *
 * **The master flag follows the channels.** `marketingConsent.granted` is what
 * every campaign query already checks, so leaving it untouched while ticking
 * four channel boxes would produce an account that looks contactable on the
 * profile and is invisible to every campaign. Granting any channel grants the
 * master flag; clearing all four withdraws it, which is the only reading of
 * "they agreed to nothing" that is not a trap.
 *
 * **Withdrawing consent here does not clear `unsubscribedAt`,** and re-granting
 * it does not resurrect a suppressed account: an unsubscribe is the customer's
 * own act and is not undone by an admin ticking a box. That has to go through
 * the marketing screen's explicit re-subscribe, which records who did it.
 */
async function setContactConsent(id, { sms, whatsapp, email, call }, adminId) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  const channels = {
    sms: Boolean(sms),
    whatsapp: Boolean(whatsapp),
    email: Boolean(email),
    call: Boolean(call),
  };

  user.contactConsent = {
    ...channels,
    at: new Date(),
    source: 'admin',
    by: adminId,
  };

  const any = Object.values(channels).some(Boolean);

  // Only move the master flag when it actually changes, so an unrelated edit
  // does not restamp somebody's original consent date.
  if (any && user.marketingConsent?.granted !== true) {
    user.marketingConsent = { granted: true, source: 'admin', at: new Date() };
  } else if (!any && user.marketingConsent?.granted === true) {
    user.marketingConsent = { ...user.marketingConsent, granted: false };
  }

  await user.save();
  return shapeUser(user.toObject());
}

/**
 * Sets the membership tier.
 *
 * A label, checked against the enum and nothing else. It does not touch price:
 * `pricingService` is the only place a discount is decided, and a tier that
 * granted one here would be a second discount engine outside that rule.
 */
async function setTier(id, { tier }) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  user.tier = tier;
  await user.save();
  return shapeUser(user.toObject());
}

/** Staff-only notes on an account. Append-only; see the model for why. */
async function addInternalNote(id, { body }, staff) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  user.internalNotes.push({
    body,
    staff: staff?._id,
    // Denormalised so a note still says who wrote it after that person leaves
    // and their account is deleted - the attribution is part of the record.
    staffName: staff?.contactName ?? staff?.email ?? 'Staff',
    createdAt: new Date(),
  });

  await user.save();
  return listInternalNotes(user);
}

async function deleteInternalNote(id, noteId) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  const note = user.internalNotes.id(noteId);
  if (!note) throw ApiError.notFound('Note not found.', 'NOTE_NOT_FOUND');

  note.deleteOne();
  await user.save();
  return listInternalNotes(user);
}

/** Newest first - a note panel is read from the top. */
function listInternalNotes(user) {
  return {
    notes: [...(user.internalNotes ?? [])]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((note) => ({
        id: note._id.toString(),
        body: note.body,
        staffName: note.staffName ?? 'Staff',
        createdAt: note.createdAt,
      })),
  };
}

/**
 * Approves a business.
 *
 * This is the gate the whole B2B model hangs on: until it runs, the account can
 * browse but sees no prices and cannot order. Credit terms are set here because
 * approving and deciding terms are one decision, not two.
 */
/**
 * Emails an approved or rejected buyer, if this business has it switched on.
 *
 * ## Why the failure is swallowed
 *
 * The decision is already written by the time this runs. A mail that cannot go
 * out is a mail problem, and turning it into a thrown error would show the
 * admin a failed approval for an account that is, in fact, approved - which is
 * worse than a missing email in every direction: they would approve it again.
 * The failure is logged, which is where a mail problem belongs.
 *
 * ## Why it reads the setting rather than always sending
 *
 * `communications.accountApproved` / `accountRejected` default **off**, like
 * everything here that reaches a customer. A business turns them on once
 * somebody has read what the message says.
 */
async function notifyAccountDecision(user, decision, reason = null) {
  try {
    const settings = await db().Settings.load();
    const key = decision === 'approved' ? 'accountApproved' : 'accountRejected';
    if (!settings?.communications?.[key]) return;

    const result =
      decision === 'approved'
        ? await sendAccountApprovedEmail({ user })
        : await sendAccountRejectedEmail({ user, reason });

    if (!result?.delivered) {
      console.error(`  Account ${decision} mail for ${user.email} not sent - ${result?.error}`);
    }
  } catch (error) {
    console.error(`  Account ${decision} mail for ${user?.email} failed:`, error.message);
  }
}

async function approveUser(id, adminId, { creditLimit, terms, accountRep }) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');
  if (user.role === 'admin') throw ApiError.badRequest('Admin accounts are not approved this way.');

  user.status = 'approved';
  user.approvedAt = new Date();
  user.approvedBy = adminId;
  user.rejectionReason = undefined;
  user.creditLimit = creditLimit;
  user.terms = terms;
  if (accountRep) user.accountRep = accountRep;

  // The referral code is minted here rather than at signup (§6.13): a pending
  // business might never be approved, and a code that can refer people before
  // its own account is trusted is a code worth abusing.
  await referralService.ensureReferralCode(user);

  await user.save();

  /**
   * Tell the buyer, if this business has that switched on.
   *
   * Gated on the setting rather than sent unconditionally: everything that
   * emails a customer defaults OFF and is turned on deliberately by somebody
   * who has read what it says. Awaited but never allowed to throw - a mail
   * failure must not turn a completed approval into an error the admin sees,
   * because the approval itself has already been written.
   */
  await notifyAccountDecision(user, 'approved');

  return shapeUser(user.toObject());
}

async function rejectUser(id, { reason }) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  user.status = 'rejected';
  user.rejectionReason = reason;
  user.approvedAt = undefined;

  await user.save();
  await notifyAccountDecision(user, 'rejected', reason);

  return shapeUser(user.toObject());
}

async function setUserStatus(id, { status }) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');
  if (user.role === 'admin') {
    throw ApiError.badRequest('You cannot change an admin account this way.', 'FORBIDDEN_TARGET');
  }

  user.status = status;
  if (status === 'approved' && !user.approvedAt) user.approvedAt = new Date();
  // Approving through the status route mints a code too, so an account's
  // referral ability does not depend on which screen approved it.
  if (status === 'approved') await referralService.ensureReferralCode(user);

  await user.save();
  return shapeUser(user.toObject());
}

/**
 * Allocates store credit to an account, or corrects it with a negative amount.
 *
 * Deliberately NOT part of `setCredit`: a credit limit is a lending decision
 * that gets edited, while an allocation is an event that gets recorded. One
 * overwrites, the other appends.
 */
async function allocateStoreCredit(id, { amountDollars, note }, adminId) {
  const amount = Math.round(Number(amountDollars) * 100);
  const posted = await storeCredit.allocate(id, { amount, note }, adminId);
  const user = await db().User.findById(id).lean();
  return { ...posted, user: shapeUser(user) };
}

async function storeCreditStatement(id) {
  return storeCredit.statement(id, { limit: 100 });
}

/** Refunds an order to the buyer's store credit. */
async function refundOrder(orderNumber, { amountDollars, note }, adminId) {
  const amount = Math.round(Number(amountDollars) * 100);
  return storeCredit.refundOrder(orderNumber, { amount, note }, adminId);
}

async function setCredit(id, { creditLimit, terms }) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  user.creditLimit = creditLimit;
  user.terms = terms;

  await user.save();
  return shapeUser(user.toObject());
}

// ---- products ---------------------------------------------------------------

function shapeProduct(product) {
  return {
    id: product._id.toString(),
    sku: product.sku,
    name: product.name,
    slug: product.slug,
    description: product.description,
    partType: product.partType,
    partTypeLabel: product.partTypeLabel,
    grade: product.grade,
    price: product.price,
    compareAtPrice: product.compareAtPrice ?? null,
    stock: product.stock,
    deviceTypeSlug: product.deviceTypeSlug,
    deviceTypeName: product.deviceTypeName,
    brandSlug: product.brandSlug,
    brandName: product.brandName,
    seriesSlug: product.seriesSlug,
    seriesName: product.seriesName,
    modelSlug: product.modelSlug,
    modelName: product.modelName,
    isActive: product.isActive,
    updatedAt: product.updatedAt,
  };
}

/**
 * `all: true` lifts the page cap - for the export, which must not silently
 * return the first hundred of four hundred products (§7.4). Deliberately a
 * separate flag rather than a bigger `limit` ceiling: the cap is there to stop
 * a screen asking for the whole catalogue by accident, and an export asking on
 * purpose should have to say so.
 */
async function listProducts({ q, stock, page = 1, limit = 40, all = false } = {}) {
  // The same fallback the dashboard badge counts by, so clicking that badge
  // still lands on exactly the rows it was counting.
  const lowStockFallback = await lowStockThreshold();

  const query = {};

  if (q) {
    const rx = likeRegex(q);
    query.$or = [{ name: rx }, { sku: rx }, { modelName: rx }];
  }

  if (stock === 'out') query.stock = 0;
  else if (stock === 'low') query.stock = { $gt: 0, $lt: lowStockFallback };
  // Both at once - the set the sidebar badge counts. It exists so that clicking
  // that badge lands on a list of exactly the rows it was counting; without it
  // the badge said 189 and the only reachable views were 136 and 53.
  else if (stock === 'attention') {
    query.isActive = true;
    query.stock = { $lt: lowStockFallback };
  }
  else if (stock === 'inactive') query.isActive = false;

  const pageNumber = all ? 1 : Math.max(1, Number(page) || 1);
  const pageSize = all ? 0 : Math.min(100, Number(limit) || 40);

  const [products, total] = await Promise.all([
    db().Product.find(query)
      .sort({ updatedAt: -1 })
      .skip(all ? 0 : (pageNumber - 1) * pageSize)
      // `.limit(0)` is Mongo's "no limit", which is what an export wants.
      .limit(pageSize)
      .lean(),
    db().Product.countDocuments(query),
  ]);

  return {
    products: products.map(shapeProduct),
    total,
    page: pageNumber,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Denormalised taxonomy names have to be looked up, not trusted from the client. */
async function resolveTaxonomyNames(data) {
  const slugs = [data.deviceTypeSlug, data.brandSlug, data.seriesSlug, data.modelSlug].filter(Boolean);
  const nodes = await db().Taxonomy.find({ slug: { $in: slugs } }).lean();
  const bySlug = new Map(nodes.map((node) => [node.slug, node]));

  return {
    deviceTypeName: bySlug.get(data.deviceTypeSlug)?.name,
    brandName: bySlug.get(data.brandSlug)?.name,
    seriesName: bySlug.get(data.seriesSlug)?.name,
    modelName: bySlug.get(data.modelSlug)?.name,
  };
}

async function createProduct(data) {
  const existing = await db().Product.findOne({ sku: data.sku.toUpperCase() });
  if (existing) throw ApiError.conflict('That SKU already exists.', 'DUPLICATE_SKU');

  const names = await resolveTaxonomyNames(data);
  const product = await db().Product.create({
    ...data,
    ...names,
    sku: data.sku.toUpperCase(),
    slug: slugify(`${data.modelSlug}-${data.partType}-${data.grade}-${Date.now().toString(36)}`),
    searchTerms: [data.name, names.modelName, names.brandName, data.partTypeLabel, data.grade].filter(
      Boolean,
    ),
  });

  invalidateTree();
  return shapeProduct(product.toObject());
}

async function updateProduct(id, data) {
  const product = await db().Product.findById(id);
  if (!product) throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');

  const duplicate = await db().Product.findOne({ sku: data.sku.toUpperCase(), _id: { $ne: id } });
  if (duplicate) throw ApiError.conflict('That SKU already exists.', 'DUPLICATE_SKU');

  const names = await resolveTaxonomyNames(data);
  Object.assign(product, data, names, { sku: data.sku.toUpperCase() });

  await product.save();
  invalidateTree();
  return shapeProduct(product.toObject());
}

/**
 * Deactivates rather than deletes.
 *
 * Orders reference products by id, so a hard delete would leave historical
 * orders pointing at nothing. `isActive: false` hides it from the storefront
 * while keeping every past order readable.
 */
async function deactivateProduct(id) {
  const product = await db().Product.findById(id);
  if (!product) throw ApiError.notFound('Product not found.', 'PRODUCT_NOT_FOUND');

  product.isActive = !product.isActive;
  await product.save();
  invalidateTree();
  return shapeProduct(product.toObject());
}

// ---- orders -----------------------------------------------------------------

/**
 * An admin raising an order directly (§7.2's `+ Create > Order`) - a phone
 * order, a walk-in, one that arrived by email.
 *
 * Almost nothing happens here. Prices are read from the catalogue by
 * `orderBuilder.buildOrderItems`, and everything after that - approval,
 * address, stock, totals, the order, the invoice, the bell - is
 * `orderBuilder.raiseOrder`, the same code a converted quote runs. That is the
 * point of the split: a second way to raise an order must not become a second
 * set of rules about when one may be raised.
 */
async function createOrder(body) {
  const user = await db().User.findById(body.user).lean();
  if (!user) throw ApiError.badRequest('Pick a client.', 'USER_NOT_FOUND');

  const items = await orderBuilder.buildOrderItems(body.items);

  const { order } = await orderBuilder.raiseOrder({
    user,
    items,
    shipping: body.shipping ?? 0,
    deliveryCode: body.deliveryCode,
    poNumber: body.poNumber,
    business: body.business || null,
    note: body.notes
      ? `Raised by an administrator. ${body.notes}`
      : 'Raised by an administrator.',
  });

  return serializeOrder(order);
}

async function listOrders({ status, q, business } = {}) {
  const query = {};
  // Scoped to the business the panel is switched to, when it is switched to one.
  // Resolved by `resolveBusinessScope` rather than read from the query string,
  // because a staff member's own business is binding and must not be widened by
  // editing a URL.
  if (business) query.business = business;

  // `open` is a pseudo-status: not a value any order holds, but the set the
  // dashboard's "Open orders" tile counts. Without it that tile could only link
  // to one of the four and would show a list contradicting its own number.
  if (status === 'open') query.status = { $in: ORDER_OPEN_STATUSES };
  else if (status === 'unfulfilled') query.status = { $in: ORDER_UNFULFILLED_STATUSES };
  else if (status && status !== 'all') query.status = String(status);

  if (q) {
    const rx = likeRegex(q);
    query.$or = [{ orderNumber: rx }, { poNumber: rx }, { 'items.sku': rx }];
  }

  const orders = await db().Order.find(query)
    .sort({ createdAt: -1 })
    .limit(200)
    // `contactName` is required for `displayNameOf` - without it every row
    // falls back to the company name, which is the thing §0 says not to show.
    .populate('user', 'businessName contactName email')
    .lean();

  const counts = await db().Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);

  return {
    orders: orders.map((order) => ({
      ...serializeOrder(order),
      businessName: order.user?.businessName ?? null,
      displayName: displayNameOf(order.user),
      businessEmail: order.user?.email ?? null,
    })),
    counts: Object.fromEntries(counts.map((row) => [row._id, row.count])),
  };
}

/**
 * One order, for the detail screen (§4b.6, phase 12).
 *
 * Looked up by `orderNumber` rather than id, because that is what a packing
 * slip, an invoice and a customer email all carry - a staff member reading a
 * number off paper should be able to type it into the URL.
 *
 * The linked invoice rides along so the screen can cross-link the two without a
 * second request; the buyer is populated for the same reason.
 */
async function getOrder(orderNumber) {
  const order = await db().Order.findOne({ orderNumber })
    .populate('user', 'businessName contactName email phone')
    .lean();
  if (!order) throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');

  const invoice = await db().Invoice.findOne({ order: order._id }).select('number status').lean();

  return {
    order: {
      ...serializeOrder(order),
      businessName: order.user?.businessName ?? null,
      displayName: displayNameOf(order.user),
      contactName: order.user?.contactName ?? null,
      businessEmail: order.user?.email ?? null,
      userId: order.user?._id?.toString() ?? null,
      invoiceNumber: invoice?.number ?? null,
      invoiceStatus: invoice?.status ?? null,
    },
  };
}

/**
 * Advances an order and appends to its timeline.
 *
 * The timeline is append-only: it is what the buyer's tracking page renders, so
 * rewriting history there would mean rewriting what the customer was told.
 * Moving to `shipped` without a tracking number is refused - that transition is
 * exactly when the buyer expects one to appear.
 */
async function updateOrderStatus(orderNumber, { status, note, tracking }) {
  const order = await db().Order.findOne({ orderNumber });
  if (!order) throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');

  if (order.status === 'delivered' && status !== 'delivered') {
    throw ApiError.badRequest('A delivered order cannot be moved back.', 'ORDER_FINALISED');
  }

  const currentIndex = ORDER_STATUS_FLOW.indexOf(order.status);
  const nextIndex = ORDER_STATUS_FLOW.indexOf(status);
  if (nextIndex !== -1 && currentIndex !== -1 && nextIndex < currentIndex) {
    throw ApiError.badRequest(
      'Order status only moves forward. Cancel the order instead.',
      'ORDER_BACKWARDS',
    );
  }

  if (tracking?.carrier || tracking?.number) {
    order.tracking = { ...order.tracking?.toObject?.(), ...tracking };
  }

  if (status === 'shipped' && !order.tracking?.number) {
    throw ApiError.badRequest(
      'Add a carrier and tracking number before marking an order shipped.',
      'TRACKING_REQUIRED',
    );
  }

  if (status !== order.status) {
    order.status = status;
    order.timeline.push({ status, at: new Date(), note: note || defaultNote(status) });
  } else if (note) {
    order.timeline.push({ status, at: new Date(), note });
  }

  await order.save();
  return serializeOrder(order.toObject());
}

function defaultNote(status) {
  return {
    placed: 'Order received and confirmed.',
    processing: 'Picking and quality-checking parts at the Toronto warehouse.',
    shipped: 'Handed to the carrier.',
    out_for_delivery: 'On the delivery vehicle.',
    delivered: 'Signed for at the delivery address.',
    cancelled: 'Order cancelled.',
  }[status];
}

// ---- invoices ---------------------------------------------------------------

/**
 * Overdue is **derived, never stored** - an unpaid invoice becomes overdue by
 * the passage of time, and writing that to the database would mean a nightly
 * job whose only job is to keep a column honest. The account side already reads
 * it this way; this matches it exactly so the two never disagree.
 */
/** A stored line, as the client reads it. Cents stay cents. */
function shapeInvoiceLine(line) {
  return {
    name: line.name,
    description: line.description ?? null,
    priceCents: line.priceCents ?? 0,
    qty: line.qty ?? 1,
    product: line.product?.toString?.() ?? null,
  };
}

function shapeAdminInvoice(invoice) {
  const balance = invoice.amount - invoice.amountPaid;
  const overdue =
    invoice.status !== 'paid' && invoice.dueDate && new Date(invoice.dueDate) < new Date();

  return {
    id: invoice._id.toString(),
    number: invoice.number,
    orderNumber: invoice.order?.orderNumber ?? null,

    /**
     * The repair this invoice bills, and the quote behind that repair.
     *
     * Only ever set on an invoice raised from a ticket - an invoice behind an
     * order says what it is for through `orderNumber` instead, and neither
     * chain is ever both.
     */
    ticket: invoice.ticket
      ? {
          id: (invoice.ticket._id ?? invoice.ticket).toString(),
          ticketNumber: invoice.ticket.ticketNumber ?? null,
          quote: invoice.ticket.quote
            ? {
                id: (invoice.ticket.quote._id ?? invoice.ticket.quote).toString(),
                quoteNumber: invoice.ticket.quote.quoteNumber ?? null,
              }
            : null,
        }
      : null,

    businessName: invoice.user?.businessName ?? null,
    displayName: displayNameOf(invoice.user),
    contactName: invoice.user?.contactName ?? null,
    userId: invoice.user?._id?.toString() ?? null,
    amount: invoice.amount,
    amountPaid: invoice.amountPaid,
    balance,
    /**
     * The gratuity, beside the total rather than inside it.
     *
     * `amount` is what the work cost and `balance` is what is still owed, and a
     * tip is neither: it is money received that was never due. Sent as its own
     * field so a screen can show it without any figure above it moving.
     */
    tipCents: invoice.tipCents ?? 0,
    tipAt: invoice.tipAt ?? null,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    terms: invoice.terms,
    // Only a hand-raised invoice carries these; one behind an order says what
    // it is for by pointing at the order.
    reference: invoice.reference ?? null,
    notes: invoice.notes ?? null,
    status: overdue ? 'overdue' : invoice.status,

    /**
     * The manual status an admin set, which is NOT the payment status above.
     *
     * Populated rather than sent as an id, so a list can draw the pill without
     * a second request per row. `null` is the ordinary state - most invoices
     * never get one - so a screen must render the absence as blank rather than
     * as a missing value.
     */
    label: invoice.label
      ? {
          id: (invoice.label._id ?? invoice.label).toString(),
          name: invoice.label.name ?? null,
          colorToken: invoice.label.colorToken ?? 'ink',
        }
      : null,
    labelSetAt: invoice.labelSetAt ?? null,
    // Whether the warranty email has already gone, so the picker can say so
    // instead of implying a second one will send.
    labelEmailSentAt: invoice.labelEmailSentAt ?? null,

    // The work, and how the amount was arrived at. Empty on a flat charge and
    // on every invoice an order raised - the detail screen shows the breakdown
    // only when there is one, rather than a row of zeroes that explains
    // nothing. Sent so the document can reproduce its own arithmetic instead
    // of the reader taking the total on trust.
    devices: (invoice.devices ?? []).map((device) => ({
      category: device.category ?? null,
      brand: device.brand ?? null,
      series: device.series ?? null,
      model: device.model ?? null,
      serial: device.serial ?? null,
      problem: device.problem ?? null,
      solution: device.solution ?? null,
      notes: device.notes ?? null,
      services: (device.services ?? []).map(shapeInvoiceLine),
      parts: (device.parts ?? []).map(shapeInvoiceLine),
    })),
    subtotalCents: invoice.subtotalCents ?? null,
    discountCents: invoice.discountCents ?? 0,
    discountCode: invoice.discountCode ?? null,
    taxCents: invoice.taxCents ?? 0,
    taxPercent: invoice.taxPercent ?? 0,
    province: invoice.province ?? null,
    travelKm: invoice.travelKm ?? 0,
    // The allowance is sent as its own figure, beside the total rather than in
    // it: it is the shop's cost for the journey, not a charge. The screen shows
    // it that way, and a reader who added it to the total would be wrong.
    travelAllowanceCents: invoice.travelAllowanceCents ?? 0,
    extendedServiceFee: Boolean(invoice.extendedServiceFee),
    extendedServiceFeeCents: invoice.extendedServiceFeeCents ?? 0,
    serviceType: invoice.serviceType ?? null,
    // `internalNotes` is deliberately NOT here: it is the one note that never
    // leaves the building, and a field that reaches the client is a field that
    // reaches a screenshot.
    customerNotes: invoice.customerNotes ?? null,
    technicianNotes: invoice.technicianNotes ?? null,
    payments: (invoice.payments ?? []).map((payment) => ({
      amount: payment.amount,
      at: payment.at,
      method: payment.method ?? null,
      reference: payment.reference ?? null,
      // So a reversed row can be struck through without pairing rows up by
      // amount and guessing which reversal belongs to which payment.
      reversedAt: payment.reversedAt ?? null,
    })),

    /**
     * What has gone back, and what still could.
     *
     * Derived from the rows by `invoiceRefundService`, the one place that
     * arithmetic lives - the refund form needs the cap, and computing it in the
     * browser would put a second answer next to the one the server enforces.
     * `refundable` is money the shop actually still holds, so a reversed
     * payment is not part of it.
     */
    refundedCents: refundedTotalOf(invoice),
    refundableCents: refundableOf(invoice),
  };
}

/**
 * Recompute an invoice's paid total and status from its own payments.
 *
 * The arithmetic moved to `invoicePaymentService` when the customer payment
 * path arrived and needed exactly the same rule. Kept as a re-export rather
 * than a second copy: two answers to "what does paid mean" is how an invoice
 * ends up `partial` on one screen and `paid` on another.
 */
const recomputeInvoice = invoicePaymentService.recompute;

/**
 * What an itemised invoice adds up to.
 *
 * **The server owns this number.** The form shows a running total so the
 * staff member can see what they are building, but that figure is a preview and is
 * discarded: PROJECT_INSTRUCTIONS is explicit that totals are recomputed
 * server-side and the client never sends a price. A browser that can name the
 * amount is a browser that can name a smaller one.
 *
 * Order of operations, and it matters: lines, then the extended service fee,
 * then the discount, then tax on what is left. Taxing before the discount
 * charges tax on money nobody paid; discounting after tax quietly changes the
 * tax remitted. Travel mileage is deliberately absent - it is internal
 * bookkeeping, not a charge (§ the form says so on its face).
 *
 * Everything is integer cents, rounded once at each boundary. Rounding per line
 * and again at the end is how a total ends up a cent off what the lines show.
 */
/**
 * What the technician's mileage came to, in integer cents.
 *
 * **Never part of the invoice total.** It is the shop's own cost for the
 * journey, recorded so it can be claimed and reported on; what the customer
 * pays for being out of area is the extended service fee, which is a separate
 * ticked line that DOES land in the subtotal. Computing it here rather than in
 * the form is the same rule every other figure follows - a client that could
 * set it could overstate a mileage claim.
 */
function travelAllowanceCents(km, ratePerKm) {
  const distance = Math.max(0, Number(km) || 0);
  const rate = Number(ratePerKm) || 0;
  return Math.round(distance * rate);
}

function invoiceTotals(body, { extendedServiceFeeCents = 0 } = {}) {
  const devices = body.devices ?? [];

  const lineCents = devices.reduce((deviceSum, device) => {
    const lines = [...(device.services ?? []), ...(device.parts ?? [])];
    return (
      deviceSum +
      lines.reduce(
        (sum, line) =>
          sum + Math.round(Number(line.priceDollars ?? 0) * 100) * Math.max(1, Number(line.qty ?? 1)),
        0,
      )
    );
  }, 0);

  const feeCents = body.extendedServiceFee ? extendedServiceFeeCents : 0;
  const subtotalCents = lineCents + feeCents;

  // A discount cannot exceed what is being discounted: a negative subtotal is
  // a refund, and a refund is a different document with a different ledger.
  const discountCents = Math.min(
    Math.round(Number(body.discountDollars ?? 0) * 100),
    subtotalCents,
  );

  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round((taxableCents * Number(body.taxPercent ?? 0)) / 100);

  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: taxableCents + taxCents,
  };
}

/** A form line as the shape the model stores - dollars in, cents out. */
function toInvoiceLine(line) {
  return {
    name: line.name,
    description: line.description || undefined,
    priceCents: Math.round(Number(line.priceDollars ?? 0) * 100),
    qty: Math.max(1, Number(line.qty ?? 1)),
    product: line.product || undefined,
  };
}

/** True when the body describes work rather than a single agreed figure. */
function isItemised(body) {
  return (body.devices ?? []).some(
    (device) => (device.services?.length ?? 0) + (device.parts?.length ?? 0) > 0,
  );
}

/**
 * A standalone invoice (§7.2's `+ Create > Invoice`) - one raised against an
 * account for something no order covers.
 *
 * Two things it does that are easy to leave out:
 *
 * - **A sent `dueDate` wins over the terms.** The terms table is a default, not
 *   a rule: an agreed date is a fact about the arrangement, and silently
 *   overwriting it with `issuedAt + 30` would be the system correcting a human
 *   who knew better.
 * - **It draws on the line of credit.** An unpaid invoice on terms is money the
 *   client owes, so `balance` moves exactly as it does when an order raises
 *   one. Skipping this would leave a client under their limit on paper while
 *   owing more than it.
 */
async function createInvoice(body) {
  const user = await db().User.findById(body.user).lean();
  if (!user) throw ApiError.badRequest('Pick a client.', 'USER_NOT_FOUND');

  const issuedAt = body.issuedAt ? new Date(`${body.issuedAt}T00:00:00`) : new Date();

  let dueDate = body.dueDate ? new Date(`${body.dueDate}T00:00:00`) : null;
  if (!dueDate) {
    dueDate = new Date(issuedAt);
    dueDate.setDate(dueDate.getDate() + (orderBuilder.TERMS_DAYS[body.terms] ?? 0));
  }

  // An itemised invoice bills its lines; a flat one bills the figure typed.
  // Either way the amount stored is the one this function computed - the
  // client's is never trusted with it.
  const itemised = isItemised(body);

  /**
   * Both travel figures come from the shop own settings, never the request.
   *
   * The fee is money the customer pays and the rate decides money the shop
   * claims, so a client able to send either could overstate a mileage claim or
   * undercharge an out-of-area visit. The form sends the DISTANCE; the rate
   * and the fee are the business.
   */
  const settings = await db().Settings.load();
  /**
   * The fee is typed per invoice; the RATE is the business.
   *
   * An out-of-area call is priced by distance and awkwardness and is negotiated
   * per job, so a fixed setting would be a number the counter has to work
   * around. The mileage rate is the opposite - it is the CRA figure the shop
   * claims at, identical on every journey, and a client able to send it could
   * overstate a claim.
   */
  const feeCents = Math.round(Number(body.extendedServiceFeeDollars ?? 0) * 100);
  const ratePerKm = Number(settings?.financial?.travelRateCentsPerKm ?? 0);

  const totals = itemised ? invoiceTotals(body, { extendedServiceFeeCents: feeCents }) : null;

  const amount = itemised ? totals.totalCents : body.amount;
  if (!(amount > 0)) {
    throw ApiError.badRequest('An invoice needs an amount.', 'INVOICE_EMPTY');
  }

  const invoice = await db().Invoice.create({
    // A charge raised by hand is money owed, not money received, so it starts
    // life as a `due` record in the `CVX-` series and is renumbered into `INV-`
    // when it settles.
    number: await orderBuilder.nextInvoiceNumber('CVX'),
    kind: 'due',
    // No `order`: that is what makes this one standalone, and the field has
    // always been optional so nothing else has to change to allow it.
    user: user._id,
    // With no order to inherit from, the customer is what knows the business.
    // Without it the charge never appears on the Invoices screen.
    business: user.business ?? null,
    amount,
    amountPaid: 0,
    issuedAt,
    dueDate,
    terms: body.terms,
    status: 'unpaid',
    reference: body.reference,
    notes: body.notes,

    // Prices are stored in cents on the line, so the document reproduces
    // itself later without re-reading a catalogue that has since moved.
    devices: (body.devices ?? []).map((device) => ({
      category: device.category,
      brand: device.brand,
      series: device.series,
      model: device.model,
      serial: device.serial,
      problem: device.problem,
      solution: device.solution,
      notes: device.notes,
      services: (device.services ?? []).map(toInvoiceLine),
      parts: (device.parts ?? []).map(toInvoiceLine),
    })),

    province: body.province || undefined,
    taxPercent: itemised ? (body.taxPercent ?? 0) : 0,
    taxCents: totals?.taxCents ?? 0,
    subtotalCents: totals?.subtotalCents ?? amount,
    discountCents: totals?.discountCents ?? 0,
    discountCode: body.discountCode || undefined,

    travelKm: body.travelKm ?? 0,
    travelAllowanceCents: travelAllowanceCents(body.travelKm, ratePerKm),
    extendedServiceFee: Boolean(body.extendedServiceFee),
    extendedServiceFeeCents: body.extendedServiceFee ? feeCents : 0,
    serviceType: body.serviceType ?? 'walk_in',
    technician: body.technician || undefined,

    customerNotes: body.customerNotes || undefined,
    technicianNotes: body.technicianNotes || undefined,
    internalNotes: body.internalNotes || undefined,
  });

  // Re-derived from the invoices rather than incremented - see `creditService`.
  if (body.terms !== 'prepaid') {
    await creditService.syncBalance(user._id);
  }

  return shapeAdminInvoice({ ...invoice.toObject(), user, order: null });
}

/**
 * Admin invoice list.
 *
 * `status=overdue` is a filter over derived state rather than a stored value,
 * so it is applied in the query as "not paid, and past due" - the dashboard
 * links straight here with it.
 */
async function listInvoices({ status, q, from, to, business, numbers } = {}) {
  const now = new Date();
  const query = {};
  // Scoped to the business the panel is switched to, when it is switched to one.
  // Resolved by `resolveBusinessScope` rather than read from the query string,
  // because a staff member's own business is binding and must not be widened by
  // editing a URL.
  if (business) query.business = business;

  /**
   * An explicit set of invoice numbers, for exporting a selection.
   *
   * **Narrowing only.** It sits alongside the business scope rather than
   * replacing it, so a number from another shop cannot be read by putting it in
   * the query string - the scope still applies and the row simply does not
   * match. Capped, because this arrives as a URL parameter and an unbounded
   * `$in` is a request somebody can make arbitrarily expensive.
   */
  if (numbers) {
    const list = String(numbers)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 500);
    if (list.length) query.number = { $in: list };
  }

  if (status === 'overdue') {
    query.status = { $ne: 'paid' };
    query.dueDate = { $lt: now };
  } else if (status && status !== 'all') {
    query.status = String(status);
  }

  if (from || to) {
    query.issuedAt = {};
    if (from) query.issuedAt.$gte = new Date(`${from}T00:00:00`);
    if (to) {
      const end = new Date(`${to}T00:00:00`);
      end.setHours(23, 59, 59, 999);
      query.issuedAt.$lte = end;
    }
  }

  if (q) {
    const rx = likeRegex(q);
    // An invoice number is the obvious search, but staff more often have the
    // business in front of them, so both resolve.
    const users = await db().User.find({ $or: [{ businessName: rx }, { email: rx }] })
      .select('_id')
      .lean();
    query.$or = [{ number: rx }, { user: { $in: users.map((user) => user._id) } }];
  }

  const invoices = await db().Invoice.find(query)
    .sort({ issuedAt: -1 })
    .limit(200)
    .populate('order', 'orderNumber')
    .populate('user', 'businessName contactName')
    .populate('label', 'name colorToken')
    .lean();

  // Counts come from the whole collection, not the filtered set - a pill that
  // showed "Overdue 0" because you are already filtered to Paid is useless.
  const [statusRows, overdueCount] = await Promise.all([
    db().Invoice.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    db().Invoice.countDocuments({ status: { $ne: 'paid' }, dueDate: { $lt: now } }),
  ]);

  const counts = Object.fromEntries(statusRows.map((row) => [row._id, row.count]));
  counts.overdue = overdueCount;
  counts.all = statusRows.reduce((sum, row) => sum + row.count, 0);

  const shaped = invoices.map(shapeAdminInvoice);

  return {
    invoices: shaped,
    counts,
    totals: {
      billed: shaped.reduce((sum, invoice) => sum + invoice.amount, 0),
      paid: shaped.reduce((sum, invoice) => sum + invoice.amountPaid, 0),
      outstanding: shaped.reduce((sum, invoice) => sum + invoice.balance, 0),
    },
  };
}

async function getInvoice(number) {
  const invoice = await db().Invoice.findOne({ number })
    .populate('order', 'orderNumber items total status')
    .populate('user', 'businessName contactName email phone')
    // The chain behind a repair invoice - its ticket, and the quote that ticket
    // came from. Two hops in one read, because the lineage strip sits above the
    // fold and a second round trip would draw it late.
    .populate({
      path: 'ticket',
      select: 'ticketNumber quote',
      populate: { path: 'quote', select: 'quoteNumber' },
    })
    .populate('label', 'name colorToken')
    .lean();

  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');
  return { invoice: shapeAdminInvoice(invoice) };
}

/**
 * Record a payment against an invoice.
 *
 * The client sends an amount, a date, a method and a reference - never a status
 * and never a running total. `amountPaid` and `status` are both recomputed from
 * the payment rows, server-side, exactly as the Instructions require of every
 * money total.
 */
async function recordPayment(number, { amountDollars, at, method, reference }) {
  const invoice = await db().Invoice.findOne({ number });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  const amount = Math.round(Number(amountDollars) * 100);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('Enter an amount to record.', 'INVALID_AMOUNT');
  }

  // The payment row, the repayment of the line of credit, the promotion of a
  // settled `due` record into an invoice and the referral accrual all happen in
  // `invoicePaymentService` - the one place any of that is allowed to happen,
  // so an admin-recorded payment and a buyer-made one cannot behave
  // differently.
  await invoicePaymentService.recordPayment(invoice, {
    amount,
    at: at ? new Date(`${at}T12:00:00`) : new Date(),
    method,
    reference,
  });

  // Read back by the invoice's *current* number: settling a `due` record
  // renumbers it out of the `CVX-` series into `INV-`, so `number` as it
  // arrived may no longer resolve.
  return getInvoice(invoice.number);
}

/**
 * Record a gratuity on an invoice.
 *
 * Separate from `recordPayment` because a tip is separate money: it does not
 * reduce what is owed and it is not part of what the work cost. See
 * `invoicePaymentService.recordTip` for why both of those matter.
 *
 * `0` clears a tip recorded by mistake, which is why the amount is allowed to
 * be zero here when a payment's may not.
 */
async function recordTip(number, { amountDollars, at } = {}) {
  const invoice = await db().Invoice.findOne({ number });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  const amount = Math.round(Number(amountDollars ?? 0) * 100);
  if (!Number.isFinite(amount) || amount < 0) {
    throw ApiError.badRequest('Enter a tip amount.', 'INVALID_AMOUNT');
  }

  await invoicePaymentService.recordTip(invoice, {
    amount,
    at: at ? new Date(`${at}T12:00:00`) : undefined,
  });

  return getInvoice(invoice.number);
}

/**
 * Void an invoice.
 *
 * Voiding is modelled as full forgiveness rather than a delete: the row stays,
 * the balance goes to zero, and the reason is recorded as a payment of type
 * `void`. An invoice that vanishes takes its own audit trail with it.
 */
async function voidInvoice(number, { reason } = {}) {
  const invoice = await db().Invoice.findOne({ number });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');
  if (invoice.status === 'paid' && invoice.amountPaid >= invoice.amount) {
    throw ApiError.badRequest('This invoice is already settled.', 'ALREADY_SETTLED');
  }

  const outstanding = invoice.amount - invoice.amountPaid;
  if (outstanding > 0) {
    // `settle: false` - a void is forgiveness, not money. It must not promote
    // the record to an invoice (nothing was invoiced) and must not earn
    // commission, which is why this does not go through `recordPayment`.
    await invoicePaymentService.applyPayment(invoice, {
      amount: outstanding,
      method: 'void',
      reference: reason || 'Voided by an administrator',
      settle: false,
    });

    // The debt is forgiven, so it stops counting against the line of credit
    // the same release a payment produces, for the opposite reason. Without
    // this a voided invoice would hold the account at its limit for money
    // nobody will ever collect.
    if (invoice.terms && invoice.terms !== 'prepaid') {
      await creditService.syncBalance(invoice.user);
    }
  } else {
    recomputeInvoice(invoice);
    await invoice.save();
  }

  // Voiding forgives the balance, so any commission this invoice earned is
  // commission on money that never arrived. Every accrual against it is
  // reversed - commission on money that came back is money leaking out
  // (§6.13). Idempotent, so voiding twice does not claw back twice.
  await referralService.reverseForInvoice(invoice.number);

  return getInvoice(number);
}

/**
 * Email an invoice to the account it belongs to.
 *
 * The **same HTML the document route renders**, not a second template: an
 * invoice that reads differently in the inbox from the one on screen is two
 * documents claiming to be one, and the discrepancy only ever surfaces in a
 * dispute.
 *
 * Nothing is retried and nothing is queued. `sendMail` reports whether the
 * transport actually accepted the message, and that answer is returned
 * verbatim so the UI can say "not sent" rather than showing a confirmation
 * for something that did not happen (§6b rule 4).
 */
/**
 * Reversing one recorded payment on an invoice.
 *
 * Thin: every rule lives in `invoicePaymentService.reversePayment`, which is
 * also where the original payment was applied - the undo and the do belong
 * together or they drift apart.
 */
async function reverseInvoicePayment(number, index, { reason } = {}) {
  const invoice = await db().Invoice.findOne({ number });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  await invoicePaymentService.reversePayment(invoice, Number(index), { reason });
  return getInvoice(invoice.number);
}
async function emailInvoice(number) {
  const invoice = await db().Invoice.findOne({ number }).populate('user').lean();
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  const to = invoice.user?.email;
  if (!to) {
    throw ApiError.badRequest(
      'This invoice has no account email to send to.',
      'NO_RECIPIENT',
    );
  }

  // Through `invoiceDocument`, not `renderInvoiceHtml` directly: it is the one
  // place that assembles the invoice, its order and the account for the
  // renderer, and going around it is how the emailed copy starts to differ
  // from the printed one.
  const html = await invoiceDocument(number);

  /**
   * The shop that raised it, not the house brand.
   *
   * `BUSINESS_INFO.name` is "Cellvix", so a CellShoppe customer was receiving
   * "Invoice INV-… from Cellvix" - a company they have never dealt with, about a
   * repair they had done somewhere else. The document body was fixed for this
   * months ago; the subject line was missed, and it is the half that shows in
   * the inbox before anything is opened.
   */
  const { shop } = await resolveInvoiceBrand(invoice.business);
  const from = shop?.name || BUSINESS_INFO.name;

  const result = await sendMail({
    to,
    subject: `Invoice ${invoice.number} from ${from}`,
    html,
    text: `Invoice ${invoice.number} - ${(invoice.amount / 100).toFixed(2)} CAD. Open the attached invoice for the full breakdown.`,
  });

  return { delivered: result?.delivered !== false, to };
}

/**
 * Nudge a customer about an invoice they have not settled.
 *
 * **Not `emailInvoice` again.** That sends the document, which is the right
 * thing when an invoice is first raised and the wrong thing as a chase: a
 * customer who has already been sent the paperwork does not need a second copy,
 * they need to be told what is outstanding and by when. So this is a short
 * message about the BALANCE, with a link to the invoice rather than the invoice
 * itself.
 *
 * **Refused on a settled invoice**, rather than sent politely. Asking somebody
 * for money they have already paid is the single worst thing this can do, and a
 * staff member working down a list will click it on the wrong row eventually.
 *
 * Manual, unlike `invoiceStatusService`, which fires the timed reminders on its
 * own schedule. This is somebody deciding to chase one account today.
 */
async function remindInvoice(number, { note } = {}) {
  const invoice = await db().Invoice.findOne({ number }).populate('user').lean();
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  const to = invoice.user?.email;
  if (!to) {
    throw ApiError.badRequest('This invoice has no account email to send to.', 'NO_RECIPIENT');
  }

  const balance = invoice.amount - (invoice.amountPaid ?? 0);
  if (balance <= 0) {
    throw ApiError.badRequest(
      'This invoice is settled, so there is nothing to remind anybody about.',
      'NOTHING_OUTSTANDING',
    );
  }

  const { shop } = await resolveInvoiceBrand(invoice.business);
  const from = shop?.name || BUSINESS_INFO.name;
  // The dollar sign is part of the figure, not decoration: "has 240.00
  // outstanding" is a number with no unit on it, in a message about money.
  const owed = `$${(balance / 100).toFixed(2)} CAD`;
  const due = invoice.dueDate ? formatDate(invoice.dueDate) : null;
  const overdue = Boolean(invoice.dueDate && new Date(invoice.dueDate) < new Date());

  const lines = [
    invoice.user?.contactName ? `Hi ${invoice.user.contactName.split(' ')[0]},` : 'Hello,',
    '',
    overdue
      ? `Invoice ${invoice.number} has ${owed} outstanding and was due on ${due}.`
      : `Invoice ${invoice.number} has ${owed} outstanding${due ? `, due on ${due}` : ''}.`,
  ];
  if (note) lines.push('', note);
  lines.push('', `Thank you,`, from);

  const text = lines.join('\n');
  const result = await sendMail({
    to,
    subject: overdue
      ? `Overdue: invoice ${invoice.number} (${owed})`
      : `Reminder: invoice ${invoice.number} (${owed})`,
    html: `<p>${lines.join('<br />')}</p>`,
    text,
  });

  return { delivered: result?.delivered !== false, to, balance, overdue };
}

/**
 * Correcting an invoice.
 *
 * **Only the fields that are a clerical detail** - the due date, the PO
 * reference and the note. The amount is deliberately not editable: it is
 * derived from the order or the lines the invoice was raised against, and a
 * total somebody can retype is a total that no longer agrees with anything.
 * Changing what was billed means voiding this invoice and raising another,
 * which leaves both documents in the record where an audit can see them.
 */
async function updateInvoice(number, data) {
  const invoice = await db().Invoice.findOne({ number });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  if (data.dueDate !== undefined) invoice.dueDate = new Date(`${data.dueDate}T00:00:00`);
  if (data.poNumber !== undefined) invoice.poNumber = data.poNumber || undefined;
  if (data.note !== undefined) invoice.note = data.note || undefined;

  // The due date decides whether a row is overdue, so the status is recomputed
  // rather than left saying what it said before the date moved.
  recomputeInvoice(invoice);
  await invoice.save();

  return getInvoice(number);
}

/**
 * Deleting an invoice.
 *
 * **Refused once money has touched it.** A paid invoice is the document the
 * business is accountable for and a receipt the customer holds; deleting it
 * would erase their proof and silently reduce revenue. That case is a **void**,
 * which leaves the record in place and says what happened to it.
 *
 * So this is only for an invoice raised in error and never paid - and it still
 * releases the line of credit it reserved, because the debt goes with it.
 */
async function deleteInvoice(number) {
  const invoice = await db().Invoice.findOne({ number });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  if ((invoice.amountPaid ?? 0) > 0) {
    throw ApiError.badRequest(
      'This invoice has payments against it. Void it instead - deleting would erase the customer’s receipt.',
      'INVOICE_HAS_PAYMENTS',
    );
  }

  const outstanding = invoice.amount - (invoice.amountPaid ?? 0);
  // The debt goes with the invoice, so the headroom it reserved comes back.
  // Synced *after* the delete, so the sum no longer counts this row.
  const releasesCredit = outstanding > 0 && invoice.terms && invoice.terms !== 'prepaid';
  const owner = invoice.user;

  // Commission accrued against an invoice that no longer exists is commission
  // on nothing, so it is reversed exactly as a void does.
  await referralService.reverseForInvoice(invoice.number);
  await invoice.deleteOne();

  if (releasesCredit) await creditService.syncBalance(owner);

  return { number };
}

/**
 * Every activity touching one account, newest first - the Activity tab on the
 * client profile.
 *
 * Assembled from what already exists rather than from an audit log: `AuditLog`
 * arrives in phase 11, and until it does, orders, invoices, payments and credit
 * movements are the record.
 */
async function userActivity(id) {
  const user = await db().User.findById(id).select('_id').lean();
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  // The feed itself lives in `activityService`, because the buyer's own
  // overview shows the same history and two assemblies of it would eventually
  // disagree about the same account.
  return activityFeed(id);
}

/**
 * Advance several orders at once.
 *
 * **Every rule the single-order route enforces still applies**, and it applies
 * here rather than being waved through because the request was plural: no
 * backwards moves, nothing out of a delivered order, and no marking an order
 * shipped without a tracking number.
 *
 * A batch is **partial by design**. One order that cannot make the move must
 * not fail the other forty, so each is attempted independently and the response
 * names what moved and what did not, with a reason per skip. The UI shows that
 * list - silently moving nineteen of twenty is how a staff member comes to trust a
 * button that is lying to them.
 *
 * Bulk deliberately offers **no tracking field**: one tracking number across
 * many parcels is wrong, so bulk-to-shipped skips anything without one already
 * and says so.
 */
async function bulkUpdateOrderStatus({ orderNumbers, status, note }) {
  const orders = await db().Order.find({ orderNumber: { $in: orderNumbers } });
  const byNumber = new Map(orders.map((order) => [order.orderNumber, order]));

  const updated = [];
  const skipped = [];

  for (const orderNumber of orderNumbers) {
    const order = byNumber.get(orderNumber);

    if (!order) {
      skipped.push({ orderNumber, reason: 'Not found.' });
      continue;
    }
    if (order.status === status) {
      skipped.push({ orderNumber, reason: `Already ${status.replace(/_/g, ' ')}.` });
      continue;
    }
    if (order.status === 'delivered') {
      skipped.push({ orderNumber, reason: 'Delivered orders cannot be moved.' });
      continue;
    }
    if (order.status === 'cancelled') {
      skipped.push({ orderNumber, reason: 'Cancelled orders cannot be moved.' });
      continue;
    }

    const currentIndex = ORDER_STATUS_FLOW.indexOf(order.status);
    const nextIndex = ORDER_STATUS_FLOW.indexOf(status);
    if (nextIndex !== -1 && currentIndex !== -1 && nextIndex < currentIndex) {
      skipped.push({ orderNumber, reason: 'Status only moves forward.' });
      continue;
    }

    if (status === 'shipped' && !order.tracking?.number) {
      skipped.push({ orderNumber, reason: 'Needs a tracking number - ship it individually.' });
      continue;
    }

    order.status = status;
    order.timeline.push({ status, at: new Date(), note: note || defaultNote(status) });
    await order.save();
    updated.push(order.orderNumber);
  }

  return { updated, skipped };
}

/**
 * The invoice document, for an admin.
 *
 * The buyer-facing route scopes its lookup to `user: req.user._id`, which is
 * correct there and means an admin gets a 404 on somebody else's invoice. This
 * renders **the same artefact through the same renderer** - a second rendering
 * would be free to drift from what the customer actually received, and then the
 * two would disagree in front of a customer.
 */
/**
 * The account statement: every invoice and payment on one account, in date
 * order, ending in what is owed.
 *
 * Covers everything to date rather than a window. A statement is read to
 * answer "what do I owe", and a rolling window has to explain an opening
 * balance carried in from outside it - which is a second number to reconcile
 * before the first one can be trusted.
 */
async function accountStatement(id, { nonce } = {}) {
  const user = await db().User.findById(id).lean();
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  const invoices = await db().Invoice.find({ user: id })
    .sort({ issuedAt: 1 })
    .populate('order', 'orderNumber')
    .lean();

  return renderStatementHtml({
    user,
    invoices: invoices.map((invoice) => ({
      ...invoice,
      orderNumber: invoice.order?.orderNumber ?? null,
    })),
    nonce,
    // The business the statement is drawn on. A statement carries a tax number
    // and an address, so the wrong one here is a billing defect rather than a
    // branding slip.
    business: await sendingBusiness(),
  });
}
/**
 * A customer paying down their line of credit - cash at the counter, an
 * e-transfer, a cheque in the post.
 *
 * **It settles real invoices, oldest first.** The alternative - decrementing
 * `balance` on its own - would leave the account reading as paid up while every
 * invoice behind it still said unpaid, and the two figures would never agree
 * again. Money arrives against documents, so this walks the outstanding
 * invoices in issue order and applies the payment through the same
 * `recordPayment` the invoice screen uses. The credit release, the status
 * recompute and the commission accrual all follow from that for free.
 *
 * Oldest first because that is how a customer's own statement reads and how
 * ageing is calculated: paying $500 against the oldest debt is what "paying
 * $500 off the account" means to both sides of the counter.
 *
 * **Not `accountService.payOffCredit`.** That is the customer's own path: it
 * clears the whole line through the payment gateway, optionally spending store
 * credit. This is the counter's: an arbitrary amount that has *already* been
 * handed over in cash or by transfer, recorded after the fact. Neither can
 * stand in for the other - one takes money, this one books money that arrived.
 *
 * Overpayment is refused rather than parked. Money beyond what is owed is a
 * store-credit allocation - a different instrument with its own ledger - and
 * quietly turning one into the other is how the two stop reconciling.
 */
async function recordCreditPayment(id, { amountDollars, method, reference } = {}) {
  const user = await db().User.findById(id);
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  const amount = Math.round(Number(amountDollars ?? 0) * 100);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw ApiError.badRequest('Enter an amount to record.', 'INVALID_AMOUNT');
  }

  // Only invoices that still owe something, oldest first.
  const invoices = await db().Invoice.find({ user: id }).sort({ issuedAt: 1 });
  const owing = invoices.filter((invoice) => invoice.amount - (invoice.amountPaid ?? 0) > 0);

  const outstanding = owing.reduce(
    (sum, invoice) => sum + (invoice.amount - (invoice.amountPaid ?? 0)),
    0,
  );

  if (outstanding === 0) {
    throw ApiError.badRequest(
      'This account has no unpaid invoices. Money beyond what is owed is a store-credit allocation.',
      'NOTHING_OUTSTANDING',
    );
  }

  if (amount > outstanding) {
    throw ApiError.badRequest(
      `That is more than the ${(outstanding / 100).toFixed(2)} outstanding across this account's invoices.`,
      'PAYMENT_TOO_LARGE',
    );
  }

  let left = amount;
  const applied = [];

  for (const invoice of owing) {
    if (left <= 0) break;

    const due = invoice.amount - (invoice.amountPaid ?? 0);
    const part = Math.min(due, left);

    await invoicePaymentService.recordPayment(invoice, {
      amount: part,
      method: method || 'cash',
      reference: reference || 'Paid against the line of credit',
    });

    applied.push({ number: invoice.number, amount: part });
    left -= part;
  }

  return { applied, amount, remaining: outstanding - amount };
}

async function invoiceDocument(number, { nonce } = {}) {
  const invoice = await db().Invoice.findOne({ number }).populate('order').lean();
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  const user = await db().User.findById(invoice.user).lean();
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  // The shop this invoice belongs to, so a repair customer is not handed a
  // document in the wholesaler brand - see .
  const brand = await resolveInvoiceBrand(invoice.business);

  return renderInvoiceHtml({
    invoice,
    order: invoice.order,
    user,
    nonce,
    ...brand,
    /**
     * The **same** `origin` the buyer's own copy gets.
     *
     * Without it `renderInvoiceHtml` drops the "Pay now" button, so the
     * document an admin printed or emailed was a different sheet of paper from
     * the one the customer opens from their account - the copy that reached
     * them had no way to pay it. One renderer was always the point; this is the
     * argument that makes both callers produce the same page.
     *
     * `env.publicOrigin` rather than the request host: the API serves this, and
     * the link has to land on the storefront.
     */
    origin: env.publicOrigin,
  });
}

export { stats, listUsers, getUser, userPayments, createUser, updateUser, setContactConsent, setTier, addInternalNote, deleteInternalNote, approveUser, rejectUser, setUserStatus, allocateStoreCredit, storeCreditStatement, refundOrder, setCredit, listProducts, createProduct, updateProduct, deactivateProduct, createOrder, listOrders, getOrder, updateOrderStatus, createInvoice, listInvoices, getInvoice, recordPayment, recordTip, recordCreditPayment, voidInvoice, emailInvoice, remindInvoice, reverseInvoicePayment, updateInvoice, deleteInvoice, userActivity, bulkUpdateOrderStatus, invoiceDocument, accountStatement };
