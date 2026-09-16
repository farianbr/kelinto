import { db } from '../db/models.js';
import '../models/CreditTransaction.js';
import '../models/User.js';
import '../models/Order.js';
import ApiError from '../utils/ApiError.js';
import payment from './payment.js';
import '../models/Invoice.js';
import { nextInvoiceNumber } from './orderBuilder.js';

/**
 * Store credit - the only place a store-credit balance moves.
 *
 * The rule this file exists to enforce: a balance is never written by hand.
 * Every change is `post()`, which increments the cached balance on the user and
 * writes the ledger row that explains it, in that order, so a row can never
 * exist without the money having moved and the balance can always be re-derived
 * from the rows.
 *
 * See `models/CreditTransaction.js` for why this is separate from the line of
 * credit.
 */

/**
 * Applies a signed movement.
 *
 * The `$inc` is conditional for spends: the filter carries `storeCredit >= |amount|`,
 * so two concurrent redemptions cannot both pass a read-then-write check and
 * overdraw the balance. A failed match means someone else got there first.
 */
async function post({
  userId,
  amount,
  type,
  note,
  order,
  orderNumber,
  invoice,
  invoiceNumber,
  createdBy,
  paymentRef,
  referral,
}) {
  if (!Number.isInteger(amount) || amount === 0) {
    throw ApiError.badRequest('A credit movement must be a non-zero whole number of cents.');
  }

  const filter = { _id: userId };
  if (amount < 0) filter.storeCredit = { $gte: -amount };

  const updated = await db().User.findOneAndUpdate(
    filter,
    { $inc: { storeCredit: amount } },
    { new: true },
  );

  if (!updated) {
    // Either the account is gone or the spend would overdraw it.
    const exists = await db().User.exists({ _id: userId });
    if (!exists) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');
    throw ApiError.badRequest(
      'That is more store credit than this account holds.',
      'INSUFFICIENT_STORE_CREDIT',
    );
  }

  const entry = await db().CreditTransaction.create({
    user: userId,
    amount,
    balanceAfter: updated.storeCredit,
    type,
    note,
    order,
    orderNumber,
    invoice,
    invoiceNumber,
    createdBy,
    paymentRef,
    referral,
  });

  await issueReceipt(entry);

  return { balance: updated.storeCredit, entry: serialize(entry) };
}

/**
 * Movement types that get a receipt document.
 *
 * The rule is "money entering the account gets a document, money leaving it on
 * an order does not". A `redemption` is already a payment row on that order's
 * own invoice, and an `adjustment` is a correction to a figure - issuing
 * documents for either would have the statement counting the same cents twice.
 *
 * A `referral` accrual is included even though nobody paid Cellvix for it: it
 * is money the business earned, and it needs a document for the same reason a
 * refund does.
 */
const RECEIPTED_TYPES = new Set(['recharge', 'grant', 'refund', 'referral']);

const RECEIPT_LABELS = {
  recharge: 'Account top-up',
  grant: 'Store credit issued by Cellvix',
  refund: 'Refund to store credit',
  referral: 'Referral commission',
};

/**
 * Raises the receipt for a credit movement.
 *
 * Placed inside `post()` rather than in each caller for the same reason the
 * ledger row itself is: this is the choke point every movement passes through,
 * and a rule enforced at the choke point cannot be forgotten by a caller added
 * later.
 *
 * **Best effort, and deliberately so.** The money has already moved and the
 * ledger row already exists by the time this runs. A document that failed to
 * render is a reconciliation problem to investigate; it is never a reason to
 * unwind a balance change that succeeded. Same reasoning `referralService`
 * applies to a commission that could not post, and `mailer` to an order
 * confirmation that could not send.
 *
 * A reversal (negative `referral`) is receipted too, at its absolute value
 * the document says what happened, and "commission reversed" is a thing that
 * happened.
 */
async function issueReceipt(entry) {
  if (!RECEIPTED_TYPES.has(entry.type)) return null;

  try {
    const gross = Math.abs(entry.amount);
    const reversal = entry.amount < 0;
    const label = RECEIPT_LABELS[entry.type] ?? 'Store credit movement';

    /**
     * **The receipt belongs to the customer's business.**
     *
     * It was created with no `business` at all, and an unassigned record is
     * invisible under every business rather than visible under all of them - so
     * the receipt showed on the customer's own profile, which scopes by user,
     * and was missing from the Invoices screen, which scopes by business. One
     * document, two screens, two different answers about whether it exists.
     *
     * Read from the customer rather than from request scope on purpose: this
     * runs inside `post()`, which is reached from a background job and a seed
     * script as well as from a request, and in those there is no scope to read.
     * The customer is the one thing a credit movement always has.
     */
    const owner = await db().User.findById(entry.user).select('business').lean();

    return await db().Invoice.create({
      number: await nextInvoiceNumber('RCT'),
      kind: 'receipt',
      user: entry.user,
      business: owner?.business ?? null,
      creditTransaction: entry._id,
      order: entry.order,
      amount: gross,
      // A receipt records money that has already moved, so it is settled on
      // the instant it exists. There is never a balance to chase.
      amountPaid: gross,
      status: 'paid',
      // No tax line: a top-up, a refund and a commission accrual are movements
      // of money, not supplies of goods, and GST/HST does not arise on them.
      // `terms: 'prepaid'` keeps it out of every line-of-credit calculation.
      terms: 'prepaid',
      issuedAt: entry.createdAt ?? new Date(),
      settledAt: entry.createdAt ?? new Date(),
      reference: reversal ? `${label} reversed` : label,
      notes: entry.note || undefined,
      payments: [
        {
          amount: gross,
          at: entry.createdAt ?? new Date(),
          method: 'store-credit',
          reference: entry.paymentRef || entry._id.toString(),
        },
      ],
    });
  } catch (error) {
    console.error(`  Store credit: receipt for movement ${entry?._id} failed - ${error.message}`);
    return null;
  }
}

function serialize(entry) {
  const doc = entry.toObject ? entry.toObject() : entry;
  return {
    id: doc._id.toString(),
    amount: doc.amount,
    balanceAfter: doc.balanceAfter,
    type: doc.type,
    note: doc.note ?? '',
    orderNumber: doc.orderNumber ?? null,
    invoiceNumber: doc.invoiceNumber ?? null,
    createdAt: doc.createdAt,
  };
}

async function balanceOf(userId) {
  const user = await db().User.findById(userId).select('storeCredit').lean();
  if (!user) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');
  return user.storeCredit ?? 0;
}

/** The statement: balance plus the movements that produced it, newest first. */
async function statement(userId, { limit = 50 } = {}) {
  const [balance, entries] = await Promise.all([
    balanceOf(userId),
    db().CreditTransaction.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);

  const added = entries.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const spent = entries.filter((row) => row.amount < 0).reduce((sum, row) => sum - row.amount, 0);

  return { balance, added, spent, transactions: entries.map(serialize) };
}

/**
 * Admin allocation. A negative amount is a correction, not a purchase - it is
 * the only way credit leaves an account without an order behind it, so it is
 * typed `adjustment` rather than `redemption` and reads that way on the
 * statement.
 */
async function allocate(userId, { amount, note }, adminId) {
  return post({
    userId,
    amount,
    type: amount > 0 ? 'grant' : 'adjustment',
    note: note || (amount > 0 ? 'Credit added by Cellvix' : 'Adjustment by Cellvix'),
    createdBy: adminId,
  });
}

/**
 * Referral commission, in or out (ERP rework §6.13).
 *
 * This exists so referrals are **not an exception** to the rule this file
 * enforces: a balance is never written by hand, and every movement is a ledger
 * row that explains itself. `referralService` decides *whether* and *how much*;
 * this decides nothing and simply moves the money, the same as every other
 * function here.
 *
 * A negative `amount` is a reversal - the referred payment was refunded or its
 * invoice voided - and carries `referral.reverses` pointing at the accrual it
 * undoes.
 *
 * Note it deliberately does **not** guard the balance the way a spend does. A
 * reversal has to succeed even when the referrer has already spent the credit:
 * refusing it would leave commission standing on money that came back, which is
 * exactly the leak the reversal exists to close. The balance is allowed to go
 * to zero and the ledger stays truthful about why.
 */
async function creditReferral({ referrerId, amount, note, referral }) {
  if (amount < 0) {
    // Spend-style guards would block a reversal against an already-spent
    // balance, so this goes through the ledger without the `$gte` filter that
    // `post` applies to negative amounts.
    const updated = await db().User.findOneAndUpdate(
      { _id: referrerId },
      { $inc: { storeCredit: amount } },
      { new: true },
    );
    if (!updated) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

    // `storeCredit` has `min: 0` on the schema, which findOneAndUpdate does not
    // enforce. Clamp explicitly so a reversal larger than the remaining balance
    // lands on zero rather than a negative number no screen is designed to show.
    if (updated.storeCredit < 0) {
      updated.storeCredit = 0;
      await updated.save();
    }

    const entry = await db().CreditTransaction.create({
      user: referrerId,
      amount,
      balanceAfter: updated.storeCredit,
      type: 'referral',
      note,
      referral,
    });

    // This branch writes the ledger itself rather than going through `post()`,
    // so it has to raise the receipt itself too - the document belongs to the
    // movement, not to the path that made it.
    await issueReceipt(entry);

    return { balance: updated.storeCredit, entry: serialize(entry) };
  }

  return post({ userId: referrerId, amount, type: 'referral', note, referral });
}

/**
 * Advance recharge: the buyer prepays and holds the money as store credit.
 *
 * The charge goes through the same mock gateway an order does, so a declined
 * top-up behaves like a declined checkout and nothing is credited.
 */
async function recharge(user, { amount, poNumber }) {
  const result = await payment.charge({
    amount,
    method: 'card',
    orderNumber: `TOPUP-${user._id.toString().slice(-6)}`,
    poNumber,
  });

  return post({
    userId: user._id,
    amount,
    type: 'recharge',
    note: 'Account top-up',
    paymentRef: result.reference,
  });
}

/**
 * Refunds an order to store credit.
 *
 * Refunding to the original payment method needs a real gateway; refunding to
 * store credit needs nothing but this ledger, keeps the money with Cellvix, and
 * is what a wholesale account wants anyway - the next order is usually days away.
 * Partial refunds are allowed up to what is left unrefunded on the order.
 */
async function refundOrder(orderNumber, { amount, note }, adminId) {
  const order = await db().Order.findOne({ orderNumber });
  if (!order) throw ApiError.notFound('Order not found.', 'ORDER_NOT_FOUND');

  const alreadyRefunded = order.refundedTotal ?? 0;
  const refundable = order.total - alreadyRefunded;

  if (refundable <= 0) {
    throw ApiError.badRequest('This order has already been refunded in full.', 'ALREADY_REFUNDED');
  }
  if (amount > refundable) {
    throw ApiError.badRequest(
      'That is more than is left to refund on this order.',
      'REFUND_TOO_LARGE',
    );
  }

  const posted = await post({
    userId: order.user,
    amount,
    type: 'refund',
    note: note || `Refund for ${order.orderNumber}`,
    order: order._id,
    orderNumber: order.orderNumber,
    createdBy: adminId,
  });

  order.refundedTotal = alreadyRefunded + amount;
  order.timeline.push({
    status: order.status,
    at: new Date(),
    note: `Refunded to store credit${note ? ` - ${note}` : ''}.`,
  });
  await order.save();

  // Referral commission follows the money back (§6.13). Placed here rather than
  // in each caller because both the admin refund route and an RMA resolution
  // arrive through this function - a rule enforced at the choke point cannot be
  // forgotten by a third caller added later.
  //
  // Only a refund in FULL reverses the commission. A partial refund is left
  // alone deliberately: clawing back a fraction of a fraction produces rounding
  // that never quite nets to zero across several partials, and the referrer
  // ends up owing a cent nobody can explain. Full refund is the case that
  // matters, and it is exact.
  //
  // Imported lazily: `referralService` imports this module, and a static import
  // here would close the cycle.
  if (order.refundedTotal >= order.total) {
    const { reverseForOrder } = await import('./referralService.js');
    await reverseForOrder(order._id);
  }

  return { ...posted, refundedTotal: order.refundedTotal, orderTotal: order.total };
}

/**
 * Credits a refund against an INVOICE rather than an order.
 *
 * **A named operation, because `post` stays private.** Every movement in this
 * ledger goes through a function that says what the movement IS - allocate,
 * recharge, refund, redeem - so that the set of reasons a balance can change is
 * a list somebody can read, rather than whatever callers happened to pass. An
 * exported `post` would make that list open-ended.
 *
 * This does **not** touch the invoice: `invoiceRefundService` owns the negative
 * payment row and calls this for the ledger half. Splitting it that way keeps
 * the rule intact that this file is the only place a store-credit balance moves,
 * without this file also deciding what a refund does to an invoice.
 *
 * Commission is NOT reversed here, for the same reason: whether this refund was
 * the one that emptied the invoice is a fact about the invoice, which the caller
 * has and this does not.
 */
async function refundInvoice({ userId, amount, invoiceId, invoiceNumber, note, adminId }) {
  return post({
    userId,
    amount,
    type: 'refund',
    // Written for the customer reading their own statement, not for us.
    note: note || `Refund for ${invoiceNumber}`,
    invoice: invoiceId,
    invoiceNumber,
    createdBy: adminId,
  });
}
/**
 * Spends credit against an order being placed.
 *
 * The caller passes the order total; how much credit is applied is decided here
 * and never by the client (PROJECT_INSTRUCTIONS.md §5.3 - the client never sends
 * a price or a discount).
 */
async function redeemForOrder({ userId, total, orderId, orderNumber }) {
  const balance = await balanceOf(userId);
  const applied = Math.min(balance, total);
  if (applied <= 0) return { applied: 0, balance };

  const { balance: after } = await post({
    userId,
    amount: -applied,
    type: 'redemption',
    note: `Applied to ${orderNumber}`,
    order: orderId,
    orderNumber,
  });

  return { applied, balance: after };
}

/** What an order could draw before it is placed - drives the checkout preview. */
async function previewForTotal(userId, total) {
  const balance = await balanceOf(userId);
  return { balance, applicable: Math.max(0, Math.min(balance, total)) };
}

export default {
  allocate,
  balanceOf,
  creditReferral,
  previewForTotal,
  recharge,
  redeemForOrder,
  refundOrder,
  refundInvoice,
  statement,
};

export { serialize, balanceOf, statement, allocate, creditReferral, recharge, refundOrder, refundInvoice, redeemForOrder, previewForTotal };
