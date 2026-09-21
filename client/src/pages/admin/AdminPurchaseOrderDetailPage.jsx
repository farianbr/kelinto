import { useState } from 'react';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import { Link, useParams } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  Ban,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  Link2,
  MessageSquare,
  PackageCheck,
  Printer,
  Send,
  Truck,
  Wallet,
} from 'lucide-react';
import { money, date, dateTime, count as formatCount } from '@/lib/format';
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
import { useTableClasses, CountLine } from '@/components/admin/DataTable';
import ProcessStrip from '@/components/admin/ProcessStrip';
import PurchaseBidsPanel from '@/components/admin/PurchaseBidsPanel';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import {
  useAdminPurchaseOrder,
  useAdminExpenseCategories,
  useAdminMutations,
} from '@/hooks/useAdmin';
import Skeleton from '@/components/ui/Skeleton';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * One purchase order - lines, receiving, landed cost and the stage actions
 * (ERP rework §6.8).
 *
 * The two automation steps live here and both are server-side: receiving a line
 * increments `Product.stock` and writes a `StockMovement`; recording the
 * payment creates an `Expense`. The client sends quantities and a reference,
 * never a stock level, a status or a money total.
 */

const STATUS_TONES = {
  draft: 'neutral',
  sent: 'info',
  negotiating: 'brand',
  confirmed: 'info',
  partial: 'warn',
  received: 'ok',
  cancelled: 'danger',
};

const METHODS = [
  { value: 'Wire transfer', label: 'Wire transfer' },
  { value: 'e-Transfer', label: 'e-Transfer' },
  { value: 'Cheque', label: 'Cheque' },
  { value: 'Credit card', label: 'Credit card' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Other', label: 'Other' },
];

/**
 * This order's own life cycle, drawn by the shared `ProcessStrip`.
 *
 * **Six stations, rendered by the same component every other record uses.** It
 * was a hand-rolled row of pills inside a panel titled "Workflow", which is the
 * thing invariant 10 exists to prevent: one idea looking like two patterns, and
 * only the local copy missing the tick-versus-clock distinction between a
 * finished stage and a live one.
 *
 * Deliberately **not** `PURCHASE_CYCLE`, which the strip at the foot draws.
 * That describes the whole seven-station pipeline a purchase moves through,
 * supplier to inventory, and is the same on every Purchase screen. This is the
 * states *this order* can be in. Same subject, different question: "how does
 * purchasing work here" against "where is this one".
 */
const PO_LIFECYCLE = [
  { key: 'draft', label: 'Draft', icon: FileText },
  { key: 'sent', label: 'Out for pricing', icon: Send },
  { key: 'quoted', label: 'Quoted', icon: MessageSquare },
  { key: 'confirmed', label: 'Confirmed', icon: Check },
  { key: 'paid', label: 'Paid', icon: Wallet },
  { key: 'received', label: 'Received', icon: PackageCheck },
];

/**
 * Which station is live.
 *
 * Payment and delivery are not sequential in practice - an order can be paid
 * before it ships or after it lands - so this reports the furthest point
 * reached rather than walking the list. A received order shows `Received` even
 * if nobody ever recorded the payment, because that is true.
 */
function lifecycleStage(order) {
  if (['received', 'partial'].includes(order.status)) return 'received';
  if (order.payment.status === 'paid') return 'paid';
  if (order.status === 'confirmed') return 'confirmed';
  if (order.status === 'negotiating') return 'quoted';
  // Sent, and somebody has answered. The stage is about the answers, not about
  // how long the order has been out.
  if (order.status === 'sent') return order.quoteCount > 0 ? 'quoted' : 'sent';
  return 'draft';
}

/** Where this one order actually sits in the purchase automation cycle. */
function cycleStage(order) {
  if (order.status === 'draft') return 'po';
  if (order.status === 'received') return 'inventory';
  if (order.status === 'partial') return 'received';
  if (order.payment.status === 'paid') return 'shipment';
  return 'sent';
}

/** `YYYY-MM-DD` in local time - `toISOString()` would shift the day westward. */
function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Receive a delivery.
 *
 * The quantities are what arrived **in this delivery**, defaulted to whatever
 * is still outstanding. The server adds them to what has already arrived,
 * refuses an over-receipt line by line, and re-derives the status - so this
 * form never sends a running total and never sends a status.
 */
function ReceiveForm({ order, onSubmit, onCancel, isPending, error, result }) {
  const outstanding = order.items.filter((item) => item.qtyOrdered - item.qtyReceived > 0);

  const { register, handleSubmit } = useAdminForm({
    defaultValues: {
      note: '',
      lines: Object.fromEntries(
        outstanding.map((item) => [item.sku, item.qtyOrdered - item.qtyReceived]),
      ),
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      {/* Partial by design: what moved and what did not, with a reason per
          skip. Silently receiving nineteen of twenty lines is how a staff member
          comes to trust a button that is lying to them. */}
      {result && (
        <div className="space-y-2">
          {result.received.length > 0 && (
            <div className="rounded-md bg-ok-50 px-3 py-2.5 text-sm text-ok">
              <p className="font-semibold">Received {result.received.length} line(s)</p>
              <ul className="mt-1 space-y-0.5">
                {result.received.map((row) => (
                  <li key={row.sku} className="tnum">
                    {row.sku} - {row.qty} received, {row.qtyAfter} on hand
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.skipped.length > 0 && (
            <div className="rounded-md bg-warn-50 px-3 py-2.5 text-sm text-warn">
              <p className="font-semibold">Skipped {result.skipped.length} line(s)</p>
              <ul className="mt-1 space-y-0.5">
                {result.skipped.map((row) => (
                  <li key={row.sku}>
                    <span className="font-mono">{row.sku}</span> - {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {outstanding.map((item) => {
          const due = item.qtyOrdered - item.qtyReceived;
          return (
            <div
              key={item.sku}
              className="grid items-center gap-2 rounded-md bg-surface-2 p-2.5 sm:grid-cols-[1fr_110px]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-ink-900">{item.name}</p>
                <p className="tnum mt-0.5 text-xs text-ink-400">
                  <span className="font-mono">{item.sku}</span> · {item.qtyReceived} of{' '}
                  {item.qtyOrdered} received · {due} outstanding
                </p>
              </div>
              <Input
                label="Receiving"
                type="number"
                min="0"
                max={due}
                {...register(`lines.${item.sku}`)}
              />
            </div>
          );
        })}
      </div>

      <Textarea label="Note" rows={2} placeholder="Packing slip, carrier, condition…" {...register('note')} />

      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
        Enter what arrived in this delivery, not a running total. Stock and the order status are both
        recalculated on the server, and each line is checked on its own - one line that cannot be
        received will not fail the rest.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        <Button type="submit" loading={isPending} disabled={!outstanding.length}>
          Receive delivery
        </Button>
      </div>
    </form>
  );
}

/**
 * Record the payment - which creates the expense.
 *
 * The amount is not on this form: it is `order.total`, read from the order on
 * the server. A payment form that let a staff member type a different number would
 * be a second source of truth for what this order cost.
 */
function PaymentForm({ order, categories, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, control } = useAdminForm({
    defaultValues: {
      method: 'Wire transfer',
      reference: order.poNumber,
      paidAt: todayIso(),
      category: categories.find((row) => row.slug === 'inventory-purchases')?.id ?? categories[0]?.id ?? '',
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="rounded-md bg-surface-2 p-3.5">
        <p className="font-mono text-sm font-medium text-ink-900">{order.poNumber}</p>
        <p className="mt-0.5 text-sm text-ink-500">{order.supplier.name}</p>
        <p className="tnum mt-1.5 text-sm">
          <span className="font-semibold text-ink-900">{money(order.total)}</span>
          <span className="text-ink-500"> - the amount this will record</span>
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField control={control} name="method" label="Method" options={METHODS} />
        <Input label="Paid on" type="date" max={todayIso()} {...register('paidAt')} />
      </div>

      <Input label="Reference" placeholder="Wire or cheque number" {...register('reference')} />

      <SelectField
        control={control}
        name="category"
        label="File under"
        options={categories.map((category) => ({ value: category.id, label: category.name }))}
      />

      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
        Recording this creates an expense for {money(order.total)}, linked to this order. It can only
        be recorded once - the expense is owned by the purchase order, so the two can never
        double-count.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Record payment
        </Button>
      </div>
    </form>
  );
}

export function AdminPurchaseOrderDetailPage() {
  const t = useTableClasses();
  const { id } = useParams();
  const [receiving, setReceiving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [receiveResult, setReceiveResult] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  // The Workflow panel's one-click payment method. The full modal still owns
  // reference, date and expense category.
  const [quickMethod, setQuickMethod] = useState(METHODS[0].value);
  const [confirmingQuickPay, setConfirmingQuickPay] = useState(false);

  const { data, isLoading, error } = useAdminPurchaseOrder(id);
  const { data: categoryData } = useAdminExpenseCategories();
  const { receivePurchaseOrder, recordPurchasePayment, setPurchaseOrderStatus } =
    useAdminMutations();

  const order = data?.order;

  // This record names the tab, so several open at once stay tellable apart.
  useDocumentTitle(order?.poNumber);
  const movements = data?.movements ?? [];
  const categories = (categoryData?.categories ?? []).filter((category) => category.isActive);

  useSetRecordLabel(order?.poNumber);

  if (error) {
    return (
      <>
        <PageHeader icon={ClipboardList} title="Purchase order" />
        <Panel>
          <PanelEmpty
            icon={ClipboardList}
            title="Purchase order not found"
            body={error.message}
            action={
              <Link
                to="/admin/purchase-orders"
                className={cn(pressable, 'inline-flex h-9 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
              >
                Back to purchase orders
              </Link>
            }
          />
        </Panel>
      </>
    );
  }

  if (isLoading || !order) {
    return (
      <>
        <PageHeader icon={ClipboardList} title="Purchase order" />
        <div className="space-y-4">
          <Skeleton className="h-24" rounded="lg" />
          <Skeleton className="h-64" rounded="lg" />
        </div>
      </>
    );
  }

  const qtyOrdered = order.items.reduce((sum, item) => sum + item.qtyOrdered, 0);
  const qtyReceived = order.items.reduce((sum, item) => sum + item.qtyReceived, 0);
  const canReceive = !['draft', 'received', 'cancelled'].includes(order.status);
  const canPay =
    !['draft', 'cancelled'].includes(order.status) && order.payment.status !== 'paid';

  return (
    // The record measure, centred - one record is a reading screen, and a
    // list is what earns the shell's full width. The `.record-page` class carries
    // the whole treatment; see the container tokens in index.css.
    <div className="record-page">
      <PageHeader
        icon={ClipboardList}
        title={order.poNumber}
        description={
          // Who it is with, and when. Before a supplier is confirmed there is
          // nobody it is with - saying "-" there would read as missing data
          // rather than as the honest answer, which is that we are still asking.
          order.supplier.id
            ? `${order.supplier.name} · ordered ${date(order.orderDate)}`
            : `${order.bidCount ? `${formatCount(order.bidCount)} supplier(s) asked` : 'No supplier asked yet'} · raised ${date(order.orderDate)}`
        }
        badge={
          <>
            <Badge tone={STATUS_TONES[order.status]} size="sm">
              {order.status}
            </Badge>
            {order.overdue && (
              <Badge tone="danger" size="sm">
                overdue
              </Badge>
            )}
          </>
        }
        action={
          <>
            <Button variant="outline" icon={Printer} onClick={() => window.print()}>
              Print
            </Button>
            <Link
              to="/admin/purchase-orders"
              className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
            >
              Back
            </Link>
          </>
        }
      />

      {setPurchaseOrderStatus.error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {setPurchaseOrderStatus.error.message}
        </p>
      )}

      {/* Where this order has got to - the shared strip, not a local row of
          pills. It leads the record because "where is this one?" is the first
          question a staff member arrives with, and the actions below it are what
          they came to do about it. */}
      <ProcessStrip
        steps={PO_LIFECYCLE}
        current={lifecycleStage(order)}
        title="This order"
        caption={
          order.status === 'cancelled'
            ? 'Cancelled - nothing further can be recorded against it.'
            : 'Send it out, compare the prices, confirm one supplier, then pay and receive.'
        }
        // A cancelled order stopped where it stood rather than passing through,
        // which is what `stoppedTone` draws.
        stoppedTone={order.status === 'cancelled' ? 'danger' : undefined}
        successOnLast
        className="mb-4"
      />

      {/* What can be done to this order right now.

          The stage strip above says where it is; this says what to do about it,
          and every control here is one a staff member reaches for at exactly this
          point in the process. No panel title: a heading reading "Workflow"
          above a row of buttons named for what they do is a label for something
          the buttons already say. */}
      {order.status !== 'cancelled' && (
        <Panel className="mb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              {/* Sending lives in the Suppliers panel, which is the only place
                  that knows who the order is going to - a second Send here
                  would either skip the mail or duplicate the picker. This
                  points at it rather than repeating it. */}
              {order.status === 'draft' && (
                <Button
                  variant="outline"
                  icon={Send}
                  onClick={() => {
                    document
                      .getElementById('po-suppliers')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  Send to suppliers
                </Button>
              )}

              {canReceive && (
                <Button variant="outline" icon={PackageCheck} onClick={() => setReceiving(true)}>
                  Receive delivery
                </Button>
              )}

              {/* Method sits beside the button rather than inside a modal: it
                  is the only thing the quick path needs to know, and asking
                  for it here is what lets Mark paid be one click. The modal
                  behind `Record payment` still carries reference, date and
                  expense category. */}
              {canPay && (
                <>
                  <div className="w-42.5">
                    <SelectMenu
                      label="Pay via"
                      size="md"
                      value={quickMethod}
                      onChange={setQuickMethod}
                      options={METHODS}
                    />
                  </div>
                  {/* Recording a supplier payment writes an expense into the
                      P&L. One click for that is the shape §3.0.1 exists to
                      stop, and the full form beside it already confirms. */}
                  <Button
                    variant="outline"
                    icon={Wallet}
                    loading={recordPurchasePayment.isPending}
                    onClick={() => setConfirmingQuickPay(true)}
                  >
                    Mark paid
                  </Button>
                  <Button variant="ghost" onClick={() => setPaying(true)}>
                    Payment details…
                  </Button>
                </>
              )}
            </div>

            {qtyReceived === 0 && (
              <Button variant="ghost" icon={Ban} onClick={() => setCancelling(true)}>
                Cancel PO
              </Button>
            )}
          </div>

          {recordPurchasePayment.error && (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {recordPurchasePayment.error.message}
            </p>
          )}
        </Panel>
      )}

      {/* `minmax(0,1fr)`, never a bare `1fr`.

          A `1fr` track refuses to shrink below its content's intrinsic width,
          and this column holds the Lines table - so a wide table pushed the
          summary column off the right edge of the viewport and clipped it. The
          `minmax(0,…)` lets the track shrink and the table scroll inside its own
          `overflow-x-auto` instead, which is the rule Instructions 3.1 states
          for wide content. Same shape the ticket detail page uses. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {/* Above Lines because it is the live question while an order is
              open: the lines say what was asked for, and until somebody is
              confirmed the prices on them are zero. */}
          <div id="po-suppliers" className="scroll-mt-4">
            <PurchaseBidsPanel order={order} />
          </div>

          <Panel icon={Boxes} title="Lines" flush>
            {/* Carries the density toggle. These lines follow the same density
                as every list table, so the page has to offer a way to set it. */}
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <CountLine
                total={order.items.length}
                noun={order.items.length === 1 ? 'line' : 'lines'}
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className={t.headRow}>
                    <th scope="col" className={t.headCell()}>
                      Product
                    </th>
                    <th scope="col" className={t.headCell('right')}>
                      Ordered
                    </th>
                    <th scope="col" className={t.headCell('right')}>
                      Received
                    </th>
                    <th scope="col" className={t.headCell('right')}>
                      Unit cost
                    </th>
                    <th scope="col" className={t.headCell('right')}>
                      Line total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => {
                    const short = item.qtyOrdered - item.qtyReceived;
                    return (
                      <tr key={item.sku} className={t.row}>
                        {/* One column, not two.

                            `item.name` and `item.inventory.name` are the same
                            product name - so Product wrapped it over three lines
                            in 120px while Linked inventory truncated the same
                            words in 266px. What that second column actually adds
                            is the stock figure and the link, and both belong
                            beside the name they describe. */}
                        <td className={t.cell()}>
                          {item.inventory ? (
                            <Link
                              to={`/admin/inventory/${item.inventory.id}`}
                              className="group inline-flex items-center gap-1.5 text-sm font-medium text-ink-900 hover:text-brand"
                            >
                              <span className="min-w-0">{item.name}</span>
                              <Link2
                                className="size-3.5 shrink-0 text-ink-300 group-hover:text-brand"
                                strokeWidth={2.25}
                                aria-hidden="true"
                              />
                            </Link>
                          ) : (
                            <p className="text-sm font-medium text-ink-900">{item.name}</p>
                          )}
                          <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-400">
                            <span className="font-mono">{item.sku}</span>
                            {item.inventory ? (
                              <span className="tnum">
                                {formatCount(item.inventory.stock)} in stock
                              </span>
                            ) : (
                              // A line with no catalogue product behind it will
                              // not move stock when it is received, and saying so
                              // here is cheaper than the staff member finding out
                              // after the delivery.
                              <span className="text-warn">Not linked - will not move stock</span>
                            )}
                          </p>
                        </td>
                        <td className={cn(t.cell('right'), 'tnum text-ink-700')}>
                          {formatCount(item.qtyOrdered)}
                        </td>
                        <td className={cn(t.cell('right'), 'tnum')}>
                          <span className={short > 0 ? 'text-warn' : 'text-ok'}>
                            {formatCount(item.qtyReceived)}
                          </span>
                          {short > 0 && order.status !== 'draft' && (
                            <span className="block text-2xs text-ink-400">{short} short</span>
                          )}
                        </td>
                        <td className={cn(t.cell('right'), 'tnum text-ink-700')}>
                          {money(item.unitCost)}
                        </td>
                        <td className={cn(t.cell('right'), 'tnum font-medium text-ink-900')}>
                          {money(item.lineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-line px-4 py-3">
              <dl className="ml-auto max-w-[260px] space-y-1 text-sm">
                <div className="tnum flex justify-between text-ink-600">
                  <dt>Subtotal</dt>
                  <dd>{money(order.subtotal)}</dd>
                </div>
                <div className="tnum flex justify-between text-ink-600">
                  <dt>Tax</dt>
                  <dd>{money(order.tax)}</dd>
                </div>
                <div className="tnum flex justify-between text-ink-600">
                  <dt>Shipping</dt>
                  <dd>{money(order.shipping)}</dd>
                </div>
                <div className="tnum flex justify-between border-t border-line pt-1 text-md font-semibold text-ink-900">
                  <dt>Total</dt>
                  <dd>{money(order.total)}</dd>
                </div>
                {/* Landed cost per unit - what a received part actually cost
                    once tax and freight are spread over it. */}
                {qtyReceived > 0 && (
                  <div className="tnum flex justify-between pt-1 text-xs text-ink-400">
                    <dt>Landed cost per unit</dt>
                    <dd>{money(Math.round(order.total / Math.max(qtyOrdered, 1)))}</dd>
                  </div>
                )}
              </dl>
            </div>
          </Panel>

          <Panel icon={PackageCheck} title="Stock movements" description="Every receipt against this order." flush>
            {movements.length ? (
              <ul className="divide-y divide-line">
                {movements.map((movement) => (
                  <li key={movement.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-ok-50 text-ok">
                      <Boxes className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink-900">
                        {movement.product?.name ?? 'Product'}{' '}
                        <span className="tnum text-ok">+{movement.qtyChange}</span>
                      </p>
                      <p className="tnum mt-0.5 text-xs text-ink-400">
                        {movement.product?.sku} · {movement.qtyAfter} on hand after ·{' '}
                        {dateTime(movement.at)}
                      </p>
                      {movement.note && (
                        <p className="mt-0.5 text-xs text-ink-500">{movement.note}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty
                icon={Boxes}
                title="Nothing received yet"
                body="Receiving a line moves stock and records a movement here."
              />
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          {/* The figures the KPI row used to carry, in the column that reads as
              a summary rather than as four tiles across the top.

              A tile row is right for a LIST, where the numbers describe a set
              somebody is about to filter. On one record they described that one
              record - and two of the four repeated the status badge and the
              stage strip, so the page opened by saying where the order was
              three times before showing a single line of it. */}
          <Panel icon={Wallet} title="Summary">
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Goods</dt>
                <dd className="tnum font-medium text-ink-900">{money(order.subtotal)}</dd>
              </div>
              {order.tax > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">Tax</dt>
                  <dd className="tnum text-ink-700">{money(order.tax)}</dd>
                </div>
              )}
              {order.shipping > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">Shipping</dt>
                  <dd className="tnum text-ink-700">{money(order.shipping)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 font-display text-lg font-bold text-ink-900">
                <dt>Total</dt>
                <dd className="tnum">{money(order.total)}</dd>
              </div>
            </dl>

            <dl className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Received</dt>
                <dd
                  className={cn(
                    'tnum font-medium',
                    qtyReceived >= qtyOrdered && qtyOrdered > 0 ? 'text-ok' : 'text-ink-900',
                  )}
                >
                  {formatCount(qtyReceived)} / {formatCount(qtyOrdered)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Expected</dt>
                <dd className={cn('text-right', order.overdue ? 'font-medium text-danger' : 'text-ink-700')}>
                  {order.expectedDate ? date(order.expectedDate) : '-'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Payment</dt>
                <dd className={order.payment.status === 'paid' ? 'text-ok' : 'text-ink-700'}>
                  {order.payment.status === 'paid'
                    ? `${order.payment.method ?? 'Paid'} · ${date(order.payment.paidAt)}`
                    : 'Unpaid'}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel icon={Truck} title={order.supplier.id ? 'Supplier' : 'No supplier yet'}>
            {order.supplier.id ? (
              <>
                <p className="text-md font-medium text-ink-900">{order.supplier.name}</p>
                {order.supplier.email && (
                  <a
                    href={`mailto:${order.supplier.email}`}
                    className="mt-0.5 block break-all text-sm text-ink-500 hover:text-brand"
                  >
                    {order.supplier.email}
                  </a>
                )}
                <Link
                  to={`/admin/suppliers/${order.supplier.id}`}
                  className={cn(pressable, 'mt-3 inline-flex h-8 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
                >
                  View profile
                </Link>
              </>
            ) : (
              // An order out for pricing genuinely has nobody it is with. Saying
              // so beats an em-dash, which reads as data somebody forgot to fill in.
              <p className="text-sm leading-relaxed text-ink-500">
                This order has not been placed with anybody yet. Compare the prices in
                <strong className="font-semibold text-ink-700"> Suppliers</strong> and confirm one.
              </p>
            )}
          </Panel>

          {order.notes && (
            <Panel icon={FileText} title="Notes">
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">
                {order.notes}
              </p>
            </Panel>
          )}

          <Panel icon={History} title="Timeline" flush>
            <ul className="divide-y divide-line">
              {order.timeline.map((entry, index) => (
                <li key={`${entry.status}-${index}`} className="flex items-start gap-2.5 px-4 py-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-400">
                    <CheckCircle2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">{entry.status}</p>
                    <p className="text-xs text-ink-400">{dateTime(entry.at)}</p>
                    {entry.note && (
                      <p className="mt-0.5 text-xs text-ink-500">{entry.note}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <ProcessStrip current={cycleStage(order)} className="mt-3" />

      <Modal
        open={receiving}
        onClose={() => {
          setReceiving(false);
          setReceiveResult(null);
        }}
        title="Receive delivery"
        size="lg"
        align="top"
      >
        {receiving && (
          <ReceiveForm
            order={order}
            result={receiveResult}
            isPending={receivePurchaseOrder.isPending}
            error={receivePurchaseOrder.error?.message}
            onCancel={() => {
              setReceiving(false);
              setReceiveResult(null);
            }}
            onSubmit={(values) =>
              receivePurchaseOrder.mutate(
                {
                  id: order.id,
                  note: values.note || undefined,
                  lines: Object.entries(values.lines ?? {})
                    .map(([sku, qty]) => ({ sku, qty: Number(qty) || 0 }))
                    .filter((line) => line.qty > 0),
                },
                {
                  // Kept open on success so the staff member reads what moved and
                  // what did not, rather than the dialog closing over the skips.
                  onSuccess: (payload) =>
                    setReceiveResult({
                      received: payload.received ?? [],
                      skipped: payload.skipped ?? [],
                    }),
                },
              )
            }
          />
        )}
      </Modal>

      <Modal
        open={paying}
        onClose={() => setPaying(false)}
        title="Record payment"
        size="md"
        align="top"
      >
        {paying && (
          <PaymentForm
            order={order}
            categories={categories}
            isPending={recordPurchasePayment.isPending}
            error={recordPurchasePayment.error?.message}
            onCancel={() => setPaying(false)}
            onSubmit={(values) =>
              recordPurchasePayment.mutate(
                { id: order.id, ...values },
                { onSuccess: () => setPaying(false) },
              )
            }
          />
        )}
      </Modal>

      {/* Only offered while nothing has been received, but it still closes the
          order out against the supplier and there is no un-cancel. */}
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={() =>
          setPurchaseOrderStatus.mutate(
            { id: order.id, status: 'cancelled' },
            { onSuccess: () => setCancelling(false) },
          )
        }
        title="Cancel this purchase order?"
        body={`${order.poNumber} to ${order.supplier.name} closes as cancelled. Nothing on it has been received.`}
        tone="danger"
        confirmLabel="Cancel order"
        cancelLabel="Keep it open"
        loading={setPurchaseOrderStatus.isPending}
        error={setPurchaseOrderStatus.error?.message}
      />

      {/* The one-click "Mark paid" beside the method picker. The full payment
          form is a form; this is a button, and it writes the same expense. */}
      <ConfirmDialog
        open={confirmingQuickPay}
        onClose={() => setConfirmingQuickPay(false)}
        onConfirm={() => {
          recordPurchasePayment.mutate(
            {
              id: order.id,
              method: quickMethod,
              reference: order.poNumber,
              paidAt: todayIso(),
            },
            { onSuccess: () => setConfirmingQuickPay(false) },
          );
        }}
        loading={recordPurchasePayment.isPending}
        error={recordPurchasePayment.error?.message}
        title={`Mark ${order.poNumber} paid?`}
        body={`${money(order.total)} to ${order.supplier.name}, by ${quickMethod}.`}
        confirmLabel="Mark paid"
        tone="warn"
      />
    </div>
  );
}

export default AdminPurchaseOrderDetailPage;
