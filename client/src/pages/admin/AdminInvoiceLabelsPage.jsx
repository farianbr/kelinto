import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import { AlertCircle, Mail, Pencil, Plus, Power, Tag, Trash2 } from 'lucide-react';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DeleteWithPreview from '@/components/admin/DeleteWithPreview';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { LABEL_COLOR_OPTIONS, invoiceLabelSchema } from '@shared/schemas/admin.js';
import { useAdminInvoiceLabels, useAdminInvoiceRules, useAdminMutations } from '@/hooks/useAdmin';
import ActiveSwitch from '@/components/admin/ActiveSwitch';
import cn from '@/lib/cn';
import TabRow from '@/components/ui/TabRow';
import { InvoiceMessagesBody, MessageFields } from '@/pages/admin/AdminInvoiceStatusPage';

/**
 * The manual invoice status list.
 *
 * ## What this screen is for
 *
 * An invoice already has a status - unpaid, partial, paid, overdue - and nobody
 * sets it: it is worked out from the payment rows. This is the *other* question
 * a shop asks of an invoice, the one about where it has got to with the
 * customer, and the vocabulary for it is the shop's own. "Thanks for Support"
 * is not a payment state and could never be one.
 *
 * So the list is data, edited here, rather than an enum that would need a deploy
 * per phrase per tenant.
 *
 * ## The part that is not cosmetic
 *
 * **A status's message reaches a customer.** Everything else on the form
 * changes how a pill looks. The message is off until somebody switches it on,
 * and it is the only thing a status sends: a fixed warranty and review email a
 * status could arm with a tick was removed on 2026-10-01 (client request), so
 * the owner writes that message here in their own words.
 *
 * ## Delete versus retire
 *
 * A label in use cannot be deleted, and the row menu says so before the click
 * rather than after: `Invoice.label` is a reference, so removing the target
 * would blank the status column on every invoice carrying it with no record of
 * what it said. Retiring takes it out of the picker and leaves the history
 * readable, which is what somebody tidying a list actually wants.
 */
const ADMIN_PAGE = {
  ...ADMIN_ROUTES['/admin/settings/invoice-labels'],
  icon: adminIcon('Tag'),
};

const SWATCH = {
  ink: 'bg-ink-300',
  brand: 'bg-brand',
  info: 'bg-info',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

/** The pill as an invoice will actually show it, so the form previews itself. */
const PILL_TONE = {
  ink: 'neutral',
  brand: 'brand',
  info: 'info',
  ok: 'ok',
  warn: 'warn',
  danger: 'danger',
};

const CHANNEL_LABELS = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };

/** "2 days after the status is set" - the timing, in words. */
function statusTimingText(delayDays) {
  const days = Math.max(Number(delayDays) || 0, 0);
  if (!days) return 'As soon as the status is set';
  return `${days} ${days === 1 ? 'day' : 'days'} after the status is set`;
}

/**
 * One manual status: its pill, and the message it sends.
 *
 * Laid out like a scheduled message (2026-10-01, client request) because it
 * now is one: a delay, a channel, a subject and a body, run by the same pass.
 * The only difference is what the delay counts from - the day this status is
 * set on an invoice, rather than a date the invoice carries - so "Counting
 * from" is shown fixed rather than offered as a choice that has one answer.
 */
function LabelForm({ label, onSubmit, onCancel, isPending, error, tokens, channels }) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useAdminForm({
    /*
      The form validated nothing before this.

      It posted whatever was typed and let the server answer, so an empty name
      came back as a banner at the top of the dialog with nothing marked and
      nothing focused - the "it throws an error somewhere and does not tell me
      which field" case. `invoiceLabelSchema` is the same schema the route
      validates against, so the two cannot disagree about what is required.
    */
    resolver: zodResolver(invoiceLabelSchema),
    defaultValues: {
      name: label?.name ?? '',
      colorToken: label?.colorToken ?? 'ink',
      isActive: label?.isActive ?? true,
      order: label?.order ?? 0,
      delayDays: label?.delayDays ?? 0,
      channels: label?.channels?.length ? label.channels : ['email'],
      subject: label?.subject ?? '',
      message: label?.message ?? '',
      // Off until somebody switches it on, like every message here.
      messageActive: label?.messageActive ?? false,
    },
  });

  // The preview reads the live form rather than the saved record: the whole
  // reason to show it is to answer "what will this look like" before saving.
  const name = watch('name');
  const colorToken = watch('colorToken');
  const delayDays = watch('delayDays');
  const messageActive = watch('messageActive');

  // `MessageFields` speaks a plain object and a patch function, the shape the
  // scheduled-message card uses, so it is bridged onto the form here.
  const messageForm = { channels: watch('channels'), subject: watch('subject'), message: watch('message') };
  const setMessage = (patch) =>
    Object.entries(patch).forEach(([key, value]) =>
      setValue(key, value, { shouldDirty: true, shouldValidate: key === 'message' && Boolean(errors.message) }),
    );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      {/* No sort order field (client request, 2026-10-01): the list and the
          picker sort by name among equals, and an existing status keeps the
          order it was saved with. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Name"
          placeholder="Thanks for Support"
          required
          error={errors.name?.message}
          {...register('name')}
        />
        <SelectField
          control={control}
          name="colorToken"
          label="Colour"
          options={LABEL_COLOR_OPTIONS}
        />
      </div>

      {/* The pill as it will appear on the invoice list. Sized and toned exactly
          as the real one, because a preview that only approximates it is a
          second thing to keep in step. */}
      <div className="flex items-center gap-2.5 rounded-md bg-surface-2 px-3 py-2.5">
        <span className="text-xs text-ink-500">On an invoice:</span>
        {name?.trim() ? (
          <Badge tone={PILL_TONE[colorToken] ?? 'neutral'} size="sm">
            {name.trim()}
          </Badge>
        ) : (
          <span className="text-xs text-ink-400">name it to see the pill</span>
        )}
      </div>

      <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-[minmax(0,120px)_minmax(0,1fr)]">
        <Input
          type="number"
          min="0"
          max="365"
          label="Days"
          suffix="days"
          hint="After it is set."
          error={errors.delayDays?.message}
          {...register('delayDays')}
        />
        <div>
          <Input label="Counting from" value="The date this status is set" readOnly disabled />
          <span className="mt-1.5 block text-sm text-ink-400">{statusTimingText(delayDays)}.</span>
        </div>
      </div>

      <MessageFields
        form={messageForm}
        set={setMessage}
        tokens={tokens}
        channels={channels}
        messageError={errors.message?.message}
        // A status can send on several channels at once (2026-10-06).
        multiple
      />

      <ActiveSwitch
        checked={Boolean(messageActive)}
        onChange={(next) => setValue('messageActive', next, { shouldDirty: true })}
        detail="Sends this message to each invoice carrying this status, once, the next time the messages are run."
      />

      <Checkbox label="Offered in the status picker" {...register('isActive')} />

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {label ? 'Save status' : 'Add status'}
        </Button>
      </div>
    </form>
  );
}

function InvoiceLabelsBody({ creating = false, onCreatingChange }) {
  const setCreating = (next) => onCreatingChange?.(next);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // `all`, because this is the one screen where a retired status must be
  // visible - it is where somebody comes to bring one back.
  const { data, isLoading } = useAdminInvoiceLabels({ status: 'all' });
  // The scheduled messages' own list carries the placeholders and which
  // channels can deliver; a status's message uses the same of both.
  const { data: ruleData } = useAdminInvoiceRules();
  const { createInvoiceLabel, updateInvoiceLabel, deleteInvoiceLabel } = useAdminMutations();

  const labels = data?.labels ?? [];

  function toPayload(values) {
    return {
      name: values.name,
      colorToken: values.colorToken,
      isActive: Boolean(values.isActive),
      order: Number(values.order) || 0,
      delayDays: Math.max(Number(values.delayDays) || 0, 0),
      channels: values.channels?.length ? values.channels : ['email'],
      subject: values.subject ?? '',
      message: values.message ?? '',
      messageActive: Boolean(values.messageActive),
    };
  }

  /*
    The same columns as Scheduled Messages, in the same order (client request,
    2026-10-01): name with its timing under it, channel, sending. A status
    carries a message now, so the two lists are read the same way. "In picker"
    stays last because only a status can be retired. Rows come back from the
    server by stored order, then name.
  */
  const hasMessage = (label) => Boolean(label.message?.trim());
  const columns = [
    {
      key: 'name',
      header: 'Status',
      priority: 1,
      render: (label) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span
              className={`size-2.5 shrink-0 rounded-full ${SWATCH[label.colorToken] ?? SWATCH.ink}`}
              aria-hidden="true"
            />
            <span className="truncate text-sm text-ink-900">{label.name}</span>
          </span>
          <span className="truncate text-xs text-ink-500">
            {hasMessage(label) ? statusTimingText(label.delayDays) : 'No message'}
          </span>
        </span>
      ),
    },
    {
      key: 'channel',
      header: 'Channels',
      priority: 2,
      render: (label) =>
        hasMessage(label) ? (
          <span className="flex flex-wrap gap-1">
            {(label.channels ?? []).map((channel) => (
              <Badge key={channel} tone={channel === 'email' ? 'info' : 'warn'} size="sm">
                {CHANNEL_LABELS[channel] ?? channel}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-xs text-ink-400">–</span>
        ),
    },
    {
      key: 'messageActive',
      header: 'Sending',
      priority: 1,
      render: (label) =>
        hasMessage(label) ? (
          <Badge tone={label.messageActive ? 'ok' : 'neutral'} size="sm">
            {label.messageActive ? 'on' : 'off'}
          </Badge>
        ) : (
          <span className="text-xs text-ink-400">–</span>
        ),
    },
    {
      key: 'isActive',
      header: 'In picker',
      priority: 2,
      render: (label) => (
        <Badge tone={label.isActive ? 'ok' : 'neutral'} size="sm">
          {label.isActive ? 'offered' : 'retired'}
        </Badge>
      ),
    },
  ];

  const rowMenu = [
    { key: 'edit', label: 'Edit status', icon: Pencil, onSelect: setEditing },
    {
      key: 'toggle',
      label: (label) => (label.isActive ? 'Retire' : 'Put back in the picker'),
      icon: Power,
      confirm: (label) => ({
        title: label.isActive ? `Retire ${label.name}?` : `Put ${label.name} back in the picker?`,
        body: label.isActive
          ? 'It stops being offered on invoices. Invoices that already carry it keep it.'
          : 'It can be picked on invoices again.',
        confirmLabel: label.isActive ? 'Retire' : 'Put back',
      }),
      // The whole record goes back, message included: the route's schema fills
      // absent fields with defaults, so a partial body would switch the
      // status's message off and clear its text.
      onSelect: (label) =>
        updateInvoiceLabel.mutateAsync({
          id: label.id,
          ...toPayload(label),
          isActive: !label.isActive,
        }),
    },
    { key: 'delete', label: 'Delete status', icon: Trash2, tone: 'danger', onSelect: setDeleting },
  ];

  return (
    <>
      {/* Said once, at the top, because it is the distinction the whole screen
          rests on - and the reason somebody arriving here looking for "mark it
          paid" is in the wrong place. */}
      <p className="mb-3 rounded-md bg-surface-2 px-3.5 py-2.5 text-sm text-ink-500">
        These sit beside an invoice's payment status, they do not replace it. Whether an invoice is
        paid is worked out from its payments and cannot be set by hand; these are for where it has
        got to with the customer. A status can also send a message a set number of days after it
        is set; those go out with the scheduled messages, when that tab&rsquo;s Run now is pressed.
      </p>

      <Panel flush>
        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={labels.length}
            shown={labels.length}
            from={0}
            noun={labels.length === 1 ? 'status' : 'statuses'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={labels}
          rowKey={(label) => label.id}
          // A click opens the status, the same as Scheduled Messages.
          onRowClick={setEditing}
          rowMenu={rowMenu}
          loading={isLoading}
          empty={
            <PanelEmpty
              icon={Tag}
              title="No after sales statuses yet"
              body="Add the ones your shop uses - “Thanks for Support”, “Picked up”, whatever you say to customers."
              action={
                <Button onClick={() => setCreating(true)} icon={Plus} size="sm">
                  Add status
                </Button>
              }
            />
          }
        />
      </Panel>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add an after sales status"
        size="lg"
        align="top"
      >
        {creating && (
          <LabelForm
            isPending={createInvoiceLabel.isPending}
            tokens={ruleData?.tokens}
            channels={ruleData?.channels}
            error={createInvoiceLabel.error?.message}
            onCancel={() => setCreating(false)}
            onSubmit={(values) =>
              createInvoiceLabel.mutate(toPayload(values), {
                onSuccess: () => setCreating(false),
              })
            }
          />
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit after sales status"
        size="lg"
        align="top"
      >
        {editing && (
          <LabelForm
            label={editing}
            isPending={updateInvoiceLabel.isPending}
            tokens={ruleData?.tokens}
            channels={ruleData?.channels}
            error={updateInvoiceLabel.error?.message}
            onCancel={() => setEditing(null)}
            onSubmit={(values) =>
              updateInvoiceLabel.mutate(
                { id: editing.id, ...toPayload(values) },
                { onSuccess: () => setEditing(null) },
              )
            }
          />
        )}
      </Modal>

      {/* The server refuses a delete for a status any invoice carries and its
          error names the count, so this dialog states the rule rather than
          predicting the outcome from a usage number it was not sent. */}
      {/* How many invoices are actually set to this status, before the click -
          the prose version described the rule without ever giving the number
          the rule turns on. */}
      <DeleteWithPreview
        type="invoice-label"
        record={deleting}
        onClose={() => setDeleting(null)}
        confirmLabel="Delete status"
        loading={deleteInvoiceLabel.isPending}
        error={deleteInvoiceLabel.error?.message}
        onConfirm={() =>
          deleteInvoiceLabel.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      />
    </>
  );
}

/**
 * Invoice statuses - the manual list, and the timed messages, as two tabs.
 *
 * ## Why one screen
 *
 * These shipped as two sibling settings screens called "Invoice Statuses" and
 * "Invoice Messages", which is a menu somebody has to read twice: both are
 * about what an invoice says and where it has got to, and the old Statuses
 * screen already carried a button across to the other one. Two tabs say that
 * relationship in the place it matters, and cost one click instead of a trip
 * back out to the settings menu.
 *
 * The tab state is local rather than a URL parameter: the two halves are views
 * of the same subject rather than separate destinations, and nothing links
 * into the messages half from outside except the legacy URL, which redirects.
 */
export function AdminInvoiceLabelsPage() {
  const [tab, setTab] = useState('statuses');

  /*
    One Add button, not two.

    Each half used to own its own: the statuses list had "Add status" above it,
    and the messages list ended with an unlabelled blank card acting as the
    create form. Two differently-shaped ways to add to one screen, and the
    message one was at the BOTTOM of a long list where nobody found it. The
    header carries a single button that adds to whichever tab is open, so the
    action is in the same place whatever you are looking at.

    The state lives here rather than in each body because the button does too -
    a body cannot own a control drawn above its own tab row.
  */
  const [creating, setCreating] = useState(false);
  const isStatuses = tab === 'statuses';

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <Button onClick={() => setCreating(true)} icon={Plus}>
            {isStatuses ? 'Add status' : 'Add message'}
          </Button>
        }
      />

      <TabRow
        className="mb-4"
        tabs={[
          // Renamed 2026-10-01 at the client's request: "Statuses" and
          // "Messages" did not say which half is set by hand and which runs
          // on a clock, and a manual status now sends a message too.
          { key: 'statuses', label: 'Manual Status', icon: Tag },
          { key: 'messages', label: 'Scheduled Messages', icon: Mail },
        ]}
        value={tab}
        onChange={(next) => {
          // A half-open create dialog belongs to the tab it was opened from.
          setCreating(false);
          setTab(next);
        }}
      />

      {isStatuses ? (
        <InvoiceLabelsBody creating={creating} onCreatingChange={setCreating} />
      ) : (
        <InvoiceMessagesBody adding={creating} onAddingChange={setCreating} />
      )}
    </div>
  );
}

export default AdminInvoiceLabelsPage;
