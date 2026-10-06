import { useEffect, useState } from 'react';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import useAuth from '@/hooks/useAuth';
import { invoiceTipSchema, invoicePaymentSchema } from '@shared/schemas/admin';
import {
  AlertCircle,
  History,
  Mail,
  HandCoins,
  MoreHorizontal,
  Pencil,
  Plus,
  BellRing,
  Printer,
  RotateCcw,
  Tag,
  Trash2,
  Wallet,
} from 'lucide-react';

import cn from '@/lib/cn';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Textarea from '@/components/ui/Textarea';
import SelectMenu from '@/components/ui/SelectMenu';
import ActionMenu from '@/components/ui/ActionMenu';
import WorkflowLineage from '@/components/admin/WorkflowLineage';
import InvoiceStatusDialog from '@/components/admin/InvoiceStatusDialog';
import {
  DocumentLayout,
  DocumentDevices,
  DocumentNotes,
  DocumentSummary,
  DocumentCustomer,
  DocumentFacts,
  DocumentHistory,
  serviceTypeLabel,
} from '@/components/admin/SalesDocument';
import { useTableClasses, CountLine } from '@/components/admin/DataTable';
import { toast } from '@/store/toastStore';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import {
  useAdminInvoice,
  useAdminInvoiceLabels,
  useAdminMutations,
  useAuditLog,
} from '@/hooks/useAdmin';
import { apiUrl } from '@/lib/api';
import { money, date, dateTime } from '@/lib/format';
import { pressable } from '@/lib/motion';

/**
 * One invoice (§4b.6, phase 12).
 *
 * **This screen writes now.** It used to be read-only, on the reasoning that
 * the Invoices list already held the payment and void dialogs and a second set
 * of controls would be a second place for those rules to drift. In practice it
 * sent a staff member who had opened an invoice to *look* at it back to a list to
 * act on it - and the rules never lived in the dialogs anyway, they live in
 * `invoicePaymentService`, which both paths call. So the controls are here,
 * against the document they describe, and the server still owns every rule.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/invoices/:number'], icon: adminIcon('FileText') };

const STATUS_TONE = {
  paid: 'ok',
  partial: 'info',
  unpaid: 'neutral',
  overdue: 'danger',
  void: 'neutral',
};

/**
 * The manual status pill, in the token the admin picked for it.
 *
 * Separate from `STATUS_TONE` above on purpose: that is payment state, which
 * the shop does not colour. These are the shop's own words.
 */
const LABEL_PILL = {
  ink: 'bg-surface-2 text-ink-600',
  brand: 'bg-brand-50 text-brand-700',
  info: 'bg-info-50 text-info',
  ok: 'bg-ok-50 text-ok',
  warn: 'bg-warn-50 text-warn',
  danger: 'bg-danger-50 text-danger',
};

/** How a payment arrived. Matches the methods the Invoices list records. */
const PAYMENT_METHODS = [
  { value: 'card', label: 'Card' },
  { value: 'e-transfer', label: 'E-transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'credit', label: 'Store credit' },
];

export function AdminInvoiceDetailPage() {
  const t = useTableClasses();
  const { number } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useAdminInvoice(number);

  // This record names the tab, so several open at once stay tellable apart.
  // Called BEFORE the loading and error returns below: a hook placed after an
  // early return runs on some renders and not others, which is the one thing
  // React's hook ordering forbids.
  useDocumentTitle(data?.invoice?.number);

  /**
   * Every edit this invoice has taken, from the audit log rather than a second
   * history collection. The log is already written as a side effect of each
   * write, so a separate trail would be a copy that can disagree with it.
   */
  const { data: auditData } = useAuditLog('activity', { entity: 'invoice', q: number, limit: 20 });

  /**
   * Which kind of business this is, which decides where Edit goes.
   *
   * A service business has a full invoice form at `/admin/invoices/:number/edit`
   * and Edit opens it. A wholesaler has no such screen - its invoices are
   * raised in a modal over the list - so Edit there keeps the clerical dialog
   * on this page.
   */
  const { features } = useAuth();
  const isService = Boolean(features?.['sales.services']);

  const {
    recordInvoicePayment,
    recordInvoiceTip,
    emailInvoice,
    reverseInvoicePayment,
    updateInvoice,
    deleteInvoice,
    setInvoiceLabel,
    refundInvoice,
    remindInvoice,
  } = useAdminMutations();

  // Active only - a retired status must not be offered back onto an invoice.
  const { data: labelData } = useAdminInvoiceLabels();
  const labels = labelData?.labels ?? [];

  const [paying, setPaying] = useState(false);
  const [tipping, setTipping] = useState(false);
  const [editing, setEditing] = useState(false);

  /**
   * `?refund=1` opens the refund form on arrival.
   *
   * The Invoices list offers Refund in its row menu but does not carry the form:
   * a refund needs an amount, a destination and a reason, so the list sends the
   * staff member here rather than keeping a second copy of it. Read in the
   * initialiser so the form is open on the first paint - arriving to a closed
   * page that pops open a frame later reads as a glitch, which is why
   * `useCreateParam` does the same for `?new=1`.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const [reminding, setReminding] = useState(false);

  /**
   * The status change waiting to be confirmed: `{ invoice, label, pickable }`,
   * or null when nothing is pending. `label` null is a real destination - "no
   * status" - which is why it lives inside the object. See `InvoiceStatusDialog`.
   */
  const [statusMove, setStatusMove] = useState(null);
  const [refunding, setRefunding] = useState(() => searchParams.get('refund') === '1');

  // Stripped once it has been acted on, so a refresh or a shared link does not
  // reopen a form for a refund that has already been made.
  useEffect(() => {
    if (searchParams.get('refund') !== '1') return;
    const next = new URLSearchParams(searchParams);
    next.delete('refund');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [deleting, setDeleting] = useState(false);
  // Emailing goes out to a real customer, so it is confirmed first - the
  // outcome then arrives as a toast rather than a banner this page has to find
  // room for. What the transport actually said is reported verbatim: a send
  // that did not happen must not read as one (§6b rule 4).
  const [emailing, setEmailing] = useState(false);
  // Which payment row is being reversed, by index. `null` when none is.
  const [reversing, setReversing] = useState(null);

  if (isLoading) return <p className="text-sm text-ink-500">Loading invoice…</p>;

  if (error) {
    return (
      <>
        <PageHeader icon={ADMIN_PAGE.icon} title="Invoice not found" />
        <p className="text-sm text-ink-500">
          {error.message}{' '}
          <Link to="/admin/invoices" className="font-semibold text-brand underline">
            Back to invoices
          </Link>
        </p>
      </>
    );
  }

  const invoice = data?.invoice;
  if (!invoice) return null;

  const account = invoice.displayName ?? invoice.businessName;
  const settled = invoice.balance <= 0;
  const entries = auditData?.entries ?? auditData?.rows ?? [];

  const documentUrl = apiUrl(`/admin/invoices/${invoice.number}/document`);
  const devices = invoice.devices ?? [];
  const serviceType = serviceTypeLabel(invoice.serviceType);

  return (
    // Laid out the way the ticket and the estimate are (`SalesDocument`, client
    // ruling 2026-10-05): this record's own working panel - the payments -
    // leads the wide column, then the work it bills, the notes and the history;
    // what it comes to, whose it is and when sit beside them.
    <div className="record-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={invoice.number}
        description={[account, serviceType].filter(Boolean).join(' · ')}
        // Two badges plus a picker, so they go under the title rather than
        // trailing off the end of it.
        badgesBelow
        badge={
          <>
            <Badge tone={STATUS_TONE[invoice.status] ?? 'neutral'} size="sm">
              {invoice.status}
            </Badge>

            {/* The status, pickable from the badge row as well as from the
                three-dot menu - one is where it is READ, the other where
                somebody goes looking for what they can do to an invoice. Both
                stage the same confirmation rather than firing: a status can
                carry a message to the customer, so a stray click on a pill
                must not start its clock.

                Hidden entirely when the shop has not made a list - an empty
                picker is a dead control. */}
            {labels.length > 0 && (
              <SelectMenu
                srLabel={`After sales status for ${invoice.number}`}
                value={invoice.label?.id ?? ''}
                options={[
                  { value: '', label: 'No status' },
                  ...labels.map((label) => ({
                    value: label.id,
                    label: label.name,
                  })),
                ]}
                align="left"
                buttonClassName={cn(
                  'h-6 w-auto gap-1 rounded-full border-0 px-2.5 text-xs font-semibold',
                  'hover:border-0 focus:border-0 focus:ring-1',
                  invoice.label
                    ? (LABEL_PILL[invoice.label.colorToken] ?? LABEL_PILL.ink)
                    : 'bg-surface-2 text-ink-400',
                )}
                menuTitle="Set the after sales status"
                menuFootnote={
                  <>
                    <Tag className="mt-px size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                    <span>
                      A status with a message switched on sends it once per invoice, with the
                      scheduled messages.
                    </span>
                  </>
                }
                onChange={(next) => {
                  const current = invoice.label?.id ?? '';
                  if (next === current) return;
                  setStatusMove({ invoice, label: labels.find((entry) => entry.id === next) ?? null });
                }}
              />
            )}
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Print first, as on the ticket and the estimate: it is the one
                action every document shares, and the place somebody looks for
                it should not move between the three. There is no PDF generator
                behind it - the route renders the invoice as a page, and the
                browser's print dialog is where "save as PDF" lives. */}
            <Button
              size="sm"
              variant="outline"
              icon={Printer}
              onClick={() => window.open(documentUrl, '_blank', 'noopener')}
            >
              Print or PDF
            </Button>

            {/* The full form on a service business, the clerical dialog on a
                wholesaler - see `isService` above. */}
            <Button
              size="sm"
              variant="outline"
              icon={Pencil}
              onClick={() =>
                isService ? navigate(`/admin/invoices/${number}/edit`) : setEditing(true)
              }
            >
              Edit
            </Button>

            <Button
              size="sm"
              variant="outline"
              icon={Mail}
              loading={emailInvoice.isPending}
              onClick={() => setEmailing(true)}
            >
              Email
            </Button>

            {/* Everything past the ones a staff member reaches for daily. */}
            <ActionMenu
              label="More invoice actions"
              trigger={
                <span className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink-600 transition-colors hover:border-ink-300 hover:bg-surface-2">
                  <MoreHorizontal className="size-4" strokeWidth={2} aria-hidden="true" />
                </span>
              }
              items={[
                {
                  key: 'payment',
                  label: 'Record payment',
                  icon: Plus,
                  disabled: settled,
                  onSelect: () => setPaying(true),
                },
                {
                  // In the menu as well as on the badge row, because that is
                  // where somebody goes looking for "what can I do to this
                  // invoice".
                  key: 'status',
                  label: 'Set after sales status',
                  icon: Tag,
                  // Nothing to pick from until the shop has made a list.
                  disabled: labels.length === 0,
                  onSelect: () =>
                    setStatusMove({
                      invoice,
                      label: labels.find((entry) => entry.id === invoice.label?.id) ?? null,
                      pickable: true,
                    }),
                },
                {
                  key: 'remind',
                  label: 'Send reminder',
                  icon: BellRing,
                  // Nothing owed, nothing to chase.
                  disabled: settled,
                  onSelect: () => setReminding(true),
                },
                {
                  key: 'refund',
                  label: 'Refund',
                  icon: RotateCcw,
                  // Nothing received means nothing to give back. Disabled rather
                  // than hidden, so the greyed row says why it cannot be used.
                  disabled: (invoice.refundableCents ?? 0) <= 0,
                  onSelect: () => setRefunding(true),
                },
                {
                  key: 'delete',
                  label: 'Delete',
                  icon: Trash2,
                  tone: 'danger',
                  onSelect: () => setDeleting(true),
                },
              ]}
            />
          </div>
        }
      />

      {/* The chain this invoice ends, when it ends one. An invoice behind an
          *order* has no such chain and draws nothing. */}
      {invoice.ticket && (
        <WorkflowLineage
          current="invoice"
          quote={invoice.ticket.quote}
          ticket={invoice.ticket}
          invoice={invoice}
          className="mb-4"
        />
      )}

      <DocumentLayout
        main={
          <>
            {/**
             * Payment information, leading the wide column.
             *
             * The two figures a staff member opens an invoice to check are what
             * it is for and what has arrived, at a size that can be read across
             * a desk, with the history that produced them directly underneath.
             */}
            <Panel
              icon={Wallet}
              title="Payment information"
              description="The paid total and the status are recomputed from the rows below."
              action={
                settled ? (
                  <Badge tone="ok" size="sm">
                    Fully paid
                  </Badge>
                ) : (
                  <Button size="xs" icon={Plus} onClick={() => setPaying(true)}>
                    Record payment
                  </Button>
                )
              }
            >
              <div className="grid gap-2.5 sm:grid-cols-3">
                <div className="rounded-lg border border-line bg-surface px-4 py-3">
                  <p className="eyebrow text-ink-400">Invoice total</p>
                  <p className="tnum mt-1.5 font-display text-2xl font-bold leading-none text-ink-900">
                    {money(invoice.amount)}
                  </p>
                </div>
                {/* Plain tiles. Balance keeps its colour, and only when there IS
                    one: an unpaid balance is the one thing on this row that can
                    require action. */}
                <div className="rounded-lg border border-line bg-surface px-4 py-3">
                  <p className="eyebrow text-ink-400">Total paid</p>
                  <p className="tnum mt-1.5 font-display text-2xl font-bold leading-none text-ink-900">
                    {money(invoice.amountPaid)}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-surface px-4 py-3">
                  <p className="eyebrow text-ink-400">Balance</p>
                  <p
                    className={cn(
                      'tnum mt-1.5 font-display text-2xl font-bold leading-none',
                      settled ? 'text-ink-900' : 'text-danger',
                    )}
                  >
                    {money(invoice.balance)}
                  </p>
                </div>
              </div>

              {/* The tip sits UNDER the three tiles, not as a fourth one: it is
                  money received that was never due, and it moves no figure
                  above it. */}
              <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-surface-2 px-4 py-2.5 text-sm">
                <span className="text-ink-500">
                  Tip <span className="text-ink-400">· not part of the invoice total</span>
                </span>

                <span className="flex items-center gap-3">
                  {invoice.tipCents > 0 && (
                    <span className="tnum font-semibold text-ink-900">{money(invoice.tipCents)}</span>
                  )}
                  <Button size="xs" variant="ghost" icon={HandCoins} onClick={() => setTipping(true)}>
                    {invoice.tipCents > 0 ? 'Edit' : 'Record a tip'}
                  </Button>
                </span>
              </div>

              <div className="mt-4">
                <p className="eyebrow mb-2 flex items-center gap-1.5 text-ink-400">
                  <History className="size-3.5 text-brand" strokeWidth={2.25} aria-hidden="true" />
                  Payment history
                </p>

                {invoice.payments.length === 0 ? (
                  <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm text-ink-500">
                    Nothing recorded against this invoice yet.
                  </p>
                ) : (
                  /* A table, not a list of lines. Payments are a ledger - the
                     same four facts on every row - and a ledger is read down
                     its columns. */
                  <div className="overflow-x-auto rounded-md border border-line">
                    <div className="border-b border-line px-3 py-2">
                      <CountLine
                        total={invoice.payments.length}
                        noun={invoice.payments.length === 1 ? 'payment' : 'payments'}
                      />
                    </div>

                    <table className="w-full table-fixed text-left">
                      <thead>
                        <tr className={t.headRow}>
                          <th scope="col" className={cn(t.headCell(), 'w-[26%]')}>
                            Date
                          </th>
                          <th scope="col" className={cn(t.headCell('right'), 'w-[18%]')}>
                            Amount
                          </th>
                          <th scope="col" className={cn(t.headCell(), 'w-[18%]')}>
                            Method
                          </th>
                          <th scope="col" className={cn(t.headCell(), 'w-[28%]')}>
                            Reference
                          </th>
                          {/* `relative` contains the `sr-only` label, which is
                              absolutely positioned and would otherwise anchor
                              to the document and stretch the page. */}
                          <th scope="col" className={cn(t.headCell('right'), 'relative w-[10%]')}>
                            <span className="sr-only">Reverse</span>
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {invoice.payments.map((payment, index) => {
                          const negative = payment.amount < 0;
                          const reversed = Boolean(payment.reversedAt);
                          const forgiven = payment.method === 'void';
                          // A refund is not a reversal, and the row has to say
                          // so: both are negative, but one undoes an error and
                          // the other returns money that really arrived.
                          const isReversal = negative && payment.method === 'reversal';
                          const refund = negative && !isReversal && !forgiven;

                          return (
                            <tr
                              key={`${payment.at}-${index}`}
                              className={cn(t.row, reversed && 'bg-surface-2/60')}
                            >
                              <td className={cn(t.cell(), 'tnum text-ink-500')}>{dateTime(payment.at)}</td>

                              <td
                                className={cn(
                                  'tnum px-3 py-2.5 text-right font-display text-md font-bold',
                                  negative ? 'text-danger' : forgiven ? 'text-ink-400' : 'text-ink-900',
                                  reversed && 'line-through opacity-60',
                                )}
                              >
                                {money(payment.amount)}
                              </td>

                              <td className={t.cell()}>
                                {payment.method && (
                                  <Badge
                                    tone={negative ? 'danger' : forgiven ? 'neutral' : 'info'}
                                    size="sm"
                                  >
                                    {refund ? `refund · ${payment.method}` : payment.method}
                                  </Badge>
                                )}
                              </td>

                              <td className={cn(t.cell(), 'truncate font-mono text-xs text-ink-400')}>
                                {payment.reference || '-'}
                              </td>

                              <td className={t.cell('right')}>
                                {/* Only a real, un-reversed payment can be
                                    reversed. A void and a reversal are already
                                    corrections. */}
                                {!negative && !reversed && !forgiven && (
                                  <button
                                    type="button"
                                    onClick={() => setReversing(index)}
                                    aria-label={`Reverse the ${money(payment.amount)} payment`}
                                    className={cn(pressable, '-m-1 rounded-sm p-1 text-ink-300 hover:text-danger')}
                                  >
                                    <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                                  </button>
                                )}
                                {reversed && (
                                  <span className="text-2xs font-medium text-ink-400">Reversed</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Panel>

            {/* What was billed. An invoice raised by an order or as a flat
                charge has no devices, and the order or the reference says what
                it is for - so the panel is drawn only when there is work. */}
            {devices.length > 0 && <DocumentDevices devices={devices} />}

            <DocumentNotes
              clientNotes={invoice.customerNotes}
              technicianNotes={invoice.technicianNotes}
              internalNotes={invoice.internalNotes}
            />

            {/* Every edit this invoice has taken, from the audit log rather than
                a second history collection. */}
            <DocumentHistory
              description="Every recorded action on this invoice, newest first."
              empty="Nothing recorded since this invoice was raised."
              entries={entries.map((entry) => ({
                key: entry.id ?? `${entry.at}-${entry.action}`,
                title: entry.description ?? entry.action,
                at: entry.at ?? entry.createdAt,
                by: entry.actor?.name ?? entry.actorName,
              }))}
            />
          </>
        }
        aside={
          <>
            <DocumentSummary
              rows={
                devices.length > 0
                  ? [
                      {
                        label: 'Services and parts',
                        value: money(
                          devices.reduce(
                            (sum, device) =>
                              sum +
                              [...(device.services ?? []), ...(device.parts ?? [])].reduce(
                                (n, line) => n + (line.priceCents ?? 0) * (line.qty ?? 1),
                                0,
                              ),
                            0,
                          ),
                        ),
                      },
                      invoice.extendedServiceFee && {
                        label: 'Extended service area',
                        value: money(invoice.extendedServiceFeeCents ?? 0),
                      },
                      invoice.discountCents > 0 && {
                        label: 'Discount',
                        hint: invoice.discountCode || undefined,
                        value: `− ${money(invoice.discountCents)}`,
                        tone: 'ok',
                      },
                      {
                        label: 'Tax',
                        hint: invoice.taxPercent ? `${invoice.taxPercent}%` : undefined,
                        value: money(invoice.taxCents ?? 0),
                      },
                    ]
                  : []
              }
              total={{ value: money(invoice.amount) }}
              after={[
                invoice.amountPaid !== 0 && { label: 'Paid', value: `− ${money(invoice.amountPaid)}` },
                {
                  label: 'Balance due',
                  value: money(Math.max(0, invoice.balance)),
                  strong: true,
                  tone: settled ? undefined : 'danger',
                },
              ]}
              // The allowance is the shop's own cost for the journey: shown
              // beside the total, never in it.
              footnote={
                invoice.travelAllowanceCents > 0
                  ? `Travel allowance ${money(invoice.travelAllowanceCents)} (${invoice.travelKm} km) is internal and not billed.`
                  : undefined
              }
            />

            <DocumentCustomer
              name={account}
              business={invoice.businessName}
              phone={invoice.phone}
              email={invoice.email}
              userId={invoice.userId}
            />

            <DocumentFacts
              items={[
                { label: 'Service type', value: serviceType },
                {
                  label: 'Order',
                  value: invoice.orderNumber ? (
                    <Link
                      to={`/admin/orders/${invoice.orderNumber}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {invoice.orderNumber}
                    </Link>
                  ) : null,
                },
                { label: 'Terms', value: (invoice.terms ?? '').toUpperCase() },
                { label: 'Issued', value: date(invoice.issuedAt) },
                { label: 'Due', value: invoice.dueDate ? date(invoice.dueDate) : null },
                { label: 'Reference', value: invoice.reference },
              ]}
            />
          </>
        }
      />

      <RecordPaymentModal
        open={paying}
        invoice={invoice}
        isPending={recordInvoicePayment.isPending}
        error={recordInvoicePayment.error?.message}
        onClose={() => setPaying(false)}
        onSubmit={(values) =>
          recordInvoicePayment.mutate(
            { number: invoice.number, ...values },
            { onSuccess: () => setPaying(false) },
          )
        }
      />

      <RecordTipModal
        open={tipping}
        invoice={invoice}
        isPending={recordInvoiceTip.isPending}
        error={recordInvoiceTip.error?.message}
        onClose={() => setTipping(false)}
        onSubmit={(values) =>
          recordInvoiceTip.mutate(
            { number: invoice.number, ...values },
            { onSuccess: () => setTipping(false) },
          )
        }
      />

      {/* The outcome is reported: whether the money went to credit or back to
          the customer is the fact the staff member has to be able to repeat at
          the counter, and the server is what decided it. */}
      <RefundInvoiceModal
        open={refunding}
        invoice={invoice}
        isPending={refundInvoice.isPending}
        error={refundInvoice.error?.message}
        onClose={() => setRefunding(false)}
        onSubmit={(values) =>
          refundInvoice.mutate(
            { number: invoice.number, ...values },
            {
              onSuccess: (result) => {
                setRefunding(false);
                toast.ok(
                  result.toStoreCredit ? 'Refunded to store credit' : 'Refund recorded',
                  result.toStoreCredit
                    ? `${money(result.refunded)} credited. The account now holds ${money(result.storeCreditBalance ?? 0)}.`
                    : `${money(result.refunded)} went back to the customer.`,
                );
              },
            },
          )
        }
      />

      <EditInvoiceModal
        open={editing}
        invoice={invoice}
        isPending={updateInvoice.isPending}
        error={updateInvoice.error?.message}
        onClose={() => setEditing(false)}
        onSubmit={(values) =>
          updateInvoice.mutate(
            { number: invoice.number, ...values },
            { onSuccess: () => setEditing(false) },
          )
        }
      />

      {/* One confirmation for both ways in - the pill on the badge row and the
          menu item - and the same one the Invoices list raises. The menu route
          arrives with nothing chosen, so it carries the picker. */}
      <InvoiceStatusDialog move={statusMove} labels={labels} onClose={() => setStatusMove(null)} />
      {/* A reminder asks a real customer for money, so it confirms and names the
          figure: "send reminder" with no amount on it is a button somebody
          clicks down a list without reading which row they are on. */}
      <ConfirmDialog
        open={reminding}
        onClose={() => setReminding(false)}
        tone="warn"
        title={`Remind ${account} about ${invoice.number}?`}
        body={`They will be emailed that ${money(invoice.balance)} is outstanding${
          invoice.dueDate ? ` and was due ${date(invoice.dueDate)}` : ''
        }. The invoice document is not attached - they already have it.`}
        confirmLabel="Send reminder"
        confirmPhrase={invoice.number}
        confirmPhraseLabel="the invoice number"
        loading={remindInvoice.isPending}
        error={remindInvoice.error?.message}
        onConfirm={() =>
          remindInvoice.mutate(
            { number: invoice.number },
            {
              onSuccess: (result) => {
                setReminding(false);
                // What the transport said, not what was attempted.
                if (result?.delivered === false) {
                  toast.error('Reminder not sent', `${result.to} could not be reached.`);
                } else {
                  toast.ok('Reminder sent', `${result.to} has it.`);
                }
              },
            },
          )
        }
      />

      {/* Emailing reaches a real customer, so it is confirmed rather than sent
          on a single click. The outcome is a toast: the server says whether the
          transport accepted it, and "sent" and "tried to send" are different
          facts the staff member has to be able to tell apart. */}
      <ConfirmDialog
        open={emailing}
        onClose={() => setEmailing(false)}
        onConfirm={() =>
          emailInvoice.mutate(
            { number: invoice.number },
            {
              onSuccess: (result) => {
                setEmailing(false);
                if (result?.delivered === false) {
                  toast.error(
                    'Nothing was sent',
                    `The mail server refused the message to ${result.to}. Check the mail settings.`,
                  );
                } else {
                  toast.ok('Invoice sent', `${invoice.number} is on its way to ${result?.to ?? account}.`);
                }
              },
              onError: (mailError) => {
                setEmailing(false);
                toast.error('Nothing was sent', mailError.message);
              },
            },
          )
        }
        title={`Email ${invoice.number}?`}
        body={`The invoice document goes to ${invoice.email ?? account} - the same page the print view renders.`}
        tone="info"
        confirmLabel="Send invoice"
        confirmPhrase={invoice.number}
        confirmPhraseLabel="the invoice number"
        loading={emailInvoice.isPending}
      />

      {/* Reversing a payment, not deleting it: both the payment and its
          reversal stay on the record. */}
      <ConfirmDialog
        open={reversing !== null}
        onClose={() => setReversing(null)}
        onConfirm={() =>
          reverseInvoicePayment.mutate(
            { number: invoice.number, index: reversing },
            {
              onSuccess: () => {
                setReversing(null);
                toast.ok('Payment reversed', 'The balance and status have been recalculated.');
              },
              onError: (reverseError) => {
                setReversing(null);
                toast.error('Could not reverse that payment', reverseError.message);
              },
            },
          )
        }
        title="Reverse this payment?"
        body="A reversing entry is added. The original stays on the history, struck through."
        tone="danger"
        confirmLabel="Reverse payment"
        confirmPhrase={invoice.number}
        confirmPhraseLabel="the invoice number"
        loading={reverseInvoicePayment.isPending}
      />

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() =>
          deleteInvoice.mutate(
            { number: invoice.number },
            {
              onSuccess: (payload) => {
                setDeleting(false);
                toast.ok(
                  'Invoice deleted',
                  payload?.deletedPayments
                    ? `${invoice.number} is gone, along with ${payload.deletedPayments} payment${payload.deletedPayments === 1 ? '' : 's'} recorded against it.`
                    : `${invoice.number} is gone.`,
                );
                navigate('/admin/invoices');
              },
            },
          )
        }
        title={`Delete ${invoice.number}?`}
        /**
         * The payments are named, because they go too.
         *
         * Deleting destroys the invoice AND every payment recorded on it, and
         * refunds nothing - so this dialog is the last place that money is
         * mentioned. `critical` with the number typed out whenever money has
         * touched it; an invoice nobody has paid is an ordinary delete and
         * does not need the typing.
         */
        body={
          invoice.amountPaid > 0
            ? `The invoice for ${invoice.displayName ?? invoice.businessName ?? 'this customer'} is destroyed, and so is the ${money(invoice.amountPaid)} recorded as paid against it. That money is NOT refunded - if the customer is owed it back, refund the invoice first. Any balance it reserved is released back to their line of credit.`
            : `The invoice for ${invoice.displayName ?? invoice.businessName ?? 'this customer'} is removed, and the balance it reserved is released back to their line of credit. This cannot be undone.`
        }
        tone={invoice.amountPaid > 0 ? 'critical' : 'danger'}
        confirmPhrase={invoice.amountPaid > 0 ? invoice.number : undefined}
        confirmPhraseLabel="the invoice number"
        confirmLabel="Delete invoice"
        loading={deleteInvoice.isPending}
        error={deleteInvoice.error?.message}
      />
    </div>
  );
}

/** Recording money against this invoice. Overpayment is refused server-side. */
/**
 * Recording a gratuity.
 *
 * **Separate from the payment modal, deliberately.** A payment is money against
 * what is owed and the form opens pre-filled with the balance; a tip is money
 * that was never owed, moves no balance, and has no figure to suggest. Sharing
 * one form would mean one amount box whose meaning depended on a dropdown,
 * which is how a tip ends up settling an invoice.
 *
 * Setting the amount **replaces** what is there, so the box opens holding the
 * current tip and `0` clears one recorded by mistake. The copy says so, because
 * "record a tip" on a form already showing a number reads like it will add.
 */
function RecordTipModal({ open, invoice, onClose, onSubmit, isPending, error }) {
  const existing = (invoice.tipCents ?? 0) / 100;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(invoiceTipSchema),
    values: { amountDollars: existing ? existing.toFixed(2) : '' },
  });

  return (
    <Modal open={open} onClose={onClose} title={`Tip on ${invoice.number}`}>
      <form
        onSubmit={handleSubmit((values) =>
          onSubmit({ amountDollars: values.amountDollars || 0 }),
        )}
        className="space-y-4"
      >
        {error && (
          <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        <Input
          label="Tip amount"
          inputMode="decimal"
          suffix="CAD"
          placeholder="0.00"
          {...register('amountDollars')}
        />

        <p className="text-xs leading-snug text-ink-400">
          A tip is recorded beside the invoice, not in it: the total stays{' '}
          <span className="tnum text-ink-600">{money(invoice.amount)}</span> and the balance stays{' '}
          <span className="tnum text-ink-600">{money(invoice.balance)}</span>. Enter 0 to remove a
          tip recorded by mistake.
        </p>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" loading={isPending}>
            Save tip
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Refunding money off the invoice.
 *
 * **The destination is the decision, so it leads.** Cash back and store credit
 * are different promises to the customer - one hands the money over, the other
 * keeps it and owes goods - and the panel says which is about to happen in the
 * words the customer would use, not as a field label. A staff member who misses
 * that has told somebody the wrong thing at the counter.
 *
 * The amount is pre-filled with everything that could go back, because refunding
 * in full is the common case; the cap is stated in the hint and enforced by the
 * server against the invoice own payment rows.
 *
 * The form itself is the confirmation (§3.0.1): it was deliberately opened,
 * an amount was typed and a destination chosen, so a second dialog on top of it
 * would be a click that confirms nothing new.
 */
function RefundInvoiceModal({ open, invoice, onClose, onSubmit, isPending, error }) {
  const refundable = invoice.refundableCents ?? 0;

  const { register, handleSubmit, watch, reset, control } = useAdminForm({
    defaultValues: {
      amountDollars: (refundable / 100).toFixed(2),
      toStoreCredit: false,
      method: 'card',
      reason: '',
    },
  });

  const toStoreCredit = watch('toStoreCredit');

  function close() {
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title={`Refund on ${invoice.number}`} align="top">
      <form
        onSubmit={handleSubmit((values) =>
          onSubmit({
            // Cents at the boundary: the form works in dollars because that is what
            // a staff member reads off a receipt, and everything past here is
            // integer cents like every other amount in the system.
            amountCents: Math.round(Number(values.amountDollars || 0) * 100),
            toStoreCredit: Boolean(values.toStoreCredit),
            method: values.toStoreCredit ? '' : values.method,
            reason: values.reason,
          }),
        )}
        className="space-y-4"
      >
        {error && (
          <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        <Input
          label="Refund amount"
          inputMode="decimal"
          suffix="CAD"
          hint={`At most ${money(refundable)} can go back - that is what has been paid and not already refunded.`}
          {...register('amountDollars')}
        />

        {/* The choice, and what each side of it means. Not a bare checkbox label:
            "add to store credit" says what the system does and not what the
            customer walks away with. */}
        <Checkbox
          label="Add to the customer store credit instead of handing the money back"
          {...register('toStoreCredit')}
        />

        <p
          className={cn(
            'rounded-md px-3 py-2.5 text-xs leading-relaxed',
            toStoreCredit ? 'bg-info-50 text-ink-700' : 'bg-surface-2 text-ink-600',
          )}
        >
          {toStoreCredit ? (
            <>
              The money stays with the business and the account is credited, so it can be spent on
              a future repair or order. The customer leaves with a balance, not cash.
            </>
          ) : (
            <>
              The money leaves the business. Record how it went back so the till and the invoice
              agree at the end of the day.
            </>
          )}
        </p>

        {/* Only asked for a cash refund: a store-credit refund records its own
            method, and offering a choice there would imply the cash moved. */}
        {!toStoreCredit && (
          <SelectField
            control={control}
            name="method"
            label="How it went back"
            // Store credit is excluded: that is the checkbox above, and offering
            // it here as a cash method would be two ways to say one thing.
            options={PAYMENT_METHODS.filter((entry) => entry.value !== 'credit')}
          />
        )}

        <Textarea
          label="Reason"
          rows={2}
          placeholder="Part failed, customer cancelled, goodwill…"
          hint="Shown on the invoice and, for a store-credit refund, on the customer statement."
          {...register('reason')}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={isPending} disabled={refundable <= 0}>
            {toStoreCredit ? 'Refund to store credit' : 'Refund the money'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RecordPaymentModal({ open, invoice, onClose, onSubmit, isPending, error }) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(invoicePaymentSchema),
    defaultValues: {
      amountDollars: (invoice.balance / 100).toFixed(2),
      method: 'card',
      reference: '',
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={`Record a payment on ${invoice.number}`}>
      <form
        onSubmit={handleSubmit((values) =>
          // `amountDollars`, not cents: `invoicePaymentSchema` coerces the
          // dollar figure itself, and converting here would hand the server a
          // number a hundred times too large.
          onSubmit({
            amountDollars: values.amountDollars,
            method: values.method,
            reference: values.reference || undefined,
          }),
        )}
        className="space-y-4"
      >
        {error && (
          <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Amount"
            inputMode="decimal"
            suffix="CAD"
            hint={`${money(invoice.balance)} outstanding`}
            error={errors.amountDollars?.message}
            data-autofocus
            {...register('amountDollars', { required: 'Enter an amount.' })}
          />
          <SelectField control={control} name="method" label="Method" options={PAYMENT_METHODS} />
        </div>

        <Input
          label="Reference"
          placeholder="Cheque number, transfer id…"
          hint="Optional. Shown on the payment history."
          {...register('reference')}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isPending}>
            Record payment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Editing an invoice: the clerical fields only.
 *
 * The amount is absent because it is derived from what was billed - see
 * `invoiceUpdateSchema`. Changing what was billed is a void plus a new
 * invoice, which leaves both documents where an audit can see them.
 */
function EditInvoiceModal({ open, invoice, onClose, onSubmit, isPending, error }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useAdminForm({
    defaultValues: {
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : '',
      poNumber: invoice.poNumber ?? '',
      note: invoice.note ?? '',
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${invoice.number}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-ink-500">
          The amount is not editable here - it is what was billed. To change what
          this invoice charges for, void it and raise a new one, so both
          documents stay in the record.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Due date"
            type="date"
            error={errors.dueDate?.message}
            data-autofocus
            {...register('dueDate')}
          />
          <Input label="PO number" placeholder="Supplier reference" {...register('poNumber')} />
        </div>

        <Input label="Note" placeholder="Shown on the invoice document." {...register('note')} />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default AdminInvoiceDetailPage;
