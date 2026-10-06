import { useEffect, useState } from 'react';
import { Mail, MessageCircle, MessageSquare } from 'lucide-react';

import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Checkbox from '@/components/ui/Checkbox';
import SelectMenu from '@/components/ui/SelectMenu';
import { useAdminMutations } from '@/hooks/useAdmin';

const CHANNEL_META = {
  email: { label: 'Email', icon: Mail },
  sms: { label: 'SMS', icon: MessageSquare },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
};

/** Whether a status will message the customer at all. */
const speaks = (label) => Boolean(label?.messageActive && label.message?.trim());

/**
 * Confirming an invoice's after sales status, wherever it is set.
 *
 * **The ticket's dialog, for invoices** (client ruling 2026-10-06: "invoice Set
 * status should show consent details as well, same as ticket statuses"). When
 * the chosen status sends a message, the channels it sends on are listed as
 * checkboxes, all ticked: a permission list for this one invoice, so unticking
 * SMS means "not by text this time" and unticking everything sets the status
 * silently. Info-toned and never typed back - it moves no money and a status
 * can be set again.
 *
 * `move` is `{ invoice, label, pickable }`. `label` null clears the status.
 * `pickable` adds the status picker inside the dialog, for the way in that
 * arrives with nothing chosen yet (the invoice's three-dot menu).
 */
export function InvoiceStatusDialog({ move, labels = [], onClose }) {
  const { setInvoiceLabel } = useAdminMutations();
  const [label, setLabel] = useState(null);
  const [notifyVia, setNotifyVia] = useState([]);

  // A new move starts on its own status with every one of its channels ticked.
  useEffect(() => {
    if (!move) return;
    setLabel(move.label ?? null);
    setNotifyVia(move.label?.channels ?? []);
  }, [move]);

  function pick(next) {
    const chosen = labels.find((entry) => entry.id === next) ?? null;
    setLabel(chosen);
    setNotifyVia(chosen?.channels ?? []);
  }

  const number = move?.invoice?.number;
  const channels = label?.channels ?? [];
  const days = label?.delayDays ?? 0;

  return (
    <ConfirmDialog
      open={Boolean(move)}
      onClose={onClose}
      tone="info"
      heading="Change after sales status?"
      title={
        move ? (
          label ? (
            <>
              Set <strong className="font-semibold text-ink-900">{number}</strong> to{' '}
              <strong className="font-semibold text-ink-900">{label.name}</strong>?
            </>
          ) : (
            <>
              Clear the status on <strong className="font-semibold text-ink-900">{number}</strong>?
            </>
          )
        ) : (
          ''
        )
      }
      body={
        <div className="space-y-3">
          {move?.pickable && (
            <SelectMenu
              label="After sales status"
              value={label?.id ?? ''}
              options={[
                { value: '', label: 'No status' },
                ...labels.map((entry) => ({ value: entry.id, label: entry.name })),
              ]}
              onChange={pick}
            />
          )}

          {label ? (
            <div className="rounded-lg border border-line bg-surface-2 p-3.5">
              <p className="eyebrow mb-2.5 text-ink-400">Notify the customer via:</p>

              <div className="space-y-1">
                {channels.map((value) => {
                  const { label: name, icon: Icon } = CHANNEL_META[value] ?? { label: value, icon: Mail };
                  return (
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
                          {name}
                        </span>
                      }
                    />
                  );
                })}
              </div>

              {/* When it goes, which the checkboxes cannot say: a status's
                  message rides the scheduled run, not the click. A status
                  whose message is off still shows its channels, so the
                  dialog reads the same for every status (2026-10-06), and
                  says plainly that nothing will go. */}
              <p className="mt-3 text-xs leading-relaxed text-ink-400">
                {speaks(label) ? (
                  <>
                    {label.name} sends its message{' '}
                    {days ? `${days} ${days === 1 ? 'day' : 'days'} after it is set` : 'once it is set'},
                    with the next run of the scheduled messages. Uncheck a channel to skip it, or all of
                    them to set the status silently.
                  </>
                ) : (
                  <>
                    {label.name}&apos;s message is switched off in Settings, After sales statuses, so
                    nothing is sent yet. The channels ticked here are kept for this invoice and used if
                    it is switched on.
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-500">
              Where the invoice has got to with the customer. Nothing is sent, and it moves no money.
            </p>
          )}
        </div>
      }
      confirmLabel="Confirm change"
      loading={setInvoiceLabel.isPending}
      error={setInvoiceLabel.error?.message}
      onConfirm={() =>
        setInvoiceLabel.mutate(
          {
            number,
            labelId: label?.id ?? null,
            // The channels this invoice allows; kept even while the status's
            // message is off, so switching it on later honours this choice.
            ...(label ? { channels: notifyVia } : {}),
          },
          { onSuccess: onClose },
        )
      }
    />
  );
}

export default InvoiceStatusDialog;
