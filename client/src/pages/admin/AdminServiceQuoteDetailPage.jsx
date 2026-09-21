import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileSignature,
  Lock,
  PencilLine,
  Send,
  Smartphone,
  StickyNote,
  Trash2,
  Wallet,
} from 'lucide-react';
import cn from '@/lib/cn';
import { money, date, titleize } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import { useAdminServiceQuote, useAdminMutations } from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';
import { toast } from '@/store/toastStore';

/**
 * One repair quote (Sales § Quote, service businesses).
 *
 * ## Why this screen exists
 *
 * `/admin/quotes/:id` used to render `AdminQuoteDetailPage` for every business.
 * That page reads `GET /admin/quotes/:id`, which is the WHOLESALE collection -
 * so on a repair shop every quote in the list opened onto "Quote not found".
 * The list was right, the record was real, and the detail route was asking the
 * wrong collection for it.
 *
 * The two are separate collections on purpose (`Quote` prices catalogue lines,
 * `ServiceQuote` prices devices and labour), so the fix is a second screen
 * rather than a merged one, chosen by the same `sales.services` flag that picks
 * between the two lists.
 *
 * ## Read-only, deliberately
 *
 * Everything here is a view. Editing happens in the builder, which is one
 * click away and already knows how to load a quote - at every status,
 * converted included (ruled 2026-09-21). The server used to refuse a write to
 * a converted estimate and this screen hid the button to match; both gates are
 * gone, because correcting a price or a typo after the ticket exists is the
 * shop's own paperwork to fix.
 *
 * Deleting is here too, behind a typed quote number.
 */

const STATUS_TONES = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'ok',
  expired: 'warn',
  converted: 'brand',
  rejected: 'danger',
};

/** One labelled figure in the summary column. */
function SummaryRow({ label, value, strong = false, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className={cn('text-sm', strong ? 'font-semibold text-ink-900' : 'text-ink-500')}>
        {label}
        {hint && <span className="ml-1 text-xs text-ink-400">{hint}</span>}
      </span>
      <span
        className={cn(
          'tnum shrink-0',
          strong ? 'font-display text-lg font-bold text-ink-900' : 'text-sm text-ink-700',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** A device, its fault and what was quoted to put it right. */
function DeviceCard({ device, index }) {
  const lines = [
    ...(device.services ?? []).map((line) => ({ ...line, kind: 'Service' })),
    ...(device.parts ?? []).map((line) => ({ ...line, kind: 'Part' })),
  ];

  const title = [device.brand, device.model].filter(Boolean).join(' ') || `Device #${index + 1}`;

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <p className="flex items-center gap-2 font-display text-sm font-bold text-ink-900">
          <Smartphone className="size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
          {title}
        </p>
        {device.category && <Badge tone="neutral">{titleize(device.category)}</Badge>}
      </div>

      {/* Serial and passcode sit together: both identify the unit on the
          counter, and both are blank more often than not. */}
      {(device.serial || device.passcode) && (
        <p className="mb-2 text-xs text-ink-500">
          {device.serial && (
            <>
              Serial <span className="font-mono text-ink-700">{device.serial}</span>
            </>
          )}
          {device.serial && device.passcode && ' · '}
          {device.passcode && (
            <>
              Passcode <span className="font-mono text-ink-700">{device.passcode}</span>
            </>
          )}
        </p>
      )}

      {(device.problem || device.solution) && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {device.problem && (
            <div>
              <p className="eyebrow text-ink-400">Problem</p>
              <p className="mt-0.5 text-sm text-ink-700">{device.problem}</p>
            </div>
          )}
          {device.solution && (
            <div>
              <p className="eyebrow text-ink-400">Solution</p>
              <p className="mt-0.5 text-sm text-ink-700">{device.solution}</p>
            </div>
          )}
        </div>
      )}

      {lines.length > 0 ? (
        <ul className="divide-y divide-line rounded-md bg-surface">
          {lines.map((line, lineIndex) => (
            <li
              key={`${line.kind}-${lineIndex}`}
              className="flex items-baseline justify-between gap-3 px-3 py-2"
            >
              <span className="min-w-0 text-sm text-ink-700">
                <Badge tone={line.kind === 'Service' ? 'info' : 'neutral'}>{line.kind}</Badge>{' '}
                {line.name}
                {line.qty > 1 && <span className="text-ink-400"> × {line.qty}</span>}
                {line.description && (
                  <span className="block text-xs text-ink-400">{line.description}</span>
                )}
              </span>
              <span className="tnum shrink-0 text-sm font-medium text-ink-900">
                {money(line.lineTotal ?? line.priceCents * (line.qty ?? 1))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-400">Nothing priced on this device yet.</p>
      )}
    </div>
  );
}

export function AdminServiceQuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [converting, setConverting] = useState(false);
  // The estimate awaiting a typed number before it is destroyed.
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading, error } = useAdminServiceQuote(id);
  const { setServiceQuoteStatus, convertServiceQuote, deleteServiceQuote } = useAdminMutations();

  const quote = data?.quote;
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
                className={cn(
                  pressable,
                  'inline-flex h-9 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2',
                )}
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
      <div className="record-page space-y-4">
        <Skeleton className="h-20 w-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const converted = Boolean(quote.convertedTicket);
  const devices = quote.devices ?? [];

  return (
    <div className="record-page">
      <PageHeader
        icon={FileSignature}
        title={quote.quoteNumber}
        description={`${quote.customerName || 'Customer'} · ${titleize(quote.serviceType ?? '')}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/quotes"
              className={cn(
                pressable,
                'inline-flex h-9 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2',
              )}
            >
              Back to quotes
            </Link>
            {/* Editing lives in the builder, at every status (ruled
                2026-09-21). This used to disappear once the quote had become a
                ticket, because the server refused that write; it no longer
                does, so the shop can correct its own paperwork after the fact. */}
            <Button
              variant="outline"
              icon={PencilLine}
              onClick={() => navigate(`/admin/quotes/${quote.id}/edit`)}
            >
              Edit
            </Button>
            {quote.storedStatus === 'draft' && (
              <Button
                icon={Send}
                loading={setServiceQuoteStatus.isPending}
                onClick={() =>
                  setServiceQuoteStatus.mutate(
                    { id: quote.id, status: 'sent' },
                    { onSuccess: () => toast.ok('Marked as sent') },
                  )
                }
              >
                Mark as sent
              </Button>
            )}
            {quote.storedStatus === 'accepted' && !converted && (
              <Button icon={ArrowRight} onClick={() => setConverting(true)}>
                Start work
              </Button>
            )}
            {/* Destructive, so it is an icon apart from the row rather than a
                fourth equal button - the same treatment the ticket screen
                gives its delete. It still confirms by name. */}
            <Button
              variant="danger"
              icon={Trash2}
              aria-label={`Delete ${quote.quoteNumber}`}
              onClick={() => setDeleting(true)}
            />
          </div>
        }
      />

      {setServiceQuoteStatus.error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {setServiceQuoteStatus.error.message}
        </p>
      )}

      {/* The one fact that changes what this screen is for: the work has
          started, and the ticket is where it now lives. */}
      {converted && (
        <Link
          to={`/admin/tickets/${quote.convertedTicket.id}`}
          className={cn(
            pressable,
            'mb-3 flex items-center gap-2 rounded-md bg-brand-50 px-3 py-2.5 text-sm text-brand-700 hover:bg-brand-100',
          )}
        >
          <CheckCircle2 className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          This quote became ticket{' '}
          <strong>{quote.convertedTicket.ticketNumber ?? 'the repair ticket'}</strong> - open it
          <ArrowRight className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
        </Link>
      )}

      <KpiRow
        tiles={[
          {
            key: 'status',
            label: 'Status',
            value: titleize(quote.status ?? ''),
            tone: STATUS_TONES[quote.status] ?? 'neutral',
            hint: quote.expired ? 'Past its valid-until date' : undefined,
          },
          {
            key: 'total',
            label: 'Quoted total',
            value: money(quote.totalCents ?? 0),
            hint: 'Tax included',
          },
          {
            key: 'devices',
            label: devices.length === 1 ? 'Device' : 'Devices',
            value: String(devices.length),
          },
          {
            key: 'valid',
            label: 'Valid until',
            value: quote.validUntil ? date(quote.validUntil) : '–',
            hint: quote.quoteDate ? `Quoted ${date(quote.quoteDate)}` : undefined,
          },
        ]}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Panel title="Devices and services" icon={Smartphone}>
            {devices.length ? (
              <div className="space-y-3">
                {devices.map((device, index) => (
                  <DeviceCard key={index} device={device} index={index} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-400">No devices on this quote.</p>
            )}
          </Panel>

          {(quote.clientNotes || quote.technicianNotes || quote.internalNotes) && (
            <Panel title="Notes" icon={StickyNote}>
              <div className="space-y-3">
                {quote.clientNotes && (
                  <div>
                    <p className="eyebrow text-ink-400">Client notes</p>
                    <p className="mt-0.5 text-sm text-ink-700">{quote.clientNotes}</p>
                  </div>
                )}
                {quote.technicianNotes && (
                  <div>
                    <p className="eyebrow text-ink-400">Technician notes</p>
                    <p className="mt-0.5 text-sm text-ink-700">{quote.technicianNotes}</p>
                  </div>
                )}
                {/* Boxed and coloured for the same reason the builder boxes it:
                    the difference between this and the two above is the whole
                    point of having three. */}
                {quote.internalNotes && (
                  <div className="rounded-md border border-warn-200 bg-warn-50 p-3">
                    <p className="eyebrow text-warn">Internal notes</p>
                    <p className="mt-0.5 text-sm text-ink-700">{quote.internalNotes}</p>
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warn">
                      <Lock className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                      Never shown on the customer's PDF.
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Summary" icon={Wallet}>
            <SummaryRow label="Subtotal" value={money(quote.subtotalCents ?? 0)} />
            {quote.extendedServiceFee && (
              <SummaryRow
                label="Extended service fee"
                value={money(quote.extendedServiceFeeCents ?? 0)}
              />
            )}
            {quote.discountCents > 0 && (
              <SummaryRow
                label="Discount"
                hint={quote.discountCode || undefined}
                value={`- ${money(quote.discountCents)}`}
              />
            )}
            <SummaryRow
              label="Tax"
              hint={quote.taxRate ? `${quote.taxRate}%` : undefined}
              value={money(quote.taxCents ?? 0)}
            />
            <div className="mt-1 border-t border-line pt-1">
              <SummaryRow label="Total" value={money(quote.totalCents ?? 0)} strong />
            </div>
          </Panel>

          <Panel title="Customer" icon={FileSignature}>
            <p className="font-display text-md font-semibold text-ink-900">{quote.customerName}</p>
            {quote.customerPhone && (
              <a
                href={`tel:${quote.customerPhone}`}
                className="mt-0.5 block text-sm text-brand underline"
              >
                {quote.customerPhone}
              </a>
            )}
            {quote.customerEmail && (
              <a
                href={`mailto:${quote.customerEmail}`}
                className="mt-0.5 block break-words text-sm text-brand underline"
              >
                {quote.customerEmail}
              </a>
            )}
            {quote.user && (
              <Link
                to={`/admin/clients/${quote.user}`}
                className={cn(pressable, 'mt-2 inline-block text-sm font-medium text-brand underline')}
              >
                Open customer profile
              </Link>
            )}
          </Panel>

          {quote.source && (
            <Panel title="Origin" icon={Clock}>
              <p className="text-sm text-ink-700">{titleize(quote.source)}</p>
            </Panel>
          )}
        </div>
      </div>

      {/* Converting creates a second record, so it names the quote and says
          exactly what will exist afterwards - the same dialog the list uses. */}
      <ConfirmDialog
        open={converting}
        onClose={() => setConverting(false)}
        title="Start work on this quote?"
        body={`${quote.quoteNumber} for ${quote.customerName} becomes a repair ticket. Every device, line and note carries over, and the ticket owns the work from then on.`}
        confirmLabel="Create the ticket"
        loading={convertServiceQuote.isPending}
        error={convertServiceQuote.error?.message}
        onConfirm={() =>
          convertServiceQuote.mutate(
            { id: quote.id },
            {
              onSuccess: (payload) => {
                setConverting(false);
                toast.ok('Ticket opened', 'It is now on the repair board.');
                const ticketId = payload?.ticket?.id;
                if (ticketId) navigate(`/admin/tickets/${ticketId}`);
              },
            },
          )
        }
      />

      {/*
        Deleting the estimate. `critical`, so the quote number is typed out:
        the document is destroyed rather than closed, and on a converted quote
        it is the paper the customer agreed to.
      */}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${quote.quoteNumber}?`}
        body={`The estimate for ${quote.customerName} is destroyed, along with its devices, lines and timeline.${
          converted
            ? ' The repair ticket it became is kept - it simply stops naming an estimate.'
            : ''
        } This cannot be undone.`}
        tone="critical"
        confirmPhrase={quote.quoteNumber}
        confirmPhraseLabel="the quote number"
        confirmLabel="Delete quote"
        loading={deleteServiceQuote.isPending}
        error={deleteServiceQuote.error?.message}
        onConfirm={() =>
          deleteServiceQuote.mutate(quote.id, {
            onSuccess: () => {
              toast.ok('Quote deleted', `${quote.quoteNumber} is gone.`);
              navigate('/admin/quotes');
            },
          })
        }
      />
    </div>
  );
}

export default AdminServiceQuoteDetailPage;
