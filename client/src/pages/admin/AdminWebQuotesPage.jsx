import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CheckCheck, FileSignature, Globe, Mail, Phone, Undo2 } from 'lucide-react';

import cn from '@/lib/cn';
import { date, dateTime, count as formatCount, titleize } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Pagination from '@/components/ui/Pagination';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import FilterStrip from '@/components/admin/FilterStrip';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminWebQuotes, useAdminMutations } from '@/hooks/useAdmin';
import { toast } from '@/store/toastStore';
import { pressable } from '@/lib/motion';

/**
 * Web quotes - the enquiries the storefront's contact form sends in.
 *
 * **They are `ContactMessage` rows.** Somebody asking "what would it cost to
 * fix this" has not created a quote: a quote is a priced document with line
 * items and an expiry, and nobody can produce one until the shop has read the
 * enquiry and decided what the job is. Storing web enquiries as draft quotes
 * would fill the Quotes list with rows carrying no prices and nothing to
 * convert.
 *
 * So this screen is the **inbox**, and `Convert` is the bridge: it opens the
 * real quote form seeded with the enquirer's details. Until this existed the
 * contact form wrote to a collection no admin screen read - messages arrived
 * and were never seen.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/web-quotes'], icon: adminIcon('Globe') };

const PILLS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read' },
  { value: 'closed', label: 'Closed' },
];

const STATUS_TONES = { new: 'brand', read: 'info', closed: 'neutral' };

/** What the enquiry is about. The storefront form's own list. */
const TOPIC_TONES = {
  quote: 'ok',
  account: 'info',
  order: 'warn',
  stock: 'info',
  warranty: 'danger',
  membership: 'ok',
  other: 'neutral',
};

const ROWS_PER_PAGE = 25;

export function AdminWebQuotesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  // The enquiry being read. A message is prose, and prose does not belong in a
  // table cell - the row shows its first line and the sheet shows all of it.
  const [reading, setReading] = useState(null);
  // A status move waiting on its confirmation, from the row menu or the drawer.
  const [moving, setMoving] = useState(null);

  const status = searchParams.get('status') ?? 'all';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));

  const { data, isLoading } = useAdminWebQuotes({ status, q: query || undefined });
  const { setWebQuoteStatus } = useAdminMutations();

  const rows = data?.webQuotes ?? [];
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const current = Math.min(page, pages);
  const paged = rows.slice((current - 1) * ROWS_PER_PAGE, current * ROWS_PER_PAGE);

  function setParam(key, value) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === 'all') params.delete(key);
    else params.set(key, value);
    if (key !== 'page') params.delete('page');
    setSearchParams(params, { replace: true });
  }

  /**
   * Opening an enquiry only opens it.
   *
   * Status is set by hand, never as a side effect of looking. Skimming a
   * message is not the same act as deciding the queue has dealt with it - a
   * staff member who opens an enquiry and leaves it for somebody better placed to
   * answer has not worked that row, and a status that moved itself under them
   * drops it out of the filter they were working from. Every move is a
   * deliberate click: the row menu, or the drawer's own buttons.
   */
  function open(row) {
    setReading(row);
  }

  /** One status move, reported the same way wherever it was started. */
  function move(row, status, title) {
    return setWebQuoteStatus
      .mutateAsync({ id: row.id, status })
      .then(() => toast.ok(title, `Enquiry from ${row.name}.`));
  }

  /** What each move asks before it runs (§3.0.1). */
  const MOVES = {
    read: { label: 'Mark as read', done: 'Marked as read', body: 'It leaves the New filter and stays in the queue.' },
    closed: { label: 'Close', done: 'Closed', body: 'It stops showing as outstanding. It can be reopened.' },
    reopen: { label: 'Reopen', done: 'Back in the queue', body: 'It shows as outstanding again.' },
  };
  const ask = (row, kind) => ({
    title: `${MOVES[kind].label} the enquiry from ${row.name}?`,
    body: MOVES[kind].body,
    confirmLabel: MOVES[kind].label,
  });

  /**
   * The bridge to a real quote.
   *
   * The quote form opens seeded with the enquirer and the enquiry keeps the
   * status it had. Closing it here would be the app deciding an enquiry was
   * answered because a form was opened, and a quote abandoned half-written
   * would leave the queue claiming work that never happened. The staff member
   * closes the row when the quote actually goes out.
   */
  function convert(row) {
    setReading(null);
    const params = new URLSearchParams({ new: '1' });
    if (row.user?.id) params.set('client', row.user.id);
    navigate(`/admin/quotes?${params.toString()}`);
  }

  /**
   * Row actions - the queue moves without opening each enquiry.
   *
   * This menu and the drawer's buttons are the only things that move an
   * enquiry: mark one read, close a duplicate, reopen something closed too
   * early, or start the quote it deserves. Each item is hidden when it would be
   * a no-op, so the menu never offers "mark read" on a row that is already
   * read.
   */
  const rowMenu = [
    {
      key: 'read',
      label: 'Mark as read',
      icon: Mail,
      hidden: (row) => row.status !== 'new',
      confirm: (row) => ask(row, 'read'),
      onSelect: (row) => move(row, 'read', MOVES.read.done),
    },
    {
      key: 'convert',
      label: 'Convert to quote',
      icon: FileSignature,
      hidden: (row) => row.status === 'closed',
      onSelect: convert,
    },
    {
      key: 'close',
      label: 'Close',
      icon: CheckCheck,
      hidden: (row) => row.status === 'closed',
      confirm: (row) => ask(row, 'closed'),
      onSelect: (row) => move(row, 'closed', MOVES.closed.done),
    },
    {
      key: 'reopen',
      label: 'Reopen',
      icon: Undo2,
      hidden: (row) => row.status !== 'closed',
      confirm: (row) => ask(row, 'reopen'),
      onSelect: (row) => move(row, 'read', MOVES.reopen.done),
    },
  ];

  const columns = [
    {
      key: 'name',
      header: 'From',
      priority: 1,
      width: '26%',
      render: (row) => (
        <>
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-md font-semibold text-ink-900">{row.name}</span>
            {row.status === 'new' && (
              <Badge tone="brand" size="sm">
                new
              </Badge>
            )}
          </span>
          <span className="block truncate text-xs text-ink-500">{row.email}</span>
        </>
      ),
    },
    {
      key: 'topic',
      header: 'Topic',
      priority: 2,
      width: '14%',
      render: (row) => (
        <Badge tone={TOPIC_TONES[row.topic] ?? 'neutral'} size="sm">
          {titleize(row.topic)}
        </Badge>
      ),
    },
    {
      key: 'message',
      header: 'Enquiry',
      priority: 2,
      width: '34%',
      render: (row) => (
        <span className="block truncate text-sm text-ink-700">{row.message}</span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Received',
      priority: 3,
      width: '14%',
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => (
        <span className="tnum whitespace-nowrap text-sm text-ink-500">
          {date(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      width: '12%',
      render: (row) => (
        <Badge tone={STATUS_TONES[row.status] ?? 'neutral'} size="sm">
          {row.status}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <KpiRow
        tiles={[
          {
            key: 'new',
            label: 'Unanswered',
            value: formatCount(counts.new ?? 0),
            hint: 'Nobody has opened these yet',
            tone: (counts.new ?? 0) > 0 ? 'brand' : 'ok',
            icon: Globe,
          },
          {
            key: 'read',
            label: 'Read',
            value: formatCount(counts.read ?? 0),
            hint: 'Seen, not yet answered',
            tone: 'info',
            icon: Mail,
          },
          {
            key: 'closed',
            label: 'Closed',
            value: formatCount(counts.closed ?? 0),
            hint: 'Answered or quoted',
            tone: 'ok',
            icon: CheckCheck,
          },
        ]}
      />

      <Panel flush>
        <FilterStrip
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Name, email, phone or message…"
          pills={PILLS.map((pill) => ({
            ...pill,
            count: pill.value === 'all' ? total : counts[pill.value],
          }))}
          activePill={status}
          onPillChange={(next) => setParam('status', next)}
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={rows.length}
            shown={paged.length}
            noun={rows.length === 1 ? 'enquiry' : 'enquiries'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(row) => row.id}
          loading={isLoading}
          onRowClick={open}
          rowMenu={rowMenu}
          defaultSort={{ key: 'createdAt', direction: 'desc' }}
          empty={
            <PanelEmpty
              icon={Globe}
              title="No enquiries"
              body="Nothing has come in through the website contact form."
            />
          }
        />

        {rows.length > 0 && (
          <div className="border-t border-line p-3">
            <Pagination
              page={current}
              pages={pages}
              onChange={(next) => setParam('page', String(next))}
            />
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(reading)}
        onClose={() => setReading(null)}
        title={reading ? `Enquiry from ${reading.name}` : 'Enquiry'}
        size="lg"
      >
        {reading && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-500">
              <a
                href={`mailto:${reading.email}`}
                className={cn(pressable, 'inline-flex items-center gap-1.5 hover:text-ink-900')}
              >
                <Mail className="size-3.5 shrink-0 text-brand" strokeWidth={2.25} aria-hidden="true" />
                {reading.email}
              </a>
              {reading.phone && (
                <a
                  href={`tel:${reading.phone.replace(/[^\d+]/g, '')}`}
                  className={cn(pressable, 'inline-flex items-center gap-1.5 hover:text-ink-900')}
                >
                  <Phone className="size-3.5 shrink-0 text-brand" strokeWidth={2.25} aria-hidden="true" />
                  {reading.phone}
                </a>
              )}
              <span className="tnum">{dateTime(reading.createdAt)}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TOPIC_TONES[reading.topic] ?? 'neutral'} size="sm">
                {titleize(reading.topic)}
              </Badge>
              {reading.orderNumber && (
                <Link
                  to={`/admin/orders/${reading.orderNumber}`}
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  {reading.orderNumber}
                </Link>
              )}
              {/* Only when a signed-in customer sent it. A guest enquiry has no
                  account to link to, and guessing one from the email address
                  would attach a stranger's message to somebody's record. */}
              {reading.user && (
                <Link
                  to={`/admin/clients/${reading.user.id}`}
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  {reading.user.displayName}
                </Link>
              )}
            </div>

            <p className="whitespace-pre-wrap rounded-md bg-surface-2 px-3.5 py-3 text-sm leading-relaxed text-ink-900">
              {reading.message}
            </p>

            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              {/* Opening no longer marks anything read, so the drawer has to
                  carry that move itself - the staff member is here, not on the row
                  menu they came from. */}
              {reading.status === 'new' && (
                <Button
                  variant="outline"
                  icon={Mail}
                  onClick={() => {
                    setMoving({ row: reading, kind: 'read', status: 'read' });
                    setReading(null);
                  }}
                >
                  Mark as read
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setMoving(
                    reading.status === 'closed'
                      ? { row: reading, kind: 'reopen', status: 'read' }
                      : { row: reading, kind: 'closed', status: 'closed' },
                  );
                  setReading(null);
                }}
              >
                {reading.status === 'closed' ? 'Reopen' : 'Close'}
              </Button>
              <Button icon={FileSignature} onClick={() => convert(reading)}>
                Convert to quote
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(moving)}
        onClose={() => setMoving(null)}
        onConfirm={() =>
          move(moving.row, moving.status, MOVES[moving.kind].done).then(() => setMoving(null), () => {})
        }
        tone="warn"
        {...(moving ? ask(moving.row, moving.kind) : {})}
        loading={setWebQuoteStatus.isPending}
        error={setWebQuoteStatus.error?.message}
      />
    </>
  );
}

export default AdminWebQuotesPage;
