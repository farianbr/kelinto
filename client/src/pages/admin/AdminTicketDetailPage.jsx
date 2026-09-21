import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  ClipboardList,
  FileText,
  History,
  Mail,
  PackageCheck,
  Phone,
  Printer,
  Receipt,
  Smartphone,
  Stethoscope,
  Tag,
  Trash2,
  Wrench,
} from 'lucide-react';
import cn from '@/lib/cn';
import { apiUrl } from '@/lib/api';
import { money, date, dateTime, count as formatCount } from '@/lib/format';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@shared/schemas/admin';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import ProcessStrip from '@/components/admin/ProcessStrip';
import WorkflowLineage from '@/components/admin/WorkflowLineage';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import { useAdminTicket, useAdminMutations } from '@/hooks/useAdmin';
import { toast } from '@/store/toastStore';
import reportStatusOutcome from '@/lib/ticketStatusOutcome';
import { pressable } from '@/lib/motion';

/**
 * One repair, from drop-off to invoice.
 *
 * **The screen the panel was missing.** Tickets had a list and a form but no
 * detail view, so the only way to read a job was to open the edit form - which
 * shows every field as an input and answers none of the questions a staff member
 * actually arrives with: where is this up to, what did we quote, what has been
 * paid, and what happens next.
 *
 * The order of the page is the order of those questions. Stage first, because
 * it is the one thing that changes daily and the one thing a customer rings
 * about. Then the money already taken, then the fault and the work, then the
 * history. The lifecycle strip at the foot is the map - it says where this
 * ticket sits in a process that outlives any one screen.
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
 * The dot beside each status in the picker.
 *
 * **The same map the Tickets list uses**, deliberately duplicated rather than
 * imported: `STATUS_DOTS` lives in `AdminTicketsPage` as a module constant and
 * exporting a colour table from a page component to another page component is
 * how two screens end up importing each other. The pair is small, stable and
 * the labels are already shared through `TICKET_STATUS_LABELS`; if a third
 * screen needs it, it moves to `shared/` then.
 *
 * Without these the picker was nine lines of identical grey text - readable,
 * but nothing to aim at, and visibly not the control the list had trained
 * people on.
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
 * **Worded for a repair shop, not for the wholesale desk.** These labels were
 * the parts business's own - bare "Net 30", "Net 60" - which is a credit
 * vocabulary that belongs to a buyer with an account and a line of credit. The
 * customer collecting a phone pays at the counter, so "Due on collection" is
 * the normal case and says the thing that actually happens; the net terms stay
 * for the business accounts a shop does invoice, named so it is clear they
 * draw on credit rather than settle now.
 */
const TERMS = [
  { value: 'prepaid', label: 'Due on collection' },
  { value: 'net15', label: 'On account - 15 days' },
  { value: 'net30', label: 'On account - 30 days' },
  { value: 'net60', label: 'On account - 60 days' },
];

/**
 * This page reads tighter than the rest of the panel, on purpose.
 *
 * A ticket is a **working screen**: a counter has it open while somebody is
 * standing there, and it carries eight sections that all want to be visible at
 * once - stage, deposit, fault, work, timeline, customer, lifecycle. The default
 * panel padding is right for a settings form somebody reads once; here it pushed
 * the timeline below the fold and made the page feel loose rather than calm.
 *
 * Applied through `bodyClassName` rather than by changing `Panel`, because that
 * component serves every screen in the admin and this is a judgement about one.
 * `twMerge` lets the later padding win at both breakpoints.
 */
const COMPACT_BODY = 'p-3 sm:p-4';

/**
 * Shorter controls, for the same reason the panels are tighter.
 *
 * **Height only.** The 16px font on an input is load-bearing rather than
 * decorative: mobile Safari zooms the page in when a focused field sets text
 * below it and never zooms back out, which leaves the sticky header wider than
 * the viewport for the rest of the visit. See the note in `ui/Input`. So these
 * lose 8px of vertical padding and keep every character size.
 */
const COMPACT_FIELD = 'h-9';

/**
 * The stages a repair moves through.
 *
 * Rendered by the shared `ProcessStrip`, **not a local component**. This page
 * used to draw its own row of brand-tinted pills with an ASCII arrow between
 * them - the same idea as the quote's and the invoice's life cycle, in a
 * different shape, so the one pattern looked like three patterns and only this
 * one lacked the tick-versus-clock distinction that tells a finished stage from
 * a live one. Quote is the standard; this now follows it.
 *
 * **Four stations, not nine.** The real ladder in `TICKET_STATUSES` has nine
 * rungs and most are shades of the same station - `ready_to_repair` and
 * `waiting_for_parts` are both "in repair" as far as anyone outside the workshop
 * is concerned. The `Status` panel above is where the exact rung lives; this is the
 * shape of the process, which is what somebody scanning wants.
 *
 * `cancelled` is not a fifth station. It is an exit that can happen from any
 * rung, so it stops the strip at whichever station the ticket had reached
 * rather than laying itself out as a stage a ticket passes *through*.
 */
const LIFECYCLE = [
  { key: 'diagnosis', label: 'Diagnosis', icon: Stethoscope },
  { key: 'processing', label: 'In repair', icon: Wrench },
  { key: 'ready_to_pickup', label: 'Ready to pickup', icon: PackageCheck },
  { key: 'invoiced', label: 'Invoiced', icon: Receipt },
];

/**
 * Which of the four stations a ticket's nine-rung status sits at.
 *
 * A cancelled ticket keeps the station it died at - `timeline` is the only
 * record of how far it got, so the last status before the cancellation is
 * where the strip stops. Without that a cancelled ticket showed as stopped at
 * Diagnosis whether it was cancelled at the counter or on the workshop.
 */
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

function stationOf(ticket, invoiced) {
  if (invoiced) return 'invoiced';

  const status =
    ticket.status === 'cancelled'
      ? ([...(ticket.timeline ?? [])]
          .reverse()
          .find((entry) => entry.status && entry.status !== 'cancelled')?.status ?? 'diagnosis')
      : ticket.status;

  if (['ready_to_pickup', 'completed'].includes(status)) return 'ready_to_pickup';
  if (['processing', 'ready_to_repair', 'waiting_for_parts', 'retention_policy'].includes(status)) {
    return 'processing';
  }
  return 'diagnosis';
}

export function AdminTicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useAdminTicket(id);

  const {
    setTicketStatus,
    recordTicketDeposit,
    removeTicketDeposit,
    convertTicketToInvoice,
    deleteTicket,
  } = useAdminMutations();

  const [converting, setConverting] = useState(false);
  const [removingDeposit, setRemovingDeposit] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * The submitted-but-unconfirmed stage move and deposit.
   *
   * **Every mutation confirms** (Instructions §3.0.1), and these two were the
   * exceptions - argued on the grounds that a form somebody filled in is itself
   * the confirmation. That reading has been overruled twice, and the two of
   * them are the page's consequential writes: a stage move MESSAGES THE
   * CUSTOMER by default, and a deposit records money taken. Neither is
   * recoverable by editing a field back - an SMS is out, and a deposit is
   * removed rather than undone.
   *
   * The form's values are parked here and the mutation fires from the dialog,
   * so what is confirmed is exactly what was typed.
   */
  const [movingStage, setMovingStage] = useState(null);
  const [recordingDeposit, setRecordingDeposit] = useState(null);

  const ticket = data?.ticket;
  useSetRecordLabel(ticket?.ticketNumber);

  if (error) {
    return (
      <>
        <PageHeader icon={ClipboardList} title="Ticket" />
        <Panel>
          <PanelEmpty
            icon={AlertCircle}
            title="That ticket could not be opened"
            body={error.message}
          />
        </Panel>
      </>
    );
  }

  if (isLoading || !ticket) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const invoiced = Boolean(ticket.invoice);
  const balance = Math.max(0, (ticket.finalCents || ticket.estimateCents || 0) - ticket.depositTotal);

  return (
    // The record measure, centred. `.record-page` carries the whole treatment
    // (see the container tokens in index.css) - this page used to hard-code its
    // own 1120px, which is exactly the per-page invented number that token
    // exists to prevent.
    <div className="record-page">
      <PageHeader
        icon={ClipboardList}
        title={ticket.ticketNumber}
        badgesBelow
        badge={
          <>
            <Badge tone={STATUS_TONES[ticket.status] ?? 'neutral'} size="sm">
              {TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
            </Badge>
            <Badge tone={ticket.priority === 'urgent' ? 'danger' : 'neutral'} size="sm">
              {ticket.priority}
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
            {/* The two things a counter prints. The label goes on the device so
                it can be found on a shelf of forty; the ticket is what the
                customer leaves with. Both render through the browser's print
                dialog, which is where "save as PDF" lives - the same reasoning
                the invoice screen gives for not shipping a PDF generator. */}
            <Button
              size="xs"
              variant="outline"
              icon={Tag}
              /**
               * `kind` goes in the params, never in the path.
               *
               * `apiUrl` appends the selected business as a query parameter of
               * its own, and it does so by starting a fresh `?`. A path that
               * already carried one produced `?kind=label?business=...`, which
               * Express reads as a single parameter named `kind` whose value is
               * `label?business=...` - so the route matched, the business never
               * resolved, and the whole thing 404'd.
               */
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
              size="xs"
              variant="outline"
              icon={Printer}
              onClick={() =>
                window.open(
                  apiUrl(`/admin/tickets/${ticket.id}/document`),
                  '_blank',
                  'noopener',
                )
              }
            >
              Download PDF
            </Button>
            <Link to={`/admin/tickets/${ticket.id}/edit`}>
              <Button size="xs" variant="outline" icon={FileText}>
                Edit
              </Button>
            </Link>
            {invoiced ? (
              <Link to={`/admin/invoices/${ticket.invoice.number ?? ticket.invoice.id}`}>
                <Button size="xs" icon={Receipt}>
                  View invoice
                </Button>
              </Link>
            ) : (
              <Button size="xs" icon={Receipt} onClick={() => setConverting(true)}>
                Convert to invoice
              </Button>
            )}
            {/* Destructive, so it is an icon apart from the row rather than a
                fifth equal button - and it still confirms by name. */}
            <Button
              size="xs"
              variant="danger"
              icon={Trash2}
              aria-label={`Delete ${ticket.ticketNumber}`}
              onClick={() => setDeleting(true)}
            />
          </>
        }
      />

      {/* Where this job came from and where it went - the whole chain, above
          the record, because "am I looking at the right one?" is the first
          question a staff member arrives with. It replaces the single "created
          from quote" banner this page used to carry, which only ever showed
          the half of the chain behind the ticket. */}
      <WorkflowLineage
        current="ticket"
        quote={ticket.quote}
        ticket={ticket}
        invoice={ticket.invoice}
        // A ticket that has not been invoiced still has that step ahead of it,
        // so the station is drawn in waiting. A ticket raised at the counter
        // with no quote behind it is not shown a quote station at all - that
        // step did not happen and never will.
        pending={invoiced ? undefined : 'invoice'}
        className="mb-3"
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <StageCard
            ticket={ticket}
            disabled={invoiced}
            isPending={setTicketStatus.isPending}
            error={setTicketStatus.error?.message}
            // Held for the confirm rather than sent - see `movingStage`.
            onMove={setMovingStage}
          />

          <DepositCard
            ticket={ticket}
            invoiced={invoiced}
            isPending={recordTicketDeposit.isPending}
            error={recordTicketDeposit.error?.message}
            onRecord={setRecordingDeposit}
            onRemove={setRemovingDeposit}
          />

          <Panel icon={Stethoscope} title="Reported fault" bodyClassName={COMPACT_BODY}>
            <p className="whitespace-pre-wrap text-sm text-ink-700">{ticket.issue}</p>
          </Panel>

          <WorkCard ticket={ticket} balance={balance} />

          <Panel icon={History} title="Timeline" flush={ticket.timeline?.length > 0}>
            {(ticket.timeline ?? []).length === 0 ? (
              <p className="text-sm text-ink-400">No history yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {[...ticket.timeline].reverse().map((entry, index) => (
                  <li key={index} className="flex items-start gap-2.5 px-3.5 py-2 sm:px-4">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-900">
                        {TICKET_STATUS_LABELS[entry.status] ?? entry.status}
                      </p>
                      {entry.note && (
                        <p className="mt-0.5 text-sm text-ink-500">{entry.note}</p>
                      )}
                    </div>
                    <p className="shrink-0 text-xs text-ink-400">{dateTime(entry.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-3">
          <CustomerCard ticket={ticket} />
        </div>
      </div>

      {/* At the foot, matching the quote, the invoice and the purchase order:
          it summarises where the record ended up after everything above it, so
          it reads as a conclusion rather than a heading. */}
      <Lifecycle ticket={ticket} invoiced={invoiced} className="mt-3" />

      {!invoiced && (
        <button
          type="button"
          onClick={() => setCancelling(true)}
          className={cn(
            pressable,
            'mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger-50 px-4 py-2.5 text-sm font-semibold text-danger hover:border-danger/50',
          )}
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
          Cancel ticket
        </button>
      )}

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
                if (payload?.invoice?.number) {
                  navigate(`/admin/invoices/${payload.invoice.number}`);
                }
              },
            },
          )
        }
      />

      {/*
        Moving the stage, confirmed.

        The consequence worth naming is not the stage - the staff member just chose
        that - it is the MESSAGE. "Message the customer" is ticked by default,
        so the commonest way to text somebody by accident is to move a stage
        without noticing the box, and the dialog says which of the two is about
        to happen in the sentence rather than leaving it to a checkbox
        higher up the page.
      */}
      <ConfirmDialog
        open={Boolean(movingStage)}
        onClose={() => setMovingStage(null)}
        onConfirm={() =>
          setTicketStatus.mutate(
            { id: ticket.id, ...movingStage },
            {
              onSuccess: (payload) => {
                setMovingStage(null);
                reportStatusOutcome(payload);
              },
            },
          )
        }
        title={`Move ${ticket.ticketNumber} to ${TICKET_STATUS_LABELS[movingStage?.status] ?? 'the next stage'}?`}
        body={
          movingStage?.channels?.length === 0
            ? `${ticket.customer?.name ?? 'The customer'} will not be told. The stage changes and the timeline records it.`
            : `${ticket.customer?.name ?? 'The customer'} is messaged about this change on the channels this shop has switched on. A message cannot be recalled once it is out.`
        }
        // `warn` rather than `info` when it reaches somebody outside the
        // building, which is the tone rule exactly (see ConfirmDialog).
        tone={movingStage?.channels?.length === 0 ? 'info' : 'warn'}
        confirmLabel="Set status"
        loading={setTicketStatus.isPending}
        error={setTicketStatus.error?.message}
      />

      {/*
        Taking a deposit, confirmed.

        Money in, against a record that has no invoice yet - so the amount and
        the method are both in the question. `critical` and a typed amount
        would be the rule for money LEAVING; this is money arriving and fully
        reversible by removing it, which is the dialog directly below.
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
        loading={removeTicketDeposit.isPending}
        error={removeTicketDeposit.error?.message}
      />

      {/*
        Deleting destroys the repair history for a device, so it takes the
        second gate the Instructions reserve for the irreversible: the staff member
        types the ticket number. Cancelling, below, only stops the job and is a
        single confirm.
      */}
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

      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        onConfirm={() =>
          setTicketStatus.mutate(
            { id: ticket.id, status: 'cancelled', note: 'Ticket cancelled.' },
            {
              onSuccess: (payload) => {
                setCancelling(false);
                reportStatusOutcome(payload);
              },
            },
          )
        }
        title={`Cancel ${ticket.ticketNumber}?`}
        body="The job stops and the ticket closes. Any deposit stays recorded - refund it separately."
        tone="danger"
        confirmLabel="Cancel ticket"
        loading={setTicketStatus.isPending}
        error={setTicketStatus.error?.message}
      />
    </div>
  );
}

/**
 * Move the job to its next stage.
 *
 * The **next** status is preselected, because advancing one rung is what
 * happens nine times in ten and pre-picking it turns the common case into one
 * click. Every other status stays available: a repair genuinely goes backwards
 * - a device on the workshop returns to `waiting_for_parts` when a part turns out
 * to be wrong - and a control that only moved forward would make a staff member
 * lie about where the job is.
 */
function StageCard({ ticket, disabled, isPending, error, onMove }) {
  const currentIndex = TICKET_STATUSES.indexOf(ticket.status);
  const next = TICKET_STATUSES[currentIndex + 1];

  /**
   * The field starts on where the ticket IS, not where it is going next.
   *
   * It used to pre-select the next rung, which turned the control into
   * something that read as a state display showing the wrong state: a ticket
   * sitting at Ready to Pickup showed "Completed", the current status was
   * missing from the list entirely, and the button beside it carried the same
   * word. Three things all saying a status nobody had chosen yet.
   *
   * Starting on the current status makes the field answer "what is this?"
   * first and "what next?" only once somebody opens it - and it makes a
   * wrongly-pressed button a no-op rather than a stage change, because the
   * submit is disabled until the value actually differs.
   */
  const { register, handleSubmit, control, watch } = useAdminForm({
    defaultValues: { status: ticket.status, note: '', notify: true },
  });

  // Nothing to do while the field still reads the status it started on.
  const unchanged = watch('status') === ticket.status;

  return (
    <Panel icon={ArrowRight} title="Status" bodyClassName={COMPACT_BODY}>
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      {disabled ? (
        <p className="text-sm text-ink-500">
          This ticket has been invoiced, so its stage is settled. Changes now belong on the invoice.
        </p>
      ) : (
        <form
          onSubmit={handleSubmit((values) =>
            onMove({
              status: values.status,
              note: values.note || undefined,
              /**
               * An empty list is "change it silently"; omitting the field
               * entirely is "behave as before", which is every channel.
               *
               * This used to submit straight to the mutation, arguing a filled-in
               * form is its own confirmation. It confirms now like everything
               * else on the page (§3.0.1): the values go to `movingStage` and
               * the dialog fires the write, because the part worth pausing on
               * is the message to the customer, not the stage.
               */
              channels: values.notify ? undefined : [],
            }),
          )}
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end"
        >
          <SelectField
            control={control}
            name="status"
            label="Set status to"
            size="sm"
            /**
             * Every status, the current one included and marked as such.
             *
             * It was filtered out before, on the reasoning that moving to
             * where you already are is not a move. True, but it left the field
             * unable to show the ticket's own state - so it opened on a value
             * that was a proposal, with no entry for the answer to "where is
             * this now?". The current rung is listed and labelled "(current)";
             * the next one still says "(next)", which is the shortcut that
             * makes the common case one click.
             */
            options={TICKET_STATUSES.map((status) => ({
              value: status,
              label:
                status === ticket.status
                  ? `${TICKET_STATUS_LABELS[status]} (current)`
                  : status === next
                    ? `${TICKET_STATUS_LABELS[status]} (next)`
                    : TICKET_STATUS_LABELS[status],
              // The same tinted dot the Tickets list puts on this status, so
              // the two controls read as one vocabulary rather than two.
              dotClass: STATUS_DOTS[status],
            }))}
          />
          <Input
            label="Note"
            placeholder="Stage change note…"
            className={COMPACT_FIELD}
            {...register('note')}
          />
          {/*
            The button says what it DOES, not where it lands.

            It used to read the destination alone - "Completed", "Processing" -
            which beside a dropdown already showing that word read as a second
            label rather than as the action, and gave no clue that pressing it
            was the thing that moved the ticket. Naming the verb and leaving
            the stage to the field next to it is the fix; the two together
            would be "Set status to Completed" on a 36px control, which wraps.

            Disabled until the field differs from the ticket's own status:
            with the current status now selected by default, an enabled button
            beside it would invite a click that does nothing.
          */}
          <Button
            type="submit"
            size="sm"
            icon={ArrowRight}
            loading={isPending}
            disabled={unchanged}
          >
            Set status
          </Button>

          {/* Spans the row: it qualifies the whole move rather than belonging to
              any one field above it. */}
          <div className="sm:col-span-3">
            <Checkbox
              label="Message the customer about this change"
              {...register('notify')}
            />
          </div>
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
              <p className="tnum shrink-0 text-sm font-semibold text-ink-900">
                {money(deposit.amount)}
              </p>
              <p className="w-24 shrink-0 text-right text-xs capitalize text-ink-500">
                {deposit.method}
              </p>
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

      <div className={cn(ticket.deposits.length > 0 && 'p-3 sm:p-4')}>
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
              /**
               * Submitting opens the confirm; it does not clear the form.
               *
               * The reset rides along as a callback the dialog runs once the
               * deposit is actually written. Clearing here would empty the
               * fields the moment the question was asked, so backing out of
               * the confirm would lose an amount the staff member had just
               * counted at the counter.
               */
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
                className={COMPACT_FIELD}
                error={errors.amountDollars?.message}
                {...register('amountDollars')}
              />
              <SelectField
                control={control}
                name="method"
                label="Method"
                size="sm"
                options={DEPOSIT_METHODS}
              />
              <Input
                label="Note"
                placeholder="optional"
                className={COMPACT_FIELD}
                {...register('note')}
              />
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

/** The devices, what was done to each, and what it comes to. */
function WorkCard({ ticket, balance }) {
  const devices = ticket.devices ?? [];
  const gross = devices.reduce(
    (sum, device) =>
      sum +
      [...(device.services ?? []), ...(device.parts ?? [])].reduce(
        (n, line) => n + (line.priceCents ?? 0) * (line.qty ?? 1),
        0,
      ),
    0,
  );

  return (
    <Panel icon={Wrench} title="Services and parts" bodyClassName={COMPACT_BODY}>
      {devices.length === 0 ? (
        <p className="text-sm text-ink-400">Nothing priced yet.</p>
      ) : (
        <div className="space-y-4">
          {devices.map((device, index) => {
            const lines = [
              ...(device.services ?? []).map((line) => ({ ...line, kind: 'Service' })),
              ...(device.parts ?? []).map((line) => ({ ...line, kind: 'Part' })),
            ];

            return (
              <div key={index}>
                <p className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold text-ink-900">
                  <Smartphone className="size-3.5 text-brand" strokeWidth={2.25} aria-hidden="true" />
                  {[device.brand, device.series, device.model].filter(Boolean).join(' ') ||
                    `Device ${index + 1}`}
                </p>

                {device.serial && (
                  <p className="mb-2 font-mono text-2xs text-ink-400">Serial {device.serial}</p>
                )}

                {lines.length === 0 ? (
                  <p className="text-sm text-ink-400">Nothing priced on this device.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {lines.map((line, lineIndex) => (
                      <li
                        key={lineIndex}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                      >
                        <span className="w-14 shrink-0 text-2xs uppercase tracking-wide text-ink-400">
                          {line.kind}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink-900">{line.name}</span>
                        <span className="tnum w-10 shrink-0 text-right text-ink-500">
                          ×{line.qty ?? 1}
                        </span>
                        <span className="tnum w-24 shrink-0 text-right font-medium text-ink-900">
                          {money((line.priceCents ?? 0) * (line.qty ?? 1))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* The arithmetic, in the order the server applies it. */}
      <dl className="mt-3 space-y-1.5 border-t border-line pt-2.5 text-sm">
        <Row label="Subtotal" value={money(gross - (ticket.discountCents ?? 0))} />
        {ticket.discountCents > 0 && (
          <Row label="Discount" value={`− ${money(ticket.discountCents)}`} />
        )}
        <Row
          label={`Tax${ticket.taxRate ? ` (${ticket.taxRate}%)` : ''}`}
          value={money(ticket.taxCents ?? 0)}
        />
        <div className="flex items-baseline justify-between border-t border-line pt-2 font-display text-md font-bold text-ink-900">
          <dt>Total</dt>
          <dd className="tnum">{money(ticket.finalCents || ticket.estimateCents || 0)}</dd>
        </div>
        {ticket.depositTotal > 0 && (
          <>
            <Row label="Deposit held" value={`− ${money(ticket.depositTotal)}`} />
            <div className="flex items-baseline justify-between pt-1 text-sm font-semibold text-ink-900">
              <dt>Still to pay</dt>
              <dd className="tnum">{money(balance)}</dd>
            </div>
          </>
        )}
      </dl>
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

/** Who it belongs to and what came in. */
function CustomerCard({ ticket }) {
  return (
    <Panel
      icon={ClipboardList}
      title="Customer"
      action={
        ticket.customer.userId && (
          <Link
            to={`/admin/clients/${ticket.customer.userId}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
          >
            View
            <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          </Link>
        )
      }
    >
      <p className="font-display text-md font-bold text-ink-900">{ticket.customer.name}</p>

      <div className="mt-2 space-y-1.5 text-sm text-ink-600">
        {ticket.customer.phone && (
          <p className="flex items-center gap-1.5">
            <Phone className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
            {ticket.customer.phone}
          </p>
        )}
        {ticket.customer.email && (
          <p className="flex min-w-0 items-center gap-1.5">
            <Mail className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
            <span className="truncate">{ticket.customer.email}</span>
          </p>
        )}
      </div>

      <dl className="mt-3 space-y-2 border-t border-line pt-2.5 text-sm">
        <Detail label="Technician" value={ticket.technician?.name ?? 'Unassigned'} />
        <Detail label="Source" value={ticket.source} />
        <Detail label="Created" value={date(ticket.createdAt)} />
        {ticket.closedAt && <Detail label="Completed" value={date(ticket.closedAt)} />}
        {ticket.dueDate && <Detail label="Due" value={date(ticket.dueDate)} />}
      </dl>
    </Panel>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="eyebrow text-ink-400">{label}</dt>
      <dd className="mt-0.5 capitalize text-ink-900">{value}</dd>
    </div>
  );
}

/**
 * Where this ticket sits in the repair process.
 *
 * The quote's treatment, applied here: `ProcessStrip` at the foot of the page,
 * `successOnLast` so reaching Invoiced reads as an outcome rather than an
 * alert, and a cancelled ticket drawn in `danger` at the station it stopped at
 * instead of being replaced by a banner. One component, one placement, one
 * vocabulary across quote, ticket, invoice and purchase order.
 */
function Lifecycle({ ticket, invoiced, className }) {
  const cancelled = ticket.status === 'cancelled';

  return (
    <ProcessStrip
      title="Life cycle of a ticket"
      successOnLast
      steps={LIFECYCLE}
      current={stationOf(ticket, invoiced)}
      stoppedTone={cancelled ? 'danger' : undefined}
      caption={
        cancelled
          ? 'Cancelled - the job stopped here. Any deposit taken stays recorded against it.'
          : 'The stage follows the Status control above; invoicing settles it.'
      }
      className={className}
    />
  );
}

/**
 * Raising the invoice.
 *
 * Only the terms are asked. Everything billed comes off the ticket, because
 * that is where the job was priced - a form that let the staff member restate the
 * lines here would be a second place for them to differ. The summary states
 * what will be carried so the conversion is not a leap of faith.
 */
function ConvertModal({ open, ticket, balance, isPending, error, onClose, onConfirm }) {
  const { handleSubmit, control } = useAdminForm({ defaultValues: { terms: 'prepaid' } });

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
              label={`${formatCount(ticket.devices?.length ?? 0)} device${(ticket.devices?.length ?? 0) === 1 ? '' : 's'}, priced as invoiced`}
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

        <p className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
          The ticket stays as the record of the work. It cannot be invoiced twice, and any deposit
          on it becomes a payment against the new invoice.
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
