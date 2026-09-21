import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileSignature,
  Plus,
  Send,
  ThumbsUp,
  Trash2,
  Wallet,
} from 'lucide-react';
import cn from '@/lib/cn';
import useAuth from '@/hooks/useAuth';
import AdminServiceQuotesPage from '@/pages/admin/AdminServiceQuotesPage';
import useCreateParam from '@/hooks/useCreateParam';
import { money, date, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectField from '@/components/ui/SelectField';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import BulkBar from '@/components/admin/BulkBar';
import FilterStrip from '@/components/admin/FilterStrip';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { pressable } from '@/lib/motion';
import {
  useAdminQuotes,
  useAdminUsers,
  useAdminInventory,
  useAdminMutations,
} from '@/hooks/useAdmin';

/**
 * Quotes (ERP rework §6.6).
 *
 * Admin-created only for now (§0.7). **Expired is derived from the date**, not
 * stored - the same reading the server does, so the pill and the row can never
 * disagree about whether a quote is still live.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/quotes'], icon: adminIcon('FileSignature') };

const PILLS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'expired', label: 'Expired' },
  { value: 'converted', label: 'Converted' },
];

const STATUS_TONES = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'ok',
  expired: 'warn',
  converted: 'brand',
  rejected: 'danger',
};

/** `YYYY-MM-DD` in local time - `toISOString()` would shift the day westward. */
function todayIso(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * The quote builder.
 *
 * A quoted unit price left blank means "use the catalogue price", so a
 * staff member quoting at list does not have to retype it. The running total below
 * is a preview - every figure is recomputed server-side at the client's own
 * provincial rate, which this form cannot know.
 */
/** `seedClient` pre-picks the customer when the form is opened from a profile. */
/**
 * What the QUOTE FORM holds.
 *
 * Money is typed in dollars and converted on submit, so `quoteSchema`'s cents
 * fields are this form's `*Dollars` ones. A line with no product selected is
 * the common half-filled row rather than an error, so only the lines that
 * carry one are checked - the submit transform drops the rest.
 */
const quoteFormSchema = z.object({
  user: z.string().trim().min(1, 'Choose a customer.'),
  validUntil: z.string().trim().min(1, 'Pick a date.'),
  shippingDollars: z.coerce.number({ invalid_type_error: 'Enter a number, or 0.' }).min(0, 'Cannot be negative.'),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        product: z.string().trim().optional().or(z.literal('')),
        qty: z.coerce.number().int().min(1, 'At least one.'),
        unitPriceDollars: z.union([z.literal(''), z.coerce.number().min(0)]).optional(),
      }),
    )
    .refine((rows) => rows.some((row) => String(row.product ?? '').trim()), {
      message: 'Add at least one line with a product on it.',
    }),
});

function QuoteForm({ clients, products, quote, seedClient, onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(quoteFormSchema),
    defaultValues: {
      user: quote?.user?.id ?? seedClient ?? clients[0]?.id ?? '',
      validUntil: quote?.validUntil
        ? new Date(quote.validUntil).toISOString().slice(0, 10)
        : todayIso(30),
      shippingDollars: quote ? (quote.shipping / 100).toFixed(2) : '0.00',
      notes: quote?.notes ?? '',
      items: quote?.items?.length
        ? quote.items.map((item) => ({
            product: item.product,
            qty: item.qty,
            unitPriceDollars: (item.unitPrice / 100).toFixed(2),
          }))
        : [{ product: '', qty: 1, unitPriceDollars: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const watched = watch('items');
  const shipping = Math.round(Number(watch('shippingDollars') || 0) * 100);

  const byId = new Map(products.map((product) => [product.id, product]));

  const subtotal = (watched ?? []).reduce((sum, line) => {
    const qty = Number(line?.qty ?? 0);
    const typed = Math.round(Number(line?.unitPriceDollars ?? 0) * 100);
    const price = typed > 0 ? typed : (byId.get(line?.product)?.price ?? 0);
    return sum + (Number.isFinite(qty) ? qty * price : 0);
  }, 0);

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
          name="user"
          label="Client"
          required
          error={errors.user?.message}
          options={clients.map((client) => ({
            value: client.id,
            label: client.displayName ?? client.contactName ?? client.email,
          }))}
        />
        <Input
          label="Valid until"
          type="date"
          min={todayIso()}
          required
          error={errors.validUntil?.message}
          {...register('validUntil')}
        />
      </div>

      <div>
        <p className="eyebrow mb-2 text-ink-400">Lines</p>

        {/* A whole-array rule ("at least one line with a product") belongs to
            no single field, so it is shown against the section rather than
            silently failing the submit with nothing marked. */}
        {errors.items?.root?.message && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {errors.items.root.message}
          </p>
        )}

        <div className="space-y-2">
          {fields.map((field, index) => {
            const listPrice = byId.get(watched?.[index]?.product)?.price;
            return (
              <div
                key={field.id}
                className="grid items-end gap-2 rounded-md bg-surface-2 p-2.5 sm:grid-cols-[1fr_80px_130px_auto]"
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
                <Input
                  label={index === 0 ? 'Quoted price' : undefined}
                  inputMode="decimal"
                  suffix="CAD"
                  placeholder={listPrice ? (listPrice / 100).toFixed(2) : 'list'}
                  hint={index === 0 ? 'Blank quotes at list' : undefined}
                  {...register(`items.${index}.unitPriceDollars`)}
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
            );
          })}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Plus}
          className="mt-2"
          onClick={() => append({ product: '', qty: 1, unitPriceDollars: '' })}
        >
          Add line
        </Button>
      </div>

      <Input
        label="Shipping"
        inputMode="decimal"
        suffix="CAD"
        placeholder="0.00"
        error={errors.shippingDollars?.message}
        {...register('shippingDollars')}
      />
      <Textarea label="Notes" rows={2} {...register('notes')} />

      <div className="rounded-md bg-surface-2 px-3 py-2.5">
        <p className="tnum flex items-baseline justify-between text-sm text-ink-600">
          <span>Subtotal</span>
          <span>{money(subtotal)}</span>
        </p>
        <p className="tnum mt-1 flex items-baseline justify-between text-sm text-ink-600">
          <span>Shipping</span>
          <span>{money(shipping)}</span>
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
          A preview before tax. GST/HST is applied server-side at this client's own provincial rate,
          which this form does not know.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {quote ? 'Save quote' : 'Create quote'}
        </Button>
      </div>
    </form>
  );
}

/**
 * One nav row, two screens.
 *
 * A product business quotes **goods** - SKU lines that become an `Order`. A
 * service business quotes **work** - devices, labour and parts that become a
 * `Ticket`. They are separate models because they share almost no fields, and
 * this is where the section picks the one its business actually has.
 *
 * `sales.services` is the test rather than the business type itself, for the
 * reason the feature registry gives: the type sets a default and an override
 * always beats it. A product business that starts doing repairs switches the
 * flag on and gets the estimate builder, without being migrated to another
 * type to gain a screen.
 *
 * Under database-per-business the two kinds can never appear together, so
 * branching here costs nothing a merged list would have saved.
 */
export function AdminQuotesPage() {
  const { features } = useAuth();
  if (features?.['sales.services']) return <AdminServiceQuotesPage />;
  return <AdminWholesaleQuotesPage />;
}

function AdminWholesaleQuotesPage() {
  const [query, setQuery] = useState('');
  // Opened directly by `+ Create` (§7.2), which arrives with `?new=1`.
  const [creating, setCreating, createSeed] = useCreateParam(true, false, ["client"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const status = searchParams.get('status') ?? 'all';

  const { data, isLoading } = useAdminQuotes({ status, q: query || undefined });
  const { data: clientData } = useAdminUsers({ status: 'approved' });
  // Only loaded while the builder is open - the catalogue is 400+ rows.
  const { data: inventoryData } = useAdminInventory({}, creating);
  const [selected, setSelected] = useState([]);
  const { createQuote, setQuoteStatus, deleteQuote } = useAdminMutations();

  const quotes = data?.quotes ?? [];

  // The KPI tiles are summed from the whole filtered set; the table gets a
  // page of it. See `useTablePage` for why paging is client-side.
  const { pageRows: pageQuotes, page, totalPages, from, setPage } = useTablePage(quotes);
  const counts = data?.counts ?? {};
  const totals = data?.totals ?? {};
  const clients = clientData?.users ?? [];
  const products = inventoryData?.products ?? [];

  function setStatus(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  }

  /**
   * Bulk accept / delete.
   *
   * **Rows the server would refuse are skipped and reported, never sent.** The
   * quote ladder only accepts a `sent` quote and refuses an expired one, and a
   * converted quote cannot be deleted because that would orphan the order it
   * became. Firing those anyway would produce a row of red toasts and leave the
   * staff member to work out which of forty selections actually moved.
   *
   * Sequential rather than `Promise.all`: these are audited writes, and forty
   * at once at a shared Atlas instance is how a bulk action becomes a partial
   * one for reasons nobody can reconstruct afterwards.
   */
  async function runBulk(action) {
    const rows = quotes.filter((quote) => selected.includes(quote.id));

    const eligible =
      action === 'accept'
        ? rows.filter((quote) => quote.storedStatus === 'sent' && !quote.expired)
        : rows.filter((quote) => quote.storedStatus !== 'converted');

    for (const quote of eligible) {
      if (action === 'accept') {
        await setQuoteStatus.mutateAsync({ id: quote.id, status: 'accepted' }).catch(() => {});
      } else {
        await deleteQuote.mutateAsync(quote.id).catch(() => {});
      }
    }

    setSelected([]);

    const skipped = rows.length - eligible.length;
    if (skipped > 0) {
      window.alert(
        action === 'accept'
          ? `${eligible.length} accepted. ${skipped} skipped - only a sent quote that has not expired can be accepted.`
          : `${eligible.length} deleted. ${skipped} skipped - a converted quote cannot be deleted without orphaning the order it became.`,
      );
    }
  }

  const columns = [
    {
      key: 'quoteNumber',
      header: 'Quote',
      priority: 1,
      render: (quote) => (
        <span className="block whitespace-nowrap font-mono text-sm font-medium text-ink-900">
          {quote.quoteNumber}
        </span>
      ),
    },
    {
      key: 'client',
      header: 'Customer',
      priority: 1,
      className: 'max-w-[180px] truncate',
      sortValue: (quote) => quote.user.displayName ?? '',
      render: (quote) => quote.user.displayName ?? '-',
    },
    {
      key: 'createdAt',
      header: 'Created',
      priority: 3,
      render: (quote) => <span className="text-sm text-ink-500">{date(quote.createdAt)}</span>,
    },
    {
      key: 'validUntil',
      header: 'Expires',
      priority: 2,
      render: (quote) =>
        quote.validUntil ? (
          <span
            className={cn('text-sm', quote.expired ? 'font-medium text-danger' : 'text-ink-500')}
          >
            {date(quote.validUntil)}
          </span>
        ) : (
          <span className="text-xs text-ink-300">-</span>
        ),
    },
    {
      key: 'itemCount',
      header: 'Lines',
      priority: 3,
      align: 'right',
      className: 'tnum',
      render: (quote) => formatCount(quote.itemCount),
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      render: (quote) => (
        <Badge tone={STATUS_TONES[quote.status]} size="sm">
          {quote.status}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: 'Amount',
      priority: 1,
      align: 'right',
      className: 'tnum',
      render: (quote) => (
        <>
          <span className="text-sm font-medium text-ink-900">{money(quote.total)}</span>
          {quote.convertedOrder?.orderNumber && (
            <span className="block font-mono text-2xs text-ink-400">
              {quote.convertedOrder.orderNumber}
            </span>
          )}
        </>
      ),
    },
  ];

  const rowMenu = [
    {
      key: 'view',
      label: 'Open quote',
      icon: FileSignature,
      onSelect: (quote) => navigate(`/admin/quotes/${quote.id}`),
    },
    {
      key: 'send',
      label: 'Mark as sent',
      icon: Send,
      // The server enforces the ladder regardless; this is a courtesy, never
      // the control (invariant 13).
      disabled: (quote) => quote.storedStatus !== 'draft',
      onSelect: (quote) => setQuoteStatus.mutate({ id: quote.id, status: 'sent' }),
    },
    {
      key: 'accept',
      label: 'Mark as accepted',
      icon: CheckCircle2,
      disabled: (quote) => quote.storedStatus !== 'sent' || quote.expired,
      onSelect: (quote) => setQuoteStatus.mutate({ id: quote.id, status: 'accepted' }),
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <Button onClick={() => setCreating(true)} icon={Plus} disabled={!clients.length}>
            New quote
          </Button>
        }
      />

      {setQuoteStatus.error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {setQuoteStatus.error.message}
        </p>
      )}

      <KpiRow
        tiles={[
          {
            key: 'open',
            label: 'Open pipeline',
            value: money(totals.open ?? 0),
            // Converted and rejected quotes are excluded - counting them would
            // flatter a number a staff member uses to forecast.
            hint: 'Draft and sent quotes still live',
            tone: 'brand',
            icon: Wallet,
          },
          {
            key: 'sent',
            label: 'Awaiting an answer',
            value: formatCount(counts.sent ?? 0),
            hint: 'Sent, not yet accepted',
            tone: 'info',
            icon: Send,
          },
          {
            key: 'expired',
            label: 'Expired',
            value: formatCount(counts.expired ?? 0),
            hint: 'Past their date and still open',
            tone: (counts.expired ?? 0) > 0 ? 'warn' : 'ok',
            icon: Clock,
          },
          {
            key: 'converted',
            label: 'Converted',
            value: formatCount(counts.converted ?? 0),
            hint: 'Became a real order',
            tone: 'ok',
            icon: CheckCircle2,
          },
        ]}
      />

      <Panel flush>
        <FilterStrip
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Quote number, business or email…"
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
          <CountLine total={quotes.length} shown={pageQuotes.length} from={from} noun={quotes.length === 1 ? 'quote' : 'quotes'} />
        </div>

        <DataTable
          columns={columns}
          rows={pageQuotes}
          rowKey={(quote) => quote.id}
          selectable
          selected={selected}
          onSelectionChange={setSelected}
          rowMenu={rowMenu}
          onRowClick={(quote) => navigate(`/admin/quotes/${quote.id}`)}
          loading={isLoading}
          defaultSort={{ key: 'createdAt', direction: 'desc' }}
          empty={
            <PanelEmpty
              icon={FileSignature}
              title="No quotes match"
              body={
                clients.length
                  ? 'Try a different filter, or build one.'
                  : 'Approve a client first - a quote is priced for an account.'
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

      {/* Bulk actions.
          **Convert is deliberately absent.** Converting asks two questions per
          quote - the delivery method, and whether a price that has drifted from
          the catalogue is accepted - and a batch would have to answer both on
          the staff member's behalf for every row. Accepting and deleting ask
          nothing, so those are the two that are safe in bulk. */}
      <BulkBar count={selected.length} noun="selected" onClear={() => setSelected([])}>
        <Button
          size="xs"
          variant="outline"
          icon={ThumbsUp}
          loading={setQuoteStatus.isPending}
          onClick={() => runBulk('accept')}
        >
          Accept
        </Button>
        <Button
          size="xs"
          variant="outline"
          icon={Trash2}
          loading={deleteQuote.isPending}
          onClick={() => runBulk('delete')}
        >
          Delete
        </Button>
      </BulkBar>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New quote"
        size="xl"
        align="top"
      >
        {creating && (
          <QuoteForm
            seedClient={createSeed.client}
            clients={clients}
            products={products}
            isPending={createQuote.isPending}
            error={createQuote.error?.message}
            onCancel={() => setCreating(false)}
            onSubmit={(values) =>
              createQuote.mutate(
                {
                  user: values.user,
                  validUntil: values.validUntil || undefined,
                  shipping: Math.round(Number(values.shippingDollars || 0) * 100),
                  notes: values.notes || undefined,
                  items: values.items
                    .filter((line) => line.product)
                    .map((line) => ({
                      product: line.product,
                      qty: Number(line.qty),
                      // Zero means "quote at list" - the server reads the
                      // catalogue price rather than a typed one.
                      unitPrice: Math.round(Number(line.unitPriceDollars || 0) * 100),
                    })),
                },
                {
                  onSuccess: (payload) => {
                    setCreating(false);
                    if (payload?.quote?.id) navigate(`/admin/quotes/${payload.quote.id}`);
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

export default AdminQuotesPage;
