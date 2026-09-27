import mongoose from 'mongoose';

import { MESSAGE_CHANNELS } from './MessageLog.js';
import { formatDate } from '../../../shared/dates.js';

/**
 * Time-lapse invoice messages (ERP rework §6.15 category 2, §8, phase 11d).
 *
 * "Send a reminder three days before an invoice is due." Each rule fires **once
 * per invoice** when its delay elapses, on the chosen channel.
 *
 * **Once per invoice is the whole design.** A reminder that re-sends every time
 * a scheduled pass runs is how a customer gets the same email fourteen mornings
 * running, and the business learns about it from the customer. `InvoiceStatusRun`
 * below records every (rule, invoice) pair that has fired, with a unique index
 * doing the enforcing - a flag on the rule or a timestamp comparison would both
 * lose a race between two passes.
 */

/**
 * What the delay counts from.
 *
 * Every one is a date already on `Invoice`, so a rule is evaluated by arithmetic
 * rather than by a state machine that has to be kept in step with the invoice's
 * own status.
 */
const RULE_TRIGGERS = [
  { value: 'invoice_created', label: 'the invoice is issued' },
  { value: 'invoice_due', label: 'the invoice falls due' },
  { value: 'invoice_overdue', label: 'the invoice becomes overdue' },
  { value: 'invoice_paid', label: 'the invoice is paid in full' },
];

/**
 * The date a trigger counts from, read off the invoice.
 *
 * `invoice_paid` is **derived from the last payment row** rather than from a
 * stored `paidAt`. `Invoice` deliberately recomputes `amountPaid` and `status`
 * from `payments` (phase 4), so adding a separate paid-date field would create
 * a second thing to keep in step with the same rows - and it would be wrong the
 * first time a payment was voided.
 *
 * Returns null when the trigger has not happened, which is how the pass knows
 * an unpaid invoice is not yet a candidate for a paid-invoice rule.
 */
function triggerDate(trigger, invoice) {
  switch (trigger) {
    case 'invoice_created':
      return invoice.issuedAt ?? invoice.createdAt ?? null;
    case 'invoice_due':
    case 'invoice_overdue':
      return invoice.dueDate ?? null;
    case 'invoice_paid': {
      if (invoice.status !== 'paid') return null;
      const paid = (invoice.payments ?? []).filter((row) => row.method !== 'void' && row.amount > 0);
      if (!paid.length) return null;
      return paid.reduce((latest, row) => (row.at > latest ? row.at : latest), paid[0].at);
    }
    default:
      return null;
  }
}

/**
 * Placeholders a message may contain (§6.15).
 *
 * Substitution is literal and total: an unknown token is left as written rather
 * than replaced with an empty string, matching `MessageTemplate.render`. A typo
 * shows up as `{{amont}}` in the preview instead of silently sending a sentence
 * with a hole in it.
 */
const RULE_TOKENS = [
  { token: '{{customer_name}}', label: 'Customer name' },
  { token: '{{shop_name}}', label: 'Your business' },
  { token: '{{invoice_number}}', label: 'Invoice number' },
  { token: '{{amount}}', label: 'Amount outstanding' },
  { token: '{{status}}', label: 'Invoice status' },
  { token: '{{due_date}}', label: 'Due date' },
];

const invoiceStatusRuleSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 80 },

    trigger: {
      type: String,
      enum: RULE_TRIGGERS.map((t) => t.value),
      required: true,
    },

    /**
     * Days after the trigger. **Negative means before** - which is how "remind
     * them three days before it is due" is expressed, and the reason this is a
     * signed integer rather than a count plus a direction enum.
     */
    delayDays: { type: Number, default: 0, min: -365, max: 365 },

    channel: { type: String, enum: MESSAGE_CHANNELS, default: 'email' },

    subject: { type: String, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 5000 },

    /**
     * Built-in rules cannot be deleted, only edited and deactivated (§6.15).
     *
     * They are the messages the business is expected to send at all; letting
     * one be deleted means discovering months later that nobody has been
     * chasing overdue invoices.
     */
    isBuiltIn: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },

    lastRunAt: Date,
  },
  { timestamps: true },
);

/**
 * Fills a message against one invoice. Unknown tokens survive untouched.
 */
invoiceStatusRuleSchema.statics.render = function render(body, { invoice, user, money }) {
  const values = {
    '{{customer_name}}': user?.businessName ?? user?.contactName ?? '',
    '{{shop_name}}': 'Your business',
    '{{invoice_number}}': invoice?.number ?? '',
    '{{amount}}': money ?? '',
    '{{status}}': invoice?.status ?? '',
    '{{due_date}}': formatDate(invoice?.dueDate, ''),
  };

  return String(body ?? '').replace(
    /\{\{\s*\w+\s*\}\}/g,
    (match) => values[match.replace(/\s/g, '')] ?? match,
  );
};

const InvoiceStatusRule = mongoose.model('InvoiceStatusRule', invoiceStatusRuleSchema);

/**
 * One (rule, invoice) pair that has already fired.
 *
 * **The unique index is the "once per invoice" guarantee**, not the code around
 * it. Two passes running concurrently - a cron overlapping with a manual run
 * both see the same unsent invoice; the second one's insert fails on the index
 * and it skips, rather than both checking a flag, both finding it unset, and
 * both sending.
 */
const invoiceStatusRunSchema = new mongoose.Schema(
  {
    rule: { type: mongoose.Schema.Types.ObjectId, ref: 'InvoiceStatusRule', required: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    invoiceNumber: String,
    channel: String,
    // `sent`, or `skipped` with the reason - a run that could not send is still
    // a run, and recording it stops the pass retrying it every day.
    status: { type: String, default: 'sent' },
    detail: String,
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

invoiceStatusRunSchema.index({ rule: 1, invoice: 1 }, { unique: true });

const InvoiceStatusRun = mongoose.model('InvoiceStatusRun', invoiceStatusRunSchema);

/**
 * The rules seeded on first use (§6.15: built-ins are marked and undeletable).
 *
 * **All ship inactive**, matching CellShoppe and for the same reason: anything
 * that emails a customer should be switched on deliberately by somebody who has
 * read what it says, not by installing the software.
 */
const BUILT_IN_RULES = [
  {
    label: 'Invoice issued',
    trigger: 'invoice_created',
    delayDays: 0,
    channel: 'email',
    subject: 'Your invoice {{invoice_number}} from {{shop_name}}',
    message:
      'Hello {{customer_name}},\n\nYour invoice {{invoice_number}} for {{amount}} is attached and is due on {{due_date}}.\n\nThank you for your business.\n{{shop_name}}',
  },
  {
    label: 'Payment reminder',
    trigger: 'invoice_due',
    delayDays: -3,
    channel: 'email',
    subject: 'Invoice {{invoice_number}} is due on {{due_date}}',
    message:
      'Hello {{customer_name}},\n\nA reminder that invoice {{invoice_number}} for {{amount}} is due on {{due_date}}.\n\nIf you have already sent payment, please ignore this note.\n{{shop_name}}',
  },
  {
    label: 'Overdue notice',
    trigger: 'invoice_overdue',
    delayDays: 7,
    channel: 'email',
    subject: 'Invoice {{invoice_number}} is overdue',
    message:
      'Hello {{customer_name}},\n\nInvoice {{invoice_number}} for {{amount}} was due on {{due_date}} and is now overdue.\n\nPlease get in touch if there is a problem with this invoice.\n{{shop_name}}',
  },
  {
    label: 'Payment received',
    trigger: 'invoice_paid',
    delayDays: 0,
    channel: 'email',
    subject: 'Payment received for {{invoice_number}}',
    message:
      'Hello {{customer_name}},\n\nWe have received payment for invoice {{invoice_number}}. Thank you.\n\n{{shop_name}}',
  },
];

/**
 * Creates the built-ins if they are missing. Additive - never overwrites an
 * edited rule, so it is safe to run at boot on a live database.
 */
async function ensureBuiltInRules() {
  for (const rule of BUILT_IN_RULES) {
    await InvoiceStatusRule.updateOne(
      { label: rule.label, isBuiltIn: true },
      { $setOnInsert: { ...rule, isBuiltIn: true, isActive: false } },
      { upsert: true },
    );
  }
}

export { RULE_TRIGGERS, triggerDate, RULE_TOKENS, InvoiceStatusRule, InvoiceStatusRun, BUILT_IN_RULES, ensureBuiltInRules };
export default InvoiceStatusRule;
