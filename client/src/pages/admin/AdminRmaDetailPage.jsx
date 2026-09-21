import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Hourglass,
  RotateCcw,
  Truck,
  Wallet,
} from 'lucide-react';
import cn from '@/lib/cn';
import { money, date, dateTime, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectField from '@/components/ui/SelectField';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { useTableClasses, CountLine } from '@/components/admin/DataTable';
import KpiRow from '@/components/admin/KpiRow';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import { useAdminRma, useAdminMutations } from '@/hooks/useAdmin';
import Skeleton from '@/components/ui/Skeleton';
import { pressable } from '@/lib/motion';

/**
 * One return - per-item disposition, inspection notes, and the resolution
 * (ERP rework §6.3).
 *
 * Two things are kept visibly apart here because they are genuinely different
 * decisions: **what the customer gets** (refund, replacement, rejection) and
 * **what happens to the goods** (restock, scrap, return to supplier). A
 * customer can be refunded for a part that is scrapped. Conflating the two is
 * how a warehouse ends up with phantom inventory.
 */

const STATUS_TONES = {
  requested: 'neutral',
  approved: 'info',
  in_transit: 'info',
  received: 'warn',
  inspecting: 'warn',
  resolved: 'ok',
  rejected: 'danger',
};

/** The ladder, in order, so the screen can offer only the next rung. */
const LADDER = ['requested', 'approved', 'in_transit', 'received', 'inspecting'];

const NEXT_LABELS = {
  approved: 'Approve return',
  in_transit: 'Mark in transit',
  received: 'Mark received',
  inspecting: 'Start inspection',
};

const DISPOSITIONS = [
  { value: 'pending', label: 'Not decided' },
  { value: 'restock', label: 'Restock - back on the shelf' },
  { value: 'scrap', label: 'Scrap - written off' },
  { value: 'return_to_supplier', label: 'Return to supplier' },
  { value: 'reject', label: 'Reject - send back to client' },
];

function statusLabel(status) {
  return String(status).replace('_', ' ');
}

/**
 * Inspection: what each part actually is, and what happens to it.
 *
 * `restock` is the only disposition that moves stock, and the form says so
 * a staff member choosing it is choosing to put units back, not just describing
 * their condition.
 */
function InspectForm({ rma, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, control } = useAdminForm({
    defaultValues: {
      inspectionNotes: rma.inspectionNotes ?? '',
      items: Object.fromEntries(
        rma.items.map((item) => [
          item.sku,
          { condition: item.condition ?? '', disposition: item.disposition },
        ]),
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

      <div className="space-y-2">
        {rma.items.map((item) => (
          <div key={item.sku} className="rounded-md bg-surface-2 p-3">
            <p className="text-sm text-ink-900">{item.name}</p>
            <p className="tnum mb-2.5 font-mono text-xs text-ink-400">
              {item.sku} · {item.qty} unit{item.qty === 1 ? '' : 's'}
              {item.reason ? ` · "${item.reason}"` : ''}
              {item.restocked ? ' · already restocked' : ''}
            </p>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <Input
                label="Condition found"
                placeholder="Screen cracked, no power"
                {...register(`items.${item.sku}.condition`)}
              />
              <SelectField
                control={control}
                name={`items.${item.sku}.disposition`}
                label="Disposition"
                options={DISPOSITIONS}
              />
            </div>
          </div>
        ))}
      </div>

      <Textarea label="Inspection notes" rows={3} {...register('inspectionNotes')} />

      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
        Only <strong className="font-semibold">Restock</strong> puts units back on the shelf, and it
        happens when the RMA is resolved - not now. Everything else records what became of the part
        without touching stock.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Save inspection
        </Button>
      </div>
    </form>
  );
}

/**
 * Resolution.
 *
 * The refund amount is proposed from what the order actually charged for these
 * lines and capped at what the order has left to refund - but the cap is the
 * server's, enforced in `storeCreditService`. This form shows the numbers so
 * the staff member is never asked to guess.
 */
function ResolveForm({ rma, refund, onSubmit, onCancel, isPending, error }) {
  const proposed = Math.min(refund.proposed, refund.refundable);

  const { register, handleSubmit, control, watch } = useAdminForm({
    defaultValues: {
      resolution: 'refund',
      amountDollars: (proposed / 100).toFixed(2),
      note: '',
    },
  });

  const resolution = watch('resolution');
  const restocking = rma.items.filter((item) => item.disposition === 'restock' && !item.restocked);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <SelectField
        control={control}
        name="resolution"
        label="What does the client get?"
        options={[
          { value: 'refund', label: 'Refund to store credit' },
          { value: 'replace', label: 'Replacement to be shipped' },
          { value: 'reject', label: 'Reject the return' },
        ]}
      />

      {resolution === 'refund' && (
        <>
          <div className="rounded-md bg-surface-2 p-3.5">
            <p className="tnum text-sm text-ink-500">
              {money(refund.proposed)} was charged for these lines ·{' '}
              {money(refund.alreadyRefunded)} already refunded on{' '}
              <span className="font-mono">{rma.orderNumber}</span> ·{' '}
              <span className="font-medium text-ink-900">{money(refund.refundable)} refundable</span>
            </p>
          </div>

          <Input
            label="Refund amount"
            inputMode="decimal"
            suffix="CAD"
            hint="Goes to store credit. The line of credit is a separate instrument and is untouched."
            {...register('amountDollars')}
          />
        </>
      )}

      <Input label="Note" placeholder="Shown on the client's statement" {...register('note')} />

      {restocking.length > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-info-50 px-3 py-2.5 text-sm leading-relaxed text-info">
          <Boxes className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          <span>
            Resolving will put{' '}
            <strong className="font-semibold">
              {formatCount(restocking.reduce((sum, item) => sum + item.qty, 0))} unit
              {restocking.reduce((sum, item) => sum + item.qty, 0) === 1 ? '' : 's'}
            </strong>{' '}
            back on the shelf - the lines inspection marked <em>restock</em>. Each writes a stock
            movement.
          </span>
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Resolve RMA
        </Button>
      </div>
    </form>
  );
}

export function AdminRmaDetailPage() {
  const t = useTableClasses();
  const { id } = useParams();
  const [inspecting, setInspecting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  // Advancing the ladder was a bare click sitting beside Reject, which already
  // confirmed. "Approve return" in particular commits to taking the goods back.
  const [advancing, setAdvancing] = useState(false);

  const { data, isLoading, error } = useAdminRma(id);
  const { setRmaStatus, inspectRma, resolveRma } = useAdminMutations();

  const rma = data?.rma;
  const refund = data?.refund ?? { proposed: 0, refundable: 0, alreadyRefunded: 0 };

  useSetRecordLabel(rma?.rmaNumber);

  if (error) {
    return (
      <>
        <PageHeader icon={RotateCcw} title="RMA" />
        <Panel>
          <PanelEmpty
            icon={RotateCcw}
            title="RMA not found"
            body={error.message}
            action={
              <Link
                to="/admin/rma"
                className={cn(pressable, 'inline-flex h-9 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
              >
                Back to returns
              </Link>
            }
          />
        </Panel>
      </>
    );
  }

  if (isLoading || !rma) {
    return (
      <>
        <PageHeader icon={RotateCcw} title="RMA" />
        <div className="space-y-3">
          <Skeleton className="h-24" rounded="lg" />
          <Skeleton className="h-64" rounded="lg" />
        </div>
      </>
    );
  }

  const rung = LADDER.indexOf(rma.status);
  const nextStatus = rung > -1 && rung < LADDER.length - 1 ? LADDER[rung + 1] : null;
  const canResolve = rma.status === 'inspecting';

  return (
    // The record measure, centred - one record is a reading screen, and a
    // list is what earns the shell's full width. The `.record-page` class carries
    // the whole treatment; see the container tokens in index.css.
    <div className="record-page">
      <PageHeader
        icon={RotateCcw}
        title={rma.rmaNumber}
        description={`${rma.user.businessName} · ${rma.orderNumber ?? 'no order'} · opened ${date(rma.createdAt)}`}
        badge={
          <>
            <Badge tone={STATUS_TONES[rma.status]} size="sm">
              {statusLabel(rma.status)}
            </Badge>
            {rma.overSla && (
              <Badge tone="danger" size="sm">
                past SLA
              </Badge>
            )}
          </>
        }
        action={
          <>
            {nextStatus && (
              <Button
                icon={nextStatus === 'inspecting' ? ClipboardCheck : Truck}
                loading={setRmaStatus.isPending}
                onClick={() => setAdvancing(true)}
              >
                {NEXT_LABELS[nextStatus]}
              </Button>
            )}
            {!rma.closed && (
              <Button variant="outline" icon={ClipboardCheck} onClick={() => setInspecting(true)}>
                Record inspection
              </Button>
            )}
            {canResolve && (
              <Button variant="outline" icon={Wallet} onClick={() => setResolving(true)}>
                Resolve
              </Button>
            )}
            {!rma.closed && (
              <Button
                variant="ghost"
                icon={Ban}
                onClick={() => setRejecting(true)}
              >
                Reject
              </Button>
            )}
          </>
        }
      />

      {setRmaStatus.error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {setRmaStatus.error.message}
        </p>
      )}

      {/* Named rather than implied: a staff member who restocked nothing should be
          able to see that they restocked nothing. */}
      {outcome && (
        <div className="mb-3 space-y-2">
          {outcome.refund && (
            <p className="rounded-md bg-ok-50 px-3 py-2.5 text-sm text-ok">
              Refunded <strong className="font-semibold">{money(outcome.refund.amount)}</strong> to
              store credit - new balance {money(outcome.refund.balance)}.
            </p>
          )}
          <p
            className={cn(
              'rounded-md px-3 py-2.5 text-sm',
              outcome.restocked?.length ? 'bg-ok-50 text-ok' : 'bg-surface-2 text-ink-500',
            )}
          >
            {outcome.restocked?.length
              ? `Restocked ${outcome.restocked.map((row) => `${row.sku} ×${row.qty}`).join(', ')}.`
              : 'Nothing was restocked - no line was marked restock at inspection.'}
          </p>
        </div>
      )}

      <KpiRow
        tiles={[
          {
            key: 'units',
            label: 'Units returning',
            value: formatCount(rma.qty),
            hint: `${formatCount(rma.itemCount)} line${rma.itemCount === 1 ? '' : 's'}`,
            tone: 'neutral',
            icon: RotateCcw,
          },
          {
            key: 'value',
            label: 'Value of lines',
            value: money(refund.proposed),
            hint: 'At the prices the order charged',
            tone: 'brand',
            icon: Wallet,
          },
          {
            key: 'refunded',
            label: 'Refunded',
            value: money(rma.refundAmount),
            hint:
              rma.refundAmount > 0
                ? 'To store credit'
                : `${money(refund.refundable)} refundable on the order`,
            tone: rma.refundAmount > 0 ? 'ok' : 'neutral',
            icon: Wallet,
          },
          {
            key: 'age',
            label: 'Age',
            value: `${rma.age}d`,
            hint: rma.closed ? 'Closed - no longer ageing' : rma.overSla ? 'Past the SLA' : 'Within the SLA',
            tone: rma.overSla ? 'danger' : rma.closed ? 'neutral' : 'info',
            icon: Hourglass,
          },
        ]}
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <Panel title="Items" description="What the client said, and what inspection found." flush>
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <CountLine
                total={rma.items.length}
                noun={rma.items.length === 1 ? 'item' : 'items'}
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
                      Qty
                    </th>
                    <th scope="col" className={t.headCell()}>
                      Condition
                    </th>
                    <th scope="col" className={t.headCell()}>
                      Disposition
                    </th>
                    <th scope="col" className={t.headCell('right')}>
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rma.items.map((item) => (
                    <tr key={item.sku} className={t.row}>
                      <td className={t.cell()}>
                        <p className="text-sm text-ink-900">{item.name}</p>
                        <p className="font-mono text-xs text-ink-400">{item.sku}</p>
                        {item.reason && (
                          <p className="mt-0.5 text-xs italic text-ink-500">
                            &ldquo;{item.reason}&rdquo;
                          </p>
                        )}
                      </td>
                      <td className={cn(t.cell('right'), 'tnum text-ink-700')}>
                        {formatCount(item.qty)}
                      </td>
                      <td className={cn(t.cell(), 'text-ink-600')}>
                        {item.condition ?? <span className="text-ink-300">not inspected</span>}
                      </td>
                      <td className={t.cell()}>
                        <Badge
                          tone={
                            item.disposition === 'restock'
                              ? 'ok'
                              : item.disposition === 'pending'
                                ? 'neutral'
                                : 'warn'
                          }
                          size="sm"
                        >
                          {statusLabel(item.disposition)}
                        </Badge>
                        {item.restocked && (
                          <span className="mt-0.5 block text-2xs text-ok">back on the shelf</span>
                        )}
                      </td>
                      <td className={cn(t.cell('right'), 'tnum text-ink-900')}>
                        {money(item.unitPrice * item.qty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {rma.inspectionNotes && (
            <Panel title="Inspection notes">
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">
                {rma.inspectionNotes}
              </p>
            </Panel>
          )}
        </div>

        <div className="space-y-3">
          <Panel title="Client">
            <p className="text-md font-medium text-ink-900">{rma.user.businessName}</p>
            {rma.user.contactName && (
              <p className="mt-0.5 text-sm text-ink-500">{rma.user.contactName}</p>
            )}
            <p className="tnum mt-2 text-sm text-ink-500">
              Store credit held:{' '}
              <span className="font-medium text-ink-900">{money(data?.storeCredit ?? 0)}</span>
            </p>
            {rma.user.id && (
              <Link
                to={`/admin/clients/${rma.user.id}`}
                className={cn(pressable, 'mt-3 inline-flex h-8 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
              >
                View profile
              </Link>
            )}
          </Panel>

          {rma.reason && (
            <Panel title="Stated reason">
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">
                {rma.reason}
              </p>
            </Panel>
          )}

          <Panel title="Timeline" flush>
            <ul className="divide-y divide-line">
              {rma.timeline.map((entry, index) => (
                <li key={`${entry.status}-${index}`} className="flex items-start gap-2.5 px-4 py-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-400">
                    <CheckCircle2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">
                      {statusLabel(entry.status)}
                    </p>
                    <p className="text-xs text-ink-400">{dateTime(entry.at)}</p>
                    {entry.note && <p className="mt-0.5 text-xs text-ink-500">{entry.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Modal
        open={inspecting}
        onClose={() => setInspecting(false)}
        title="Record inspection"
        size="lg"
        align="top"
      >
        {inspecting && (
          <InspectForm
            rma={rma}
            isPending={inspectRma.isPending}
            error={inspectRma.error?.message}
            onCancel={() => setInspecting(false)}
            onSubmit={(values) =>
              inspectRma.mutate(
                {
                  id: rma.id,
                  inspectionNotes: values.inspectionNotes || undefined,
                  items: Object.entries(values.items ?? {}).map(([sku, line]) => ({
                    sku,
                    condition: line.condition || undefined,
                    disposition: line.disposition,
                  })),
                },
                { onSuccess: () => setInspecting(false) },
              )
            }
          />
        )}
      </Modal>

      <Modal
        open={resolving}
        onClose={() => setResolving(false)}
        title="Resolve this return"
        size="md"
        align="top"
      >
        {resolving && (
          <ResolveForm
            rma={rma}
            refund={refund}
            isPending={resolveRma.isPending}
            error={resolveRma.error?.message}
            onCancel={() => setResolving(false)}
            onSubmit={(values) =>
              resolveRma.mutate(
                {
                  id: rma.id,
                  resolution: values.resolution,
                  amountDollars: values.resolution === 'refund' ? values.amountDollars : undefined,
                  note: values.note || undefined,
                },
                {
                  onSuccess: (payload) => {
                    setResolving(false);
                    setOutcome({ restocked: payload.restocked, refund: payload.refund });
                  },
                },
              )
            }
          />
        )}
      </Modal>

      {/* Rejecting closes the RMA against the customer with no credit and no
          restock. It sat next to Resolve as a bare click. */}
      <ConfirmDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        onConfirm={() =>
          setRmaStatus.mutate(
            { id: rma.id, status: 'rejected' },
            { onSuccess: () => setRejecting(false) },
          )
        }
        title="Reject this return?"
        body={`${rma.rmaNumber} closes with no credit to the customer and nothing back into stock.`}
        tone="danger"
        confirmLabel="Reject return"
        loading={setRmaStatus.isPending}
        error={setRmaStatus.error?.message}
      />

      <ConfirmDialog
        open={advancing}
        onClose={() => setAdvancing(false)}
        onConfirm={() =>
          setRmaStatus.mutate(
            { id: rma.id, status: nextStatus },
            { onSuccess: () => setAdvancing(false) },
          )
        }
        title={`${NEXT_LABELS[nextStatus] ?? 'Advance'} ${rma.rmaNumber}?`}
        body={
          nextStatus === 'approved'
            ? 'The customer is told to send the goods back.'
            : 'The return moves to the next stage. It does not step back.'
        }
        confirmLabel={NEXT_LABELS[nextStatus] ?? 'Advance'}
        tone={nextStatus === 'approved' ? 'warn' : 'info'}
        loading={setRmaStatus.isPending}
        error={setRmaStatus.error?.message}
      />
    </div>
  );
}

export default AdminRmaDetailPage;
