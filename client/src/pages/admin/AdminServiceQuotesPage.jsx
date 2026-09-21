import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileSignature,
  Plus,
  Send,
  Smartphone,
  Trash2,
  Wallet,
  Wrench,
} from 'lucide-react';

import { money, date, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import BulkBar from '@/components/admin/BulkBar';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import FilterStrip from '@/components/admin/FilterStrip';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import useCreateRedirect from '@/hooks/useCreateRedirect';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminServiceQuotes, useAdminMutations } from '@/hooks/useAdmin';
import { toast } from '@/store/toastStore';

const ADMIN_PAGE = {
  ...ADMIN_ROUTES['/admin/quotes'],
  icon: adminIcon('FileSignature'),
  title: 'Quotes',
  description: 'Repair quotes given before the device is in the shop.',
};

const PILLS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'expired', label: 'Expired' },
  { value: 'converted', label: 'Converted' },
];

const STATUS_TONE = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'ok',
  expired: 'warn',
  converted: 'ok',
  rejected: 'danger',
};

/** The devices on one quote, as one line. */
function deviceSummary(quote) {
  const devices = quote.devices ?? [];
  if (!devices.length) return '–';

  const first = [devices[0].brand, devices[0].model].filter(Boolean).join(' ') || 'Device';
  return devices.length > 1 ? `${first} +${devices.length - 1}` : first;
}

/**
 * Repair quotes (Sales § Quote, service businesses).
 *
 * **The service half of one nav row.** `AdminQuotesPage` renders this instead
 * of the wholesale quote list when the business sells services. They are
 * separate models and separate screens, but one section: under
 * database-per-business a shop only ever has one kind, so a business never sees
 * a list that mixes them and never needs two menu items to find its own.
 *
 * The builder is a **full page**, not a modal here - a quote carries any
 * number of devices, each with its own lines and notes, which is more than a
 * dialog can hold without scrolling past what it is asking about.
 */
export function AdminServiceQuotesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // `+ Create > Quote` and the customer profile both arrive with `?new=1`. The
  // builder here is a full page, not a modal, so the flag is forwarded to it
  // rather than consumed - see `useCreateRedirect`.
  useCreateRedirect('/admin/quotes/create');
  const [query, setQuery] = useState('');
  const [converting, setConverting] = useState(null);
  // The estimate awaiting a typed number before it is destroyed.
  const [deleting, setDeleting] = useState(null);
  const [selected, setSelected] = useState([]);

  const status = searchParams.get('status') ?? 'all';

  const { data, isLoading } = useAdminServiceQuotes({ status, q: query || undefined });
  const { setServiceQuoteStatus, convertServiceQuote, deleteServiceQuote } = useAdminMutations();

  const quotes = data?.quotes ?? [];
  const counts = data?.counts ?? {};
  const totals = data?.totals ?? {};

  const { pageRows: pageQuotes, page, totalPages, from, setPage } = useTablePage(quotes);

  function setStatus(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  }

  /**
   * A bulk action, applied to what is actually eligible.
   *
   * **Filtered before it runs rather than refused.** Selecting fourteen rows
   * and being told "one of these cannot be accepted" leaves the staff member to
   * work out which; doing the twelve that can and reporting the two that could
   * not is the same information without the hunt.
   *
   * Sequential rather than `Promise.all`: these are audited writes, and forty
   * at once against a shared Atlas instance is how a bulk action becomes a
   * partial one for reasons nobody can reconstruct afterwards.
   *
   * **Convert is deliberately absent**, as it is on the wholesale list. It
   * creates a ticket per quote and asks a question per conversion; a batch
   * would answer it on the staff member's behalf for every row.
   */
  async function runBulk(action) {
    const rows = quotes.filter((quote) => selected.includes(quote.id));

    const eligible =
      action === 'accept'
        ? rows.filter((quote) => quote.storedStatus === 'sent' && !quote.expired)
        : rows.filter((quote) => !quote.convertedTicket);

    for (const quote of eligible) {
      if (action === 'accept') {
        await setServiceQuoteStatus
          .mutateAsync({ id: quote.id, status: 'accepted' })
          .catch(() => {});
      } else {
        await deleteServiceQuote.mutateAsync(quote.id).catch(() => {});
      }
    }

    setSelected([]);

    const done = eligible.length;
    const skipped = rows.length - done;
    const noun = action === 'accept' ? 'accepted' : 'deleted';

    if (skipped > 0) {
      toast.error(
        `${formatCount(done)} ${noun}, ${formatCount(skipped)} skipped`,
        action === 'accept'
          ? 'Only a sent quote that has not expired can be accepted.'
          : 'A quote that has become a ticket cannot be deleted - the ticket references it.',
      );
    } else if (done > 0) {
      toast.ok(`${formatCount(done)} ${noun}`, 'Done.');
    }
  }

  const columns = [
    {
      key: 'quoteNumber',
      header: 'Quote',
      priority: 1,
      render: (quote) => (
        <>
          <span className="block font-mono text-xs text-ink-900">{quote.quoteNumber}</span>
          <span className="block text-2xs text-ink-400">{date(quote.quoteDate)}</span>
        </>
      ),
    },
    {
      key: 'customerName',
      header: 'Customer',
      priority: 1,
      render: (quote) => (
        <>
          <span className="block truncate text-sm text-ink-900">{quote.customerName}</span>
          {quote.customerPhone && (
            <span className="block truncate text-2xs text-ink-400">{quote.customerPhone}</span>
          )}
        </>
      ),
    },
    {
      key: 'devices',
      header: 'Device',
      priority: 2,
      render: (quote) => <span className="text-xs text-ink-500">{deviceSummary(quote)}</span>,
    },
    {
      key: 'totalCents',
      header: 'Total',
      priority: 1,
      align: 'right',
      className: 'tnum',
      render: (quote) => <span className="text-sm text-ink-900">{money(quote.totalCents)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      render: (quote) => (
        <Badge tone={STATUS_TONE[quote.status] ?? 'neutral'} size="sm">
          {quote.status}
        </Badge>
      ),
    },
    {
      key: 'convertedTicket',
      header: 'Ticket',
      priority: 3,
      render: (quote) =>
        quote.convertedTicket ? (
          <span className="font-mono text-2xs text-ink-500">
            {quote.convertedTicket.ticketNumber}
          </span>
        ) : (
          <span className="text-ink-300">–</span>
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
      key: 'edit',
      label: 'Edit quote',
      icon: Wrench,
      // Editable at every status, converted included (ruled 2026-09-21). This
      // was disabled once a ticket existed; the shop corrects its own paperwork,
      // and the ticket is a separate record that this does not reach into.
      onSelect: (quote) => navigate(`/admin/quotes/${quote.id}/edit`),
    },
    {
      key: 'send',
      label: 'Mark as sent',
      icon: Send,
      // The server enforces this regardless; the menu is a courtesy.
      disabled: (quote) => quote.storedStatus !== 'draft',
      onSelect: (quote) => setServiceQuoteStatus.mutate({ id: quote.id, status: 'sent' }),
    },
    {
      key: 'accept',
      label: 'Mark as accepted',
      icon: CheckCircle2,
      disabled: (quote) => quote.storedStatus !== 'sent' || quote.expired,
      onSelect: (quote) => setServiceQuoteStatus.mutate({ id: quote.id, status: 'accepted' }),
    },
    {
      key: 'convert',
      label: 'Customer brought the device in',
      icon: Smartphone,
      disabled: (quote) => quote.storedStatus !== 'accepted' || Boolean(quote.convertedTicket),
      onSelect: setConverting,
    },
    {
      /**
       * Deleting, at any status (ruled 2026-09-21).
       *
       * The estimate had no delete at all before this - a draft typed against
       * the wrong customer stayed in the list for ever. A converted one takes
       * its ticket's back-reference with it rather than leaving the ticket
       * pointing at a record that is gone; the ticket itself is untouched,
       * because the work still happened.
       */
      key: 'delete',
      label: 'Delete quote',
      icon: Trash2,
      tone: 'danger',
      onSelect: setDeleting,
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <Button onClick={() => navigate('/admin/quotes/create')} icon={Plus}>
            New quote
          </Button>
        }
      />

      {setServiceQuoteStatus.error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {setServiceQuoteStatus.error.message}
        </p>
      )}

      <KpiRow
        tiles={[
          {
            key: 'open',
            label: 'Open pipeline',
            value: money(totals.open ?? 0),
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
            label: 'Became a ticket',
            value: formatCount(counts.converted ?? 0),
            hint: 'Device came in, work started',
            tone: 'ok',
            icon: CheckCircle2,
          },
        ]}
      />

      <Panel flush>
        <FilterStrip
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Quote number, customer, phone or model…"
          pills={PILLS.map((pill) => ({ ...pill, count: counts[pill.value] }))}
          activePill={status}
          onPillChange={setStatus}
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={quotes.length}
            shown={pageQuotes.length}
            from={from}
            noun={quotes.length === 1 ? 'quote' : 'quotes'}
          />
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
          defaultSort={{ key: 'quoteNumber', direction: 'desc' }}
          empty={
            <PanelEmpty
              icon={FileSignature}
              title={query || status !== 'all' ? 'No quotes match' : 'No quotes yet'}
              body={
                query || status !== 'all'
                  ? 'Try a different filter.'
                  : 'A quote is for a customer who has not left their device. Somebody who walks in with one goes straight to a ticket.'
              }
              action={
                <Button onClick={() => navigate('/admin/quotes/create')} icon={Plus} size="sm">
                  New quote
                </Button>
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

      {/* Accept and delete ask nothing per row, so they are safe in bulk.
          Converting is not: it creates a ticket and asks a question each time. */}
      <BulkBar count={selected.length} noun="selected" onClear={() => setSelected([])}>
        <Button
          size="xs"
          variant="outline"
          icon={CheckCircle2}
          loading={setServiceQuoteStatus.isPending}
          onClick={() => runBulk('accept')}
        >
          Accept
        </Button>
        <Button
          size="xs"
          variant="outline"
          icon={Trash2}
          loading={deleteServiceQuote.isPending}
          onClick={() => runBulk('delete')}
        >
          Delete
        </Button>
      </BulkBar>

      {/*
        Converting starts work and creates a second record, so it names the
        quote and says exactly what will exist afterwards.
      */}
      <ConfirmDialog
        open={Boolean(converting)}
        onClose={() => setConverting(null)}
        title="Start work on this quote?"
        body={
          converting
            ? `${converting.quoteNumber} for ${converting.customerName} becomes a repair ticket. ` +
              'Every device, line and note carries over, and the ticket owns the work from then on.'
            : ''
        }
        confirmLabel="Create the ticket"
        loading={convertServiceQuote.isPending}
        error={convertServiceQuote.error?.message}
        onConfirm={() =>
          convertServiceQuote.mutate(
            { id: converting.id },
            {
              onSuccess: (result) => {
                setConverting(null);
                // Straight to the ticket: that is where the work lives now, and
                // it is what the counter needs open next.
                if (result?.ticket?.id) navigate(`/admin/tickets/${result.ticket.id}`);
              },
            },
          )
        }
      />

      {/*
        Deleting the estimate.

        `critical` and a typed quote number, because the document is destroyed
        rather than closed - and because a converted estimate is the paper the
        customer agreed to, which is worth one deliberate act to remove. The
        body says what happens to the ticket, since that is the question a
        staff member will have at exactly this moment.
      */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.quoteNumber}?`}
        body={
          deleting
            ? `The estimate for ${deleting.customerName} is destroyed, along with its devices, lines and timeline.${
                deleting.convertedTicket
                  ? ' The repair ticket it became is kept - it simply stops naming an estimate.'
                  : ''
              } This cannot be undone.`
            : ''
        }
        tone="critical"
        confirmPhrase={deleting?.quoteNumber}
        confirmPhraseLabel="the quote number"
        confirmLabel="Delete quote"
        loading={deleteServiceQuote.isPending}
        error={deleteServiceQuote.error?.message}
        onConfirm={() =>
          deleteServiceQuote.mutate(deleting.id, {
            onSuccess: () => {
              toast.ok('Quote deleted', `${deleting.quoteNumber} is gone.`);
              setDeleting(null);
            },
          })
        }
      />
    </>
  );
}

export default AdminServiceQuotesPage;
