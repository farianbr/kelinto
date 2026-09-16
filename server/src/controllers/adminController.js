import { randomBytes } from 'node:crypto';
import { asyncHandler } from '../utils/ApiError.js';
import * as adminService from '../services/adminService.js';
import auditService from '../services/auditService.js';
import invoiceRefundService from '../services/invoiceRefundService.js';
import { db } from '../db/models.js';
import '../models/User.js';
import '../models/Invoice.js';

/**
 * **Audit hooks live in the controller, not the service** (§7.5, phase 11b).
 *
 * The request is the only thing that knows the actor and the IP, and a service
 * reaching for `req` is the pattern this codebase already refuses elsewhere
 * (see `authService.register`, which takes `{ ip }` rather than the request).
 * Controllers here are thin wrappers, so this is also where a mutation is
 * unambiguously "done" - every row is written **after** the operation returned,
 * never before, so the log never claims something that then failed.
 *
 * `record` never throws, so none of these need a `try`.
 */

// `from` and `to` are inclusive `YYYY-MM-DD` days; the service owns end-of-day
// and the default window, so both halves cannot disagree about what a range is.
const stats = asyncHandler(async (req, res) => {
  res.json(await adminService.stats({ from: req.query.from, to: req.query.to }));
});

// ---- customers --------------------------------------------------------------

const listUsers = asyncHandler(async (req, res) => {
  res.json(await adminService.listUsers(req.query));
});

const createUser = asyncHandler(async (req, res) => {
  const user = await adminService.createUser(req.body, req.user._id);

  await auditService.record({
    req,
    action: 'user.create',
    entity: { kind: 'user', id: user.id, label: user.businessName },
    after: { status: user.status, creditLimit: user.creditLimit, terms: user.terms },
    description: `Opened ${user.businessName} as a ${user.status} account.`,
  });

  res.status(201).json({ user });
});

const getUser = asyncHandler(async (req, res) => {
  res.json(await adminService.getUser(req.params.id));
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await adminService.updateUser(req.params.id, req.body);

  await auditService.record({
    req,
    action: 'user.update',
    entity: { kind: 'user', id: req.params.id, label: user.businessName ?? user.email },
    // Only the identity fields this endpoint can actually write. Credit and
    // status are edited elsewhere and would be noise in this record.
    after: {
      businessName: user.businessName,
      contactName: user.contactName,
      email: user.email,
      phone: user.phone,
    },
    description: `Edited the profile for ${user.businessName ?? user.email}.`,
  });

  res.json({ user });
});

/**
 * Consent is always audited, and audited as a `security` record.
 *
 * Under CASL the defensible question is not "is consent on" but "who set it,
 * when, and on what basis" - so the before/after pair matters more here than on
 * an ordinary field edit, and it belongs in the log an auditor is pointed at
 * rather than the general activity feed.
 */
const setContactConsent = asyncHandler(async (req, res) => {
  const before = await db().User.findById(req.params.id)
    .select('contactConsent marketingConsent')
    .lean();
  const user = await adminService.setContactConsent(req.params.id, req.body, req.user._id);

  await auditService.record({
    req,
    kind: 'security',
    action: 'user.consent',
    entity: { kind: 'user', id: req.params.id, label: user.businessName ?? user.email },
    before: {
      channels: {
        sms: before?.contactConsent?.sms === true,
        whatsapp: before?.contactConsent?.whatsapp === true,
        email: before?.contactConsent?.email === true,
        call: before?.contactConsent?.call === true,
      },
      marketing: before?.marketingConsent?.granted === true,
    },
    after: { channels: user.consent.channels, marketing: user.consent.marketing },
    description: `Recorded contact consent for ${user.businessName ?? user.email}.`,
  });

  res.json({ user });
});

const setTier = asyncHandler(async (req, res) => {
  const before = await db().User.findById(req.params.id).select('tier').lean();
  const user = await adminService.setTier(req.params.id, req.body);

  await auditService.record({
    req,
    action: 'user.tier',
    entity: { kind: 'user', id: req.params.id, label: user.businessName ?? user.email },
    before: { tier: before?.tier ?? 'standard' },
    after: { tier: user.tier },
    description: `Set ${user.businessName ?? user.email} to the ${user.tier} tier.`,
  });

  res.json({ user });
});

const addInternalNote = asyncHandler(async (req, res) => {
  // `req.user` rather than just the id: the note denormalises who wrote it, so
  // it still reads correctly after that person's account is gone.
  res.status(201).json(await adminService.addInternalNote(req.params.id, req.body, req.user));
});

const deleteInternalNote = asyncHandler(async (req, res) => {
  const result = await adminService.deleteInternalNote(req.params.id, req.params.noteId);

  // Deleting somebody else's note is the one destructive act on this screen,
  // so it is the one that leaves a row behind.
  await auditService.record({
    req,
    action: 'user.note_delete',
    entity: { kind: 'user', id: req.params.id, label: req.params.noteId },
    description: 'Deleted an internal note.',
  });

  res.json(result);
});

const approveUser = asyncHandler(async (req, res) => {
  const user = await adminService.approveUser(req.params.id, req.user._id, req.body);

  await auditService.record({
    req,
    action: 'user.approve',
    entity: { kind: 'user', id: req.params.id, label: user.businessName ?? user.email },
    after: { status: user.status, creditLimit: user.creditLimit, terms: user.terms },
    description: `Approved ${user.businessName ?? user.email} with a ${user.terms} limit.`,
  });

  res.json({ user });
});

const rejectUser = asyncHandler(async (req, res) => {
  const user = await adminService.rejectUser(req.params.id, req.body);

  await auditService.record({
    req,
    action: 'user.reject',
    entity: { kind: 'user', id: req.params.id, label: user.businessName ?? user.email },
    after: { status: user.status, reason: req.body?.reason ?? '' },
    description: `Rejected ${user.businessName ?? user.email}.`,
  });

  res.json({ user });
});

const setUserStatus = asyncHandler(async (req, res) => {
  const user = await adminService.setUserStatus(req.params.id, req.body);

  // Suspending an account is a security event as well as an administrative
  // one - it is how somebody's access is taken away - so it lands in the
  // security log rather than only in the activity feed.
  const kind = req.body?.status === 'suspended' ? 'security' : 'activity';

  await auditService.record({
    req,
    kind,
    action: 'user.status',
    entity: { kind: 'user', id: req.params.id, label: user.businessName ?? user.email },
    after: { status: user.status },
    description: `Set ${user.businessName ?? user.email} to ${user.status}.`,
  });

  res.json({ user });
});

/**
 * The **line of credit** - what Cellvix lends. Not store credit, which moves
 * only through `storeCreditService` and is logged separately below.
 */
const setCredit = asyncHandler(async (req, res) => {
  // A lean read of the two fields rather than `getUser`, which also fetches ten
  // orders and ten invoices this does not need.
  const before = await db().User.findById(req.params.id).select('creditLimit terms').lean();
  const user = await adminService.setCredit(req.params.id, req.body);

  await auditService.record({
    req,
    action: 'user.credit_limit',
    entity: { kind: 'user', id: req.params.id, label: user.businessName ?? user.email },
    before: { creditLimit: before?.creditLimit ?? null, terms: before?.terms ?? null },
    after: { creditLimit: user.creditLimit, terms: user.terms },
    description: `Set the line of credit for ${user.businessName ?? user.email}.`,
  });

  res.json({ user });
});

// ---- products ---------------------------------------------------------------

const listProducts = asyncHandler(async (req, res) => {
  res.json(await adminService.listProducts(req.query));
});

const createProduct = asyncHandler(async (req, res) => {
  res.status(201).json({ product: await adminService.createProduct(req.body) });
});

const updateProduct = asyncHandler(async (req, res) => {
  res.json({ product: await adminService.updateProduct(req.params.id, req.body) });
});

const toggleProduct = asyncHandler(async (req, res) => {
  res.json({ product: await adminService.deactivateProduct(req.params.id) });
});

// ---- orders -----------------------------------------------------------------

const listOrders = asyncHandler(async (req, res) => {
  res.json(await adminService.listOrders({ ...req.query, business: req.businessScope }));
});

const createOrder = asyncHandler(async (req, res) => {
  // The body's business wins - it is the fulfilling shop the staff member chose
  // and the current scope is the fallback for the usual case where they did
  // not change it.
  const order = await adminService.createOrder({
    ...req.body,
    business: req.body.business || req.businessScope || null,
  });

  await auditService.record({
    req,
    action: 'order.create',
    entity: { kind: 'order', id: order.orderNumber, label: order.orderNumber },
    after: { total: order.total, items: order.items?.length ?? 0 },
    description: `Raised ${order.orderNumber} by hand.`,
  });

  res.status(201).json({ order });
});

const getOrder = asyncHandler(async (req, res) => {
  res.json(await adminService.getOrder(req.params.orderNumber));
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  res.json({ order: await adminService.updateOrderStatus(req.params.orderNumber, req.body) });
});

/**
 * **Store credit** - what the business already holds, moved through the one
 * service allowed to move it. §7.6 names this as money-moving and therefore
 * always audited with actor and IP.
 */
const allocateStoreCredit = asyncHandler(async (req, res) => {
  const result = await adminService.allocateStoreCredit(req.params.id, req.body, req.user._id);

  await auditService.record({
    req,
    action: 'store_credit.allocate',
    entity: { kind: 'storeCredit', id: req.params.id, label: result?.entry?.type ?? '' },
    after: {
      // Cents, from the ledger entry itself rather than the dollars posted
      // this is what actually moved.
      amount: result?.entry?.amount ?? null,
      type: result?.entry?.type ?? null,
      note: req.body?.note ?? '',
      // The resulting balance, so the row answers "what did this leave them
      // with" without a second lookup against a value that has since moved.
      balanceAfter: result?.balance ?? null,
    },
    description: `Store credit ${(result?.entry?.amount ?? 0) >= 0 ? 'added to' : 'deducted from'} account ${req.params.id}.`,
  });

  res.status(201).json(result);
});

const storeCreditStatement = asyncHandler(async (req, res) => {
  res.json(await adminService.storeCreditStatement(req.params.id));
});

/** Every payment this customer has made, flattened off their invoices. */
const userPayments = asyncHandler(async (req, res) => {
  res.json(await adminService.userPayments(req.params.id));
});

const refundOrder = asyncHandler(async (req, res) => {
  const result = await adminService.refundOrder(req.params.orderNumber, req.body, req.user._id);

  await auditService.record({
    req,
    action: 'order.refund',
    entity: { kind: 'order', id: req.params.orderNumber, label: req.params.orderNumber },
    after: {
      amount: result?.entry?.amount ?? null,
      note: req.body?.note ?? '',
      balanceAfter: result?.balance ?? null,
      // Named by the service: a partial refund is normal, and the row should
      // say how much of the order has now been returned in total.
      refundedTotal: result?.refundedTotal ?? null,
    },
    description: `Refunded ${req.params.orderNumber} to store credit.`,
  });

  res.status(201).json(result);
});

// ---- invoices ---------------------------------------------------------------

const listInvoices = asyncHandler(async (req, res) => {
  res.json(await adminService.listInvoices({ ...req.query, business: req.businessScope }));
});

const createInvoice = asyncHandler(async (req, res) => {
  const invoice = await adminService.createInvoice(req.body);

  await auditService.record({
    req,
    action: 'invoice.create',
    entity: { kind: 'invoice', id: invoice.number, label: invoice.number },
    after: { amount: invoice.amount, terms: invoice.terms, dueDate: invoice.dueDate },
    description: `Raised ${invoice.number} against ${invoice.businessName} with no order behind it.`,
  });

  res.status(201).json({ invoice });
});

const getInvoice = asyncHandler(async (req, res) => {
  res.json(await adminService.getInvoice(req.params.number));
});

const recordInvoicePayment = asyncHandler(async (req, res) => {
  const result = await adminService.recordPayment(req.params.number, req.body);
  const invoice = result?.invoice ?? result;

  await auditService.record({
    req,
    action: 'invoice.payment',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    after: {
      amountDollars: req.body?.amountDollars ?? null,
      method: req.body?.method ?? '',
      reference: req.body?.reference ?? '',
      // Recomputed server-side from the payment rows, so this is the invoice's
      // real position rather than what the caller believed it would be.
      amountPaid: invoice?.amountPaid ?? null,
      status: invoice?.status ?? null,
    },
    description: `Recorded a payment against ${req.params.number}.`,
  });

  res.status(201).json(result);
});

/**
 * A gratuity. Audited like a payment, because it is money the shop received
 * even though it never touches what the customer owed.
 */
const recordInvoiceTip = asyncHandler(async (req, res) => {
  const result = await adminService.recordTip(req.params.number, req.body);
  const invoice = result?.invoice ?? result;

  await auditService.record({
    req,
    action: 'invoice.tip',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    after: { tipDollars: req.body?.amountDollars ?? 0, tipCents: invoice?.tipCents ?? 0 },
    description: Number(req.body?.amountDollars ?? 0)
      ? `Recorded a tip on ${req.params.number}.`
      : `Cleared the tip on ${req.params.number}.`,
  });

  res.json(result);
});

const voidInvoice = asyncHandler(async (req, res) => {
  const result = await adminService.voidInvoice(req.params.number, req.body);
  const invoice = result?.invoice ?? result;

  await auditService.record({
    req,
    action: 'invoice.void',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    after: { status: invoice?.status ?? 'void', reason: req.body?.reason ?? '' },
    description: `Voided ${req.params.number}${req.body?.reason ? ` - ${req.body.reason}` : ''}.`,
  });

  res.json(result);
});

/**
 * Refund money off an invoice, to cash or to store credit.
 *
 * **Audited with the destination in it**, because the two are different promises
 * to the customer and "we refunded you" does not say which happened. The cents
 * and the resulting balance are recorded for the same reason the order refund
 * records them: "where did $200 go" is a question somebody asks later.
 */
/**
 * Chase an unpaid invoice.
 *
 * Audited with what the transport actually said, like every other mail path
 * here: "reminded" and "tried to remind" are different facts, and only one of
 * them means the customer has been asked.
 */
const remindInvoice = asyncHandler(async (req, res) => {
  const result = await adminService.remindInvoice(req.params.number, req.body);

  await auditService.record({
    req,
    action: 'invoice.remind',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    after: {
      to: result.to,
      delivered: result.delivered,
      balance: result.balance,
      overdue: result.overdue,
    },
    description: result.delivered
      ? `Reminded ${result.to} about ${req.params.number}.`
      : `Tried to remind ${result.to} about ${req.params.number}; it did not send.`,
  });

  res.json(result);
});

const refundInvoice = asyncHandler(async (req, res) => {
  const result = await invoiceRefundService.refundInvoice(
    req.params.number,
    req.body,
    req.user._id,
  );

  await auditService.record({
    req,
    action: 'invoice.refund',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    after: {
      amount: result.refunded,
      destination: result.toStoreCredit ? 'store credit' : 'cash back',
      reason: req.body?.reason ?? '',
      status: result.status,
      refundableLeft: result.refundable,
      storeCreditBalance: result.storeCreditBalance,
    },
    description:
      `Refunded ${(result.refunded / 100).toFixed(2)} on ${req.params.number} ` +
      `${result.toStoreCredit ? 'to store credit' : 'as cash back'}` +
      `${req.body?.reason ? ` - ${req.body.reason}` : '.'}`,
  });

  res.status(201).json(result);
});

/**
 * Email the invoice to its account.
 *
 * The audit line records what the transport actually said, not what was
 * attempted: "sent" and "tried to send" are different facts, and only one of
 * them means the customer has the document.
 */
const reverseInvoicePayment = asyncHandler(async (req, res) => {
  const result = await adminService.reverseInvoicePayment(
    req.params.number,
    req.params.index,
    req.body,
  );

  await auditService.record({
    req,
    action: 'invoice.payment.reverse',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    after: { index: Number(req.params.index), reason: req.body?.reason ?? '' },
    description: `Reversed a payment on ${req.params.number}${req.body?.reason ? ` - ${req.body.reason}` : ''}.`,
  });

  res.json(result);
});
/**
 * Cash (or a transfer) paid against the line of credit at the counter.
 *
 * The audit line names the invoices it actually landed on, because "paid
 * " and "settled INV-10042 and part of INV-10043" are the same event and
 * only the second one can be reconciled later.
 */
const recordCreditPayment = asyncHandler(async (req, res) => {
  const result = await adminService.recordCreditPayment(req.params.id, req.body);

  await auditService.record({
    req,
    action: 'client.credit.payment',
    entity: { kind: 'user', id: req.params.id, label: req.params.id },
    after: { amount: result.amount, applied: result.applied },
    description: `Recorded ${(result.amount / 100).toFixed(2)} against the line of credit - ${result.applied.map((row) => row.number).join(', ')}.`,
  });

  res.json(result);
});
const emailInvoice = asyncHandler(async (req, res) => {
  const result = await adminService.emailInvoice(req.params.number);

  await auditService.record({
    req,
    action: 'invoice.email',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    after: { to: result.to, delivered: result.delivered },
    description: result.delivered
      ? `Emailed ${req.params.number} to ${result.to}.`
      : `Tried to email ${req.params.number} to ${result.to} - the transport refused it.`,
  });

  res.json(result);
});

const updateInvoice = asyncHandler(async (req, res) => {
  const before = await db().Invoice.findOne({ number: req.params.number })
    .select('dueDate poNumber note')
    .lean();
  const result = await adminService.updateInvoice(req.params.number, req.body);

  await auditService.recordChange({
    req,
    action: 'invoice.update',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    before,
    after: req.body,
    description: `Edited ${req.params.number}.`,
  });

  res.json(result);
});

const deleteInvoice = asyncHandler(async (req, res) => {
  const result = await adminService.deleteInvoice(req.params.number);

  await auditService.record({
    req,
    action: 'invoice.delete',
    entity: { kind: 'invoice', id: req.params.number, label: req.params.number },
    description: `Deleted ${req.params.number}, which had no payments against it.`,
  });

  res.json(result);
});

// ---- client profile ---------------------------------------------------------

const userActivity = asyncHandler(async (req, res) => {
  res.json(await adminService.userActivity(req.params.id));
});

// ---- bulk -------------------------------------------------------------------

// Partial by design: the response names what moved and what did not, and the
// UI shows the skips rather than reporting a clean success.
const bulkUpdateOrderStatus = asyncHandler(async (req, res) => {
  res.json(await adminService.bulkUpdateOrderStatus(req.body));
});

/**
 * The invoice document, for an admin.
 *
 * Same per-response CSP as the buyer-facing route: Helmet's global policy
 * forbids inline script, the page needs exactly one line of it for the print
 * button, and loosening the policy app-wide to serve one document would be the
 * wrong tradeoff. Nothing loads; the one nonced script may run.
 */
const invoiceDocument = asyncHandler(async (req, res) => {
  const nonce = randomBytes(16).toString('base64');
  const html = await adminService.invoiceDocument(req.params.number, { nonce });

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src data:",
      `script-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  );
  res.type('html').send(html);
});

/**
 * The account statement, rendered for print-to-PDF.
 *
 * Same CSP shape as the invoice document: the page carries one inline script
 * (its print button) and nothing else, so the nonce is the only thing allowed
 * to run and every other source is denied.
 */
const accountStatement = asyncHandler(async (req, res) => {
  const nonce = randomBytes(16).toString('base64');
  const html = await adminService.accountStatement(req.params.id, { nonce });

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src data:",
      `script-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  );
  res.type('html').send(html);
});
export { stats, listUsers, createUser, getUser, userPayments, updateUser, setContactConsent, setTier, addInternalNote, deleteInternalNote, approveUser, rejectUser, setUserStatus, setCredit, listProducts, createProduct, updateProduct, toggleProduct, listOrders, createOrder, getOrder, updateOrderStatus, allocateStoreCredit, storeCreditStatement, refundOrder, listInvoices, createInvoice, getInvoice, recordInvoicePayment, recordInvoiceTip, recordCreditPayment, voidInvoice, refundInvoice, remindInvoice, emailInvoice, reverseInvoicePayment, updateInvoice, deleteInvoice, userActivity, bulkUpdateOrderStatus, invoiceDocument, accountStatement };
