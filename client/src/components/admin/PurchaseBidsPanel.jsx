import { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  FileText,
  MessageSquare,
  Send,
  Trash2,
  Trophy,
  Truck,
  Undo2,
  UserPlus,
} from 'lucide-react';
import { money, date, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import ActionMenu from '@/components/ui/ActionMenu';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useTableClasses } from '@/components/admin/DataTable';
import { toast } from '@/store/toastStore';
import { apiUrl } from '@/lib/api';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';
import {
  useAdminPoBids,
  useSuppliersForComponentTypes,
  useAdminMutations,
} from '@/hooks/useAdmin';

/**
 * Every supplier this purchase order was put to, and what they came back with
 * (§6.8a).
 *
 * **The comparison is the point of this panel.** One row per supplier, sorted
 * so the answer that should win is at the top - and `isBest` is the server's
 * ranking, not this component's, because "cheapest complete bid" is a rule and
 * a rule belongs in one place. An incomplete bid is marked as such rather than
 * ranked: a supplier who cannot fill every line has a smaller total for a
 * smaller order, and letting that sort to the top is exactly how the
 * cheapest-looking answer turns out not to cover the order.
 *
 * Sits above `Lines` because it is the live question while an order is open:
 * the lines say what was asked for, and until somebody is confirmed the prices
 * on them are zero.
 */

const BID_TONES = {
  invited: 'neutral',
  viewed: 'warn',
  quoted: 'info',
  negotiating: 'brand',
  confirmed: 'ok',
  declined: 'neutral',
  lost: 'neutral',
};

const BID_LABELS = {
  invited: 'not opened',
  viewed: 'opened',
  quoted: 'quoted',
  negotiating: 'negotiating',
  confirmed: 'confirmed',
  declined: 'declined',
  lost: 'not chosen',
};

const DELIVERY_LABELS = {
  pending: 'not dispatched',
  preparing: 'preparing',
  dispatched: 'dispatched',
  in_transit: 'in transit',
  delivered: 'delivered',
};

/**
 * One supplier's answer.
 *
 * **A card, not a table row** - and the reason is what this panel is for. A
 * table compares uniform rows of the same few values; this compares *offers*,
 * and an offer is a bundle of facts that belong together: who, at what price,
 * how soon, how much of the order they can actually fill, and what paperwork
 * they have raised. Squeezed into six fixed columns those facts were 19px wider
 * than the panel - so the whole comparison scrolled sideways - and Status was
 * carrying four different kinds of note in 141px.
 *
 * Cards also let the **money be the size it deserves**. The total is the number
 * a staff member is comparing, and in a table cell it was 13px of tabular text
 * indistinguishable from the lead time beside it.
 *
 * The list is short by nature - a handful of suppliers carry any one component
 * type - which is the same argument the Businesses screen makes for cards over
 * a table at low row counts.
 */
function BidCard({
  bid,
  order,
  lineCount,
  canAct,
  onNegotiate,
  onConfirm,
  onRemove,
  removing,
  proformaOpen,
  onToggleProforma,
  proformaBusy,
  onAcceptProforma,
  onRequestRevision,
}) {
  const answered = ['quoted', 'negotiating'].includes(bid.status);
  const priced = answered || bid.status === 'confirmed';
  const settled = ['declined', 'lost'].includes(bid.status);

  // Computed once and used both to decide whether the notes row exists and to
  // render each note, so the wrapper can never appear around nothing.
  const showsShortfall = answered && !bid.complete;
  const showsProforma = Boolean(bid.proforma);
  const showsDelivery = Boolean(bid.delivery) && bid.status === 'confirmed';
  const showsDecline = bid.status === 'declined' && Boolean(bid.declineReason);

  return (
    <li
      className={cn(
        'rounded-lg border bg-surface p-3.5',
        // The leading answer gets the only coloured edge on the list. Everything
        // else is quiet, which is what makes it findable at a glance.
        bid.isBest ? 'border-ok/40' : 'border-line',
        settled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-display text-md font-semibold text-ink-900">
              {bid.supplier.name}
            </span>
            {/* The server's ranking, not ours. Only ever set on a complete answer. */}
            {bid.isBest && (
              <Badge tone="ok" size="sm" icon={Trophy}>
                best
              </Badge>
            )}
            <Badge tone={BID_TONES[bid.status]} size="sm">
              {BID_LABELS[bid.status]}
            </Badge>
          </div>

          {bid.supplier.email && (
            <a
              href={`mailto:${bid.supplier.email}`}
              onClick={(event) => event.stopPropagation()}
              className="mt-0.5 block truncate text-xs text-ink-400 hover:text-brand hover:underline"
            >
              {bid.supplier.email}
            </a>
          )}
        </div>

        {/* The figure being compared, at the size that says so. */}
        <div className="shrink-0 text-right">
          {priced ? (
            <>
              <p className="tnum font-display text-lg font-bold leading-none text-ink-900">
                {money(bid.total)}
              </p>
              {bid.leadTimeDays != null && (
                <p className="mt-1 text-xs text-ink-400">{bid.leadTimeDays} day lead time</p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-300">No price yet</p>
          )}
        </div>

        {canAct && (
          <ActionMenu
            align="right"
            label={`Actions for ${bid.supplier.name}`}
            items={[
              {
                key: 'negotiate',
                label: 'Negotiate…',
                icon: MessageSquare,
                hidden: !answered,
                onSelect: onNegotiate,
              },
              {
                key: 'confirm',
                label: 'Confirm this supplier',
                icon: Check,
                hidden: !answered,
                onSelect: onConfirm,
              },
              {
                key: 'remove',
                label: 'Remove from order',
                icon: Trash2,
                danger: true,
                disabled: removing,
                hidden: answered || bid.status === 'declined',
                onSelect: onRemove,
              },
            ]}
          />
        )}
      </div>

      {/* The notes that were fighting for room inside a 141px Status cell. Each
          is a different kind of fact and only ever one or two apply at once.

          **Each condition below is spelled out identically to the one guarding
          its row.** They started as looser tests - `bid.delivery` rather than
          `showsDelivery` - and a losing bid carries a default `delivery` object
          from the schema, so the wrapper rendered its top border and padding
          around content that was then filtered out: an empty ruled strip under
          every supplier who was not chosen. */}
      {(showsShortfall || showsProforma || showsDelivery || showsDecline) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-xs">
          {/* An incomplete answer is called out rather than ranked - the whole
              reason the comparison can be trusted. */}
          {showsShortfall && (
            <span className="flex items-center gap-1 font-medium text-warn">
              <AlertCircle className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              {/* Two different shortfalls, named apart. A supplier who cannot
                  touch a line at all and one who can send 30 of 40 both make a
                  bid incomplete, but only the first is a gap somebody has to
                  fill from another supplier. */}
              {bid.quotedLines < lineCount
                ? `Can supply ${formatCount(bid.quotedLines)} of ${formatCount(lineCount)} lines`
                : `Short on ${formatCount(bid.shortLines ?? 0)} line${(bid.shortLines ?? 0) === 1 ? '' : 's'}`}
            </span>
          )}

          {showsProforma && (
            <button
              type="button"
              onClick={onToggleProforma}
              aria-expanded={proformaOpen}
              className={cn(
                pressable,
                'flex items-center gap-1 font-medium text-ink-700 hover:text-brand',
              )}
            >
              <FileText className="size-3.5 shrink-0 text-ink-400" strokeWidth={2.25} aria-hidden="true" />
              Proforma {bid.proforma.number || `rev ${bid.proforma.revision}`}
              <span className="tnum text-ink-400">· {money(bid.proforma.total)}</span>
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 text-ink-400 transition-transform',
                  proformaOpen && 'rotate-180',
                )}
                strokeWidth={2.25}
                aria-hidden="true"
              />
            </button>
          )}

          {/* Where the PI has got to with us. A pending one is work waiting on
              somebody here, which is worth saying next to the link rather than
              only inside the panel nobody has opened. */}
          {showsProforma && bid.proforma.review === 'accepted' && (
            <span className="flex items-center gap-1 text-ok">
              <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              Accepted
            </span>
          )}
          {showsProforma && bid.proforma.review === 'revision_requested' && (
            <span className="flex items-center gap-1 text-warn">
              <Undo2 className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              Revision asked for
            </span>
          )}

          {showsDelivery && (
            <span className="flex items-center gap-1 text-ink-500">
              <Truck className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              {DELIVERY_LABELS[bid.delivery.status] ?? bid.delivery.status}
              {bid.delivery.trackingNumber && (
                <span className="font-mono text-ink-400">· {bid.delivery.trackingNumber}</span>
              )}
            </span>
          )}

          {showsDecline && (
            <span className="min-w-0 flex-1 truncate text-ink-400">“{bid.declineReason}”</span>
          )}
        </div>
      )}

      {showsProforma && proformaOpen && (
        <ProformaDetail
          bid={bid}
          order={order}
          canAct={canAct}
          busy={proformaBusy}
          onAccept={onAcceptProforma}
          onRequestRevision={onRequestRevision}
        />
      )}
    </li>
  );
}

/**
 * One proforma, opened out - what the supplier is invoicing and what accepting
 * it would change.
 *
 * **The comparison is the point, not the list.** A PI shown on its own is a
 * table of numbers a staff member has to hold against the order in their head;
 * shown as a diff it answers the only question they actually have - *is this
 * what we asked for?* Lines that match are quiet, lines that moved carry the
 * before and after, and the count of what changed is stated above the table so
 * "nothing moved" is readable without reading every row.
 *
 * A PI raised before line detail existed has no `lines`, so the table falls
 * back to the order's own - the document is still the same total, it simply
 * cannot show its own arithmetic, and an empty table would read as a broken
 * screen rather than an old record.
 */
function ProformaDetail({ bid, order, canAct, busy, onAccept, onRequestRevision }) {
  const t = useTableClasses();
  const pi = bid.proforma;
  const diff = bid.proformaDiff;
  const accepted = pi.review === 'accepted';

  // The rows to draw: the diff while a decision is still open, the PI's own
  // lines once it is accepted and the order already matches them.
  const rows = diff?.rows ?? null;
  const fallback = pi.lines?.length ? pi.lines : null;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold text-ink-900">
          Proforma {pi.number || `rev ${pi.revision}`}
          {pi.revision > 1 && pi.number && (
            <span className="ml-1.5 font-normal text-ink-400">rev {pi.revision}</span>
          )}
        </p>
        <p className="text-xs text-ink-400">
          {pi.issuedAt && <>Issued {date(pi.issuedAt)}</>}
          {pi.validUntil && <> · valid to {date(pi.validUntil)}</>}
        </p>
      </div>

      {/* What accepting would do, said before the table rather than left to be
          inferred from it. */}
      {!accepted && diff && (
        <p
          className={cn(
            'mb-2.5 text-xs',
            diff.changed > 0 ? 'font-medium text-warn' : 'text-ink-500',
          )}
        >
          {diff.changed > 0
            ? `Accepting changes ${diff.changed} line${diff.changed === 1 ? '' : 's'} on this order.`
            : 'This matches the order line for line.'}
        </p>
      )}

      {accepted && (
        <p className="mb-2.5 flex items-center gap-1.5 text-xs text-ok">
          <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          Accepted {date(pi.acceptedAt)} - the order matches this document.
        </p>
      )}

      {pi.review === 'revision_requested' && (
        <p className="mb-2.5 rounded-md bg-warn-50 px-2.5 py-2 text-xs leading-relaxed text-ink-600">
          <span className="font-medium text-warn">Revision asked for</span>
          {pi.revisionRequestedAt && <> on {date(pi.revisionRequestedAt)}</>}
          {pi.revisionNote && <> - “{pi.revisionNote}”</>}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-line">
        <table className={t.table}>
          <thead>
            <tr>
              <th scope="col" className={t.headCell()}>Item</th>
              <th scope="col" className={cn(t.headCell('right'), 'tnum')}>Qty</th>
              <th scope="col" className={cn(t.headCell('right'), 'tnum')}>Unit cost</th>
              <th scope="col" className={cn(t.headCell('right'), 'tnum')}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? fallback ?? []).map((row) => {
              const isDiff = Boolean(rows);
              const sku = row.sku;
              const qty = isDiff ? row.toQty : row.qty;
              const cost = isDiff ? row.toCost : row.unitCost;
              const dropped = isDiff && row.change === 'removed';
              const moved = isDiff && row.change !== 'same' && !dropped;

              return (
                <tr key={sku} className={cn(t.row, dropped && 'opacity-60')}>
                  <td className={t.cell()}>
                    <span className="block text-sm text-ink-900">{row.name}</span>
                    <span className="block font-mono text-2xs text-ink-400">{sku}</span>
                  </td>

                  <td className={cn(t.cell('right'), 'tnum text-sm')}>
                    {dropped ? (
                      <span className="text-danger">not supplied</span>
                    ) : (
                      <>
                        {/* The old number first and struck through, so the row
                            reads as a change rather than as a fact. */}
                        {isDiff && ['qty', 'both'].includes(row.change) && (
                          <span className="mr-1.5 text-ink-300 line-through">{row.fromQty}</span>
                        )}
                        <span className={cn(moved && ['qty', 'both'].includes(row.change) && 'font-semibold text-warn')}>
                          {qty}
                        </span>
                      </>
                    )}
                  </td>

                  <td className={cn(t.cell('right'), 'tnum text-sm')}>
                    {isDiff && ['cost', 'both'].includes(row.change) && (
                      <span className="mr-1.5 text-ink-300 line-through">{money(row.fromCost)}</span>
                    )}
                    <span className={cn(moved && ['cost', 'both'].includes(row.change) && 'font-semibold text-warn')}>
                      {money(cost)}
                    </span>
                  </td>

                  <td className={cn(t.cell('right'), 'tnum text-sm text-ink-900')}>
                    {dropped ? '-' : money(cost * qty)}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t border-line">
              <td className={cn(t.cell(), 'text-xs text-ink-500')} colSpan={3}>
                Subtotal
              </td>
              <td className={cn(t.cell('right'), 'tnum text-sm text-ink-900')}>
                {money(diff?.subtotal ?? pi.subtotal)}
              </td>
            </tr>
            {(pi.shipping ?? 0) > 0 && (
              <tr>
                <td className={cn(t.cell(), 'text-xs text-ink-500')} colSpan={3}>Shipping</td>
                <td className={cn(t.cell('right'), 'tnum text-sm text-ink-900')}>{money(pi.shipping)}</td>
              </tr>
            )}
            {(pi.tax ?? 0) > 0 && (
              <tr>
                <td className={cn(t.cell(), 'text-xs text-ink-500')} colSpan={3}>Tax</td>
                <td className={cn(t.cell('right'), 'tnum text-sm text-ink-900')}>{money(pi.tax)}</td>
              </tr>
            )}
            <tr className="border-t border-line">
              <td className={cn(t.cell(), 'text-xs font-semibold text-ink-700')} colSpan={3}>
                Total
              </td>
              <td className={cn(t.cell('right'), 'tnum font-display text-md font-bold text-ink-900')}>
                {money(diff?.total ?? pi.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {(pi.paymentTerms || pi.bankDetails || pi.note) && (
        <dl className="mt-3 space-y-1.5 text-xs">
          {pi.paymentTerms && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-400">Payment terms</dt>
              <dd className="min-w-0 text-ink-700">{pi.paymentTerms}</dd>
            </div>
          )}
          {pi.bankDetails && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-400">Bank details</dt>
              <dd className="min-w-0 whitespace-pre-line text-ink-700">{pi.bankDetails}</dd>
            </div>
          )}
          {pi.note && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-400">Note</dt>
              <dd className="min-w-0 text-ink-700">{pi.note}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={apiUrl(`/admin/purchase-orders/${order.id}/bids/${bid.supplier.id}/proforma`)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            pressable,
            'inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink-600 hover:border-ink-300 hover:bg-surface-2',
          )}
        >
          <FileText className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          Open document
        </a>

        {/* Only while a decision is still open. An accepted PI has nothing left
            to decide, and an order already confirmed or received is past the
            point where rewriting its lines would be honest. */}
        {canAct && !accepted && (
          <>
            <Button size="sm" icon={Check} loading={busy} onClick={onAccept}>
              Confirm this proforma
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={Undo2}
              disabled={busy}
              onClick={onRequestRevision}
            >
              Send for revision
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function PurchaseBidsPanel({ order }) {
  const { data, isLoading } = useAdminPoBids(order.id);
  const {
    invitePoSuppliers,
    removePoSupplier,
    sendPurchaseOrder,
    negotiatePoBid,
    confirmPoSupplier,
    acceptProforma,
    requestProformaRevision,
  } = useAdminMutations();

  const [adding, setAdding] = useState(false);
  const [negotiating, setNegotiating] = useState(null);
  const [confirming, setConfirming] = useState(null);
  // Which supplier's proforma is open. One at a time: two diff tables side by
  // side invite comparing the wrong pair of columns, and the comparison that
  // matters is against the order, not against each other.
  const [expanded, setExpanded] = useState(null);
  const [revising, setRevising] = useState(null);
  const [error, setError] = useState(null);
  // One-click writes, each held here until its dialog is confirmed (§3.0.1).
  // All three are critical: sending emails every supplier, accepting a
  // proforma rewrites the order's lines, and removing a supplier withdraws them.
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [accepting, setAccepting] = useState(null);
  const [removing, setRemoving] = useState(null);

  const board = data;
  const bids = board?.bids ?? [];

  // Editable while the order is still being decided. Past `confirmed` the
  // supplier panel is a record of what happened, not a set of controls.
  const open = ['draft', 'sent', 'negotiating'].includes(order.status);
  const isDraft = order.status === 'draft';

  if (isLoading) {
    return (
      <Panel title="Suppliers" flush>
        <div className="p-4">
          <Skeleton className="h-24" rounded="lg" />
        </div>
      </Panel>
    );
  }

  function send() {
    setError(null);
    sendPurchaseOrder.mutate(
      { id: order.id },
      {
        onSuccess: (result) => {
          setConfirmingSend(false);
          toast.ok(
            'Sent',
            result.mailed === result.total
              ? `All ${formatCount(result.total)} supplier(s) were emailed.`
              : `${formatCount(result.mailed)} of ${formatCount(result.total)} were emailed - check the addresses on the rest.`,
          );
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <>
      <Panel
        title="Suppliers"
        description={
          isDraft
            ? 'Who this order will go to. Nothing reaches them until it is sent.'
            : `${formatCount(board?.quoteCount ?? 0)} of ${formatCount(bids.length)} have answered.`
        }
        flush
        action={
          open ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" icon={UserPlus} onClick={() => setAdding(true)}>
                Add suppliers
              </Button>
              {isDraft && (
                <Button
                  size="sm"
                  icon={Send}
                  loading={sendPurchaseOrder.isPending}
                  disabled={!bids.length}
                  onClick={() => setConfirmingSend(true)}
                >
                  Send to {formatCount(bids.length)}
                </Button>
              )}
            </div>
          ) : null
        }
      >
        {error && (
          <p className="flex items-start gap-2 border-b border-line bg-danger-50 px-3 py-2.5 text-sm text-danger sm:px-4">
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        {!bids.length ? (
          <PanelEmpty
            icon={UserPlus}
            title="Nobody has been asked yet"
            body="Add the suppliers who carry these parts, then send the order to collect their prices."
            action={
              <Button size="sm" icon={UserPlus} onClick={() => setAdding(true)}>
                Add suppliers
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2 p-3 sm:p-4">
            {bids.map((bid) => (
              <BidCard
                key={bid.id}
                bid={bid}
                order={order}
                lineCount={order.items.length}
                canAct={open}
                removing={removePoSupplier.isPending}
                proformaOpen={expanded === bid.id}
                onToggleProforma={() =>
                  setExpanded((current) => (current === bid.id ? null : bid.id))
                }
                proformaBusy={acceptProforma.isPending}
                onAcceptProforma={() => setAccepting(bid)}
                onRequestRevision={() => setRevising(bid)}
                onNegotiate={() => setNegotiating(bid)}
                onConfirm={() => setConfirming(bid)}
                onRemove={() => setRemoving(bid)}
              />
            ))}
          </ul>
        )}

        {/* The negotiation history, under the table rather than inside a row:
            it is a conversation, and a conversation does not fit in a cell. */}
        {bids.some((bid) => bid.negotiations?.length > 0) && (
          <div className="border-t border-line px-3 py-3 sm:px-4">
            <p className="eyebrow mb-2 text-ink-400">Negotiation history</p>
            <ul className="space-y-1.5">
              {bids.flatMap((bid) =>
                (bid.negotiations ?? []).map((round) => (
                  <li key={`${bid.id}-${round.round}`} className="text-sm text-ink-700">
                    <span className="font-medium text-ink-900">{bid.supplier.name}</span>
                    {' · round '}
                    {round.round}
                    {round.askedTotal != null && (
                      <>
                        {' · asked '}
                        <span className="tnum font-medium">{money(round.askedTotal)}</span>
                      </>
                    )}
                    {round.theirCounter != null && (
                      <>
                        {' against '}
                        <span className="tnum">{money(round.theirCounter)}</span>
                      </>
                    )}
                    <span className="text-ink-400">
                      {' · '}
                      {date(round.at)}
                      {round.channels?.length ? ` · ${round.channels.join(', ')}` : ''}
                      {round.respondedAt ? ' · answered' : ' · awaiting reply'}
                    </span>
                    {round.note && (
                      <span className="block text-xs text-ink-500">{round.note}</span>
                    )}
                  </li>
                )),
              )}
            </ul>
          </div>
        )}
      </Panel>

      <AddSuppliersModal
        open={adding}
        onClose={() => setAdding(false)}
        order={order}
        existing={bids.map((bid) => bid.supplier.id)}
        invite={invitePoSuppliers}
      />

      <NegotiateModal
        bid={negotiating}
        order={order}
        onClose={() => setNegotiating(null)}
        negotiate={negotiatePoBid}
      />

      <ConfirmModal
        bid={confirming}
        order={order}
        onClose={() => setConfirming(null)}
        confirm={confirmPoSupplier}
      />

      <ConfirmDialog
        open={confirmingSend}
        onClose={() => setConfirmingSend(false)}
        onConfirm={send}
        tone="warn"
        title={`Send ${order.poNumber} to ${formatCount(bids.length)} supplier${bids.length === 1 ? '' : 's'}?`}
        body={`${bids.map((bid) => bid.supplier.name).join(', ')} will each be emailed a link to price it. An email cannot be recalled.`}
        confirmLabel="Send order"
        confirmPhrase={order.poNumber}
        confirmPhraseLabel="the order number"
        loading={sendPurchaseOrder.isPending}
        error={error}
      />

      <ConfirmDialog
        open={Boolean(accepting)}
        onClose={() => setAccepting(null)}
        onConfirm={() =>
          acceptProforma.mutate(
            { id: order.id, supplierId: accepting.supplier.id },
            {
              onSuccess: (result) => {
                setAccepting(null);
                const changed = result?.diff?.changed ?? 0;
                toast.ok(
                  'Proforma confirmed',
                  changed
                    ? `The order now matches it - ${changed} line${changed === 1 ? '' : 's'} updated.`
                    : 'The order already matched it line for line.',
                );
              },
              onError: (err) => setError(err.message),
            },
          )
        }
        tone="warn"
        title={`Accept ${accepting?.supplier.name}'s proforma for ${order.poNumber}?`}
        body="The order's lines are rewritten to match the proforma, and the supplier sees it as accepted."
        confirmLabel="Accept proforma"
        confirmPhrase={order.poNumber}
        confirmPhraseLabel="the order number"
        loading={acceptProforma.isPending}
        error={error}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removePoSupplier.mutate(
            { id: order.id, supplierId: removing.supplier.id },
            { onSuccess: () => setRemoving(null), onError: (err) => setError(err.message) },
          )
        }
        title={`Remove ${removing?.supplier.name} from ${order.poNumber}?`}
        body="They are taken off this order, and any price they gave on it is discarded."
        confirmLabel="Remove supplier"
        confirmPhrase={removing?.supplier.name}
        confirmPhraseLabel="the supplier's name"
        loading={removePoSupplier.isPending}
        error={error}
      />

      <RevisionModal
        bid={revising}
        order={order}
        onClose={() => setRevising(null)}
        request={requestProformaRevision}
      />
    </>
  );
}

/**
 * Send a proforma back, with a reason.
 *
 * **The reason is required**, because the supplier sees it verbatim and
 * "please revise" with no note is a round trip that teaches them nothing
 * they will guess, usually at the wrong line. The server enforces the same
 * rule; this just says so before the request is made.
 */
function RevisionModal({ bid, order, onClose, request }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  if (!bid) return null;

  function submit(event) {
    event.preventDefault();
    setError(null);

    const reason = note.trim();
    if (!reason) {
      setError('Say what needs changing - the supplier sees this.');
      return;
    }

    request.mutate(
      { id: order.id, supplierId: bid.supplier.id, note: reason },
      {
        onSuccess: () => {
          toast.ok('Sent back for revision', `${bid.supplier.name} has been asked to reissue it.`);
          setNote('');
          onClose();
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <Modal
      open={Boolean(bid)}
      onClose={onClose}
      title={`Send ${bid.supplier.name}'s proforma back?`}
      size="sm"
      align="top"
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <form onSubmit={submit}>
        <p className="mb-3 text-sm leading-relaxed text-ink-500">
          They keep the proforma they sent and issue a new revision against it. Nothing on the
          order changes until you confirm one.
        </p>

        <Textarea
          label="What needs changing"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          hint="The supplier reads this exactly as written."
          autoFocus
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" icon={Undo2} loading={request.isPending}>
            Send for revision
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Pick who to ask.
 *
 * **Tag-suggested and pre-ticked, with a free search underneath.** The suggested
 * set is every active supplier carrying one of the order's component types
 * which is the question a purchasing clerk actually has ("who sells batteries")
 * - and the search is there because the answer is a default, not a rule.
 */
function AddSuppliersModal({ open, onClose, order, existing, invite }) {
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState(null);

  const { data, isLoading } = useSuppliersForComponentTypes(order.componentTypes ?? []);
  const suggested = (data?.suppliers ?? []).filter(
    (supplier) => !existing.includes(supplier.id),
  );

  function toggle(id) {
    setPicked((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function submit() {
    setError(null);
    if (!picked.length) {
      setError('Pick at least one supplier.');
      return;
    }
    invite.mutate(
      { id: order.id, supplierIds: picked },
      {
        onSuccess: (result) => {
          setPicked([]);
          onClose();
          toast.ok(
            'Added',
            order.status === 'draft'
              ? `${formatCount(result.added)} supplier(s) will be asked when you send this order.`
              : `${formatCount(result.added)} supplier(s) were emailed.`,
          );
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Add suppliers" size="md" align="top">
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      {!order.componentTypes?.length ? (
        <p className="text-sm text-ink-500">
          This order carries no component types, so there is nobody to suggest. Add them to the
          order first.
        </p>
      ) : isLoading ? (
        <Skeleton className="h-32" rounded="lg" />
      ) : !suggested.length ? (
        <p className="text-sm text-ink-500">
          Every supplier tagged with these component types is already on this order.
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-500">
            Suppliers tagged with {order.componentTypes.join(', ')}.
          </p>
          <ul className="space-y-1.5">
            {suggested.map((supplier) => {
              const on = picked.includes(supplier.id);
              return (
                <li key={supplier.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(supplier.id)}
                    className={cn(
                      pressable,
                      'flex w-full items-start gap-2.5 rounded-md border p-3 text-left',
                      on
                        ? 'border-ok/40 bg-ok-50'
                        : 'border-line bg-surface hover:border-line-strong',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                        on ? 'border-ok bg-ok text-white' : 'border-line-strong',
                      )}
                    >
                      {on && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">
                        {supplier.name}
                      </span>
                      <span className="block truncate text-xs text-ink-400">
                        {supplier.matched.join(', ')}
                        {/* A supplier with no portal login can still be asked
                            the mail carries the lines - but the screen should
                            say so rather than let a clerk expect a price that
                            has nowhere to be typed. */}
                        {!supplier.hasPortal && ' · no portal access'}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button icon={UserPlus} loading={invite.isPending} onClick={submit}>
          Add {picked.length ? formatCount(picked.length) : ''}
        </Button>
      </div>
    </Modal>
  );
}

/** Ask a supplier to move on their price. */
function NegotiateModal({ bid, order, onClose, negotiate }) {
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  if (!bid) return null;

  function submit() {
    setError(null);
    const askedTotal = target.trim() === '' ? undefined : Math.round(Number(target) * 100);
    if (askedTotal != null && !Number.isFinite(askedTotal)) {
      setError('That is not an amount.');
      return;
    }

    negotiate.mutate(
      { id: order.id, supplierId: bid.supplier.id, askedTotal, note: note || undefined },
      {
        onSuccess: () => {
          setTarget('');
          setNote('');
          onClose();
          toast.ok('Sent', `${bid.supplier.name} has been asked to revise their price.`);
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <Modal
      open={Boolean(bid)}
      onClose={onClose}
      title={`Negotiate with ${bid.supplier.name}`}
      size="sm"
      align="top"
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <p className="mb-3 text-sm text-ink-500">
        They quoted <span className="tnum font-semibold text-ink-900">{money(bid.total)}</span>.
      </p>

      <Input
        label="Your target"
        inputMode="decimal"
        suffix="$"
        placeholder="0.00"
        hint="Optional - a number gives them something specific to answer."
        value={target}
        onChange={(event) => setTarget(event.target.value)}
      />

      <Textarea
        label="Message"
        rows={3}
        placeholder="Volume is firm at these quantities - is there any movement on the unit price?"
        containerClassName="mt-3"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <p className="mt-2 text-xs leading-relaxed text-ink-400">
        Sent by email, plus any other channel they have consented to. We record which ones actually
        carried it.
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button icon={MessageSquare} loading={negotiate.isPending} onClick={submit}>
          Send
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Confirm the order with one supplier.
 *
 * Says plainly what it will do, because it is the irreversible step: the other
 * suppliers are told they were not chosen, and any line the winner cannot
 * supply leaves the order rather than sitting on it at a price nobody quoted.
 */
function ConfirmModal({ bid, order, onClose, confirm }) {
  const [error, setError] = useState(null);

  if (!bid) return null;

  const missing = order.items.length - bid.quotedLines;

  function submit() {
    setError(null);
    confirm.mutate(
      { id: order.id, supplierId: bid.supplier.id },
      {
        onSuccess: (result) => {
          onClose();
          toast.ok(
            'Confirmed',
            result.dropped?.length
              ? `Order placed with ${bid.supplier.name}. ${formatCount(result.dropped.length)} line(s) they could not supply were removed.`
              : `Order placed with ${bid.supplier.name}.`,
          );
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <Modal
      open={Boolean(bid)}
      onClose={onClose}
      title={`Confirm with ${bid.supplier.name}?`}
      size="sm"
      align="top"
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <p className="text-sm leading-relaxed text-ink-700">
        This places the order with {bid.supplier.name} at{' '}
        <span className="tnum font-semibold text-ink-900">{money(bid.total)}</span>, prices its
        lines from their quote, and tells every other supplier they were not chosen.
      </p>

      {missing > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm text-warn">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          They cannot supply {formatCount(missing)} of the {formatCount(order.items.length)} lines.
          Those lines will be removed from this order - raise a second one for them.
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button icon={Check} loading={confirm.isPending} onClick={submit}>
          Confirm order
        </Button>
      </div>
    </Modal>
  );
}

export default PurchaseBidsPanel;
