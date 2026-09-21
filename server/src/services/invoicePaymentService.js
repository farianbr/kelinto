import { db } from '../db/models.js';
import '../models/Invoice.js';
import '../models/User.js';
import ApiError from '../utils/ApiError.js';
import { sendPaymentReceiptEmail } from './transactionalMail.js';
import orderBuilder from './orderBuilder.js';
import creditService from './creditService.js';
import '../models/CreditTransaction.js';
import * as referralService from './referralService.js';

/**
 * Invoice payment - the only place a payment is recorded against an invoice.
 *
 * It exists for the same reason `storeCreditService` and `pricingService` do:
 * three things must happen together every time money lands on an invoice, and
 * a second place that records a payment is a second place to forget one of
 * them.
 *
 *   1. the payment row is written and the header recomputed from the rows;
 *   2. the **line of credit is repaid** - an amount owed on terms that is paid
 *      has to come off `db().User.balance`, or the account stays at its limit
 *      forever;
 *   3. a `due` record that reaches zero **becomes an invoice** - renumbered out
 *      of the `CVX-` series into `INV-`.
 *
 * Step 2 did not exist anywhere before this file. `orderService` and
 * `adminService.createInvoice` both `$inc` the balance upward when an order or
 * a charge goes on terms, and nothing ever brought it back down: repayment was
 * only ever *displayed*, reconstructed from payment rows by
 * `accountService.lineOfCreditActivity`. A buyer who paid every invoice still
 * showed a full balance and no remaining credit.
 *
 * Admin payments (`adminService.recordPayment`), customer payments
 * (`accountService.payInvoice` / `payOffCredit`) and voids all come through
 * here, so none of the three can drift apart from the others.
 */

/**
 * Recompute an invoice's paid total and status **from its own payments**.
 *
 * Never trust an incoming `amountPaid`: the sum of the rows is the truth, and
 * recomputing it here means a corrected or removed payment cannot leave the
 * header disagreeing with the rows beneath it.
 *
 * Lives here rather than in `adminService` (where it was written) because the
 * customer payment path needs exactly the same arithmetic, and two copies of
 * "what does paid mean" is how an invoice ends up `partial` on one screen and
 * `paid` on another.
 */
function recompute(invoice) {
  const paid = (invoice.payments ?? []).reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
  invoice.amountPaid = paid;

  if (paid <= 0) invoice.status = 'unpaid';
  else if (paid >= invoice.amount) invoice.status = 'paid';
  else invoice.status = 'partial';

  return invoice;
}

/** What is still owed. Never negative - overpayment is refused before it lands. */
function outstandingOf(invoice) {
  return Math.max(0, invoice.amount - (invoice.amountPaid ?? 0));
}

/**
 * Records one payment against one invoice.
 *
 * `amount` is integer cents and is decided by the caller from the invoice's own
 * balance - never sent by a client (§5.3).
 *
 * `settle: false` is for a void, which zeroes the balance without money having
 * arrived: it must not repay the line of credit (nothing was paid), must not
 * promote the record to an invoice (nothing was invoiced), and must not earn
 * anybody commission. The caller handles the reversal.
 *
 * Returns `{ invoice, promoted, previousNumber }` - `promoted` tells the caller
 * a `due` record just became an invoice, and `previousNumber` is what it was
 * called before, which the referral reversal needs to find accruals booked
 * against the old number.
 */
async function applyPayment(invoice, { amount, method, reference, at, settle = true } = {}) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw ApiError.badRequest('Enter an amount to record.', 'INVALID_AMOUNT');
  }

  const outstanding = outstandingOf(invoice);
  if (amount > outstanding) {
    // Overpayment is a real situation, but it belongs in store credit rather
    // than an invoice that claims to be more than paid. Refuse and say so.
    throw ApiError.badRequest(
      `That is more than the ${(outstanding / 100).toFixed(2)} outstanding on this invoice.`,
      'PAYMENT_TOO_LARGE',
    );
  }

  invoice.payments.push({
    amount,
    at: at ?? new Date(),
    method: method || undefined,
    reference: reference || undefined,
  });

  recompute(invoice);

  // ---- repay the line of credit ------------------------------------------
  // Only money actually paid repays it, and only on an account that drew on it
  // in the first place: a prepaid invoice never incremented `balance`, so
  // decrementing it here would push the account into credit it never used.
  //
  // The balance is **re-derived**, not decremented - see `creditService`. A
  // counter nudged from six call sites drifts the moment one of them is missed,
  // and it had: an account owing $2.26 was carrying $2,950.96. Recomputing from
  // the invoices means paying one restores exactly the headroom it took, which
  // is what a line of credit is supposed to do.
  //
  // Deferred until after `invoice.save()` below, because the sum has to include
  // the row this function just pushed.
  const syncCreditAfterSave = settle && invoice.terms && invoice.terms !== 'prepaid';

  // ---- promote a settled `due` record into an invoice ---------------------
  // The renumbering happens on save, but the *old* number is returned so the
  // caller can accrue commission before anything looks the invoice up again.
  const promoted = settle && invoice.kind === 'due' && invoice.status === 'paid';
  const previousNumber = invoice.number;

  if (promoted) {
    invoice.kind = 'invoice';
    invoice.number = await orderBuilder.nextInvoiceNumber('INV');
    invoice.settledAt = new Date();
  }

  await invoice.save();

  // After the save, so the aggregate sees the payment row just written.
  if (syncCreditAfterSave) await creditService.syncBalance(invoice.user);

  return { invoice, promoted, previousNumber };
}

/**
 * Records a payment and books the referral commission it earned.
 *
 * The two are separated above and joined here because the ordering matters and
 * is easy to get wrong: commission is keyed on `(invoiceNumber, paymentIndex)`
 * (`referralService.accrueForPayment`), and a settling payment **renumbers the
 * invoice**. Accruing after the rename would book the commission against a
 * number that no earlier accrual on the same invoice shares, and a later
 * reversal - which searches by number - would find only half of them.
 *
 * So: any accruals already standing against the old number are re-pointed at
 * the new one first, then this payment accrues against the new number. Every
 * accrual for an invoice ends up under one number, whatever order the
 * instalments arrived in.
 */
async function recordPayment(invoice, options) {
  const result = await applyPayment(invoice, options);

  if (result.promoted && result.previousNumber !== invoice.number) {
    // Best-effort, and deliberately so: a commission row that could not be
    // re-pointed is a reconciliation problem, never a reason to reject a
    // payment that genuinely happened.
    try {
      await db().CreditTransaction.updateMany(
        { type: 'referral', 'referral.invoiceNumber': result.previousNumber },
        { $set: { 'referral.invoiceNumber': invoice.number } },
      );
    } catch (error) {
      console.error(
        `  Invoice ${invoice.number}: re-pointing referral rows from ${result.previousNumber} failed - ${error.message}`,
      );
    }
  }

  // Referral commission accrues on payment, never on the order (§6.13) - an
  // unpaid invoice has earned nobody anything. Keyed on this payment's index,
  // so an invoice settled in instalments earns once per instalment and a
  // replayed request cannot pay twice. `accrueForPayment` swallows its own
  // failures.
  await referralService.accrueForPayment(invoice, invoice.payments.length - 1);

  /**
   * The customer's receipt, if this business has that switched on.
   *
   * Sent from the shared write path rather than from each caller, so a payment
   * recorded by an admin, by the buyer through the portal, or by the mock
   * gateway all produce the same receipt - three call sites each remembering
   * to send one is two that eventually will not.
   *
   * Swallowed like the referral accrual above it and for the same reason: the
   * money has moved and the row is written. A mail failure must not turn a
   * completed payment into an error somebody retries.
   */
  try {
    const settings = await db().Settings.load();
    if (settings?.communications?.paymentConfirmation) {
      const user = await db().User.findById(invoice.user).lean();
      const sent = await sendPaymentReceiptEmail({
        user,
        invoice: invoice.toObject ? invoice.toObject() : invoice,
        amount: options.amount,
      });
      if (!sent?.delivered) {
        console.error(`  Receipt for invoice ${invoice.number} not sent - ${sent?.error}`);
      }
    }
  } catch (error) {
    console.error(`  Receipt for invoice ${invoice.number} failed:`, error.message);
  }

  return result;
}

/**
 * Loads a payable record for one buyer, or refuses.
 *
 * Scoped to `user` rather than found by number alone: an invoice number is
 * guessable, and a buyer must never be able to pay - or even read the balance
 * of - somebody else's invoice. A miss is a 404 rather than a 403, so the
 * endpoint does not confirm that a number exists.
 */
async function payableFor(userId, number) {
  const invoice = await db().Invoice.findOne({ number, user: userId });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  if (invoice.kind === 'receipt') {
    throw ApiError.badRequest('A receipt is a record of money already moved.', 'NOT_PAYABLE');
  }
  if (outstandingOf(invoice) <= 0) {
    throw ApiError.badRequest('This invoice is already settled.', 'ALREADY_SETTLED');
  }

  return invoice;
}


/**
 * Reversing a recorded payment.
 *
 * **The row stays.** A payment that is deleted leaves a customer holding a
 * receipt for something the system says never happened, and an audit with a
 * gap where money moved. So a reversal is an entry of its own - the original
 * payment and the fact that it was reversed are both true, and both are on
 * the record.
 *
 * The reversal is stored as a **negative amount** with `method: 'reversal'`,
 * which is what makes `recompute` fall out correctly: the paid total is the sum
 * of the rows, so subtracting is enough and no field has to be corrected by
 * hand. Everything the original payment did is undone in the same order it was
 * done - the credit line is re-drawn, and the commission it earned is reversed.
 */
async function reversePayment(invoice, index, { reason } = {}) {
  const original = invoice.payments?.[index];
  if (!original) {
    throw ApiError.notFound('That payment is not on this invoice.', 'PAYMENT_NOT_FOUND');
  }
  if (original.amount < 0) {
    throw ApiError.badRequest('That entry is already a reversal.', 'ALREADY_REVERSED');
  }
  if (original.reversedAt) {
    throw ApiError.badRequest('That payment has already been reversed.', 'ALREADY_REVERSED');
  }

  // Stamped on the original so the UI can show it struck through without
  // having to pair rows up by amount and guess which reversal belongs to it.
  original.reversedAt = new Date();

  invoice.payments.push({
    amount: -original.amount,
    at: new Date(),
    method: 'reversal',
    reference: reason || `Reversal of ${(original.amount / 100).toFixed(2)}`,
  });

  recompute(invoice);

  await invoice.save();

  // The debt is owed again. Re-derived rather than incremented, for the reason
  // in `creditService`: the reversal row is already on the invoice, so the sum
  // reflects it without this function having to know which direction to nudge.
  if (invoice.terms && invoice.terms !== 'prepaid') {
    await creditService.syncBalance(invoice.user);
  }

  // Commission was booked on money that has now been taken back, so it is
  // reversed too - commission on money that came back is money leaking out.
  await referralService.reverseForInvoice(invoice.number);

  return invoice;
}

/**
 * Record a gratuity against an invoice.
 *
 * **Deliberately not a payment.** `recompute` sums `payments` into `amountPaid`
 * and settles the invoice when that reaches `amount`, so a tip added there would
 * mark a repair paid that is still owed for. It is not added to `amount` either:
 * that figure is what the work cost, it carries tax, and inflating it would tax
 * a gratuity and overstate every revenue report that reads an invoice total as
 * the price of the job.
 *
 * So it sits in its own field, `recompute` is never called, and the balance due
 * is exactly what it was before.
 *
 * **Setting it replaces rather than accumulates.** A tip is one number on one
 * transaction, and a staff member correcting a mistyped figure expects to correct
 * it, not to add to it. `0` clears one recorded in error.
 */
async function recordTip(invoice, { amount, at } = {}) {
  const cents = Math.round(Number(amount ?? 0));
  if (!Number.isFinite(cents) || cents < 0) {
    throw ApiError.badRequest('Enter a tip amount.', 'TIP_INVALID');
  }

  invoice.tipCents = cents;
  // Cleared alongside the amount, so a removed tip leaves no timestamp claiming
  // one was given.
  invoice.tipAt = cents > 0 ? (at ? new Date(at) : new Date()) : null;

  await invoice.save();
  return invoice;
}

export default {
  reversePayment,
  applyPayment,
  outstandingOf,
  payableFor,
  recompute,
  recordPayment,
  recordTip,
};

export {
  applyPayment,
  outstandingOf,
  payableFor,
  recompute,
  recordPayment,
  recordTip,
  reversePayment,
};
