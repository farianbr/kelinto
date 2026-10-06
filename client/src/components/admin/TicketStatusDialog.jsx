import { useEffect, useState } from 'react';
import { Mail, MessageCircle, MessageSquare } from 'lucide-react';

import { TICKET_STATUS_LABELS } from '@shared/schemas/admin';
import { titleize } from '@/lib/format';
import reportStatusOutcome from '@/lib/ticketStatusOutcome';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Checkbox from '@/components/ui/Checkbox';
import { useAdminMutations } from '@/hooks/useAdmin';

/**
 * The channels the confirmation offers to suppress.
 *
 * **These are permissions, not sends.** The customer is messaged on the ONE
 * channel recorded on their profile; unticking a row here says "not by that
 * route this time", and unticking every row changes the status silently. Which
 * is why all three start ticked: the default is the behaviour the move already
 * had, and the dialog exists to let somebody opt OUT of it.
 *
 * `call` is deliberately absent. It is a task logged for a staff member rather
 * than a message anything transmits, so offering to switch it off would imply
 * the system was about to ring somebody.
 */
const NOTIFY_CHANNELS = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'sms', label: 'SMS', icon: MessageSquare },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
];

const ALL_CHANNELS = NOTIFY_CHANNELS.map((channel) => channel.value);

/**
 * Confirming a ticket's status move, wherever it is made.
 *
 * **One dialog for the Tickets list and the ticket itself** (client ruling
 * 2026-10-05: "set status confirmation should be similar on both inside and
 * outside edit options; follow the outside one"). The list's version is the
 * standard: an info-toned question naming the ticket and the destination,
 * and the channels as checkboxes. **No typed phrase** - typing a record back is
 * kept for deletes, and a technician moving a job several times a day learns
 * to type through a gate that guards nothing.
 *
 * `note`, when the caller collected one, rides along to the timeline.
 */
export function TicketStatusDialog({ move, onClose }) {
  const { setTicketStatus } = useAdminMutations();
  const [notifyVia, setNotifyVia] = useState(ALL_CHANNELS);

  // Every move starts with every channel ticked, so confirming with nothing
  // touched is the behaviour the move had before the dialog existed.
  useEffect(() => {
    if (move) setNotifyVia(ALL_CHANNELS);
  }, [move]);

  const label = move ? (TICKET_STATUS_LABELS[move.status] ?? titleize(move.status)) : '';

  return (
    <ConfirmDialog
      open={Boolean(move)}
      onClose={onClose}
      // `info`, not the default danger: this is an ordinary, reversible move a
      // technician makes many times a day, and a red alarm on every one
      // teaches them to click through reds.
      tone="info"
      heading="Change repair status?"
      title={
        move ? (
          <>
            Change <strong className="font-semibold text-ink-900">ticket {move.ticket.ticketNumber}</strong>{' '}
            to <strong className="font-semibold text-ink-900">{label}</strong>?
          </>
        ) : (
          ''
        )
      }
      body={
        <div className="rounded-lg border border-line bg-surface-2 p-3.5">
          <p className="eyebrow mb-2.5 text-ink-400">Notify the customer via:</p>

          <div className="space-y-1">
            {NOTIFY_CHANNELS.map(({ value, label: channel, icon: Icon }) => (
              <Checkbox
                key={value}
                checked={notifyVia.includes(value)}
                onChange={(event) =>
                  setNotifyVia((current) =>
                    event.target.checked
                      ? [...current, value]
                      : current.filter((entry) => entry !== value),
                  )
                }
                label={
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
                    {channel}
                  </span>
                }
              />
            ))}
          </div>

          {/* Says what unticking DOES, because the checkboxes cannot: the
              customer is reached on the one channel they chose, so these are
              permissions rather than three separate messages. */}
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            Uncheck a channel to skip it. Uncheck all to change the status silently.
          </p>
        </div>
      }
      confirmLabel="Confirm change"
      loading={setTicketStatus.isPending}
      error={setTicketStatus.error?.message}
      onConfirm={() =>
        setTicketStatus.mutate(
          {
            id: move.ticket.id,
            status: move.status,
            note: move.note || undefined,
            channels: notifyVia,
          },
          {
            // The move can silently fail to reach the customer - no channel on
            // file, a declined one, no provider wired - and the staff member
            // has to learn that now, not when somebody rings to ask.
            onSuccess: (result) => {
              reportStatusOutcome(result);
              onClose();
              move.onDone?.();
            },
          },
        )
      }
    />
  );
}

export default TicketStatusDialog;
