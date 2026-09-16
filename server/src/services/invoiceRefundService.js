import { db } from '../db/models.js';
import '../models/Invoice.js';
import ApiError from '../utils/ApiError.js';
import invoicePaymentService from './invoicePaymentService.js';
import storeCredit from './storeCreditService.js';
import creditService from './creditService.js';

/**
 * Refunding money off an invoice (Sales § Invoice).
 *
 * ## Why this is not `storeCreditService.refundOrder`
 *
 * That one refunds an **order**, and needs one: it reads `order.total`, caps
 * against `order.refundedTotal` and writes the order's timeline. A repair
 * invoice has no order behind it, so that path cannot express the case at all.
 *
 * ## The two destinations, and why they are not the same operation
 *
 * A refund is money leaving. **Where it goes decides what gets written:**
 *
 *   - **Cash back** (the money actually leaves the business): a negative
 *     payment row on the invoice, and nothing else. The customer is holding the
 *     cash, so there is no balance anywhere to credit.
 *   - **Store credit** (the business keeps the money and owes goods instead): a
 *     negative payment row on the invoice **and** a ledger entry through
 *     `storeCreditService`, which is the only place a store-credit balance may
 *     move.
 *
 * The payment row is common to both because in both cases the invoice was paid
 * and now partly is not: `recompute` reads the rows, so an invoice refunded in
 * full falls back to `unpaid` on its own rather than anybody writing a status.
 *
 * **Store credit is not "instead of" the payment row.** Recording only the
 * ledger entry would leave the invoice still reading fully paid while the
 * customer holds a balance for the same cents, and every revenue figure would
 * count them twice.
 *
 * ## What a refund is not
 *
 * Not a **void**: a void forgives a balance nobody has paid, and zeroes what is
 * owed without money moving. Not a **payment reversal**: that undoes one
 * specific payment row that should never have been recorded, in full, and is
 * about correcting the record rather than returning money. A refund is a real
 * movement of a chosen amount, and all three stay separate.
 */

/**
 * What has already been refunded on this invoice, in cents.
 *
 * **Derived from the rows, never stored.** `Invoice.amountPaid` is recomputed
 * from `payments` for exactly this reason, and a `refundedTotal` field would be
 * a second answer to a question the rows already answer - one that could drift
 * the first time anything wrote a row without updating it.
 *
 * Reversals are excluded: a reversal undoes a payment that should not have been
 * recorded, which is a correction to the record rather than money handed back.
 * Counting it here would make a corrected typo look like a refund the customer
 * received.
 */
function refundedTotalOf(invoice) {
  return (invoice.payments ?? [])
    .filter((payment) => (payment.amount ?? 0) < 0 && payment.method !== 'reversal')
    .reduce((sum, payment) => sum + Math.abs(payment.amount), 0);
}

/**
 * What is left to refund: money the shop actually still holds.
 *
 * **Reversals net out of the received side, not the refunded side.** A payment
 * that was reversed never really arrived - it was recorded in error - so the
 * shop is not holding it and cannot give it back. Summing only the positive
 * rows would leave a reversed $400 payment looking refundable, and refunding it
 * would hand over money that was never taken. Caught by the test rather than by
 * reading the code: the first version did exactly that.
 *
 * Which is also why `refundedTotalOf` excludes reversals - counted on both
 * sides they would cancel and the bug would hide.
 *
 * `amountPaid` is not used here even though `recompute` derives it the same
 * way: it is the net of every row INCLUDING real refunds, so a fully refunded
 * invoice reads 0 and could be refunded again from a fresh payment without this
 * noticing. The two questions are different and only look alike.
 */
function refundableOf(invoice) {
  const rows = invoice.payments ?? [];

  const received = rows
    .filter((payment) => (payment.amount ?? 0) > 0)
    .reduce((sum, payment) => sum + payment.amount, 0);

  const reversed = rows
    .filter((payment) => (payment.amount ?? 0) < 0 && payment.method === 'reversal')
    .reduce((sum, payment) => sum + Math.abs(payment.amount), 0);

  return Math.max(0, received - reversed - refundedTotalOf(invoice));
}

/**
 * Refund part or all of what was paid on an invoice.
 *
 * @param {string} number  the invoice number
 * @param {object} body
 * @param {number} body.amountCents    integer cents, positive
 * @param {boolean} body.toStoreCredit true keeps the money and credits the
 *   account; false hands it back
 * @param {string} [body.method]       how it went back, for a cash refund
 * @param {string} [body.reason]       why, shown on the record
 * @param {string} actorId
 */
async function refundInvoice(number, body = {}, actorId) {
  const invoice = await db().Invoice.findOne({ number });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  const amount = Number(body.amountCents);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw ApiError.badRequest('Enter an amount to refund.', 'REFUND_AMOUNT_REQUIRED');
  }

  /**
   * Capped at what was actually RECEIVED, not at the invoice total.
   *
   * An invoice for $400 with $100 paid can only give $100 back; refunding the
   * other $300 would hand over money that never arrived, and the ledger would
   * balance because both sides of it are wrong.
   */
  const refundable = refundableOf(invoice);
  if (refundable <= 0) {
    throw ApiError.badRequest(
      'There is nothing to refund on this invoice - no payment has been received, or it has all gone back already.',
      'NOTHING_TO_REFUND',
    );
  }
  if (amount > refundable) {
    throw ApiError.badRequest(
      `That is more than is left to refund. At most $${(refundable / 100).toFixed(2)} can go back.`,
      'REFUND_TOO_LARGE',
    );
  }

  const toStoreCredit = body.toStoreCredit === true;
  const reason = String(body.reason ?? '').trim();

  /**
   * The store-credit ledger entry goes FIRST, and deliberately.
   *
   * It is the half that can legitimately fail - the account may have been
   * deleted - and `post()` throws when it does. Writing the invoice row first
   * would leave an invoice showing a refund the customer never received, which
   * is the worse of the two half-states: the shop believes it has settled up
   * and the customer is still owed.
   *
   * Cash back has no such half: the row is the whole record.
   */
  let credit = null;
  if (toStoreCredit) {
    credit = await storeCredit.refundInvoice({
      userId: invoice.user,
      amount,
      invoiceId: invoice._id,
      invoiceNumber: invoice.number,
      note: reason ? `Refund for ${invoice.number} - ${reason}` : null,
      adminId: actorId,
    });
  }

  /**
   * The negative payment row.
   *
   * `method` records where the money went, and `store-credit` is a real answer
   * to that: somebody reading the invoice a year later needs to know the cash
   * never left the building.
   */
  invoice.payments.push({
    amount: -amount,
    at: new Date(),
    method: toStoreCredit ? 'store-credit' : body.method || 'refund',
    reference: reason || `Refund of $${(amount / 100).toFixed(2)}`,
  });

  invoicePaymentService.recompute(invoice);
  await invoice.save();

  /**
   * The debt is owed again, on an invoice sold on terms.
   *
   * Re-derived from the invoices rather than nudged by this amount, the same way
   * `reversePayment` does it: the row is already on the invoice, so the sum
   * reflects it without this function having to know which direction to move.
   */
  if (invoice.terms && invoice.terms !== 'prepaid') {
    await creditService.syncBalance(invoice.user);
  }

  /**
   * Commission booked on money that has now gone back.
   *
   * Only on a **full** refund, which is the rule `refundOrder` already sets and
   * the reasoning is its: clawing back a fraction of a fraction leaves rounding
   * that never nets to zero across several partials, and a referrer ends up
   * owing a cent nobody can explain.
   */
  // Nothing left to give back means all of it has gone back. Read off the rows
  // AFTER the save, so it accounts for this refund and every earlier one.
  if (refundableOf(invoice) === 0) {
    // Lazy: `referralService` imports `storeCreditService`, which this imports,
    // and a static import here would close the cycle. The same reason
    // `refundOrder` defers its own.
    const { reverseForInvoice } = await import('./referralService.js');
    await reverseForInvoice(invoice.number);
  }

  return {
    number: invoice.number,
    refunded: amount,
    toStoreCredit,
    // What is left, so the screen can disable the action without a refetch.
    refundable: refundableOf(invoice),
    status: invoice.status,
    amountPaid: invoice.amountPaid,
    balance: invoice.amount - invoice.amountPaid,
    storeCreditBalance: credit?.balance ?? null,
  };
}

export { refundInvoice, refundableOf, refundedTotalOf };
export default { refundInvoice, refundableOf, refundedTotalOf };
