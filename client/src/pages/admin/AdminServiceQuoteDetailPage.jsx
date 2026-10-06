import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertCircle, ArrowRight, FileSignature, PencilLine, Printer, Send, Trash2 } from 'lucide-react';
import cn from '@/lib/cn';
import { apiUrl } from '@/lib/api';
import { money, date, titleize } from '@/lib/format';
import { SERVICE_QUOTE_STATUS_LABELS } from '@shared/schemas/admin';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import WorkflowLineage from '@/components/admin/WorkflowLineage';
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
import { useAdminServiceQuote, useAdminMutations } from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';
import { toast } from '@/store/toastStore';

/**
 * One repair quote (Sales § Quote, service businesses).
 *
 * `/admin/quotes/:id` renders this for a service business and the wholesale
 * `AdminQuoteDetailPage` otherwise: they are separate collections on purpose
 * (`Quote` prices catalogue lines, `ServiceQuote` prices devices and labour).
 *
 * Laid out the way the ticket and the invoice are (`SalesDocument`, client
 * ruling 2026-10-05). A quote has no working panel of its own - its moves
 * are the header's buttons - so the wide column opens straight on the work.
 *
 * Read-only: editing lives in the builder, at every status (ruled 2026-09-21).
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

export function AdminServiceQuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [converting, setConverting] = useState(false);
  // The quote awaiting a typed number before it is destroyed.
  const [deleting, setDeleting] = useState(false);
  // "Mark as sent" is a status change fired from one button (§3.0.1).
  const [confirmingSent, setConfirmingSent] = useState(false);

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
  const serviceType = serviceTypeLabel(quote.serviceType);
  const statusLabel = SERVICE_QUOTE_STATUS_LABELS[quote.status] ?? titleize(quote.status ?? '');

  return (
    <div className="record-page">
      <PageHeader
        icon={FileSignature}
        title={quote.quoteNumber}
        description={[quote.customerName, serviceType].filter(Boolean).join(' · ')}
        badgesBelow
        badge={
          <>
            <Badge tone={STATUS_TONES[quote.status] ?? 'neutral'} size="sm">
              {statusLabel}
            </Badge>
            {quote.expired && (
              <Badge tone="warn" size="sm">
                Past its valid-until date
              </Badge>
            )}
          </>
        }
        action={
          <>
            <Button
              size="sm"
              variant="outline"
              icon={Printer}
              onClick={() =>
                window.open(apiUrl(`/admin/service-quotes/${quote.id}/document`), '_blank', 'noopener')
              }
            >
              Print or PDF
            </Button>
            {/* Editing lives in the builder, at every status (ruled 2026-09-21). */}
            <Button
              size="sm"
              variant="outline"
              icon={PencilLine}
              onClick={() => navigate(`/admin/quotes/${quote.id}/edit`)}
            >
              Edit
            </Button>
            {quote.storedStatus === 'draft' && (
              <Button size="sm" icon={Send} onClick={() => setConfirmingSent(true)}>
                Mark as sent
              </Button>
            )}
            {quote.storedStatus === 'accepted' && !converted && (
              <Button size="sm" icon={ArrowRight} onClick={() => setConverting(true)}>
                Convert to ticket
              </Button>
            )}
            {/* Destructive, so it is an icon apart from the row rather than a
                fourth equal button - the same treatment the ticket gives its
                delete. It still confirms by name. */}
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              aria-label={`Delete ${quote.quoteNumber}`}
              onClick={() => setDeleting(true)}
            />
          </>
        }
      />

      {setServiceQuoteStatus.error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {setServiceQuoteStatus.error.message}
        </p>
      )}

      {/* The chain this quote starts. Once it has become a ticket, that is
          where the work lives, and the ticket station is the way there. */}
      <WorkflowLineage
        current="quote"
        quote={quote}
        ticket={quote.convertedTicket}
        pending={converted ? undefined : 'ticket'}
        className="mb-4"
      />

      <DocumentLayout
        main={
          <>
            <DocumentDevices devices={devices} showPasscode />

            <DocumentNotes
              clientNotes={quote.clientNotes}
              technicianNotes={quote.technicianNotes}
              internalNotes={quote.internalNotes}
            />

            <DocumentHistory
              entries={[...(quote.timeline ?? [])].reverse().map((entry, index) => ({
                key: `${entry.at}-${index}`,
                title: SERVICE_QUOTE_STATUS_LABELS[entry.status] ?? titleize(entry.status ?? ''),
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
                {
                  label: 'Services and parts',
                  value: money(
                    devices.reduce(
                      (sum, device) =>
                        sum +
                        [...(device.services ?? []), ...(device.parts ?? [])].reduce(
                          (n, line) => n + (line.lineTotal ?? (line.priceCents ?? 0) * (line.qty ?? 1)),
                          0,
                        ),
                      0,
                    ),
                  ),
                },
                quote.extendedServiceFee && {
                  label: 'Extended service area',
                  value: money(quote.extendedServiceFeeCents ?? 0),
                },
                quote.discountCents > 0 && {
                  label: 'Discount',
                  hint: quote.discountCode || undefined,
                  value: `− ${money(quote.discountCents)}`,
                  tone: 'ok',
                },
                {
                  label: 'Tax',
                  hint: quote.taxRate ? `${quote.taxRate}%` : undefined,
                  value: money(quote.taxCents ?? 0),
                },
              ]}
              total={{ value: money(quote.totalCents ?? 0) }}
            />

            <DocumentCustomer
              name={quote.customerName}
              phone={quote.customerPhone}
              email={quote.customerEmail}
              userId={quote.user}
            />

            <DocumentFacts
              items={[
                { label: 'Service type', value: serviceType },
                { label: 'Quote date', value: quote.quoteDate ? date(quote.quoteDate) : null },
                { label: 'Valid until', value: quote.validUntil ? date(quote.validUntil) : null },
                { label: 'Source', value: quote.source ? titleize(quote.source) : null },
              ]}
            />
          </>
        }
      />

      <ConfirmDialog
        open={confirmingSent}
        onClose={() => setConfirmingSent(false)}
        onConfirm={() =>
          setServiceQuoteStatus.mutate(
            { id: quote.id, status: 'sent' },
            {
              onSuccess: () => {
                setConfirmingSent(false);
                toast.ok('Marked as sent');
              },
            },
          )
        }
        tone="warn"
        title={`Mark ${quote.quoteNumber} as sent?`}
        body={`It is recorded as sent to ${quote.customerName}. Nothing is emailed from here.`}
        confirmLabel="Mark as sent"
        loading={setServiceQuoteStatus.isPending}
        error={setServiceQuoteStatus.error?.message}
      />

      {/* Converting creates a second record, so it names the quote and says
          exactly what will exist afterwards - the same dialog the list uses. */}
      <ConfirmDialog
        open={converting}
        onClose={() => setConverting(false)}
        title={`Convert ${quote.quoteNumber} to a ticket?`}
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

      {/* Deleting the quote. The quote number is typed out: the document is
          destroyed rather than closed. */}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${quote.quoteNumber}?`}
        body={`The quote for ${quote.customerName} is destroyed, along with its devices, lines and timeline.${
          converted ? ' The repair ticket it became is kept - it simply stops naming a quote.' : ''
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
