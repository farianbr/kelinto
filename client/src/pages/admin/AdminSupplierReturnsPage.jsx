import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import { AlertCircle, Coins, Plus, RotateCcw, Send, Trash2, Truck } from 'lucide-react';
import { SUPPLIER_RETURN_REASON_VALUES } from '@shared/schemas/admin';
import cn from '@/lib/cn';
import { money, date, count as formatCount, titleize } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectField from '@/components/ui/SelectField';
import SelectMenu from '@/components/ui/SelectMenu';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import FilterStrip from '@/components/admin/FilterStrip';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import useCreateParam from '@/hooks/useCreateParam';
import { pressable } from '@/lib/motion';
import {
  useSupplierReturns,
  useAdminSuppliers,
  useAdminPurchaseOrders,
  useAdminInventory,
  useAdminMutations,
} from '@/hooks/useAdmin';

/**
 * Returns to a supplier (Purchase § RMA / Returns).
 *
 * The purchase-side counterpart of `/admin/rma`, and deliberately the same shape
 * on screen: a status ladder, an age column that stops at close, and money that
 * is **recorded rather than projected**. What differs is the direction - stock
 * leaves the shelf and a credit is claimed from the supplier, rather than
 * arriving and being refunded to a customer.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/supplier-returns'], icon: adminIcon('RotateCcw') };

const PILLS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'requested', label: 'Requested' },
  { value: 'authorised', label: 'Authorised' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'credited', label: 'Credited' },
  { value: 'overdue', label: 'Overdue' },
];

const STATUS_TONES = {
  draft: 'neutral',
  requested: 'info',
  authorised: 'info',
  shipped: 'warn',
  credited: 'ok',
  rejected: 'danger',
};

const REASON_OPTIONS = SUPPLIER_RETURN_REASON_VALUES.map((value) => ({
  value,
  label: titleize(value.replace(/_/g, ' ')),
}));

/** What the ladder allows next, mirroring the server so a menu never offers a refusal. */
const NEXT_STATUS = {
  draft: 'requested',
  requested: 'authorised',
  authorised: 'shipped',
};

const NEXT_LABEL = {
  draft: 'Mark requested',
  requested: 'Mark authorised',
  authorised: 'Mark shipped',
};

/**
 * Open a return.
 *
 * **No cost field.** The credit a supplier owes is what was paid for the part,
 * which the server snapshots from the purchase order (or the product, when a
 * fault surfaces without paperwork). Letting a staff member type it would make the
 * expected credit an opinion rather than a record.
 */
/**
 * What the RETURN form holds.
 *
 * Money is typed in dollars and converted on submit, and a line with no
 * product chosen is a half-filled row rather than an error - the submit
 * transform drops those before they reach the route.
 */
const supplierReturnFormSchema = z.object({
  supplier: z.string().trim().min(1, 'Choose a supplier.'),
  purchaseOrder: z.string().trim().optional().or(z.literal('')),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
  supplierRmaNumber: z.string().trim().max(60).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        product: z.string().trim().optional().or(z.literal('')),
        qty: z.coerce.number().int().min(1, 'At least one.'),
        reason: z.string().trim(),
        note: z.string().trim().max(500).optional().or(z.literal('')),
      }),
    )
    .refine((rows) => rows.some((row) => String(row.product ??'').trim()), {
      message: 'Add at least one part going back.',
    }),
});

/** Recording the credit a supplier actually gave. */
const supplierCreditFormSchema = z.object({
  amountDollars: z.coerce
    .number({ invalid_type_error: 'Enter the credit amount.' })
    .min(0, 'Cannot be negative.'),
  reference: z.string().trim().max(60).optional().or(z.literal('')),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
});

function ReturnForm({ suppliers, purchaseOrders, products, onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(supplierReturnFormSchema),
    defaultValues: {
      supplier: suppliers[0]?.id ?? '',
      purchaseOrder: '',
      reason: '',
      supplierRmaNumber: '',
      notes: '',
      items: [{ product: '', qty: 1, reason: 'faulty', note: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const supplier = watch('supplier');

  // Only this supplier's orders: a return against somebody else's PO is refused
  // by the server, so it should not be offerable here either.
  const supplierPos = purchaseOrders.filter((po) => (po.supplier?.id ?? po.supplier) === supplier);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          control={control}
          name="supplier"
          label="Supplier"
          required
          error={errors.supplier?.message}
          options={suppliers.map((row) => ({ value: row.id, label: row.name }))}
        />
        <SelectField
          control={control}
          name="purchaseOrder"
          label="Purchase order"
          hint="Optional - sets what the parts cost."
          options={[
            { value: '', label: 'Not known' },
            ...supplierPos.map((po) => ({ value: po.id, label: po.poNumber })),
          ]}
        />
      </div>

      <div>
        <p className="eyebrow mb-2 text-ink-400">Lines</p>

        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid items-end gap-2 rounded-md bg-surface-2 p-2.5 sm:grid-cols-[1fr_70px_140px_auto]"
            >
              <SelectField
                control={control}
                name={`items.${index}.product`}
                label={index === 0 ? 'Product' : undefined}
                options={products.map((product) => ({
                  value: product.id,
                  label: `${product.sku} · ${product.name}`,
                }))}
                size="sm"
              />
              <Input
                label={index === 0 ? 'Qty' : undefined}
                type="number"
                min="1"
                {...register(`items.${index}.qty`)}
              />
              <SelectField
                control={control}
                name={`items.${index}.reason`}
                label={index === 0 ? 'Reason' : undefined}
                options={REASON_OPTIONS}
                size="sm"
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
          onClick={() => append({ product: '', qty: 1, reason: 'faulty', note: '' })}
        >
          Add line
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Supplier's RMA number"
          hint="Theirs, not ours - the number to quote."
          {...register('supplierRmaNumber')}
        />
        <Input label="Reason" placeholder="Two arrived dead" {...register('reason')} />
      </div>

      <Textarea label="Notes" rows={2} {...register('notes')} />

      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
        The expected credit is worked out from what these parts cost on the purchase order. Stock
        does not move until the return is marked <strong className="font-semibold">shipped</strong>.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Open return
        </Button>
      </div>
    </form>
  );
}

/** Recording what the supplier actually gave back. */
function CreditForm({ supplierReturn, onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(supplierCreditFormSchema),
    defaultValues: {
      amountDollars: (supplierReturn.expectedCredit / 100).toFixed(2),
      reference: '',
      note: '',
    },
  });

  const typed = Math.round(Number(watch('amountDollars') || 0) * 100);
  const shortfall = supplierReturn.expectedCredit - typed;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="rounded-md bg-surface-2 p-3.5">
        <p className="font-mono text-sm font-medium text-ink-900">
          {supplierReturn.returnNumber}
        </p>
        <p className="mt-0.5 text-sm text-ink-500">{supplierReturn.supplierName}</p>
        <p className="tnum mt-1.5 text-sm text-ink-500">
          {money(supplierReturn.expectedCredit)} claimed across{' '}
          {formatCount(supplierReturn.qty)} {supplierReturn.qty === 1 ? 'part' : 'parts'}
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Credit given"
          inputMode="decimal"
          suffix="CAD"
          placeholder="0.00"
          required
          error={errors.amountDollars?.message}
          {...register('amountDollars')}
        />
        <Input label="Credit note" placeholder="CN-4471" {...register('reference')} />
      </div>

      {/* A short-paid claim is the case worth seeing, so the form says so
          before it is saved rather than leaving it to be noticed later. */}
      {shortfall > 0 && (
        <p className="rounded-md bg-warn-50 px-3 py-2.5 text-sm text-warn">
          {money(shortfall)} less than claimed. That difference is kept on the return.
        </p>
      )}

      <Textarea label="Note" rows={2} {...register('note')} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Record credit
        </Button>
      </div>
    </form>
  );
}

export function AdminSupplierReturnsPage() {
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useCreateParam();
  const [crediting, setCrediting] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const status = searchParams.get('status') ?? 'all';

  const { data, isLoading } = useSupplierReturns({ status, q: query || undefined });
  const { data: supplierData } = useAdminSuppliers({});
  const { data: poData } = useAdminPurchaseOrders({});
  // The catalogue is 400+ rows; it loads only while the form is open.
  const { data: inventoryData } = useAdminInventory({}, Boolean(creating));

  const {
    createSupplierReturn,
    setSupplierReturnStatus,
    recordSupplierCredit,
    deleteSupplierReturn,
  } = useAdminMutations();

  const returns = data?.returns ?? [];

  // A page of rows for the table; counts and tiles still read the full set.
  const { pageRows: pageReturns, page, totalPages, from, setPage } = useTablePage(returns);
  const counts = data?.counts ?? {};
  // `orders` is the key the purchase service answers with, not `purchaseOrders`.
  const purchaseOrders = poData?.orders ?? [];

  function setStatus(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  }

  const columns = [
    {
      key: 'returnNumber',
      header: 'Return',
      priority: 1,
      render: (row) => (
        <>
          <span className="block whitespace-nowrap font-mono text-sm font-medium text-ink-900">
            {row.returnNumber}
          </span>
          {row.purchaseOrderNumber && (
            <span className="block font-mono text-2xs text-ink-400">
              {row.purchaseOrderNumber}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      priority: 1,
      sortValue: (row) => row.supplierName,
      render: (row) => (
        <>
          <span className="block truncate text-sm text-ink-900">{row.supplierName}</span>
          {row.supplierRmaNumber && (
            <span className="block truncate text-xs text-ink-400">
              Their ref {row.supplierRmaNumber}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'qty',
      header: 'Parts',
      priority: 3,
      align: 'right',
      className: 'tnum',
      render: (row) => formatCount(row.qty),
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      render: (row) => (
        <Badge tone={STATUS_TONES[row.status]} size="sm">
          {titleize(row.status)}
        </Badge>
      ),
    },
    {
      key: 'age',
      header: 'Age',
      priority: 3,
      align: 'right',
      className: 'tnum',
      sortValue: (row) => row.age,
      render: (row) => (
        <span className={cn('text-sm', row.overSla ? 'font-medium text-danger' : 'text-ink-500')}>
          {row.age}d
        </span>
      ),
    },
    {
      // Claimed and given, side by side - the gap between them is the reason
      // somebody chases a supplier, so it is never collapsed into one figure.
      key: 'expectedCredit',
      header: 'Credit',
      priority: 1,
      align: 'right',
      className: 'tnum',
      sortValue: (row) => row.expectedCredit,
      render: (row) => (
        <>
          <span className="text-sm font-medium text-ink-900">
            {row.status === 'credited' ? money(row.creditAmount) : money(row.expectedCredit)}
          </span>
          {row.status === 'credited' && row.creditShortfall > 0 ? (
            <span className="block text-2xs text-warn">
              {money(row.creditShortfall)} short
            </span>
          ) : (
            <span className="block text-2xs text-ink-400">
              {row.status === 'credited' ? 'in full' : 'claimed'}
            </span>
          )}
        </>
      ),
    },
  ];

  const rowMenu = [
    {
      key: 'advance',
      label: (row) => NEXT_LABEL[row.status] ?? 'Advance',
      icon: Send,
      // The server enforces the ladder regardless; hiding the entry is a
      // courtesy, never the control (invariant 13).
      hidden: (row) => !NEXT_STATUS[row.status],
      onSelect: (row) =>
        setSupplierReturnStatus.mutate({ id: row.id, status: NEXT_STATUS[row.status] }),
    },
    {
      key: 'credit',
      label: 'Record credit',
      icon: Coins,
      hidden: (row) => row.status !== 'shipped',
      onSelect: (row) => setCrediting(row),
    },
    {
      key: 'reject',
      label: 'Supplier refused',
      icon: AlertCircle,
      hidden: (row) => row.closed,
      onSelect: (row) => setRejecting(row),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      tone: 'danger',
      // Once stock has moved there are `StockMovement` rows pointing at this
      // number, and deleting would leave them referring to nothing.
      hidden: (row) => ['shipped', 'credited'].includes(row.status),
      onSelect: (row) => setDeleting(row),
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
            New return
          </Button>
        }
      />

      <KpiRow
        tiles={[
          {
            key: 'open',
            label: 'Open',
            value: formatCount(counts.open ?? 0),
            hint: 'Not yet credited or refused',
            tone: (counts.open ?? 0) > 0 ? 'warn' : 'ok',
            icon: RotateCcw,
          },
          {
            key: 'outstanding',
            label: 'Credit outstanding',
            value: money(data?.outstanding ?? 0),
            hint: 'Claimed and not yet received',
            tone: (data?.outstanding ?? 0) > 0 ? 'danger' : 'ok',
            icon: Coins,
          },
          {
            key: 'shipped',
            label: 'In transit',
            value: formatCount(counts.shipped ?? 0),
            hint: 'Sent back, awaiting credit',
            tone: 'info',
            icon: Truck,
          },
          {
            key: 'overdue',
            label: 'Over SLA',
            value: formatCount(counts.overdue ?? 0),
            hint: `Older than ${data?.slaDays ?? 14} days`,
            tone: (counts.overdue ?? 0) > 0 ? 'danger' : 'ok',
            icon: AlertCircle,
          },
        ]}
      />

      <Panel flush>
        <FilterStrip
          stackPills
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Return number, supplier or PO…"
          pills={PILLS.map((pill) => ({ ...pill, count: counts[pill.value] }))}
          activePill={status}
          onPillChange={setStatus}
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={returns.length}
            shown={pageReturns.length}
            from={from}
            noun={returns.length === 1 ? 'return' : 'returns'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={pageReturns}
          rowKey={(row) => row.id}
          rowMenu={rowMenu}
          loading={isLoading}
          empty={
            <PanelEmpty
              icon={RotateCcw}
              title="Nothing going back"
              body={
                (supplierData?.suppliers ?? []).length
                  ? 'No returns match this filter.'
                  : 'Add a supplier first - a return is raised against one.'
              }
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
        title="Return stock to a supplier"
        size="lg"
        align="top"
      >
        {creating && (
          <ReturnForm
            suppliers={supplierData?.suppliers ?? []}
            purchaseOrders={purchaseOrders}
            products={inventoryData?.products ?? []}
            isPending={createSupplierReturn.isPending}
            error={createSupplierReturn.error?.message}
            onCancel={() => setCreating(false)}
            onSubmit={(values) =>
              createSupplierReturn.mutate(
                {
                  ...values,
                  purchaseOrder: values.purchaseOrder || undefined,
                  reason: values.reason || undefined,
                  supplierRmaNumber: values.supplierRmaNumber || undefined,
                  notes: values.notes || undefined,
                },
                { onSuccess: () => setCreating(false) },
              )
            }
          />
        )}
      </Modal>

      <Modal
        open={Boolean(crediting)}
        onClose={() => setCrediting(null)}
        title="Record the supplier's credit"
        size="md"
      >
        {crediting && (
          <CreditForm
            supplierReturn={crediting}
            isPending={recordSupplierCredit.isPending}
            error={recordSupplierCredit.error?.message}
            onCancel={() => setCrediting(null)}
            onSubmit={(values) =>
              recordSupplierCredit.mutate(
                { id: crediting.id, ...values },
                { onSuccess: () => setCrediting(null) },
              )
            }
          />
        )}
      </Modal>

      {/* Deleting a return is only offered before stock has moved, but it is
          still a record leaving the system for good, so the return number is
          retyped rather than clicked past from a row menu. */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleteSupplierReturn.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
        title="Delete this supplier return?"
        body={
          deleting
            ? `${deleting.returnNumber} to ${deleting.supplierName} will be removed permanently.`
            : ''
        }
        confirmPhrase={deleting?.returnNumber}
        confirmPhraseLabel="the return number"
        confirmLabel="Delete return"
        loading={deleteSupplierReturn.isPending}
        error={deleteSupplierReturn.error?.message}
      />

      {/* Refused closes the return out. Reversible only by raising a new one,
          so it asks once. */}
      <ConfirmDialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onConfirm={() =>
          setSupplierReturnStatus.mutate(
            { id: rejecting.id, status: 'rejected' },
            { onSuccess: () => setRejecting(null) },
          )
        }
        title="Mark the supplier as having refused?"
        body={
          rejecting
            ? `${rejecting.returnNumber} closes with no credit from ${rejecting.supplierName}.`
            : ''
        }
        tone="danger"
        confirmLabel="Supplier refused"
        loading={setSupplierReturnStatus.isPending}
        error={setSupplierReturnStatus.error?.message}
      />
    </>
  );
}

export default AdminSupplierReturnsPage;
