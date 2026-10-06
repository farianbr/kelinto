import mongoose from 'mongoose';

import InvoiceStatusRule, {
  InvoiceStatusRun,
  RULE_TRIGGERS,
  RULE_TOKENS,
  triggerDate,
  ensureBuiltInRules,
} from '../models/InvoiceStatusRule.js';
import { db } from '../db/models.js';
import '../models/Invoice.js';
import '../models/InvoiceLabel.js';
import '../models/User.js';
import '../models/MessageLog.js';
import '../models/Settings.js';
import ApiError from '../utils/ApiError.js';
import { sendMail, mailerConfigured } from './mailer.js';
import { channelStatus } from './marketingService.js';
import { toEmailHtml, toPlainText, looksLikeHtml } from './messageBody.js';

/**
 * Cents to `$1,234.56`, for the `{{amount}}` placeholder.
 *
 * Local rather than imported from `pricingService`, which has an identical
 * private helper: that file is the one place a discount is decided
 * (PROJECT_INSTRUCTIONS.md) and widening its exports to share a formatter is
 * how unrelated code starts reaching into it.
 */
const formatCents = (cents) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((cents ?? 0) / 100);

/**
 * Automatic, time-lapse invoice messages (ERP rework §6.15, phase 11d).
 *
 * Four rules hold this file together.
 *
 * **1. Once per invoice, enforced by an index.** Every send writes an
 * `InvoiceStatusRun` keyed uniquely on (rule, invoice). Two passes overlapping
 * both see the same candidate; the second one's insert fails and it skips.
 * Checking a flag first and writing after would let both send.
 *
 * **2. The run is recorded before the send, not after.** If the mail call
 * throws, the row still stands and the invoice is not retried tomorrow
 * because "we sent it twice" is a worse outcome for a customer than "we sent it
 * once and it failed", and the failure is visible in the run's own status.
 *
 * **3. Consent and suppression are respected.** These are transactional
 * messages about an invoice the customer already owes, not marketing, so CASL
 * consent is not required - but an account with no email is skipped with a
 * reason rather than silently.
 *
 * **4. Nothing reports a send that did not happen.** SMS and WhatsApp have no
 * transport (§6b U3–U4), so a rule on those channels records `skipped` with the
 * channel's own reason. Email genuinely sends.
 */

function shape(rule) {
  return {
    id: rule._id.toString(),
    label: rule.label,
    trigger: rule.trigger,
    delayDays: rule.delayDays ?? 0,
    channel: rule.channel,
    subject: rule.subject ?? '',
    message: rule.message,
    isBuiltIn: Boolean(rule.isBuiltIn),
    isActive: Boolean(rule.isActive),
    lastRunAt: rule.lastRunAt ?? null,
  };
}

/**
 * Every rule, plus what the screen needs to render its editor.
 *
 * Seeds the built-ins on read rather than only in `npm run seed`: a live cluster
 * that predates this phase would otherwise show an empty screen, which is the
 * exact failure phase 9 hit with roles and businesses (Session 34).
 */
async function list() {
  await ensureBuiltInRules();

  const rules = await InvoiceStatusRule.find().sort({ isBuiltIn: -1, createdAt: 1 }).lean();

  // Which channels can actually deliver, so the screen's banner states it
  // plainly rather than each rule guessing (§6.15).
  const channels = {};
  for (const channel of ['email', 'sms', 'whatsapp']) {
    channels[channel] = await channelStatus(channel);
  }

  return {
    rules: rules.map(shape),
    triggers: RULE_TRIGGERS,
    tokens: RULE_TOKENS,
    channels,
  };
}

async function create(input) {
  const rule = await InvoiceStatusRule.create({
    label: input.label.trim(),
    trigger: input.trigger,
    delayDays: input.delayDays ?? 0,
    channel: input.channel ?? 'email',
    subject: input.subject ?? '',
    message: input.message,
    // Only the seeded set is built-in; nothing created through the API can
    // claim to be, or it would become undeletable.
    isBuiltIn: false,
    isActive: Boolean(input.isActive),
  });

  return { rule: shape(rule.toObject()) };
}

async function update(id, input) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Rule not found.', 'RULE_NOT_FOUND');

  const rule = await InvoiceStatusRule.findById(id);
  if (!rule) throw ApiError.notFound('Rule not found.', 'RULE_NOT_FOUND');

  // A built-in's text, timing, channel and active state are all editable - only
  // its existence is protected (§6.15).
  rule.label = input.label?.trim() ?? rule.label;
  rule.trigger = input.trigger ?? rule.trigger;
  rule.delayDays = input.delayDays ?? rule.delayDays;
  rule.channel = input.channel ?? rule.channel;
  rule.subject = input.subject ?? rule.subject;
  rule.message = input.message ?? rule.message;
  if (input.isActive !== undefined) rule.isActive = Boolean(input.isActive);

  await rule.save();
  return { rule: shape(rule.toObject()) };
}

async function remove(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Rule not found.', 'RULE_NOT_FOUND');

  const rule = await InvoiceStatusRule.findById(id);
  if (!rule) throw ApiError.notFound('Rule not found.', 'RULE_NOT_FOUND');

  if (rule.isBuiltIn) {
    throw ApiError.badRequest(
      'Built-in messages cannot be deleted. Switch it off instead.',
      'RULE_IS_BUILT_IN',
    );
  }

  await rule.deleteOne();
  return { removed: true, label: rule.label };
}

/** Every invoice a rule would fire against right now, unsent. */
async function candidatesFor(rule, now) {
  // A manual status's message counts from the day the status was set, and only
  // on invoices still carrying it: one that has moved on to another status is
  // no longer where the message was written for.
  if (rule.trigger === 'label_set') {
    const invoices = await db()
      .Invoice.find({ label: rule.labelId, labelSetAt: { $ne: null } })
      .lean();
    return invoices.filter((invoice) => {
      const fireAt = new Date(invoice.labelSetAt);
      fireAt.setDate(fireAt.getDate() + (rule.delayDays ?? 0));
      return fireAt <= now;
    });
  }

  // Paid invoices are only candidates for the paid trigger; the rest are about
  // money still owed and must stop the moment it is settled.
  const statusFilter =
    rule.trigger === 'invoice_paid' ? { status: 'paid' } : { status: { $ne: 'paid' } };

  const invoices = await db().Invoice.find(statusFilter).lean();
  const due = [];

  for (const invoice of invoices) {
    const base = triggerDate(rule.trigger, invoice);
    if (!base) continue;

    const fireAt = new Date(base);
    fireAt.setDate(fireAt.getDate() + (rule.delayDays ?? 0));
    if (fireAt > now) continue;

    due.push(invoice);
  }

  return due;
}

/**
 * Runs every active rule. Returns what it did, per rule.
 *
 * `dryRun` reports what *would* be sent without sending or recording anything
 * which is what makes this screen safe to try on a live database, and is the
 * first thing a staff member will want before switching a rule on.
 *
 * There is **no scheduler in this codebase yet**: this is called by an admin
 * pressing Run. A daily cron is phase 12's concern (§6.15 says "via a daily
 * cron pass"), and until it exists the screen says so rather than implying
 * these fire on their own.
 */
async function run({ dryRun = false, now = new Date() } = {}) {
  // The master switch on Email Settings (§6.15 category 5, phase 11e). A rule
  // being active is not enough - the business has to have automatic invoice
  // email switched on at all. Reported rather than silently returning nothing,
  // because "the run did nothing" and "the run is switched off" look identical
  // from the screen otherwise.
  //
  // **Off is the shipped default** (§6.15: anything that emails a customer
  // starts switched off), so this branch is what a staff member hits first. It
  // returns `disabled` with the reason rather than an empty result set: "the
  // run did nothing" and "the run is switched off" are indistinguishable
  // otherwise, and the second has an obvious fix the first does not.
  const settings = await db().Settings.load();
  if (settings?.communications?.invoiceReminders !== true) {
    return {
      dryRun,
      ranAt: now,
      disabled: true,
      reason:
        'Automatic invoice email is switched off in Email Settings, so no message was sent. Switch on “Invoice reminders” there first.',
      results: [],
    };
  }

  /*
    Manual status messages (2026-10-01) ride the same pass as the scheduled
    ones. Shaped as a rule so everything below treats them alike; the run row
    keys on the status's own id, so "once per invoice" holds for them too and
    can never collide with a rule's rows. `fromLabel` stops the pass stamping
    `lastRunAt` on a rule that does not exist.

    A status sends on every channel it lists (2026-10-06), narrowed per invoice
    to the ones the staff member left ticked when they set it
    (`Invoice.labelChannels`). Still ONE run row per invoice: the row says the
    status has spoken to this customer, and each channel's own outcome is in
    the message history.
  */
  const statusMessages = (await db().InvoiceLabel.find({ messageActive: true }).lean())
    .filter((label) => label.message?.trim())
    .map((label) => ({
      _id: label._id,
      label: label.name,
      trigger: 'label_set',
      labelId: label._id,
      delayDays: label.delayDays ?? 0,
      channels: label.channels?.length ? label.channels : ['email'],
      subject: label.subject,
      message: label.message,
      fromLabel: true,
    }));

  const rules = [
    ...(await InvoiceStatusRule.find({ isActive: true }).lean()).map((rule) => ({
      ...rule,
      channels: [rule.channel ?? 'email'],
    })),
    ...statusMessages,
  ];
  const results = [];

  // Asked once per channel per pass, not once per invoice.
  const statusOf = new Map();
  const transport = async (channel) => {
    if (!statusOf.has(channel)) statusOf.set(channel, await channelStatus(channel));
    return statusOf.get(channel);
  };
  const smtpReady = await mailerConfigured();

  for (const rule of rules) {
    const candidates = await candidatesFor(rule, now);

    let sent = 0;
    let skipped = 0;
    const reasons = [];
    const tally = (outcome, detail) => {
      if (outcome === 'sent') sent += 1;
      else {
        skipped += 1;
        if (detail && !reasons.includes(detail)) reasons.push(detail);
      }
    };

    for (const invoice of candidates) {
      // The channels this invoice allows. An empty list was a status set
      // silently: the run row is still written, so it is not asked again.
      const channels = Array.isArray(invoice.labelChannels) && rule.fromLabel
        ? rule.channels.filter((channel) => invoice.labelChannels.includes(channel))
        : rule.channels;

      // Rule 1: the index decides, not a prior read. A duplicate key here means
      // another pass got there first, which is exactly the outcome we want.
      if (!dryRun) {
        try {
          await InvoiceStatusRun.create({
            rule: rule._id,
            invoice: invoice._id,
            invoiceNumber: invoice.number,
            channel: channels.join(','),
            status: 'pending',
          });
        } catch (error) {
          if (error?.code === 11000) continue; // already fired for this invoice
          throw error;
        }
      } else if (await InvoiceStatusRun.exists({ rule: rule._id, invoice: invoice._id })) {
        continue;
      }

      if (!channels.length) {
        if (!dryRun) {
          await InvoiceStatusRun.updateOne(
            { rule: rule._id, invoice: invoice._id },
            { $set: { status: 'skipped', detail: 'Set without notifying the customer.', at: new Date() } },
          );
        }
        tally('skipped', 'Set without notifying the customer.');
        continue;
      }

      const user = await db().User.findById(invoice.user).lean();

      const outstanding = Math.max((invoice.amount ?? 0) - (invoice.amountPaid ?? 0), 0);
      // On a status message, {{status}} is the status that sent it, not the
      // payment state underneath.
      const context = {
        invoice: rule.fromLabel ? { ...invoice, status: rule.label } : invoice,
        user,
        money: formatCents(outstanding),
      };
      const body = InvoiceStatusRule.render(rule.message, context);
      const subject = InvoiceStatusRule.render(rule.subject || `Invoice ${invoice.number}`, context);

      const details = [];
      let anySent = false;

      for (const channel of channels) {
        const status = await transport(channel);
        const isEmail = channel === 'email';
        const to = isEmail ? user?.email : user?.phone;

        let outcome = 'sent';
        let detail = '';

        if (!to) {
          outcome = 'skipped';
          detail = isEmail
            ? 'That account has no email address on file.'
            : 'That account has no phone number on file.';
        } else if (!status.delivers) {
          // Rule 4: a channel with no transport records what it could not do.
          outcome = 'skipped';
          detail = status.reason ?? `${channel} cannot send yet.`;
        } else if (isEmail && !smtpReady) {
          // A dry run has to predict the same outcome the real run produces.
          outcome = 'skipped';
          detail = 'No SMTP transport is configured, so the message cannot be sent.';
        }

        if (dryRun) {
          tally(outcome, detail);
          continue;
        }

        if (outcome === 'sent' && isEmail) {
          try {
            const result = await sendMail({
              to: user.email,
              subject,
              text: toPlainText(body),
              // Plain bodies still go as text alone, as they always did; an HTML
              // one is sanitised first (services/messageBody.js).
              html: looksLikeHtml(body) ? toEmailHtml(body) : undefined,
            });
            if (!result.delivered) {
              outcome = 'skipped';
              detail = `Sending failed: ${result.error ?? 'the message could not be delivered.'}`;
            }
          } catch (error) {
            // Rule 2: the run row already exists, so a thrown send is recorded
            // as a failure rather than silently retried tomorrow.
            outcome = 'skipped';
            detail = `Sending failed: ${error.message}`;
          }
        }

        // Every attempt is in the message history, so the invoice's contact
        // record is complete whether or not it went out.
        await db().MessageLog.create({
          channel,
          direction: 'outbound',
          user: invoice.user,
          businessName: user?.businessName ?? '',
          to: to ?? '',
          subject: isEmail ? subject : undefined,
          body: isEmail ? body : toPlainText(body),
          status: outcome === 'sent' ? 'sent' : 'queued_unconfigured',
          unconfiguredReason: outcome === 'sent' ? undefined : detail,
        });

        if (outcome === 'sent') anySent = true;
        else details.push(`${channel}: ${detail}`);
        tally(outcome, detail);
      }

      if (!dryRun) {
        await InvoiceStatusRun.updateOne(
          { rule: rule._id, invoice: invoice._id },
          {
            $set: {
              status: anySent ? 'sent' : 'skipped',
              detail: details.join(' · '),
              at: new Date(),
            },
          },
        );
      }
    }

    if (!dryRun && !rule.fromLabel && (sent || skipped)) {
      await InvoiceStatusRule.updateOne({ _id: rule._id }, { $set: { lastRunAt: new Date() } });
    }

    results.push({
      rule: rule.label,
      channel: rule.channels.join(', '),
      matched: candidates.length,
      sent,
      skipped,
      reasons,
    });
  }

  return { dryRun, ranAt: now, results };
}

export default { list, create, update, remove, run };

export { list, create, update, remove, run };
