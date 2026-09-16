import { db } from '../db/models.js';
import '../models/MessageLog.js';
import '../models/User.js';
import { sendMail } from './mailer.js';
import { channelStatus } from './marketingService.js';
import { displayNameOf } from '../utils/displayName.js';

/**
 * Telling a customer their repair moved (Sales § Ticket).
 *
 * ## Why this is not `marketingService.sendMessage`
 *
 * Three reasons, and each of them would be a bug if this reused that path.
 *
 * **It must never throw.** `sendMessage` refuses a suppressed recipient with a
 * `400`, which is right for a staff member deliberately writing to somebody - they
 * should learn before it sends, not after. Here the caller is a status change,
 * and a repair that cannot be marked ready because a notification failed is a
 * workshop blocked by its own mail server. Everything below resolves; nothing
 * rejects.
 *
 * **A status update is transactional, not marketing.** `isSuppressed` gates on
 * `marketingConsent.granted`, which is consent to be *advertised to*. Telling
 * somebody the device they handed over is ready is not advertising, it is the
 * service they asked for, and refusing to send it because they declined a
 * newsletter would leave devices sitting uncollected. **`unsubscribedAt` is
 * still honoured** - somebody who has asked to stop hearing from us entirely
 * gets nothing - and so is per-channel consent, because a customer who said
 * "no SMS" meant it about SMS.
 *
 * **It routes by preference, not by whatever is configured.** The channel comes
 * from `User.preferredContact`, which is the single thread the whole sales flow
 * hangs on: captured once at the counter or the kiosk, reused at every later
 * notification point.
 *
 * ## What it does when it cannot send
 *
 * It logs the row anyway, with a status saying why. A `MessageLog` entry that
 * records "we would have texted them, there is no SMS provider connected" is
 * worth far more than silence - it is what a staff member reads when a customer
 * rings asking why nobody told them.
 */

/** Which statuses are worth a customer's attention. */
const NOTIFIABLE = {
  diagnosis: {
    subject: 'We have your device',
    line: (ticket) =>
      `We have received your ${deviceName(ticket)} and it is booked in for diagnosis. Your reference is ${ticket.ticketNumber}.`,
  },
  accepted: {
    subject: 'Your repair is booked in',
    line: (ticket) =>
      `Your ${deviceName(ticket)} has been accepted for repair. Your reference is ${ticket.ticketNumber}.`,
  },
  waiting_for_parts: {
    subject: 'Waiting on a part',
    line: (ticket) =>
      `We are waiting on a part for your ${deviceName(ticket)}. We will let you know as soon as it arrives.`,
  },
  ready_to_repair: {
    subject: 'Your repair is starting',
    line: (ticket) => `Everything is in to repair your ${deviceName(ticket)} and work is starting.`,
  },
  processing: {
    subject: 'Your repair is under way',
    line: (ticket) => `We are working on your ${deviceName(ticket)} now.`,
  },
  ready_to_pickup: {
    subject: 'Your device is ready to collect',
    line: (ticket) =>
      `Good news, your ${deviceName(ticket)} is ready to collect. Please bring your reference, ${ticket.ticketNumber}.`,
  },
  completed: {
    subject: 'Thanks from all of us',
    line: (ticket) =>
      `Your ${deviceName(ticket)} repair is complete and collected. Thank you for choosing us.`,
  },
  cancelled: {
    subject: 'Your repair has been cancelled',
    line: (ticket) =>
      `The repair on your ${deviceName(ticket)} has been cancelled. Please get in touch if that is not what you expected.`,
  },
};

/**
 * `retention_policy` is deliberately absent.
 *
 * It is an internal state about how long the shop keeps an uncollected device,
 * and a message announcing it would read as a threat rather than an update.
 * When a shop wants to chase an uncollected device, that is a deliberate
 * message a staff member writes, not an automatic one.
 */

function deviceName(ticket) {
  const first = ticket.devices?.[0];
  const parts = [first?.brand ?? ticket.deviceBrand, first?.model ?? ticket.deviceModel];
  const name = parts.filter(Boolean).join(' ').trim();
  return name || 'device';
}

/**
 * Whether this channel may carry a transactional message to this account.
 *
 * Deliberately NOT `marketingService.isSuppressed` - see the note above. A
 * customer who never answered the consent question still gets told their device
 * is ready: they handed it over and asked to be contacted about it, which is
 * the basis for this message and not the one consent covers.
 */
function channelAllowed(account, channel) {
  // A full unsubscribe outranks everything, including this.
  if (account?.unsubscribedAt) return false;

  // Never asked. Transactional messages are still allowed - silence is not a
  // refusal, and a repair update is the service they came in for.
  if (!account?.contactConsent?.at) return true;

  // Asked and answered. An explicit "no" on this channel is honoured.
  return account.contactConsent[channel] === true;
}

/**
 * Send one status update, on the customer's preferred channel.
 *
 * **Always resolves.** The return value says what happened so a caller can log
 * it, and nothing here is allowed to fail a status change.
 *
 * @returns `{ sent, reason, channel }`
 */
/**
 * @param {string[]} [allowed]  channels the staff member permitted for this
 *   move. Absent means all of them; an EMPTY array means none, which is how a
 *   status is changed silently. It never widens anything: the customer is
 *   still only ever messaged on the channel they chose.
 */
async function notifyStatusChange(ticket, status, actor = null, allowed = null) {
  const copy = NOTIFIABLE[status];
  if (!copy) return { sent: false, reason: 'status-not-notifiable', channel: null };

  try {
    // A walk-in with no account has no preference to read and no history to
    // write against - `MessageLog.user` is required for exactly that reason.
    if (!ticket.user) return { sent: false, reason: 'no-account', channel: null };

    const userId = ticket.user._id ?? ticket.user;
    const account = await db().User.findById(userId).lean();
    if (!account) return { sent: false, reason: 'no-account', channel: null };

    const channel = account.preferredContact;

    /**
     * The staff member unticked this channel on the confirmation.
     *
     * **`call` is exempt unless the list is empty.** The confirmation offers
     * Email, SMS and WhatsApp - the three things that transmit - so a customer
     * whose preference is `call` matches none of them and would be silently
     * dropped by a staff member who unticked nothing. A call is not a message
     * anyway: it is logged below as a task for somebody to ring them, and the
     * dialog never offered to switch that off.
     *
     * An EMPTY list is different and does suppress it: that is "change the
     * status silently", which is a decision about the customer rather than
     * about a transport.
     */
    if (Array.isArray(allowed)) {
      const suppressed = channel === 'call' ? allowed.length === 0 : !allowed.includes(channel);
      if (suppressed) {
        return { sent: false, reason: 'channel-skipped-by-staff', channel };
      }
    }

    if (!channel) {
      // Nobody asked how to reach them. Worth recording rather than silently
      // skipping: it is the prompt to go and ask.
      return { sent: false, reason: 'no-preferred-channel', channel: null };
    }

    if (!channelAllowed(account, channel)) {
      return { sent: false, reason: 'channel-declined', channel };
    }

    const body = copy.line(ticket);
    const to = channel === 'email' ? account.email : (account.phone ?? '');
    if (!to) return { sent: false, reason: 'no-address', channel };

    const row = {
      channel,
      direction: 'outbound',
      user: userId,
      businessName: displayNameOf(account),
      to,
      staff: actor ?? undefined,
      subject: copy.subject,
      body,
      status: 'queued_unconfigured',
    };

    if (channel === 'call') {
      /**
       * A call cannot be placed automatically, and pretending otherwise would
       * be the worst outcome here: the row would say "sent" and nobody would
       * have rung. It is logged as a task instead, which is what a call always
       * is in this system.
       */
      row.status = 'logged';
      row.body = `Call the customer: ${body}`;
      await db().MessageLog.create(row);
      return { sent: false, reason: 'call-logged-for-staff', channel };
    }

    if (channel === 'email') {
      const result = await sendMail({
        to: account.email,
        subject: copy.subject,
        html: `<p>${body}</p>`,
        text: body,
      });
      row.status = result.delivered ? 'sent' : 'failed';
      row.provider = result.via;
      if (!result.delivered) {
        row.unconfiguredReason = result.error ?? 'The message could not be delivered.';
      }
      await db().MessageLog.create(row);
      return { sent: result.delivered, reason: result.delivered ? 'sent' : 'mail-failed', channel };
    }

    /**
     * SMS and WhatsApp.
     *
     * **Gated on `delivers`, never on `configured`** - the two are different
     * questions and §6b rule 4 exists because of it. An admin can save Twilio
     * keys on the API Keys screen, which makes the channel `configured`, while
     * nothing in this codebase transmits through them yet. Keying on
     * `configured` would write `status: 'sent'` for a message that never left
     * the building, and the one thing worse than not telling a customer their
     * device is ready is a log insisting we did.
     */
    const provider = await channelStatus(channel);
    if (!provider?.delivers) {
      row.status = 'queued_unconfigured';
      row.unconfiguredReason =
        provider?.reason ?? `No ${channel.toUpperCase()} provider is connected.`;
      await db().MessageLog.create(row);
      return { sent: false, reason: 'provider-not-configured', channel };
    }

    row.status = 'sent';
    row.provider = provider.label;
    await db().MessageLog.create(row);
    return { sent: true, reason: 'sent', channel };
  } catch (error) {
    /**
     * Swallowed on purpose, and this is the whole point of the module.
     *
     * A technician marking a device ready must not be blocked because a mail
     * server timed out or a log write failed. The failure is reported in the
     * return value and the status change proceeds regardless.
     */
    return { sent: false, reason: `error: ${error.message}`, channel: null };
  }
}

export { NOTIFIABLE, channelAllowed, notifyStatusChange };
export default { notifyStatusChange };
