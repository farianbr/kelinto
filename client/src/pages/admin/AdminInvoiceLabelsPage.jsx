import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { AlertCircle, FileText, Mail, Pencil, Plus, Power, Tag, Trash2 } from 'lucide-react';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { LABEL_COLOR_OPTIONS } from '@shared/schemas/admin.js';
import { useAdminInvoiceLabels, useAdminMutations } from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

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
 * ## The one row that is not cosmetic
 *
 * **"Sends the warranty email" arms an automatic email to a customer.** Every
 * other field on this form changes how a pill looks; that one makes the system
 * write to somebody outside the building the first time the label lands on a
 * paid invoice. It is therefore called out on the form, shown as its own column
 * in the table, and named in the confirmation - a staff member should never
 * discover it from a customer's reply.
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

function LabelForm({ label, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, control, watch } = useForm({
    defaultValues: {
      name: label?.name ?? '',
      colorToken: label?.colorToken ?? 'ink',
      sendsWarrantyEmail: label?.sendsWarrantyEmail ?? false,
      isActive: label?.isActive ?? true,
      order: label?.order ?? 0,
    },
  });

  // The preview reads the live form rather than the saved record: the whole
  // reason to show it is to answer "what will this look like" before saving.
  const name = watch('name');
  const colorToken = watch('colorToken');
  const sends = watch('sendsWarrantyEmail');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Input label="Name" placeholder="Thanks for Support" {...register('name')} />

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          control={control}
          name="colorToken"
          label="Colour"
          options={LABEL_COLOR_OPTIONS}
        />
        <Input label="Sort order" type="number" min="0" {...register('order')} />
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

      {/* The consequence is spelled out in the label, not left to the field
          name: this is the one control here that reaches a customer. */}
      <Checkbox
        label="Sends the warranty and review email, once, the first time this is set on a paid invoice"
        {...register('sendsWarrantyEmail')}
      />
      {sends && (
        <p className="flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-xs text-warn">
          <Mail className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          Choosing this status on a paid invoice emails the customer their warranty and a review
          link. It sends once per invoice, so clearing the status and setting it again will not
          send a second one.
        </p>
      )}

      <Checkbox label="Active - offered in the status picker" {...register('isActive')} />

      <div className="flex justify-end gap-2">
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

export function AdminInvoiceLabelsPage() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // `all`, because this is the one screen where a retired status must be
  // visible - it is where somebody comes to bring one back.
  const { data, isLoading } = useAdminInvoiceLabels({ status: 'all' });
  const { createInvoiceLabel, updateInvoiceLabel, deleteInvoiceLabel } = useAdminMutations();

  const labels = data?.labels ?? [];

  function toPayload(values) {
    return {
      name: values.name,
      colorToken: values.colorToken,
      sendsWarrantyEmail: Boolean(values.sendsWarrantyEmail),
      isActive: Boolean(values.isActive),
      order: Number(values.order) || 0,
    };
  }

  const columns = [
    {
      key: 'name',
      header: 'Status',
      priority: 1,
      render: (label) => (
        <span className="flex items-center gap-2">
          <span
            className={`size-2.5 shrink-0 rounded-full ${SWATCH[label.colorToken] ?? SWATCH.ink}`}
            aria-hidden="true"
          />
          <span className="truncate text-sm text-ink-900">{label.name}</span>
        </span>
      ),
    },
    {
      key: 'sendsWarrantyEmail',
      header: 'Warranty email',
      priority: 1,
      render: (label) =>
        label.sendsWarrantyEmail ? (
          <Badge tone="warn" size="sm" icon={Mail}>
            sends once
          </Badge>
        ) : (
          <span className="text-xs text-ink-400">–</span>
        ),
    },
    {
      key: 'order',
      header: 'Order',
      priority: 3,
      align: 'right',
      className: 'tnum',
      render: (label) => <span className="text-sm text-ink-500">{label.order}</span>,
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
      onSelect: (label) =>
        updateInvoiceLabel.mutate({
          id: label.id,
          name: label.name,
          colorToken: label.colorToken,
          sendsWarrantyEmail: label.sendsWarrantyEmail,
          order: label.order,
          isActive: !label.isActive,
        }),
    },
    { key: 'delete', label: 'Delete status', icon: Trash2, tone: 'danger', onSelect: setDeleting },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <>
            <Link
              to="/admin/settings/invoice-status"
              className={cn(
                pressable,
                'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2',
              )}
            >
              <FileText className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              Invoice messages
            </Link>
            <Button onClick={() => setCreating(true)} icon={Plus}>
              Add status
            </Button>
          </>
        }
      />

      {/* Said once, at the top, because it is the distinction the whole screen
          rests on - and the reason somebody arriving here looking for "mark it
          paid" is in the wrong place. */}
      <p className="mb-3 rounded-md bg-surface-2 px-3.5 py-2.5 text-sm text-ink-500">
        These sit beside an invoice's payment status, they do not replace it. Whether an invoice is
        paid is worked out from its payments and cannot be set by hand; these are for where it has
        got to with the customer.
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
          rowMenu={rowMenu}
          loading={isLoading}
          defaultSort={{ key: 'order', direction: 'asc' }}
          empty={
            <PanelEmpty
              icon={Tag}
              title="No statuses yet"
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
        title="Add a status"
        size="md"
        align="top"
      >
        {creating && (
          <LabelForm
            isPending={createInvoiceLabel.isPending}
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
        title="Edit status"
        size="md"
        align="top"
      >
        {editing && (
          <LabelForm
            label={editing}
            isPending={updateInvoiceLabel.isPending}
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
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this status?"
        body={
          deleting
            ? `“${deleting.name}” will be removed from the list. If any invoice is currently set to it, the delete is refused and you should retire it instead - that takes it out of the picker and leaves those invoices readable.`
            : ''
        }
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

export default AdminInvoiceLabelsPage;
