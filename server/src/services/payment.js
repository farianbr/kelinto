import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';

/**
 * Payment gateway - MOCK.
 *
 * The client chose a mock at kickoff (PROJECT_INSTRUCTIONS.md §0), and the
 * default is still "every charge succeeds". Nothing anywhere else in the
 * codebase knows that: controllers call `charge()` and read
 * `{ status, reference }`, so swapping in Stripe, Moneris or anything else is a
 * change to this file alone.
 *
 * DECLINES ARE OPT-IN. A payment-failure page that cannot be reached is a page
 * nobody can review, so there are two deliberate ways to make this decline:
 *
 *   - `MOCK_PAYMENT_DECLINE=true` in the environment - declines everything,
 *     which is what the smoke test and the screenshot runner use;
 *   - a DELIVERY NOTE starting with `DECLINE` - one order at a time, no
 *     restart, which is how the failure page is demonstrated to the client.
 *     This used to ride on the PO number, but a PO is supplier paperwork and
 *     the customer checkout no longer collects one. Delivery notes are the
 *     remaining free-text field on that form, so the trigger moved there.
 *     `poNumber` is still honoured for the admin and quick-order paths that
 *     legitimately carry one.
 *
 * Neither is reachable by accident on a normal order, so the locked "mock always
 * succeeds" decision still holds for every buyer who is not asking for a decline.
 *
 * When a real gateway swaps in:
 *   - keep the `{ status, reference, processedAt }` shape;
 *   - keep throwing `PAYMENT_DECLINED` on a decline - the checkout page routes
 *     on that code, not on the message;
 *   - move the secret key into config/env.js so it is validated at boot.
 */

const DECLINE_PREFIX = 'DECLINE';

const DECLINE_REASONS = {
  forced: 'The payment was declined by the card issuer. No charge was made.',
  marker: 'Test decline: this order carried a DECLINE marker. No charge was made.',
};

function startsWithMarker(value) {
  return String(value ?? '').trim().toUpperCase().startsWith(DECLINE_PREFIX);
}

function declineReason({ poNumber, deliveryNotes }) {
  if (env.MOCK_PAYMENT_DECLINE) return 'forced';
  // Either field - the customer checkout sends a delivery note, the admin and
  // quick-order paths still send a PO number.
  if (startsWithMarker(deliveryNotes) || startsWithMarker(poNumber)) return 'marker';
  return null;
}

/**
 * @param {object} params
 * @param {number} params.amount   total in integer cents
 * @param {'card'|'terms'} params.method
 * @param {string} params.orderNumber
 * @param {string} [params.poNumber]
 * @param {string} [params.deliveryNotes]
 * @returns {Promise<{ status: 'paid'|'pending', reference: string, processedAt: Date }>}
 * @throws {ApiError} 402 PAYMENT_DECLINED
 */
async function charge({ amount, method, orderNumber, poNumber, deliveryNotes }) {
  // A little latency so the checkout's loading state is exercised in dev.
  await new Promise((resolve) => setTimeout(resolve, 350));

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Refusing to charge a non-positive amount: ${amount}`);
  }

  const reason = declineReason({ poNumber, deliveryNotes });
  if (reason) throw ApiError.paymentDeclined(DECLINE_REASONS[reason]);

  return {
    // Buying on terms does not move money now - the invoice does that later.
    // Nor does an order paid at the counter: a person takes that money in the
    // shop, and it is recorded against the invoice when they do.
    status: method === 'terms' || method === 'counter' ? 'pending' : 'paid',
    reference: `mock_${method}_${orderNumber}_${Date.now().toString(36)}`,
    processedAt: new Date(),
  };
}

export default { charge };

export { charge };
