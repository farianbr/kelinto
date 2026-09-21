import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  AlertTriangle,
  Hourglass,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
} from 'lucide-react';
import cn from '@/lib/cn';
import useCreateParam from '@/hooks/useCreateParam';
import { money, date, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import BadgeExplainer from '@/components/admin/BadgeExplainer';
import KpiRow from '@/components/admin/KpiRow';
import FilterStrip from '@/components/admin/FilterStrip';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminRmas, useAdminMutations } from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';

/**
 * RMA / returns (ERP rework §6.3).
 *
 * **The Age column drives the day.** It carries the warning treatment past the
 * SLA, and it stops counting once an RMA closes - a return resolved in two days
 * should not still be shouting six months later, because a row that always
 * shouts is a row a staff member learns to ignore.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/rma'], icon: adminIcon('RotateCcw') };

const PILLS = [
  { value: 'all', label: 'All' },
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'received', label: 'Received' },
  { value: 'inspecting', label: 'Inspecting' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'rejected', label: 'Rejected' },
];

const STATUS_TONES = {
  requested: 'neutral',
  approved: 'info',
  in_transit: 'info',
  received: 'warn',
  inspecting: 'warn',
  resolved: 'ok',
  rejected: 'danger',
};

const RESOLUTION_TONES = { pending: 'neutral', refund: 'ok', replace: 'info', reject: 'danger' };

function statusLabel(status) {
  return String(status).replace('_', ' ');
}

/**
 * Open a return against an order.
 *
 * The SKUs are typed rather than picked from a list because the staff member has a
 * packing slip in front of them, not a catalogue. The server matches each line
 * against the order's own lines and refuses anything that was not sold - or
 * more units than were.
 */
/**
 * What the RETURN FORM holds.
 *
 * A return needs the order it came off - that is the rule the whole record
 * rests on (a return is goods coming back from a completed sale), and it was
 * only ever enforced on the server, which meant a blank order number came back
 * as a banner rather than marking the field it belongs to.
 */
const rmaFormSchema = z.object({
  orderNumber: z.string().trim().min(1, 'Enter the order these parts came off.').max(40),
  reason: z.string().trim().max(2000).optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        sku: z.string().trim().optional().or(z.literal('')),
        qty: z.coerce.number().int().min(1, 'At least one.'),
        reason: z.string().trim().max(500).optional().or(z.literal('')),
      }),
    )
    .refine((rows) => rows.some((row) => String(row.sku ?? '').trim()), {
      message: 'Add at least one item coming back.',
    }),
});

function RmaForm({ onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(rmaFormSchema),
    defaultValues: {
      orderNumber: '',
      reason: '',
      items: [{ sku: '', qty: 1, reason: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Input
        label="Order number"
        placeholder="CVX-2026-10001"
        hint="The order these parts were bought on."
        required
        error={errors.orderNumber?.message}
        {...register('orderNumber')}
      />

      <div>
        <p className="eyebrow mb-2 text-ink-400">Items coming back</p>

        {errors.items?.root?.message && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {errors.items.root.message}
          </p>
        )}

        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid items-end gap-2 rounded-md bg-surface-2 p-2.5 sm:grid-cols-[160px_80px_1fr_auto]"
            >
              <Input
                label={index === 0 ? 'SKU' : undefined}
                {...register(`items.${index}.sku`)}
              />
              <Input
                label={index === 0 ? 'Qty' : undefined}
                type="number"
                min="1"
                {...register(`items.${index}.qty`)}
              />
              <Input
                label={index === 0 ? 'Reason' : undefined}
                placeholder="Dead on arrival"
                {...register(`items.${index}.reason`)}
              />
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={fields.length === 1}
                aria-label={`Remove line ${index + 1}`}
                className={cn(pressable, 'flex size-9 shrink-0 items-center justify-center rounded-md border border-line text-ink-400 hover:border-danger/30 hover:bg-danger-50 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40')}
              >
                <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Plus}
          className="mt-2"
          onClick={() => append({ sku: '', qty: 1, reason: '' })}
        >
          Add line
        </Button>
      </div>

      <Textarea label="Why is this coming back?" rows={3} {...register('reason')} />

      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
        Each line is checked against the order it came from - a part that was not sold on it, or more
        units than were, is refused. Nothing is refunded or restocked until the return has been
        inspected.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Open RMA
        </Button>
      </div>
    </form>
  );
}

export function AdminRmaPage() {
  const [query, setQuery] = useState('');
  // Opened directly by `+ Create` (§7.2), which arrives with `?new=1`.
  const [creating, setCreating] = useCreateParam();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const status = searchParams.get('status') ?? 'all';

  const { data, isLoading } = useAdminRmas({ status, q: query || undefined });
  const { createRma } = useAdminMutations();

  const rmas = data?.rmas ?? [];

  // The KPI tiles are summed from the whole filtered set; the table gets a
  // page of it. See `useTablePage` for why paging is client-side.
  const { pageRows: pageRmas, page, totalPages, from, setPage } = useTablePage(rmas);
  const counts = data?.counts ?? {};
  const totals = data?.totals ?? {};
  const slaDays = data?.slaDays ?? 14;

  function setStatus(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  }

  const columns = [
    {
      key: 'rmaNumber',
      header: 'RMA',
      priority: 1,
      render: (rma) => (
        <span className="block whitespace-nowrap font-mono text-sm font-medium text-ink-900">
          {rma.rmaNumber}
        </span>
      ),
    },
    {
      key: 'client',
      header: 'Customer',
      priority: 1,
      className: 'max-w-[160px] truncate',
      // The person, not the company (§0) - a sole trader has no business name
      // and rendered as a dash.
      sortValue: (rma) => rma.user.displayName ?? '',
      render: (rma) => rma.user.displayName ?? '-',
    },
    {
      key: 'orderNumber',
      header: 'Order',
      priority: 3,
      render: (rma) => (
        <span className="whitespace-nowrap font-mono text-xs text-ink-500">
          {rma.orderNumber ?? '-'}
        </span>
      ),
    },
    {
      key: 'qty',
      header: 'Items',
      priority: 3,
      align: 'right',
      className: 'tnum',
      render: (rma) => (
        <>
          <span className="text-sm text-ink-900">{formatCount(rma.qty)}</span>
          <span className="block text-2xs text-ink-400">
            {formatCount(rma.itemCount)} line{rma.itemCount === 1 ? '' : 's'}
          </span>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      render: (rma) => (
        <Badge tone={STATUS_TONES[rma.status]} size="sm">
          {statusLabel(rma.status)}
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      priority: 3,
      className: 'max-w-[200px] truncate',
      render: (rma) => (
        <span className="text-sm text-ink-500">{rma.reason ?? '-'}</span>
      ),
    },
    {
      key: 'resolution',
      header: 'Resolution',
      priority: 2,
      render: (rma) => (
        <>
          <Badge tone={RESOLUTION_TONES[rma.resolution]} size="sm">
            {rma.resolution}
          </Badge>
          {rma.refundAmount > 0 && (
            <span className="tnum mt-0.5 block text-2xs text-ink-400">
              {money(rma.refundAmount)}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'age',
      header: 'Age',
      priority: 1,
      align: 'right',
      className: 'tnum',
      // CellShoppe's hourglass treatment, kept - this is the column that drives
      // the day. Closed rows stop ageing, so only live work carries the warning.
      render: (rma) => (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-sm',
            rma.overSla ? 'font-medium text-danger' : rma.closed ? 'text-ink-300' : 'text-ink-600',
          )}
        >
          {rma.overSla && (
            <AlertTriangle className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          )}
          {rma.age}d
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <Button onClick={() => setCreating(true)} icon={Plus}>
            Open RMA
          </Button>
        }
      />

      <BadgeExplainer />

      <KpiRow
        tiles={[
          {
            key: 'open',
            label: 'Open returns',
            value: formatCount(counts.open ?? 0),
            hint: 'Not yet resolved or rejected',
            tone: (counts.open ?? 0) > 0 ? 'warn' : 'ok',
            icon: RotateCcw,
          },
          {
            key: 'overdue',
            label: `Past ${slaDays} days`,
            value: formatCount(counts.overdue ?? 0),
            hint: 'Open longer than the SLA allows',
            tone: (counts.overdue ?? 0) > 0 ? 'danger' : 'ok',
            icon: Hourglass,
          },
          {
            key: 'units',
            label: 'Units returned',
            value: formatCount(totals.unitsReturned ?? 0),
            hint: 'Across the rows shown',
            tone: 'neutral',
            icon: AlertTriangle,
          },
          {
            key: 'refunded',
            label: 'Refunded',
            value: money(totals.refunded ?? 0),
            hint: 'To store credit, across the rows shown',
            tone: 'info',
            icon: Wallet,
          },
        ]}
      />

      <Panel flush>
        <FilterStrip
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="RMA number, order or business…"
          pills={PILLS.map((pill) => ({ ...pill, count: counts[pill.value] }))}
          activePill={status}
          onPillChange={setStatus}
          onExport={(format) =>
            window.alert(
              `Export to ${format} arrives in phase 12. It will carry the current filters: ` +
                `status "${status}"${query ? `, search "${query}"` : ''}.`,
            )
          }
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine total={rmas.length} shown={pageRmas.length} from={from} noun={rmas.length === 1 ? 'return' : 'returns'} />
        </div>

        <DataTable
          columns={columns}
          rows={pageRmas}
          rowKey={(rma) => rma.id}
          onRowClick={(rma) => navigate(`/admin/rma/${rma.id}`)}
          loading={isLoading}
          defaultSort={{ key: 'age', direction: 'desc' }}
          empty={
            <PanelEmpty
              icon={RotateCcw}
              title="No returns match"
              body="Try a different filter, or open one against an order."
            />
          }
        />

        <Pagination
          page={page}
          pages={totalPages}
          onChange={setPage}
          hideWhenSingle
          className="border-t border-line px-3 py-3 sm:px-4"
        />

      </Panel>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Open a return"
        size="lg"
        align="top"
      >
        {creating && (
          <RmaForm
            isPending={createRma.isPending}
            error={createRma.error?.message}
            onCancel={() => setCreating(false)}
            onSubmit={(values) =>
              createRma.mutate(
                {
                  orderNumber: values.orderNumber.trim(),
                  reason: values.reason,
                  items: values.items
                    .filter((line) => line.sku.trim())
                    .map((line) => ({
                      sku: line.sku.trim(),
                      qty: Number(line.qty),
                      reason: line.reason || undefined,
                    })),
                },
                {
                  onSuccess: (payload) => {
                    setCreating(false);
                    if (payload?.rma?.id) navigate(`/admin/rma/${payload.rma.id}`);
                  },
                },
              )
            }
          />
        )}
      </Modal>
    </>
  );
}

export default AdminRmaPage;
