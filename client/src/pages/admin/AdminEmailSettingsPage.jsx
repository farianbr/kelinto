import { useEffect, useState } from 'react';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';

import cn from '@/lib/cn';
import { communicationsSettingsSchema } from '@shared/schemas/admin';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { SettingsFormActions } from '@/components/admin/settings/SettingsForm';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminSettings, useAdminMutations } from '@/hooks/useAdmin';

/**
 * Email Settings (§6.15, category 5, phase 11e).
 *
 * **Every toggle carries a full sentence explaining what it does** - §6.15 calls
 * that worth copying exactly, and it is: "auto-send payment status updates" is
 * meaningless without knowing which emails that means and to whom.
 *
 * **Toggles that gate nothing are marked as such.** Eleven switches that all
 * look equally functional would have a staff member turn one on, assume customers
 * are being emailed, and find out from a customer. The server sends
 * `communicationsWired`, so a toggle stops being marked the moment its send
 * path lands - one edit in `settingsService`, not a change here.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/email'], icon: adminIcon('Mail') };

/**
 * The toggles, in the order §6.15 lists them, with Cellvix's two additions.
 * The copy is the point - each says what it sends and to whom.
 */
const TOGGLES = [
  {
    key: 'invoiceOnOrder',
    label: 'Email the invoice when an order is placed',
    detail:
      'The buyer receives their invoice as soon as checkout completes. This is on today and has been since the storefront opened.',
  },
  {
    key: 'invoiceReminders',
    label: 'Send automatic invoice messages',
    detail:
      'The master switch for the time-lapse messages on the Invoice Statuses screen - reminders, overdue notices and payment confirmations. Individual messages still have to be switched on there as well.',
  },
  {
    key: 'paymentStatusUpdates',
    label: 'Email the customer when an invoice changes status',
    detail:
      'Covered by the invoice messages above: a status message fires when its rule matches. Switching this off stops those without editing each rule.',
  },
  {
    key: 'quoteOnCreate',
    label: 'Email a quote when it is created',
    detail: 'Sends the quote to the account it was built for as soon as it is saved.',
  },
  {
    key: 'paymentConfirmation',
    label: 'Email a receipt when a payment is recorded',
    detail: 'A confirmation to the customer each time a payment is entered against their invoice.',
  },
  {
    key: 'accountApproved',
    label: 'Email a business when its account is approved',
    detail:
      'Tells a pending business it can now see wholesale pricing and place orders. Without this they find out by signing in and noticing.',
  },
  {
    key: 'accountRejected',
    label: 'Email a business when its account is rejected',
    detail: 'Sends the rejection reason recorded on the Approvals screen.',
  },
  {
    key: 'lowStockAlerts',
    label: 'Email an alert when stock runs low',
    detail:
      'Notifies the address below when a part drops under its low-stock threshold. Goes to your own team, never to a customer.',
  },
];

function Toggle({ toggle, checked, wired, onChange }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 border-b border-line py-3.5 last:border-b-0',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={toggle.label}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-ok' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-display text-md font-semibold text-ink-900">
            {toggle.label}
          </span>
          {/* §6b rule 4, applied to a settings screen: a switch in front of code
              nobody has written yet says so, rather than looking identical to
              the three that work. */}
          {!wired && <Badge tone="warn">Not built yet</Badge>}
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-ink-500">
          {toggle.detail}
          {!wired && (
            <span className="mt-1 block text-warn">
              This particular message has not been written yet - it is not an email problem.
              Everything else on this page sends. The setting is saved and takes effect the moment
              the message exists.
            </span>
          )}
        </span>
      </span>
    </label>
  );
}

export function AdminEmailSettingsPage() {
  const { data, isLoading } = useAdminSettings();
  const { saveCommunications } = useAdminMutations();
  const [saved, setSaved] = useState(false);
  // The dollars the staff member sees. `notifyAboveAmount` in the form stays cents.
  const [dollarsField, setDollarsField] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useAdminForm({
    resolver: zodResolver(communicationsSettingsSchema),
    defaultValues: {},
  });

  useEffect(() => {
    if (!data?.communications || isDirty) return;
    reset(data.communications);
    setDollarsField(
      data.communications.notifyAboveAmount ? String(data.communications.notifyAboveAmount / 100) : '',
    );
  }, [data, isDirty, reset]);

  const values = watch();
  const wired = data?.communicationsWired ?? {};

  async function onSubmit(payload) {
    setSaved(false);
    try {
      const next = await saveCommunications.mutateAsync(payload);
      reset(next.communications);
      setDollarsField(
        next.communications.notifyAboveAmount ? String(next.communications.notifyAboveAmount / 100) : '',
      );
      setSaved(true);
    } catch (err) {
      setError('root', { message: err.message });
    }
  }

  if (isLoading) return <p className="text-sm text-ink-500">Loading settings…</p>;

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <form onSubmit={handleSubmit(onSubmit)} className=" space-y-4">
        <Panel title="Automatic emails" description="What the system sends without being asked.">
          <div>
            {TOGGLES.map((toggle) => (
              <Toggle
                key={toggle.key}
                toggle={toggle}
                checked={Boolean(values[toggle.key])}
                wired={wired[toggle.key] !== false}
                onChange={(next) => {
                  setValue(toggle.key, next, { shouldDirty: true });
                  setSaved(false);
                }}
              />
            ))}
          </div>
        </Panel>

        <Panel
          title="Reminders & notifications"
          description="When the invoice messages fire, and who on your team hears about what."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              type="number"
              min="0"
              max="90"
              label="Remind this many days before due"
              suffix="days"
              hint="Used by the built-in payment reminder."
              error={errors.reminderDaysBefore?.message}
              {...register('reminderDaysBefore')}
            />
            <Input
              type="number"
              min="0"
              max="90"
              label="Follow up this many days after due"
              suffix="days"
              hint="Used by the built-in overdue notice."
              error={errors.followUpDaysAfter?.message}
              {...register('followUpDaysAfter')}
            />

            <Input
              label="Admin notification email"
              type="email"
              hint="Where internal alerts go. Leave empty for none."
              error={errors.adminEmail?.message}
              {...register('adminEmail')}
            />
            {/* Dollars on screen, cents on the wire - the convention every
                other money field in the panel follows. A field labelled
                "cents" would have somebody type 500 meaning $500. */}
            <Input
              type="number"
              min="0"
              step="0.01"
              label="Notify when a payment exceeds"
              suffix="CAD"
              hint="Zero means never notify on size alone."
              error={errors.notifyAboveAmount?.message}
              value={dollarsField}
              onChange={(event) => {
                setDollarsField(event.target.value);
                setValue('notifyAboveAmount', Math.round(Number(event.target.value || 0) * 100), {
                  shouldDirty: true,
                });
                setSaved(false);
              }}
            />

            <Input
              label="Low-stock alert email"
              type="email"
              containerClassName="sm:col-span-2"
              hint="Where low-stock alerts go, if they are switched on above."
              error={errors.lowStockEmail?.message}
              {...register('lowStockEmail')}
            />
          </div>

          <p className="mt-4 border-t border-line pt-3 text-sm leading-relaxed text-ink-500">
            These two day counts are read by the built-in reminder and overdue messages. Editing a
            message’s own timing on the Invoice Statuses screen overrides them for that message.
          </p>
        </Panel>

        <SettingsFormActions
          unsavedLabel="the email settings"
          dirty={isDirty}
          saving={isSubmitting || saveCommunications.isPending}
          saved={saved}
          error={errors.root?.message}
          onReset={() => {
            reset();
            // The dollars field lives outside RHF, so `reset()` does not touch
            // it - discarding has to put the server's value back by hand.
            setDollarsField(
              data?.communications?.notifyAboveAmount
                ? String(data.communications.notifyAboveAmount / 100)
                : '',
            );
            setSaved(false);
          }}
        />
      </form>
    </div>
  );
}

export default AdminEmailSettingsPage;
