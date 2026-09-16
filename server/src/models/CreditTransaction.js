import mongoose from 'mongoose';

/**
 * The store-credit ledger.
 *
 * Store credit and the line of credit are two different things and are kept
 * apart deliberately:
 *
 *   - the **line of credit** (`User.creditLimit` / `User.balance` / `terms`) is
 *     money Cellvix lends the business - a limit it draws against and pays back
 *     on invoice terms;
 *   - **store credit** (this ledger, mirrored on `User.storeCredit`) is money
 *     the business already holds with Cellvix - a refund, a prepaid top-up, or
 *     an allocation an admin made - which reduces what the next order costs.
 *
 * Every movement is a row here. `User.storeCredit` is a cache of the running
 * total so a balance read is one document rather than an aggregation, and every
 * row carries the `balanceAfter` it produced, so the two can be reconciled and a
 * statement can be printed without re-summing history.
 *
 * Nothing writes this collection directly - `services/storeCreditService.js`
 * owns it, the same way `pricingService` owns discounts.
 */

/**
 * `referral` (ERP rework §6.13) is commission a business earned because an
 * account it referred paid an invoice. It is its own type rather than a
 * `grant`: a grant is somebody at Cellvix deciding to give money away, while
 * this is money owed under a standing arrangement and triggered automatically.
 * The two need to be told apart on a statement and in the reports.
 *
 * A reversal - the referred payment was refunded or its invoice voided - is
 * also typed `referral`, with a negative amount, so a referral and its undo sit
 * on the same line of any report that groups by type.
 */
const CREDIT_TYPES = [
  'refund',
  'recharge',
  'grant',
  'adjustment',
  'redemption',
  'referral',
];

const creditTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Signed integer cents. Positive adds credit, negative spends it.
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },

    type: { type: String, enum: CREDIT_TYPES, required: true, index: true },

    // Free text shown to the buyer on their statement, so it is written for
    // them, not for us: "Refund for CVX-2026-10042", not "adj/ref/42".
    note: { type: String, trim: true, maxlength: 240 },

    // Set when the movement belongs to an order - a refund against it, or credit
    // spent on it.
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    orderNumber: String,

    /**
     * Set when the movement belongs to an INVOICE rather than an order.
     *
     * A repair invoice has no order behind it, so `orderNumber` above cannot
     * describe a refund against one - a statement row reading only "Refund"
     * with nothing to trace it to is the thing this prevents. Both fields
     * exist because an invoice raised from an order can be refunded either
     * way round, and the row should say which document the money came off.
     */
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    invoiceNumber: String,

    // Who made it happen. Absent for buyer-initiated top-ups and redemptions.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Mock gateway reference for a top-up, so a recharge can be traced the same
    // way an order payment can.
    paymentRef: String,

    // ---- referral commission (§6.13) ---------------------------------------
    // Only set on `referral` rows. Together these are what makes an accrual
    // traceable back to the money that produced it, and what lets a reversal
    // find the exact accrual to undo.
    referral: {
      // The account whose payment earned this - the referrer is `user` above.
      from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      fromName: String,
      // The invoice that was paid, and which payment row within it. An invoice
      // can be paid in instalments and each instalment earns separately, so the
      // invoice number alone is not a unique key.
      invoiceNumber: String,
      paymentIndex: Number,
      // The rate in force when this was earned. Snapshotted, never looked up
      // later: §6.13 requires that changing the rate does not silently restate
      // commission already earned, the same way an order line snapshots price.
      percent: Number,
      // The payment amount the commission was calculated from.
      basis: Number,
      // Set on a reversal, pointing at the accrual it undoes.
      reverses: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditTransaction' },
    },
  },
  { timestamps: true },
);

creditTransactionSchema.index({ user: 1, createdAt: -1 });

// Finding the accrual a reversal must undo, and the "already paid for this
// instalment" check that makes accrual idempotent. Sparse because only referral
// rows carry these fields at all.
creditTransactionSchema.index(
  { 'referral.invoiceNumber': 1, 'referral.paymentIndex': 1 },
  { sparse: true },
);

const CreditTransaction = mongoose.model('CreditTransaction', creditTransactionSchema);

export { CREDIT_TYPES, CreditTransaction };
export default CreditTransaction;
