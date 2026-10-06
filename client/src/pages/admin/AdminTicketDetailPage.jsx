import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  ClipboardList,
  FileText,
  Printer,
  Receipt,
  Smartphone,
  Tag,
  Trash2,
  XCircle,
} from 'lucide-react';
import cn from '@/lib/cn';
import { apiUrl } from '@/lib/api';
import { money, date, dateTime, count as formatCount, titleize } from '@/lib/format';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@shared/schemas/admin';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import WorkflowLineage from '@/components/admin/WorkflowLineage';
import TicketStatusDialog from '@/components/admin/TicketStatusDialog';
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
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import { useAdminTicket, useAdminMutations } from '@/hooks/useAdmin';
import { toast } from '@/store/toastStore';
import { pressable } from '@/lib/motion';

/**
 * One repair, from drop-off to invoice.
 *
 * Laid out the way the quote and the invoice are (`SalesDocument`, client
 * ruling 2026-10-05): the work in the wide column, and what it comes to, whose
 * it is and when beside it. A ticket's own working panel, the repair status,
 * leads the wide column because it is the one thing that changes daily and the
 * one thing a customer rings about; the deposit sits after the work, beside
 * the money it is taken against.
 */

/** The tones the status ladder reads in. Open states warm, terminal ones cool. */
const STATUS_TONES = {
  diagnosis: 'info',
  accepted: 'info',
  waiting_for_parts: 'warn',
  ready_to_repair: 'info',
  processing: 'warn',
  retention_policy: 'warn',
  ready_to_pickup: 'ok',
  completed: 'ok',
  cancelled: 'danger',
};

/**
 * The dot beside each status in the picker - the same map the Tickets list
 * uses, so the two controls read as one vocabulary rather than two.
 */
const STATUS_DOTS = {
  diagnosis: 'bg-info/60',
  accepted: 'bg-warn',
  waiting_for_parts: 'bg-danger/70',
  ready_to_repair: 'bg-brand',
  processing: 'bg-brand-600',
  retention_policy: 'bg-ink-300',
  ready_to_pickup: 'bg-ok',
  completed: 'bg-ok/60',
  cancelled: 'bg-danger',
};

const DEPOSIT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Credit card' },
  { value: 'debit', label: 'Debit card' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

/**
 * Payment terms on the invoice a repair converts into.
 *
 * Worded for a repair shop: the customer collecting a phone pays at the
 * counter, so "Due on collection" is the normal case; the net terms stay for
 * the business accounts a shop does invoice, named so it is clear they draw on
 * credit rather than settle now.
 */
const TERMS = [
  { value: 'prepaid', label: 'Due on collection' },
  { value: 'net15', label: 'On account - 15 days' },
  { value: 'net30', label: 'On account - 30 days' },
  { value: 'net60', label: 'On account - 60 days' },
];

/** Taking a deposit on a ticket. The box starts empty, so this is the one that most needed a rule. */
const depositFormSchema = z
  .object({
    amountDollars: z.coerce
      .number({ invalid_type_error: 'Enter an amount.' })
      .positive('Enter an amount greater than zero.'),
  })
  // Everything else on these small dialogs is a picker or a note, and is
  // passed through rather than restated.
  .passthrough();

export function AdminTicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useAdminTicket(id);

  const { recordTicketDeposit, removeTicketDeposit, convertTicketToInvoice, deleteTicket } =
    useAdminMutations();

  const [converting, setConverting] = useState(false);
  const [removingDeposit, setRemovingDeposit] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /**
   * The stage move waiting on the shared status dialog, and the deposit waiting
   * on its own confirm. Both are parked here and the write fires from the
   * dialog, so what is confirmed is exactly what was typed.
   */
  const [statusMove, setStatusMove] = useState(null);
  const [recordingDeposit, setRecordingDeposit] = useState(null);

  const ticket = data?.ticket;
  useSetRecordLabel(ticket?.ticketNumber);

  if (error) {
    return (
      <>
        <PageHeader icon={ClipboardList} title="Ticket" />
        <Panel>
          <PanelEmpty icon={AlertCircle} title="That ticket could not be opened" body={error.message} />
        </Panel>
      </>
    );
  }

  if (isLoading || !ticket) {
    return (
      <div className="record-page space-y-4">
        <Skeleton className="h-16 w-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const invoiced = Boolean(ticket.invoice);
  const total = ticket.finalCents || ticket.estimateCents || 0;
  const balance = Math.max(0, total - ticket.depositTotal);

  /**
   * The devices, or the one a ticket written before devices existed describes.
   * Its fault lived on `issue`, so it is shown as that device's problem rather
   * than in a panel of its own.
   */
  const devices = ticket.devices?.length
    ? ticket.devices
    : [
        {
          brand: ticket.device?.brand,
          model: ticket.device?.model,
          serial: ticket.device?.serial,
          problem: ticket.issue,
          services: [],
          parts: [],
        },
      ];

  const gross = devices.reduce(
    (sum, device) =>
      sum +
      [...(device.services ?? []), ...(device.parts ?? [])].reduce(
        (n, line) => n + (line.priceCents ?? 0) * (line.qty ?? 1),
        0,
      ),
    0,
  );

  const serviceType = serviceTypeLabel(ticket.serviceType);

  return (
    <div className="record-page">
      <PageHeader
        icon={ClipboardList}
        title={ticket.ticketNumber}
        description={[ticket.customer?.name, serviceType].filter(Boolean).join(' · ')}
        badgesBelow
        badge={
          <>
            <Badge tone={STATUS_TONES[ticket.status] ?? 'neutral'} size="sm">
              {TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
            </Badge>
            {ticket.overSla && (
              <Badge tone="warn" size="sm">
                {formatCount(ticket.age)} days
              </Badge>
            )}
            {/* How the job arrived. Only worth saying when it was not the
                counter, which is the default and therefore not news. */}
            {ticket.source === 'kiosk' && (
              <Badge tone="ok" size="sm" icon={Smartphone}>
                Kiosk check-in
              </Badge>
            )}
          </>
        }
        action={
          <>
            {/* The two things a counter prints. Both render through the
                browser's print dialog, which is where "save as PDF" lives.
                `kind` goes in the params, never in the path: `apiUrl` appends
                the business with a fresh `?`. */}
            <Button
              size="sm"
              variant="outline"
              icon={Tag}
              onClick={() =>
                window.open(
                  apiUrl(`/admin/tickets/${ticket.id}/document`, { kind: 'label' }),
                  '_blank',
                  'noopener',
                )
              }
            >
              Print label
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={Printer}
              onClick={() =>
                window.open(apiUrl(`/admin/tickets/${ticket.id}/document`), '_blank', 'noopener')
              }
            >
              Print or PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={FileText}
              onClick={() => navigate(`/admin/tickets/${ticket.id}/edit`)}
            >
              Edit
            </Button>
            {invoiced ? (
              <Button
                size="sm"
                icon={Receipt}
                onClick={() => navigate(`/admin/invoices/${ticket.invoice.number ?? ticket.invoice.id}`)}
              >
                View invoice
              </Button>
            ) : (
              <Button size="sm" icon={Receipt} onClick={() => setConverting(true)}>
                Convert to invoice
              </Button>
            )}
            {/* Destructive, so it is an icon apart from the row rather than a
                fifth equal button - and it still confirms by name. */}
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              aria-label={`Delete ${ticket.ticketNumber}`}
              onClick={() => setDeleting(true)}
            />
          </>
        }
      />

      <WorkflowLineage
        current="ticket"
        quote={ticket.quote}
        ticket={ticket}
        invoice={ticket.invoice}
        // A ticket that has not been invoiced still has that step ahead of it.
        pending={invoiced ? undefined : 'invoice'}
        className="mb-4"
      />

      <DocumentLayout
        main={
          <>
            <StageCard
              // Keyed by the status, so a move made anywhere (the list, another tab)
              // re-seeds the picker with where the ticket now is.
              key={ticket.status}
              ticket={ticket}
              invoiced={invoiced}
              onMove={setStatusMove}
              onCancel={() =>
                setStatusMove({ ticket, status: 'cancelled', note: 'Ticket cancelled.' })
              }
            />

            <DocumentDevices devices={devices} showCondition showPasscode />

            <DocumentNotes
              clientNotes={ticket.clientNotes}
              technicianNotes={ticket.technicianNotes}
              internalNotes={ticket.notes}
            />

            <DepositCard
              ticket={ticket}
              invoiced={invoiced}
              isPending={recordTicketDeposit.isPending}
              error={recordTicketDeposit.error?.message}
              onRecord={setRecordingDeposit}
              onRemove={setRemovingDeposit}
            />

            <DocumentHistory
              entries={[...(ticket.timeline ?? [])].reverse().map((entry, index) => ({
                key: `${entry.at}-${index}`,
                title: TICKET_STATUS_LABELS[entry.status] ?? entry.status,
                note: entry.note,
                at: entry.at,
              }))}
            />
          </>
        }
        aside={
          <>
            <DocumentSummary
              rows={[
                { label: 'Services and parts', value: money(gross) },
                ticket.discountCents > 0 && {
                  label: 'Discount',
                  hint: ticket.discountCode || undefined,
                  value: `− ${money(ticket.discountCents)}`,
                  tone: 'ok',
                },
                {
                  label: 'Tax',
                  hint: ticket.taxRate ? `${ticket.taxRate}%` : undefined,
                  value: money(ticket.taxCents ?? 0),
                },
              ]}
              total={{ value: money(total) }}
              after={
                ticket.depositTotal > 0
                  ? [
                      { label: 'Deposit held', value: `− ${money(ticket.depositTotal)}` },
                      { label: 'Still to pay', value: money(balance), strong: true },
                    ]
                  : []
              }
              footnote={invoiced ? undefined : 'Not final until the ticket is invoiced.'}
            />

            <DocumentCustomer
              name={ticket.customer?.name}
              phone={ticket.customer?.phone}
              email={ticket.customer?.email}
              userId={ticket.customer?.userId}
              // The kiosk asked whether they had the account's phone with them
              // and they did not; this number is for this repair only, and the
              // profile keeps its own. Said, so the mismatch is not "fixed".
              phoneNote={ticket.intake?.alternateContact ? 'for this repair only' : undefined}
            />

            <DocumentFacts
              items={[
                { label: 'Service type', value: serviceType },
                { label: 'Technician', value: ticket.technician?.name ?? 'Unassigned' },
                { label: 'Source', value: titleize(ticket.source ?? '') },
                { label: 'Created', value: date(ticket.createdAt) },
                { label: 'Est. completion', value: ticket.dueDate ? date(ticket.dueDate) : null },
                { label: 'Completed', value: ticket.closedAt ? date(ticket.closedAt) : null },
              ]}
            />
          </>
        }
      />

      <ConvertModal
        open={converting}
        ticket={ticket}
        balance={balance}
        isPending={convertTicketToInvoice.isPending}
        error={convertTicketToInvoice.error?.message}
        onClose={() => setConverting(false)}
        onConfirm={(values) =>
          convertTicketToInvoice.mutate(
            { id: ticket.id, ...values },
            {
              onSuccess: (payload) => {
                setConverting(false);
                if (payload?.invoice?.number) navigate(`/admin/invoices/${payload.invoice.number}`);
              },
            },
          )
        }
      />

      {/* The same confirmation the Tickets list raises, cancelling included:
          channels to untick, no typed phrase (client ruling 2026-10-05). */}
      <TicketStatusDialog move={statusMove} onClose={() => setStatusMove(null)} />

      {/*
        Taking a deposit, confirmed. Money in, against a record that has no
        invoice yet - so the amount and the method are both in the question.
      */}
      <ConfirmDialog
        open={Boolean(recordingDeposit)}
        onClose={() => setRecordingDeposit(null)}
        onConfirm={() => {
          const { onDone, ...values } = recordingDeposit;
          recordTicketDeposit.mutate(
            { id: ticket.id, ...values },
            {
              onSuccess: () => {
                setRecordingDeposit(null);
                onDone?.();
              },
            },
          );
        }}
        title="Record this deposit?"
        body={`${money(Math.round(Number(recordingDeposit?.amountDollars ?? 0) * 100))} by ${recordingDeposit?.method ?? 'cash'} is held against ${ticket.ticketNumber} for ${ticket.customer?.name ?? 'this customer'}, and carries over as a payment when the ticket becomes an invoice.`}
        tone="warn"
        confirmLabel="Record deposit"
        loading={recordTicketDeposit.isPending}
        error={recordTicketDeposit.error?.message}
      />

      <ConfirmDialog
        open={Boolean(removingDeposit)}
        onClose={() => setRemovingDeposit(null)}
        onConfirm={() =>
          removeTicketDeposit.mutate(
            { id: ticket.id, depositId: removingDeposit.id },
            { onSuccess: () => setRemovingDeposit(null) },
          )
        }
        title="Remove this deposit?"
        body={`${money(removingDeposit?.amount ?? 0)} taken by ${removingDeposit?.method ?? 'cash'} will no longer be held against this ticket. Use this only for a deposit recorded in error.`}
        tone="danger"
        confirmLabel="Remove deposit"
        confirmPhrase={ticket.ticketNumber}
        confirmPhraseLabel="the ticket number"
        loading={removeTicketDeposit.isPending}
        error={removeTicketDeposit.error?.message}
      />

      {/* Deleting destroys the repair history for a device, so the ticket
          number is typed back. */}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() =>
          deleteTicket.mutate(ticket.id, {
            onSuccess: () => {
              setDeleting(false);
              toast.ok('Ticket deleted', `${ticket.ticketNumber} is gone.`);
              navigate('/admin/tickets');
            },
          })
        }
        title={`Delete ${ticket.ticketNumber}?`}
        body={`The whole repair record for ${ticket.customer?.name ?? 'this customer'} goes, including its timeline and any deposit recorded against it. This cannot be undone.`}
        tone="danger"
        confirmPhrase={ticket.ticketNumber}
        confirmPhraseLabel="the ticket number"
        confirmLabel="Delete ticket"
        loading={deleteTicket.isPending}
        error={deleteTicket.error?.message}
      />
    </div>
  );
}

/**
 * Move the job to another stage.
 *
 * The field starts on where the ticket IS, with the next rung marked "(next)",
 * so it answers "what is this?" first and the common move is one pick. Every
 * other status stays available: a repair genuinely goes backwards. Submitting
 * opens the shared status dialog, which is where the customer message is
 * decided - the same one the Tickets list raises.
 *
 * Cancelling is the one move offered on its own, in the panel's header: it
 * stops the job, and a staff member looking for it should not have to know it
 * is the last entry in a list of nine.
 */
function StageCard({ ticket, invoiced, onMove, onCancel }) {
  const currentIndex = TICKET_STATUSES.indexOf(ticket.status);
  const next = TICKET_STATUSES[currentIndex + 1];

  const { register, handleSubmit, control, watch, reset } = useAdminForm({
    defaultValues: { status: ticket.status, note: '' },
  });

  // Nothing to do while the field still reads the status it started on.
  const unchanged = watch('status') === ticket.status;

  return (
    <Panel
      icon={ArrowRight}
      title="Repair status"
      action={
        !invoiced &&
        ticket.status !== 'cancelled' && (
          <Button size="xs" variant="ghost" icon={XCircle} onClick={onCancel}>
            Cancel ticket
          </Button>
        )
      }
    >
      {invoiced ? (
        <p className="text-sm text-ink-500">
          This ticket has been invoiced, so its stage is settled. Changes now belong on the invoice.
        </p>
      ) : (
        <form
          onSubmit={handleSubmit((values) =>
            onMove({
              ticket,
              status: values.status,
              note: values.note || undefined,
              // Clears the note once the move is made, and only then - backing
              // out of the dialog keeps what was typed.
              onDone: () => reset({ status: values.status, note: '' }),
            }),
          )}
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end"
        >
          <SelectField
            control={control}
            name="status"
            label="Set repair status to"
            options={TICKET_STATUSES.map((status) => ({
              value: status,
              label:
                status === ticket.status
                  ? `${TICKET_STATUS_LABELS[status]} (current)`
                  : status === next
                    ? `${TICKET_STATUS_LABELS[status]} (next)`
                    : TICKET_STATUS_LABELS[status],
              dotClass: STATUS_DOTS[status],
            }))}
          />
          <Input label="Note" placeholder="Stage change note…" {...register('note')} />
          {/* The button says what it DOES, not where it lands, and stays
              disabled until the field differs from the ticket's own status. */}
          <Button type="submit" size="sm" icon={ArrowRight} disabled={unchanged}>
            Set status
          </Button>
        </form>
      )}
    </Panel>
  );
}

/**
 * Money taken before the invoice exists.
 *
 * A repair is quoted, the customer pays something at the counter, and the
 * invoice is not raised until the work is done - so the payment has nowhere to
 * live. The hint says what happens to it, because "deposit" alone does not
 * explain why it is being recorded on a ticket rather than against a bill.
 */
function DepositCard({ ticket, invoiced, isPending, error, onRecord, onRemove }) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(depositFormSchema),
    defaultValues: { amountDollars: '', method: 'cash', note: '' },
  });

  return (
    <Panel
      icon={Banknote}
      title="Deposit"
      action={
        ticket.depositTotal > 0 && (
          <span className="tnum font-display text-md font-bold text-ink-900">
            {money(ticket.depositTotal)} held
          </span>
        )
      }
      flush={ticket.deposits.length > 0}
    >
      {ticket.deposits.length > 0 && (
        <ul className="divide-y divide-line border-b border-line">
          {ticket.deposits.map((deposit) => (
            <li key={deposit.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <p className="min-w-0 flex-1 text-sm text-ink-500">{dateTime(deposit.at)}</p>
              <p className="tnum shrink-0 text-sm font-semibold text-ink-900">{money(deposit.amount)}</p>
              <p className="w-24 shrink-0 text-right text-xs capitalize text-ink-500">{deposit.method}</p>
              {!invoiced && (
                <button
                  type="button"
                  onClick={() => onRemove(deposit)}
                  aria-label="Remove this deposit"
                  className={cn(
                    pressable,
                    'flex size-8 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-danger-50 hover:text-danger',
                  )}
                >
                  <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={cn(ticket.deposits.length > 0 && 'p-4 sm:p-5')}>
        {invoiced ? (
          <p className="text-sm text-ink-500">
            This ticket is invoiced. Record any further payment against the invoice.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-500">
              Customer paid before the invoice exists? Record it here - it carries over as a payment
              when this ticket becomes an invoice.
            </p>

            {error && (
              <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
                <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {error}
              </p>
            )}

            <form
              // Submitting opens the confirm; the reset rides along as a
              // callback the dialog runs once the deposit is actually written,
              // so backing out keeps an amount just counted at the counter.
              onSubmit={handleSubmit((values) =>
                onRecord({
                  ...values,
                  onDone: () => reset({ amountDollars: '', method: values.method, note: '' }),
                }),
              )}
              className="grid gap-3 sm:grid-cols-[120px_minmax(0,160px)_minmax(0,1fr)_auto] sm:items-end"
            >
              <Input
                label="Amount"
                required
                inputMode="decimal"
                placeholder="0.00"
                error={errors.amountDollars?.message}
                {...register('amountDollars')}
              />
              <SelectField control={control} name="method" label="Method" options={DEPOSIT_METHODS} />
              <Input label="Note" placeholder="optional" {...register('note')} />
              <Button type="submit" size="sm" loading={isPending}>
                Record
              </Button>
            </form>
          </>
        )}
      </div>
    </Panel>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between text-ink-600">
      <dt>{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}

/**
 * Raising the invoice.
 *
 * Only the terms are asked. Everything billed comes off the ticket, because
 * that is where the job was priced - a form that let the staff member restate the
 * lines here would be a second place for them to differ.
 */
function ConvertModal({ open, ticket, balance, isPending, error, onClose, onConfirm }) {
  const { handleSubmit, control } = useAdminForm({ defaultValues: { terms: 'prepaid' } });
  const deviceCount = ticket.devices?.length ?? 0;

  return (
    <Modal open={open} onClose={onClose} title="Convert to invoice" size="md" align="top">
      <form onSubmit={handleSubmit(onConfirm)} className="space-y-4">
        {error && (
          <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="rounded-md bg-surface-2 p-3.5">
          <p className="eyebrow mb-2 text-ink-400">What carries over</p>
          <dl className="space-y-1.5 text-sm">
            <Row
              label={`${formatCount(deviceCount)} device${deviceCount === 1 ? '' : 's'}, priced as invoiced`}
              value={money(ticket.finalCents || ticket.estimateCents || 0)}
            />
            {ticket.depositTotal > 0 && (
              <Row label="Deposit, as a payment" value={`− ${money(ticket.depositTotal)}`} />
            )}
            <div className="flex items-baseline justify-between border-t border-line pt-1.5 font-semibold text-ink-900">
              <dt>Balance on the new invoice</dt>
              <dd className="tnum">{money(balance)}</dd>
            </div>
          </dl>
        </div>

        <SelectField control={control} name="terms" label="Payment terms" options={TERMS} />

        <p className="text-xs leading-relaxed text-ink-500">
          The ticket stays as the record of the work. It cannot be invoiced twice, and any deposit on
          it becomes a payment against the new invoice.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon={Receipt} loading={isPending}>
            Create invoice
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default AdminTicketDetailPage;
