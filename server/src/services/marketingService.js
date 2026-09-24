import crypto from 'node:crypto';

import { MESSAGE_CHANNELS } from '../models/MessageLog.js';
import { db } from '../db/models.js';
import '../models/MessageTemplate.js';
import '../models/Campaign.js';
import '../models/User.js';
import '../models/Order.js';
import '../models/Settings.js';
import ApiError from '../utils/ApiError.js';
import { likeRegex } from '../utils/regex.js';
import { sendMail, mailerConfigured } from './mailer.js';
import credentialService from './credentialService.js';
import env from '../config/env.js';
import { BUSINESS_INFO } from '../../../shared/business.js';
import { sendingBusiness } from './sendingBusiness.js';
import { storefrontOrigin } from './linkOrigins.js';

/**
 * Marketing - the four communication channels (ERP rework §6.13, phase 9).
 *
 * Three rules hold this file together.
 *
 * **1. A channel with no provider logs; it never pretends.** SMS, WhatsApp and
 * calls have nothing to send through (§6b, U3–U5). Composing on one still
 * writes a `MessageLog` row, with `status: 'queued_unconfigured'` and the
 * reason it is unconfigured, and the response says so plainly. Nothing here
 * ever returns a success the staff member could read as "delivered". Email is the
 * exception whenever `SMTP_URL` is configured, and reports a failure when it
 * is not - there is no local outbox standing in for a delivery.
 *
 * **2. Consent is applied at send, never at compose.** `resolveAudience` runs
 * when a campaign is sent, not when it is drafted, so an account that
 * unsubscribes in between does not receive it. The audience filter chooses a
 * population; consent then removes from it, and there is no code path and no
 * request field that can skip that step.
 *
 * **3. Every commercial email carries identification and a working
 * unsubscribe.** CASL requires both. They are appended by `decorate()` inside
 * the send loop rather than being the campaign author's responsibility - a
 * compliance requirement that depends on somebody remembering is not one.
 */

/**
 * Which channels can actually deliver, and what is missing when they cannot.
 *
 * The single source of truth for §6b's U3–U5: the screens read this through
 * `channelStatus()` rather than each hard-coding its own notice, so connecting
 * a provider changes one predicate and every surface follows.
 */
const CHANNEL_PROVIDERS = {
  email: {
    label: 'Email',
    // Email delivers only when there is a transport behind it. Asking the
    // mailer keeps this answer and what a send actually does in step.
    configured: mailerConfigured,
    reason: 'No SMTP transport is configured, so email cannot be delivered.',
  },
  // These two now resolve through `credentialService`, which checks the env
  // vars **and** the credentials saved on the API Keys screen (§6.15). Before
  // phase 11c a key typed into that screen would have been stored and never
  // read - a setting that changes nothing is worse than no setting.
  sms: {
    label: 'SMS',
    configured: () => credentialService.isConfigured('twilio'),
    // Credentials can be present while nothing sends: there is no Twilio client
    // in this codebase yet (§6b U3, phase 13). `delivers` is what the screens'
    // notice keys on, so saving keys never silently claims delivery.
    delivers: () => false,
    reason: 'Twilio is not connected yet. Messages are saved to history and are not sent.',
    savedButUnwired:
      'Twilio credentials are saved, but outbound SMS is not wired up yet. Messages are saved to history and are not sent.',
  },
  whatsapp: {
    label: 'WhatsApp',
    configured: () => credentialService.isConfigured('whatsapp'),
    delivers: () => false,
    reason:
      'The WhatsApp Business API is not connected yet. Messages are saved to history and are not sent.',
    savedButUnwired:
      'WhatsApp credentials are saved, but outbound sending is not wired up yet. Messages are saved to history and are not sent.',
  },
  /**
   * A note transports nothing - it records something said in person, so there
   * is no provider, nothing to configure and nothing that could fail. Same
   * shape as `call` for that reason, and the same `logged` status.
   */
  note: {
    label: 'Notes',
    configured: async () => true,
    reason: null,
  },
  call: {
    label: 'Calls',
    // A logged call records something that already happened on a phone, so
    // there is nothing to configure and nothing to send: its status is
    // `logged`, never `queued_unconfigured`. Click-to-dial is the deferred
    // half (§6b U5).
    configured: async () => true,
    reason: null,
  },
};

/**
 * What a channel can do right now - drives the persistent notice on each screen.
 *
 * Async since phase 11c: a channel's readiness now depends on credentials in
 * the database as well as the environment, and reading those is a query.
 */
async function channelStatus(channel) {
  const provider = CHANNEL_PROVIDERS[channel];
  if (!provider) throw ApiError.badRequest('Unknown channel.', 'UNKNOWN_CHANNEL');

  const configured = await provider.configured();

  /**
   * **`configured` and `delivers` are not the same question**, and phase 11c is
   * what separated them.
   *
   * `configured` means credentials are present. `delivers` means a message
   * actually leaves the building. For email they coincide. For SMS and WhatsApp
   * they do not: an admin can now save Twilio keys on the API Keys screen, but
   * nothing in this codebase transmits through them yet - that is phase 13
   * (§6b U3–U4).
   *
   * The screens' inactive notice keys on `delivers`, so saving keys does not
   * make a notice disappear from a channel that still cannot send. Collapsing
   * the two would have the panel quietly claim delivery it does not do, which
   * is precisely what §6b rule 4 exists to prevent.
   */
  const delivers = provider.delivers ? provider.delivers(configured) : configured;

  return {
    channel,
    label: provider.label,
    configured,
    delivers,
    // Neither `call` nor `note` transmits, so "configured" means something
    // different for both: there is no provider to be ready or unready.
    sends: channel !== 'call' && channel !== 'note',
    reason: delivers ? null : configured ? provider.savedButUnwired : provider.reason,
  };
}

async function channelStatuses() {
  const resolved = await Promise.all(MESSAGE_CHANNELS.map((channel) => channelStatus(channel)));
  return MESSAGE_CHANNELS.reduce(
    (out, channel, index) => ({ ...out, [channel]: resolved[index] }),
    {},
  );
}

// ---- serialisation ----------------------------------------------------------

function serializeMessage(row) {
  return {
    id: row._id.toString(),
    channel: row.channel,
    direction: row.direction,
    user: row.user ? String(row.user._id ?? row.user) : null,
    businessName: row.businessName ?? '',
    to: row.to ?? '',
    staffName: row.staffName ?? '',
    subject: row.subject ?? '',
    body: row.body ?? '',
    status: row.status,
    unconfiguredReason: row.unconfiguredReason ?? null,
    recordingUrl: row.recordingUrl ?? null,
    campaign: row.campaign ? String(row.campaign) : null,
    createdAt: row.createdAt,
  };
}

function serializeTemplate(row) {
  return {
    id: row._id.toString(),
    name: row.name,
    channel: row.channel,
    document: row.document ?? 'none',
    // Without this the grid cannot find the message it just saved: it looks a
    // template up by (channel, document, status), and a row answering with no
    // status matches the General cell instead of the one it belongs to.
    status: row.status ?? '',
    subject: row.subject ?? '',
    body: row.body,
    isActive: row.isActive !== false,
    createdAt: row.createdAt,
  };
}

function serializeCampaign(row) {
  return {
    id: row._id.toString(),
    name: row.name,
    subject: row.subject,
    body: row.body,
    audience: { filter: row.audience?.filter ?? 'approved', count: row.audience?.count ?? 0 },
    status: row.status,
    scheduledAt: row.scheduledAt ?? null,
    sentAt: row.sentAt ?? null,
    stats: {
      sent: row.stats?.sent ?? 0,
      delivered: row.stats?.delivered ?? 0,
      opened: row.stats?.opened ?? 0,
      clicked: row.stats?.clicked ?? 0,
      bounced: row.stats?.bounced ?? 0,
      unsubscribed: row.stats?.unsubscribed ?? 0,
      skipped: row.stats?.skipped ?? 0,
      queued: row.stats?.queued ?? 0,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---- messages ---------------------------------------------------------------

/**
 * The history panel beside every compose form.
 *
 * Scoped to one channel by default, because that is what the screens ask for.
 * `user` narrows it to one account for the client profile's contact history.
 */
async function listMessages({ channel, user, search, status, page = 1, limit = 25 } = {}) {
  const filter = {};
  if (channel) filter.channel = channel;
  if (user) filter.user = user;
  if (status) filter.status = status;
  if (search) {
    const rx = likeRegex(search);
    filter.$or = [{ businessName: rx }, { body: rx }, { subject: rx }, { to: rx }];
  }

  const perPage = Math.min(Number(limit) || 25, 100);
  const current = Math.max(Number(page) || 1, 1);

  const [rows, total] = await Promise.all([
    db().MessageLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((current - 1) * perPage)
      .limit(perPage)
      .lean(),
    db().MessageLog.countDocuments(filter),
  ]);

  return {
    messages: rows.map(serializeMessage),
    total,
    page: current,
    pages: Math.max(Math.ceil(total / perPage), 1),
  };
}

/**
 * Composes on one channel.
 *
 * The status is decided here from the provider's real state, never from the
 * request - a client cannot ask for a message to be marked sent. On an
 * unconfigured channel the row is still written and the caller gets back the
 * reason, which is what the screen shows instead of a confirmation (§6b rule 1).
 */
async function sendMessage(
  channel,
  { userId, body, subject, direction, recordingUrl, templateId },
  staff,
) {
  const status = await channelStatus(channel);

  const account = await db().User.findById(userId).lean();
  if (!account) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  let text = body;
  if (templateId) {
    const template = await db().MessageTemplate.findById(templateId).lean();
    if (!template) throw ApiError.notFound('Template not found.', 'TEMPLATE_NOT_FOUND');
    // A template fills an empty box; typed text always wins, so picking a
    // template and then editing it does not lose the edit.
    if (!text?.trim()) {
      // The sending business, so `{{shopName}}` resolves to whoever is
      // actually writing. Rendered without it the token was 'Cellvix' on
      // every business.
      const business = await sendingBusiness();
      text = db().MessageTemplate.render(template.body, account, {
        shopName: business.name,
      });
    }
  }

  if (!text?.trim() && channel !== 'call') {
    throw ApiError.badRequest('Write a message first.', 'EMPTY_MESSAGE');
  }

  const row = {
    channel,
    direction: direction ?? 'outbound',
    user: account._id,
    businessName: account.businessName,
    to: channel === 'email' ? account.email : (account.phone ?? ''),
    staff: staff?._id,
    staffName: staff?.contactName ?? '',
    subject: subject ?? '',
    body: text ?? '',
    recordingUrl: recordingUrl || undefined,
  };

  if (channel === 'call' || channel === 'note') {
    // Nothing is transmitted: both record a conversation that already
    // happened - one down a phone line, one across a counter.
    row.status = 'logged';
  } else if (channel === 'email') {
    if (isSuppressed(account, 'email')) {
      // A one-to-one email to a suppressed account is refused rather than
      // quietly logged. Somebody is choosing to write to a business that
      // cannot lawfully be written to, and they should learn that before it is
      // sent, not after.
      //
      // The two reasons are NOT the same and must not share a message: an
      // account that opted out made a decision that has to be respected, while
      // one that simply has no consent on file has decided nothing - it
      // predates the consent field, or was created by an import. Telling a
      // staff member that somebody "unsubscribed" when they never did sends them
      // to apologise for something that did not happen.
      throw account.unsubscribedAt
        ? ApiError.badRequest(
            `${account.businessName} has unsubscribed from email. Reach them another way.`,
            'RECIPIENT_UNSUBSCRIBED',
          )
        : ApiError.badRequest(
            `There is no marketing consent on file for ${account.businessName}, so email cannot be sent to them. Record consent on their profile first, or reach them another way.`,
            'RECIPIENT_NO_CONSENT',
          );
    }

    /**
     * The business writing, not the house brand.
     *
     * CASL requires the sender to identify themselves on every commercial
     * message, and `decorate` puts that identification in the footer. Naming
     * the wrong company there is a compliance failure rather than a branding
     * slip - the recipient consented to hear from the business they deal with.
     */
    const business = await sendingBusiness();
    const origin = await storefrontOrigin();

    const result = await sendMail({
      to: account.email,
      subject: subject || `A message from ${business.name}`,
      html: decorate(text, account, business, origin),
      text,
    });
    row.status = result.delivered ? 'sent' : 'failed';
    row.provider = result.via;
    // An email that did not go out is a failure, not a queue: there is no
    // outbox holding it and no retry behind it. The screen prints the reason.
    if (!result.delivered) {
      row.unconfiguredReason = result.error ?? 'The message could not be delivered.';
    }
  } else {
    /**
     * SMS and WhatsApp now carry the same consent gate email has.
     *
     * They had none, because before per-channel consent there was nothing to
     * check that was not simply the email flag - and refusing an SMS on the
     * grounds of email consent would have been wrong. Now that a customer can
     * say "email yes, SMS no", that answer has to be honoured on the channel it
     * was given about, and it is checked **before** the message is written:
     * `queued_unconfigured` means "we will send this when the provider is
     * wired", so logging one to somebody who has declined the channel would
     * queue up a future violation rather than prevent one.
     */
    if (isSuppressed(account, channel)) {
      throw account.unsubscribedAt
        ? ApiError.badRequest(
            `${account.businessName} has unsubscribed. Reach them another way.`,
            'RECIPIENT_UNSUBSCRIBED',
          )
        : ApiError.badRequest(
            `${account.businessName} has not consented to ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}. Record consent on their profile first, or reach them another way.`,
            'RECIPIENT_NO_CONSENT',
          );
    }

    // **Credentials are stored but no client sends them yet**
    // - that is phase 13's job (§6b U3–U4), and this file has no Twilio or
    // WhatsApp SDK in it.
    //
    // So having keys changes what the row *says*, never whether it sent. The
    // alternative is worse in both directions: reporting `sent` would be a lie
    // (§6b rule 4), and repeating "Twilio is not connected" after an admin has
    // just connected Twilio would send them back to the API Keys screen to fix
    // something that is not broken.
    row.status = 'queued_unconfigured';
    // `channelStatus` already picks the right sentence for whether credentials
    // are merely absent or present-but-unwired, so there is one place that
    // decides what a staff member is told.
    row.unconfiguredReason = status.reason;
  }

  const saved = await db().MessageLog.create(row);

  return {
    message: serializeMessage(saved),
    // Rendered verbatim by the screen rather than each one inventing its own
    // wording, so "what did the system actually do" has one answer.
    notice: saved.status === 'queued_unconfigured' ? saved.unconfiguredReason : null,
  };
}

// ---- templates --------------------------------------------------------------

async function listTemplates({ channel } = {}) {
  const filter = {};
  if (channel) filter.channel = channel;
  const rows = await db().MessageTemplate.find(filter).sort({ channel: 1, name: 1 }).lean();
  return { templates: rows.map(serializeTemplate) };
}

async function createTemplate(data, staff) {
  const row = await db().MessageTemplate.create({ ...data, createdBy: staff?._id });
  return { template: serializeTemplate(row) };
}

async function updateTemplate(id, data) {
  const row = await db().MessageTemplate.findByIdAndUpdate(id, data, { new: true });
  if (!row) throw ApiError.notFound('Template not found.', 'TEMPLATE_NOT_FOUND');
  return { template: serializeTemplate(row) };
}

async function deleteTemplate(id) {
  const row = await db().MessageTemplate.findByIdAndDelete(id);
  if (!row) throw ApiError.notFound('Template not found.', 'TEMPLATE_NOT_FOUND');
  return { ok: true };
}

// ---- consent ----------------------------------------------------------------

/**
 * Is this account excluded from commercial contact on `channel`?
 *
 * Three gates, in the order they outrank each other:
 *
 *   1. `unsubscribedAt` - the customer's own withdrawal. A later withdrawal
 *      always beats an earlier opt-in, whatever order the fields were written.
 *   2. `marketingConsent.granted` - the master switch every campaign query
 *      already checks, and the one an admin moves.
 *   3. `contactConsent[channel]` - what they agreed to be reached **on**.
 *
 * **A missing channel record is not a refusal.** Accounts that predate the
 * channel field have never been asked, and treating "not recorded" as "no"
 * would silently empty every existing audience the moment this shipped. So the
 * channel gate applies only once somebody has actually answered
 * (`contactConsent.at` is set); until then the master flag decides alone, which
 * is exactly the behaviour that was here before.
 *
 * `channel` is optional so existing callers that ask the general question keep
 * working unchanged.
 */
function isSuppressed(account, channel) {
  if (account?.unsubscribedAt) return true;
  if (account?.marketingConsent?.granted !== true) return true;

  if (!channel || !account?.contactConsent?.at) return false;
  return account.contactConsent[channel] !== true;
}

/**
 * The token in an unsubscribe link.
 *
 * An HMAC of the account id rather than the id itself: a bare id in a URL is an
 * enumeration hole that would let anyone unsubscribe anyone. Keyed on
 * `JWT_SECRET` because that is the secret this deployment already has. It
 * carries no expiry on purpose - an unsubscribe link that stops working is a
 * CASL problem, not a security improvement.
 */
function unsubscribeToken(userId) {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`unsubscribe:${String(userId)}`)
    .digest('hex')
    .slice(0, 32);
}

function unsubscribeUrl(account, origin = env.publicOrigin) {
  const id = String(account._id);
  // The business's own storefront (`linkOrigins.storefrontOrigin`), passed in
  // by the async sender: `/unsubscribe` is a storefront page, and on a split
  // installation the platform apex no longer serves one.
  return `${origin}/unsubscribe?u=${id}&t=${unsubscribeToken(id)}`;
}

/**
 * Wraps a campaign body in what the law requires: who is writing, how to reach
 * them, and how to stop receiving it.
 *
 * Applied here rather than in the composer so no campaign can ship without it.
 * The body is escaped on the way in - admin-authored copy is never trusted as
 * markup, on the server any more than on the client (Instructions §9).
 */
function decorate(body, account, business = BUSINESS_INFO, origin = env.publicOrigin) {
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>]/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character],
    );

  const paragraphs = String(body ?? '')
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${escape(block).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const { line1, city, region, postal } = business.address ?? {};
  const address = [line1, city, [region, postal].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');

  return [
    '<div style="font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#0A0A0B;max-width:600px">',
    paragraphs,
    '<hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0">',
    // CASL: sender identification and a working unsubscribe on every
    // commercial message. Not optional, and not the author's job to remember.
    `<p style="font-size:12px;color:#6B6B6B;margin:0 0 8px">${escape(business.name)}${address ? ` - ${escape(address)}` : ''}</p>`,
    '<p style="font-size:12px;color:#6B6B6B;margin:0">You are receiving this because you hold a wholesale account with us. ',
    `<a href="${unsubscribeUrl(account, origin)}" style="color:#CF3429">Unsubscribe</a>.</p>`,
    '</div>',
  ].join('');
}

/**
 * Turns an audience filter into the accounts that will actually receive a send.
 *
 * Two layers, and the order matters: the filter picks a population, then
 * consent removes from it. `skipped` is the difference, reported so that a send
 * of 12 against an audience of 40 is explained rather than looking broken.
 *
 * Staff and admin accounts are never in an audience - they are Cellvix, not
 * customers.
 */
async function resolveAudience(filter = 'approved') {
  const base = { role: 'buyer' };

  if (filter === 'approved') base.status = 'approved';
  else if (filter === 'pending') base.status = 'pending';
  else if (filter === 'all_customers') base.status = { $in: ['approved', 'pending'] };
  else if (filter === 'with_orders') base.status = 'approved';
  else throw ApiError.badRequest('Unknown audience.', 'UNKNOWN_AUDIENCE');

  let candidates = await db().User.find(base)
    .select('email businessName contactName marketingConsent contactConsent unsubscribedAt')
    .lean();

  if (filter === 'with_orders') {
    const ids = await db().Order.distinct('user', {});
    const placed = new Set(ids.map(String));
    candidates = candidates.filter((row) => placed.has(String(row._id)));
  }

  // Campaigns are email, and now say so: an account that consented to SMS but
  // not email is not in an email campaign's audience.
  const eligible = candidates.filter((row) => !isSuppressed(row, 'email'));

  return { eligible, matched: candidates.length, skipped: candidates.length - eligible.length };
}

// ---- campaigns --------------------------------------------------------------

async function listCampaigns({ status, search, page = 1, limit = 25 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (search) filter.$or = [{ name: likeRegex(search) }, { subject: likeRegex(search) }];

  const perPage = Math.min(Number(limit) || 25, 100);
  const current = Math.max(Number(page) || 1, 1);

  const [rows, total] = await Promise.all([
    db().Campaign.find(filter)
      .sort({ createdAt: -1 })
      .skip((current - 1) * perPage)
      .limit(perPage)
      .lean(),
    db().Campaign.countDocuments(filter),
  ]);

  return {
    campaigns: rows.map(serializeCampaign),
    total,
    page: current,
    pages: Math.max(Math.ceil(total / perPage), 1),
  };
}

async function getCampaign(id) {
  const row = await db().Campaign.findById(id).lean();
  if (!row) throw ApiError.notFound('Campaign not found.', 'CAMPAIGN_NOT_FOUND');

  // The recipient count is recomputed on read rather than trusted from the
  // document: consent moves between saves, and a stale figure here is the one
  // the staff member would use to decide whether to send.
  const { eligible, skipped } = await resolveAudience(row.audience?.filter ?? 'approved');

  return {
    campaign: serializeCampaign(row),
    audience: { eligible: eligible.length, skipped },
  };
}

async function createCampaign(data, staff) {
  const { eligible } = await resolveAudience(data.audience?.filter ?? 'approved');
  const row = await db().Campaign.create({
    ...data,
    audience: { filter: data.audience?.filter ?? 'approved', count: eligible.length },
    status: 'draft',
    createdBy: staff?._id,
  });
  return { campaign: serializeCampaign(row) };
}

/**
 * Edits stop once a campaign has gone out.
 *
 * A sent campaign is a record of what was said. Editing it would rewrite
 * history that the recipients already hold a copy of.
 */
async function updateCampaign(id, data) {
  const row = await db().Campaign.findById(id);
  if (!row) throw ApiError.notFound('Campaign not found.', 'CAMPAIGN_NOT_FOUND');
  if (row.status === 'sent' || row.status === 'sending') {
    throw ApiError.badRequest(
      'This campaign has already gone out and cannot be edited. Create a new one instead.',
      'CAMPAIGN_ALREADY_SENT',
    );
  }

  const filter = data.audience?.filter ?? row.audience?.filter ?? 'approved';
  const { eligible } = await resolveAudience(filter);

  row.name = data.name ?? row.name;
  row.subject = data.subject ?? row.subject;
  row.body = data.body ?? row.body;
  row.audience = { filter, count: eligible.length };
  await row.save();

  return { campaign: serializeCampaign(row) };
}

async function deleteCampaign(id) {
  const row = await db().Campaign.findById(id);
  if (!row) throw ApiError.notFound('Campaign not found.', 'CAMPAIGN_NOT_FOUND');
  if (row.status === 'sent') {
    throw ApiError.badRequest(
      'A sent campaign is a record of what went out and stays on file.',
      'CAMPAIGN_ALREADY_SENT',
    );
  }
  await row.deleteOne();
  return { ok: true };
}

/**
 * Sends a campaign.
 *
 * The audience is resolved **now**, not at compose time, so an account that
 * unsubscribed in between is excluded. Every message is decorated with sender
 * identification and an unsubscribe link, and each gets its own `MessageLog`
 * row, so a client profile's contact history shows campaign mail alongside the
 * one-to-one messages.
 *
 * Failures are per-recipient and never abort the run: one bad address must not
 * cost the other thirty-nine their message. The counts returned say exactly
 * what happened, which is why `sent` is incremented rather than assumed.
 */
async function sendCampaign(id, staff) {
  const row = await db().Campaign.findById(id);
  if (!row) throw ApiError.notFound('Campaign not found.', 'CAMPAIGN_NOT_FOUND');
  if (row.status === 'sent' || row.status === 'sending') {
    throw ApiError.badRequest('This campaign has already been sent.', 'CAMPAIGN_ALREADY_SENT');
  }

  const { eligible, skipped } = await resolveAudience(row.audience?.filter ?? 'approved');
  if (eligible.length === 0) {
    throw ApiError.badRequest(
      'Nobody in this audience has consented to marketing email, so there is nobody to send to.',
      'EMPTY_AUDIENCE',
    );
  }

  row.status = 'sending';
  await row.save();

  // Resolved once for the whole send, not per recipient: it is the same business
  // for every message in a campaign, and a lookup inside the loop would be one
  // query per account for an answer that cannot change mid-send.
  const business = await sendingBusiness();
  const origin = await storefrontOrigin();

  let sent = 0;
  let queued = 0;
  let failed = 0;

  for (const account of eligible) {
    const body = db().MessageTemplate.render(row.body, account, {
      shopName: business.name,
    });
    let status = 'failed';
    let reason;

    try {
      const result = await sendMail({
        to: account.email,
        subject: db().MessageTemplate.render(row.subject, account, {
          shopName: business.name,
        }),
        html: decorate(body, account, business, origin),
        text: body,
      });
      status = result.delivered ? 'sent' : 'failed';
      if (!result.delivered) {
        reason = result.error ?? 'The message could not be delivered.';
      }
    } catch (error) {
      // `sendMail` resolves on every path, so arriving here means something
      // unforeseen. It is counted, and the run carries on.
      reason = error.message;
    }

    if (status === 'sent') sent += 1;
    else if (status === 'queued_unconfigured') queued += 1;
    else failed += 1;

    await db().MessageLog.create({
      channel: 'email',
      direction: 'outbound',
      user: account._id,
      businessName: account.businessName,
      to: account.email,
      staff: staff?._id,
      staffName: staff?.contactName ?? '',
      subject: row.subject,
      body,
      status,
      unconfiguredReason: reason,
      campaign: row._id,
      provider: 'mailer',
    });
  }

  row.status = failed === eligible.length ? 'failed' : 'sent';
  row.sentAt = new Date();
  // `sent` counts accepted messages only. Failures and unsendable channels are
  // reported separately rather than inflating it - §6b rule 4 governs numbers
  // as much as words.
  row.stats.sent = sent;
  row.stats.delivered = sent;
  row.stats.bounced = failed;
  row.stats.skipped = skipped;
  row.stats.queued = queued;
  row.audience.count = eligible.length;
  await row.save();

  return {
    campaign: serializeCampaign(row),
    result: { sent, queued, failed, skipped, audience: eligible.length },
  };
}

// ---- unsubscribes -----------------------------------------------------------

/** The Unsubscribes screen: who opted out, and when. */
async function listUnsubscribes({ search, page = 1, limit = 25 } = {}) {
  const filter = { unsubscribedAt: { $ne: null } };
  if (search) filter.$or = [{ businessName: likeRegex(search) }, { email: likeRegex(search) }];

  const perPage = Math.min(Number(limit) || 25, 100);
  const current = Math.max(Number(page) || 1, 1);

  const [rows, total, consenting] = await Promise.all([
    db().User.find(filter)
      .select('businessName contactName email unsubscribedAt marketingConsent contactConsent')
      .sort({ unsubscribedAt: -1 })
      .skip((current - 1) * perPage)
      .limit(perPage)
      .lean(),
    db().User.countDocuments(filter),
    db().User.countDocuments({ role: 'buyer', unsubscribedAt: null, 'marketingConsent.granted': true }),
  ]);

  return {
    unsubscribes: rows.map((row) => ({
      id: row._id.toString(),
      businessName: row.businessName,
      contactName: row.contactName,
      email: row.email,
      unsubscribedAt: row.unsubscribedAt,
      consentSource: row.marketingConsent?.source ?? null,
      consentAt: row.marketingConsent?.at ?? null,
    })),
    total,
    consenting,
    page: current,
    pages: Math.max(Math.ceil(total / perPage), 1),
  };
}

/**
 * The public unsubscribe endpoint, reached from the link in every campaign.
 *
 * No session required - somebody unsubscribing is very often not signed in, and
 * CASL requires the mechanism to work in no more than two clicks. The HMAC
 * stands in for authentication: it proves the link came from us without letting
 * anybody unsubscribe an account by guessing an id.
 *
 * Idempotent. Unsubscribing twice is a success, not an error: a person clicking
 * the link again should be reassured, not shown a failure.
 */
async function unsubscribe(userId, token) {
  const expected = unsubscribeToken(userId);
  const given = String(token ?? '');

  // Constant-time compare. Guessing the token is impractical anyway, but a
  // timing-safe check costs nothing here.
  const ok =
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));

  if (!ok) {
    throw ApiError.badRequest('That unsubscribe link is not valid.', 'INVALID_UNSUBSCRIBE_TOKEN');
  }

  const account = await db().User.findById(userId).select('businessName email unsubscribedAt');
  if (!account) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  if (!account.unsubscribedAt) {
    account.unsubscribedAt = new Date();
    await account.save();
  }

  return {
    ok: true,
    businessName: account.businessName,
    email: account.email,
    unsubscribedAt: account.unsubscribedAt,
  };
}

/**
 * An admin putting an account back on the list.
 *
 * This records a **new** consent with source `admin` rather than clearing the
 * unsubscribe and leaving the old consent standing - re-subscribing somebody is
 * a claim that they asked for it, and that claim needs its own date and its own
 * trail. The screen says as much before the staff member confirms.
 */
async function resubscribe(userId) {
  const account = await db().User.findById(userId);
  if (!account) throw ApiError.notFound('Account not found.', 'USER_NOT_FOUND');

  account.unsubscribedAt = undefined;
  account.marketingConsent = { granted: true, source: 'admin', at: new Date() };
  await account.save();

  return { ok: true };
}

// ---- the marketing overview -------------------------------------------------

/** Counts and channel states for the marketing screens' header tiles. */
async function summary() {
  const [byChannel, campaigns, unsubscribed, consenting, settings] = await Promise.all([
    db().MessageLog.aggregate([{ $group: { _id: '$channel', count: { $sum: 1 } } }]),
    db().Campaign.countDocuments({}),
    db().User.countDocuments({ role: 'buyer', unsubscribedAt: { $ne: null } }),
    db().User.countDocuments({ role: 'buyer', unsubscribedAt: null, 'marketingConsent.granted': true }),
    db().Settings.load(),
  ]);

  return {
    messages: byChannel.reduce((out, row) => ({ ...out, [row._id]: row.count }), {}),
    campaigns,
    unsubscribed,
    consenting,
    channels: await channelStatuses(),
    businessName: settings?.business?.name ?? BUSINESS_INFO.name,
  };
}

/**
 * The send caps, and how much of each has been used.
 *
 * The usage half is the point: a cap with no counter beside it is a number
 * nobody can act on, and the question a staff member actually has is "how
 * close are we". Counted from `MessageLog` rather than from a running total,
 * because the log is what a send writes and a separate counter would drift
 * from it the first time anything failed midway.
 *
 * Outbound only. An inbound reply is not something this business sent, so
 * counting it toward a send cap would let a busy inbox switch off sending.
 */
async function listLimits() {
  const settings = await db().Settings.load();
  const stored = settings?.communications?.limits ?? {};

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [today, month] = await Promise.all([
    db().MessageLog.aggregate([
      { $match: { direction: 'outbound', createdAt: { $gte: startOfDay } } },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
    ]),
    db().MessageLog.aggregate([
      { $match: { direction: 'outbound', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
    ]),
  ]);

  const countBy = (rows) => rows.reduce((out, row) => ({ ...out, [row._id]: row.count }), {});
  const usedToday = countBy(today);
  const usedMonth = countBy(month);

  return {
    limits: MESSAGE_CHANNELS.map((channel) => {
      const row = stored?.[channel] ?? {};
      return {
        channel,
        daily: row.daily ?? 0,
        monthly: row.monthly ?? 0,
        alertPercent: row.alertPercent ?? 80,
        alertEmail: row.alertEmail ?? '',
        usedToday: usedToday[channel] ?? 0,
        usedThisMonth: usedMonth[channel] ?? 0,
      };
    }),
  };
}

/** Save one channel s caps. See `messageLimitSchema` on why one at a time. */
async function saveLimit(body = {}) {
  const channel = String(body.channel);
  if (!MESSAGE_CHANNELS.includes(channel)) {
    throw ApiError.badRequest('Unknown channel.', 'UNKNOWN_CHANNEL');
  }

  await db().Settings.updateOne(
    { key: 'singleton' },
    {
      $set: {
        [`communications.limits.${channel}.daily`]: Number(body.daily) || 0,
        [`communications.limits.${channel}.monthly`]: Number(body.monthly) || 0,
        [`communications.limits.${channel}.alertPercent`]: Number(body.alertPercent) || 0,
        [`communications.limits.${channel}.alertEmail`]: String(body.alertEmail ?? '').trim(),
      },
    },
    { upsert: true },
  );

  return listLimits();
}

export default {
  channelStatus,
  channelStatuses,
  listMessages,
  sendMessage,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  listUnsubscribes,
  unsubscribe,
  resubscribe,
  resolveAudience,
  summary,
  listLimits,
  saveLimit,
};

export { channelStatus, channelStatuses, listMessages, sendMessage, listTemplates, createTemplate, updateTemplate, deleteTemplate, isSuppressed, unsubscribeToken, resolveAudience, listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign, sendCampaign, listUnsubscribes, unsubscribe, resubscribe, summary, listLimits, saveLimit };
