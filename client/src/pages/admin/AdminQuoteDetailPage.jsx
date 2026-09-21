import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  FileSignature,
  PencilLine,
  Send,
  TrendingDown,
  Wallet,
  XCircle,
} from 'lucide-react';
import cn from '@/lib/cn';
import { money, date, dateTime, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { useTableClasses, CountLine } from '@/components/admin/DataTable';
import KpiRow from '@/components/admin/KpiRow';
import ProcessStrip from '@/components/admin/ProcessStrip';
import WorkflowLineage from '@/components/admin/WorkflowLineage';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import { useAdminQuote, useAdminMutations } from '@/hooks/useAdmin';
import useAuth from '@/hooks/useAuth';
import AdminServiceQuoteDetailPage from './AdminServiceQuoteDetailPage';
import Skeleton from '@/components/ui/Skeleton';
import { pressable } from '@/lib/motion';

/**
 * One quote - lines, expiry, the live price comparison, and conversion
 * (ERP rework §6.6).
 *
 * The comparison panel is the point of this screen. A quote is a promise held
 * for a period, and the catalogue keeps moving underneath it; showing that
 * *while the quote is still open* is what lets a staff member re-quote before a
 * client accepts a price that now loses money.
 */

const STATUS_TONES = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'ok',
  expired: 'warn',
  converted: 'brand',
  rejected: 'danger',
};

/**
 * The price-comparison table.
 *
 * Rendered in two places with the same component: inline on the quote while it
 * is open, and inside the conversion dialog when the server refuses with
 * `QUOTE_PRICE_DRIFT`. One implementation means the staff member sees the same
 * numbers whichever moment they are looking at.
 */
function DriftTable({ drift, compact = false }) {
  const t = useTableClasses();
  const lines = (drift?.lines ?? []).filter(
    (line) => line.difference !== 0 || line.belowCost || line.unavailable || line.shortStock,
  );

  if (!lines.length) {
    return (
      <p className="text-sm text-ink-500">
        Every quoted price still matches the catalogue.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className={t.headRow}>
            {['Item', 'Qty', 'Quoted', 'Today', 'Difference'].map((header, index) => (
              <th
                key={header}
                scope="col"
                className={t.headCell(index === 0 ? 'left' : 'right')}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.sku} className={t.row}>
              <td className={t.cell()}>
                <span className="block truncate text-sm text-ink-900">{line.name}</span>
                <span className="block font-mono text-2xs text-ink-300">{line.sku}</span>

                {/* The two states that actually stop a conversion are named
                    rather than left for the staff member to infer from a dash. */}
                {line.unavailable && (
                  <Badge tone="danger" size="sm" className="mt-1">
                    no longer available
                  </Badge>
                )}
                {line.shortStock && !line.unavailable && (
                  <Badge tone="danger" size="sm" className="mt-1">
                    short of stock
                  </Badge>
                )}
                {line.belowCost && !line.unavailable && (
                  <Badge tone="warn" size="sm" className="mt-1">
                    below today&rsquo;s cost
                  </Badge>
                )}
              </td>
              <td className={cn(t.cell('right'), 'tnum text-ink-700')}>{line.qty}</td>
              <td className={cn(t.cell('right'), 'tnum font-medium text-ink-900')}>
                {money(line.quotedPrice)}
              </td>
              <td className={cn(t.cell('right'), 'tnum text-ink-700')}>
                {line.livePrice === null ? '-' : money(line.livePrice)}
              </td>
              <td className={cn(t.cell('right'), 'tnum')}>
                {line.difference === null ? (
                  <span className="text-ink-300">-</span>
                ) : (
                  // Signed once: a quote below today's price is a negative, and
                  // the tone follows the sign rather than a second label.
                  <span className={cn('font-medium', line.difference < 0 ? 'text-danger' : 'text-ok')}>
                    {line.difference < 0 ? '−' : '+'}
                    {money(Math.abs(line.difference))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!compact && (
        <p className="tnum mt-2 px-3 text-xs text-ink-500">
          Quoted total {money(drift.quotedTotal)} · at today&rsquo;s prices {money(drift.liveTotal)}
        </p>
      )}
    </div>
  );
}

/**
 * Where a quote sits on its ladder.
 *
 * **The steps are the real states, not a simplified three.** `draft → sent →
 * accepted → converted` is what `quoteService.ALLOWED_TRANSITIONS` enforces, so
 * a strip that skipped `draft` would show a quote as further along than it is
 * and the buttons in the header, which follow the same ladder, would offer a
 * step the strip never drew.
 *
 * **Rejected and expired are exits, not steps.** They are terminal and they can
 * happen from more than one rung, so laying them out in a row would imply a
 * quote passes *through* them on the way to being converted. They replace the
 * strip with a line saying where the quote stopped and which rung it reached
 * `storedStatus` still carries that, which is exactly why the serializer keeps
 * it alongside the derived status.
 *
 * `ProcessStrip` rather than `StepIndicator`, deliberately: this is a status
 * display of a record's position, not a wizard somebody advances through. The
 * Instructions forbid forking `StepIndicator`, and this does not touch it.
 */
const QUOTE_LIFECYCLE = [
  { key: 'draft', label: 'Draft', icon: PencilLine },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'accepted', label: 'Accepted', icon: CheckCircle2 },
  { key: 'converted', label: 'Converted', icon: ArrowRight },
];

function QuoteLifecycle({ quote, className }) {
  const stopped = ['rejected', 'expired'].includes(quote.status);

  if (stopped) {
    const rejected = quote.status === 'rejected';
    // How far it got before it stopped. `storedStatus` is the rung actually
    // reached - an expired quote is stored as `sent`, and saying "expired" with
    // no other context loses the fact that it was sent and never answered.
    const reached =
      QUOTE_LIFECYCLE.find((step) => step.key === quote.storedStatus)?.label ?? 'Draft';

    /**
     * A stopped quote shows the rail it did **not** finish.
     *
     * The rungs it reached stay filled and the rest stay empty, with the stage
     * it died at marked in the exit's own tone - so "rejected" is placed on the
     * ladder rather than replacing it with a sentence. A bare banner threw away
     * the one thing worth knowing: how close it got.
     */
    return (
      <section aria-label="Quote life cycle" className={cn('space-y-2.5', className)}>
        <ProcessStrip
          title="Life cycle of a quote"
      successOnLast
          steps={QUOTE_LIFECYCLE}
          current={quote.storedStatus}
          stoppedTone={rejected ? 'danger' : 'warn'}
          caption={null}
        />

        <p
          className={cn(
            'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 py-2 text-sm',
            rejected ? 'bg-danger-50 text-danger' : 'bg-warn-50 text-warn',
          )}
        >
          {rejected ? (
            <XCircle className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <Clock className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          )}
          <span className="font-semibold">
            {rejected ? 'Rejected' : 'Expired'} at the {reached} stage.
          </span>
          <span className="opacity-80">
            {rejected
              ? 'It goes no further - raise a new quote to price this again.'
              : 'Extend its expiry to carry on, or raise a new quote at current prices.'}
          </span>
        </p>
      </section>
    );
  }

  return (
    <ProcessStrip
      title="Life cycle of a quote"
      successOnLast
      steps={QUOTE_LIFECYCLE}
      current={quote.status}
      caption={
        quote.status === 'converted'
          ? 'This quote became an order - its price is now the order’s.'
          : 'A quote can be rejected at any stage, and lapses on its expiry date.'
      }
      className={className}
    />
  );
}

export const QUOTE_STATUS_CONFIRM = {
  sent: {
    title: 'Mark this quote as sent?',
    body: 'It counts as issued from now on, and the customer can accept it.',
    confirmLabel: 'Mark as sent',
    tone: 'warn',
  },
  accepted: {
    title: 'Mark this quote as accepted?',
    body: 'The priced offer is committed and the quote can be converted.',
    confirmLabel: 'Mark as accepted',
    tone: 'warn',
  },
  rejected: {
    title: 'Reject this quote?',
    body: 'It closes and cannot be accepted afterwards.',
    consequence: 'Requoting means raising a new one.',
    confirmLabel: 'Reject quote',
    tone: 'danger',
  },
};

/**
 * One quote, from whichever collection this business keeps them in.
 *
 * The same split `AdminQuotesPage` makes one level up, and for the same reason:
 * `Quote` prices catalogue lines, `ServiceQuote` prices devices and labour, and
 * they are separate collections behind separate endpoints.
 *
 * This branch used to be missing, so `/admin/quotes/:id` asked the WHOLESALE
 * endpoint for every business - and on a repair shop every row in the list
 * opened onto "Quote not found". The record was real and the list was right;
 * the detail route was querying the wrong collection.
 */
export function AdminQuoteDetailRoute() {
  const { features } = useAuth();
  if (features?.['sales.services']) return <AdminServiceQuoteDetailPage />;
  return <AdminQuoteDetailPage />;
}

function AdminQuoteDetailPage() {
  const t = useTableClasses();
  const { id } = useParams();
  const navigate = useNavigate();
  /**
   * The three status buttons all wrote on a single click.
   *
   * Each one is a decision somebody else then acts on: "sent" is what puts the
   * quote in front of the customer, "accepted" commits the priced offer, and
   * "rejected" closes it - and none of the three can be walked back from this
   * screen. They sit next to each other in one row, which is exactly where a
   * misclick lands on the wrong one.
   */
  const [pendingStatus, setPendingStatus] = useState(null);
  const [converting, setConverting] = useState(false);
  const [driftFromServer, setDriftFromServer] = useState(null);

  const { data, isLoading, error } = useAdminQuote(id);
  const { setQuoteStatus, convertQuote } = useAdminMutations();

  const quote = data?.quote;
  const drift = data?.drift;

  useSetRecordLabel(quote?.quoteNumber);

  if (error) {
    return (
      <>
        <PageHeader icon={FileSignature} title="Quote" />
        <Panel>
          <PanelEmpty
            icon={FileSignature}
            title="Quote not found"
            body={error.message}
            action={
              <Link
                to="/admin/quotes"
                className={cn(pressable, 'inline-flex h-9 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
              >
                Back to quotes
              </Link>
            }
          />
        </Panel>
      </>
    );
  }

  if (isLoading || !quote) {
    return (
      <>
        <PageHeader icon={FileSignature} title="Quote" />
        <div className="space-y-3">
          <Skeleton className="h-24" rounded="lg" />
          <Skeleton className="h-64" rounded="lg" />
        </div>
      </>
    );
  }

  const margin = quote.items.reduce(
    (acc, item) => {
      if (item.unitCost == null) return { ...acc, uncosted: acc.uncosted + 1 };
      return {
        ...acc,
        cost: acc.cost + item.unitCost * item.qty,
        costedRevenue: acc.costedRevenue + item.lineTotal,
      };
    },
    { cost: 0, costedRevenue: 0, uncosted: 0 },
  );

  const marginPercent =
    margin.costedRevenue > 0
      ? Math.round(((margin.costedRevenue - margin.cost) / margin.costedRevenue) * 100)
      : null;

  function runConvert(acknowledgeDrift) {
    convertQuote.mutate(
      { id: quote.id, acknowledgeDrift, deliveryCode: 'ground' },
      {
        onSuccess: (payload) => {
          setConverting(false);
          setDriftFromServer(null);
          if (payload?.order?.orderNumber) navigate('/admin/orders');
        },
        onError: (err) => {
          // The server refuses a drifted conversion and hands back the full
          // comparison. Showing it and asking is the whole contract - the
          // staff member decides to honour the quoted price, we never decide for
          // them and never apply it silently.
          if (err.code === 'QUOTE_PRICE_DRIFT' && err.fields?.drift) {
            setDriftFromServer(err.fields.drift);
            setConverting(true);
          }
        },
      },
    );
  }

  return (
    // The record measure, centred - one record is a reading screen, and a
    // list is what earns the shell's full width. The `.record-page` class carries
    // the whole treatment; see the container tokens in index.css.
    <div className="record-page">
      <PageHeader
        icon={FileSignature}
        title={quote.quoteNumber}
        description={`${quote.user.displayName ?? quote.user.contactName} · created ${date(quote.createdAt)}`}
        badge={
          <>
            <Badge tone={STATUS_TONES[quote.status]} size="sm">
              {quote.status}
            </Badge>
            {drift?.hasDrift && !['converted', 'rejected'].includes(quote.storedStatus) && (
              <Badge tone="warn" size="sm">
                prices moved
              </Badge>
            )}
          </>
        }
        action={
          <>
            {quote.storedStatus === 'draft' && (
              <Button
                icon={Send}
                loading={setQuoteStatus.isPending}
                onClick={() => setPendingStatus('sent')}
              >
                Mark as sent
              </Button>
            )}
            {quote.storedStatus === 'sent' && !quote.expired && (
              <Button
                icon={CheckCircle2}
                loading={setQuoteStatus.isPending}
                onClick={() => setPendingStatus('accepted')}
              >
                Mark as accepted
              </Button>
            )}
            {quote.storedStatus === 'accepted' && (
              <Button icon={ArrowRight} onClick={() => runConvert(false)} loading={convertQuote.isPending}>
                Convert to order
              </Button>
            )}
            {!['converted', 'rejected'].includes(quote.storedStatus) && (
              <Button
                variant="ghost"
                icon={Ban}
                onClick={() => setPendingStatus('rejected')}
              >
                Reject
              </Button>
            )}
          </>
        }
      />

      {/* Only a quote that became a repair has this chain. A quote converted
          into an *order* for goods never touches a ticket, and drawing three
          empty stations on it would invent a workflow it is not in - the
          "Converted" panel in the sidebar is where that route is reported. */}
      {quote.convertedTicket && (
        <WorkflowLineage
          current="quote"
          quote={quote}
          ticket={quote.convertedTicket}
          invoice={quote.convertedTicket.invoice}
          // The repair is under way but not yet billed - that step is still to
          // come, so it is drawn in waiting rather than left off.
          pending={quote.convertedTicket.invoice ? undefined : 'invoice'}
          className="mb-3"
        />
      )}

      {(setQuoteStatus.error || (convertQuote.error && convertQuote.error.code !== 'QUOTE_PRICE_DRIFT')) && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {(setQuoteStatus.error ?? convertQuote.error).message}
        </p>
      )}

      {quote.expired && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm leading-relaxed text-warn">
          <Clock className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span>
            This quote expired on {date(quote.validUntil)}. Extend its expiry before accepting or
            converting it - honouring a lapsed price is a decision worth recording.
          </span>
        </p>
      )}

      <KpiRow
        tiles={[
          {
            key: 'total',
            label: 'Quote total',
            value: money(quote.total),
            hint: `${money(quote.subtotal)} of goods`,
            tone: 'brand',
            icon: Wallet,
          },
          {
            key: 'lines',
            label: 'Lines',
            value: formatCount(quote.itemCount),
            hint: `${formatCount(quote.items.reduce((sum, item) => sum + item.qty, 0))} units`,
            tone: 'neutral',
            icon: FileSignature,
          },
          {
            key: 'margin',
            label: 'Margin',
            value: marginPercent === null ? '-' : `${marginPercent}%`,
            hint:
              margin.uncosted > 0
                ? `Excludes ${formatCount(margin.uncosted)} line(s) with no recorded cost`
                : 'At the quoted prices',
            tone: marginPercent !== null && marginPercent < 0 ? 'danger' : 'ok',
            icon: TrendingDown,
          },
          {
            key: 'expiry',
            label: 'Expires',
            value: quote.validUntil ? date(quote.validUntil) : '-',
            hint: quote.expired ? 'Past its date' : 'Still live',
            tone: quote.expired ? 'warn' : 'info',
            icon: Clock,
          },
        ]}
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <Panel title="Lines" flush>
            {/* Carries the density toggle - these lines follow the same density
                as every list table. */}
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <CountLine
                total={quote.items.length}
                noun={quote.items.length === 1 ? 'line' : 'lines'}
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
                    <th scope="col" className={t.headCell('right')}>
                      Quoted price
                    </th>
                    <th scope="col" className={t.headCell('right')}>
                      Line total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quote.items.map((item) => (
                    <tr key={item.sku} className={t.row}>
                      <td className={t.cell()}>
                        <p className="text-sm text-ink-900">{item.name}</p>
                        <p className="font-mono text-xs text-ink-400">{item.sku}</p>
                      </td>
                      <td className={cn(t.cell('right'), 'tnum text-ink-700')}>
                        {formatCount(item.qty)}
                      </td>
                      <td className={cn(t.cell('right'), 'tnum text-ink-700')}>
                        {money(item.unitPrice)}
                      </td>
                      <td className={cn(t.cell('right'), 'tnum font-medium text-ink-900')}>
                        {money(item.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-line px-4 py-3">
              <dl className="ml-auto max-w-[260px] space-y-1 text-sm">
                <div className="tnum flex justify-between text-ink-600">
                  <dt>Subtotal</dt>
                  <dd>{money(quote.subtotal)}</dd>
                </div>
                <div className="tnum flex justify-between text-ink-600">
                  <dt>Shipping</dt>
                  <dd>{money(quote.shipping)}</dd>
                </div>
                <div className="tnum flex justify-between text-ink-600">
                  <dt>GST/HST</dt>
                  <dd>{money(quote.tax)}</dd>
                </div>
                <div className="tnum flex justify-between border-t border-line pt-1 text-md font-semibold text-ink-900">
                  <dt>Total</dt>
                  <dd>{money(quote.total)}</dd>
                </div>
              </dl>
            </div>
          </Panel>

          {!['converted', 'rejected'].includes(quote.storedStatus) && (
            <Panel
              title="Against today's catalogue"
              description="What this quote promised, and what those parts cost now."
            >
              <DriftTable drift={drift} />
            </Panel>
          )}
        </div>

        <div className="space-y-3">
          <Panel title="Customer">
            <p className="text-md font-medium text-ink-900">{quote.user.businessName}</p>
            {quote.user.contactName && (
              <p className="mt-0.5 text-sm text-ink-500">{quote.user.contactName}</p>
            )}
            {quote.user.email && (
              <a
                href={`mailto:${quote.user.email}`}
                className="mt-0.5 block break-all text-sm text-ink-500 hover:text-brand"
              >
                {quote.user.email}
              </a>
            )}
            {quote.user.id && (
              <Link
                to={`/admin/clients/${quote.user.id}`}
                className={cn(pressable, 'mt-3 inline-flex h-8 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
              >
                View profile
              </Link>
            )}
          </Panel>

          {quote.convertedOrder?.orderNumber && (
            <Panel title="Converted">
              <p className="text-sm text-ink-600">
                This quote became order{' '}
                <span className="font-mono font-medium text-ink-900">
                  {quote.convertedOrder.orderNumber}
                </span>
                .
              </p>
            </Panel>
          )}

          {quote.notes && (
            <Panel title="Notes">
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">
                {quote.notes}
              </p>
            </Panel>
          )}

          <Panel title="Timeline" flush>
            <ul className="divide-y divide-line">
              {quote.timeline.map((entry, index) => (
                <li key={`${entry.status}-${index}`} className="flex items-start gap-2.5 px-4 py-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-400">
                    <CheckCircle2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">{entry.status}</p>
                    <p className="text-xs text-ink-400">{dateTime(entry.at)}</p>
                    {entry.note && <p className="mt-0.5 text-xs text-ink-500">{entry.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {/* ---- life cycle -----------------------------------------------------
          At the foot of the page, matching the invoice and the purchase order:
          it summarises where the record ended up after everything above it, so
          it reads as a conclusion rather than a heading. Where this quote sits
          on the ladder `quoteService.ALLOWED_TRANSITIONS` enforces, so the strip
          and the action buttons can never disagree about what comes next. */}
      <QuoteLifecycle quote={quote} className="mt-4" />

      <Modal
        open={converting}
        onClose={() => {
          setConverting(false);
          setDriftFromServer(null);
        }}
        title="Catalogue prices have changed"
        size="lg"
        align="top"
      >
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm leading-relaxed text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>
              These parts cost something different today than when{' '}
              <strong className="font-semibold">{quote.quoteNumber}</strong> was issued. Converting
              honours <strong className="font-semibold">the quoted prices</strong> - that is the
              promise made to the client. Confirm you have seen the difference.
            </span>
          </p>

          <DriftTable drift={driftFromServer ?? drift} compact />

          {(driftFromServer ?? drift) && (
            <p className="tnum rounded-md bg-surface-2 px-3 py-2.5 text-sm text-ink-600">
              Converting at the quoted total of{' '}
              <span className="font-medium text-ink-900">
                {money((driftFromServer ?? drift).quotedTotal)}
              </span>
              , rather than {money((driftFromServer ?? drift).liveTotal)} at today&rsquo;s prices.
            </p>
          )}

          {convertQuote.error && convertQuote.error.code !== 'QUOTE_PRICE_DRIFT' && (
            <p className="flex items-start gap-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              {convertQuote.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConverting(false);
                setDriftFromServer(null);
              }}
            >
              Cancel
            </Button>
            <Button loading={convertQuote.isPending} onClick={() => runConvert(true)}>
              Convert at quoted prices
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        onClose={() => setPendingStatus(null)}
        onConfirm={() => {
          setQuoteStatus.mutate(
            { id: quote.id, status: pendingStatus },
            { onSuccess: () => setPendingStatus(null) },
          );
        }}
        loading={setQuoteStatus.isPending}
        error={setQuoteStatus.error?.message}
        {...(QUOTE_STATUS_CONFIRM[pendingStatus] ?? QUOTE_STATUS_CONFIRM.sent)}
      />
    </div>
  );
}

export default AdminQuoteDetailRoute;
