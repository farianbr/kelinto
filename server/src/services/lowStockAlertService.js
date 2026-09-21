import { db } from '../db/models.js';
import '../models/Settings.js';
import { getReorderQueue } from './reorderService.js';
import { sendLowStockEmail } from './transactionalMail.js';

/**
 * The low-stock alert, sent to the shop rather than to a customer.
 *
 * ## Why this is not part of the invoice-message pass
 *
 * `invoiceStatusService.run` is the obvious place to hang a daily job, and it
 * is the wrong one: it returns early unless `communications.invoiceReminders`
 * is on, so a shop that wanted stock alerts but not invoice chasers would get
 * neither. The two switches are separate on the Email Settings screen because
 * they are separate decisions, and sharing a gate would quietly make one
 * depend on the other.
 *
 * ## Why not the notification bell
 *
 * `notificationService` already computes this queue, and that is a **read**
 * path - it runs on every poll of the bell. Sending mail from it would email
 * the shop on every page load. This is a job, called deliberately.
 *
 * ## Once a day, at most
 *
 * The same shelves are low tomorrow, so a job run twice sends twice unless
 * something remembers. `communications.lowStockAlertAt` is that memory: a
 * timestamp on the settings document, checked before sending and written
 * after. It means a re-run on the same day is a no-op rather than a second
 * mail, and a cron that fires hourly is safe.
 */
async function sendLowStockAlert({ force = false, now = new Date() } = {}) {
  const settings = await db().Settings.load();
  const comms = settings?.communications ?? {};

  if (!comms.lowStockAlerts) {
    return { sent: false, reason: 'Low-stock alerts are switched off in Email Settings.' };
  }

  const to = comms.lowStockEmail || comms.adminEmail;
  if (!to) {
    return {
      sent: false,
      reason: 'No alert address is set. Add one on Email Settings first.',
    };
  }

  // Already sent today, unless a human asked for it from the screen.
  if (!force && comms.lowStockAlertAt) {
    const last = new Date(comms.lowStockAlertAt);
    if (last.toDateString() === now.toDateString()) {
      return { sent: false, reason: 'An alert has already gone out today.' };
    }
  }

  const { items, counts } = await getReorderQueue();
  if (!counts.total) {
    return { sent: false, reason: 'Nothing is at or below its reorder point.' };
  }

  const result = await sendLowStockEmail({ to, items, total: counts.total });

  if (result?.delivered) {
    // Stamped only on a real send: a failed attempt must not suppress
    // tomorrow's, which is the whole point of remembering.
    await db().Settings.updateOne(
      { key: 'singleton' },
      { $set: { 'communications.lowStockAlertAt': now } },
      { upsert: true },
    );
  }

  return {
    sent: Boolean(result?.delivered),
    to,
    count: counts.total,
    reason: result?.delivered ? undefined : result?.error,
  };
}

export { sendLowStockAlert };
export default { sendLowStockAlert };
