import { toast } from '@/store/toastStore';

/**
 * Say what a ticket status change actually did, beyond moving the status.
 *
 * Two side effects ride along with a move and **both fail quietly on purpose**:
 * the customer notification (a mail server must not block a technician) and the
 * invoice raised at `ready_to_pickup` (an unbillable ticket must not either).
 * Failing quietly is right; staying quiet about it is not. A staff member who has
 * just marked a device ready needs to know the customer was NOT texted at the
 * moment it happens, not when somebody rings to ask why nobody called.
 *
 * **Shared by the list and the detail screen**, because a status can be moved
 * from either and a customer messaged from one but not the other would be the
 * kind of difference nobody notices until it matters.
 *
 * The copy is deliberately what to do next rather than an error code: "no
 * preferred channel on file" is a prompt to go and ask, not a fault.
 */
const NOTIFY_MESSAGE = {
  'no-account': 'This is a walk-in with no account, so nobody was messaged.',
  'no-preferred-channel':
    'No preferred channel is recorded for this customer, so nobody was messaged. Set one on their profile.',
  'channel-declined':
    'This customer has declined that channel, so nobody was messaged. Reach them another way.',
  'no-address': 'There is no address on file for that channel, so nobody was messaged.',
  'call-logged-for-staff':
    'This customer prefers a phone call, so it is logged for somebody to make.',
  'provider-not-configured':
    'No provider is connected for that channel, so the message is logged but not sent.',
  'mail-failed': 'The email could not be delivered. It is logged with the reason.',
};

/**
 * The one "not sent" that is not a problem.
 *
 * The staff member unticked the channel on the confirmation, so this is the
 * thing they asked for. Reported, because a silent status change and a silent
 * FAILURE look identical from the outside and somebody has to be able to tell
 * them apart - but as a neutral note rather than the red "Customer not
 * notified", which would be the interface arguing with a decision it just took.
 */
const SKIPPED_BY_STAFF = 'channel-skipped-by-staff';

export function reportStatusOutcome(payload) {
  const notified = payload?.notified;

  if (notified && !notified.sent && notified.reason === SKIPPED_BY_STAFF) {
    toast.info('Status changed quietly', 'The customer was not messaged, as you asked.');
  } else if (notified && !notified.sent) {
    const message = NOTIFY_MESSAGE[notified.reason];
    // An unrecognised reason is still worth surfacing verbatim rather than
    // swallowing: it is almost always the `error: ...` branch.
    if (message) toast.error('Customer not notified', message);
    else if (notified.reason?.startsWith('error:')) {
      toast.error('Customer not notified', notified.reason.replace('error: ', ''));
    }
  } else if (notified?.sent) {
    toast.ok('Customer notified', `Sent by ${notified.channel}.`);
  }

  if (payload?.invoice) {
    toast.ok('Invoice raised', `${payload.invoice.number} was created for this repair.`);
  } else if (payload?.invoiceError) {
    toast.error('No invoice raised', payload.invoiceError);
  }
}

export default reportStatusOutcome;
