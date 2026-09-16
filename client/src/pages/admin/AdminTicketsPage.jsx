import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  ClipboardList,
  Download,
  Hourglass,
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_PRIORITIES,
  TICKET_SOURCES,
} from '@shared/schemas/admin';
import cn from '@/lib/cn';
import reportStatusOutcome from '@/lib/ticketStatusOutcome';
import { count as formatCount, titleize } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import SelectMenu from '@/components/ui/SelectMenu';
import Pagination from '@/components/ui/Pagination';
import PageHeader from '@/components/admin/PageHeader';
import BadgeExplainer from '@/components/admin/BadgeExplainer';
import KpiRow from '@/components/admin/KpiRow';
import FilterStrip from '@/components/admin/FilterStrip';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import { PER_PAGE_OPTIONS, DEFAULT_PER_PAGE } from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminTickets, useAdminMutations } from '@/hooks/useAdmin';

/**
 * Repair tickets (Sales § Ticket).
 *
 * **The Age column drives the day**, as it does on RMA: it carries the warning
 * past the SLA and stops counting once a ticket closes, because a row that
 * always shouts is a row a staff member learns to ignore.
 *
 * The status control is an inline dropdown on every row rather than a menu
 * item, which is deliberate. A repair moves several times a day and often
 * backwards - the wrong screen arrives, a fix does not hold - so the move a
 * staff member makes most often should cost one click, not three. The server takes
 * any status and records each move on the ticket timeline; the timeline is the
 * control here, not a transition table.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/tickets'], icon: adminIcon('ClipboardList') };

/** The pills, in workflow order. `completed`/`cancelled` live under Filters. */
const PILL_STATUSES = [
  'diagnosis',
  'accepted',
  'waiting_for_parts',
  'ready_to_repair',
  'processing',
  'retention_policy',
  'ready_to_pickup',
];

const PILLS = [
  { value: 'all', label: 'All' },
  ...PILL_STATUSES.map((value) => ({ value, label: TICKET_STATUS_LABELS[value] })),
];

const STATUS_TONES = {
  diagnosis: 'info',
  accepted: 'info',
  waiting_for_parts: 'warn',
  ready_to_repair: 'info',
  processing: 'warn',
  retention_policy: 'neutral',
  ready_to_pickup: 'ok',
  completed: 'ok',
  cancelled: 'danger',
};

const PRIORITY_TONES = { low: 'neutral', normal: 'neutral', high: 'warn', urgent: 'danger' };

/**
 * The dot beside each status in the menu.
 *
 * The same colour the row's own badge carries, so the menu and the row agree at
 * a glance rather than making the reader map "Waiting for Parts" back onto
 * amber from memory. Each is a token, never a hex.
 *
 * `ready_to_repair` and `processing` are deliberately different from the two
 * that flank them: they are the middle of the workshop and the pair a staff member
 * moves between most, so telling them apart matters more here than anywhere.
 */
/**
 * The status cell's own tint.
 *
 * A soft ground and a strong label, rather than a bordered control: the colour
 * IS the status, and the reader scans this column for it. Each pairing is a
 * token tint with its own ink, so the text clears contrast on its own ground
 * rather than relying on a single grey that happens to work on four of them.
 */
/**
 * The channels the confirmation offers to suppress.
 *
 * **These are permissions, not sends.** The customer is messaged on the ONE
 * channel recorded on their profile; unticking a row here says "not by that
 * route this time", and unticking every row changes the status silently. Which
 * is why all three start ticked: the default is the behaviour the move already
 * had, and the dialog exists to let somebody opt OUT of it.
 *
 * `call` is deliberately absent. It is a task logged for a staff member rather
 * than a message anything transmits, so offering to switch it off would imply
 * the system was about to ring somebody.
 */
const NOTIFY_CHANNELS = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'sms', label: 'SMS', icon: MessageSquare },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
];

const STATUS_PILL = {
  diagnosis: 'bg-info-50 text-info',
  accepted: 'bg-warn-50 text-warn',
  waiting_for_parts: 'bg-danger-50 text-danger',
  ready_to_repair: 'bg-brand-50 text-brand-700',
  processing: 'bg-brand-100 text-brand-700',
  retention_policy: 'bg-surface-2 text-ink-600',
  ready_to_pickup: 'bg-ok-50 text-ok',
  completed: 'bg-ok-50 text-ok',
  cancelled: 'bg-danger-50 text-danger',
};

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

/**
 * What the row's inline menu offers.
 *
 * **The live rungs only.** `completed` and `cancelled` are endings rather than
 * moves: completing is what the pickup step leads to, and cancelling stops the
 * job and is confirmed on the ticket itself. Offering both in a one-click row
 * menu puts the two irreversible-feeling answers a slip away from the six a
 * staff member makes daily.
 */
const STATUS_OPTIONS = PILL_STATUSES.map((value) => ({
  value,
  label: TICKET_STATUS_LABELS[value],
  dotClass: STATUS_DOTS[value],
}));

const PRIORITY_OPTIONS = TICKET_PRIORITIES.map((value) => ({ value, label: titleize(value) }));
const SOURCE_OPTIONS = TICKET_SOURCES.map((value) => ({ value, label: titleize(value) }));



export function AdminTicketsPage() {
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState(null);

  /**
   * The status move waiting to be confirmed: `{ ticket, status }`.
   *
   * A status change messages a customer, so it is a mutation fired from one
   * click that reaches a third party - which §3.0.1 says confirms. It used to
   * fire straight off the picker, so picking the wrong row from a nine-item menu
   * texted somebody that their device was ready.
   */
  const [statusMove, setStatusMove] = useState(null);
  const [notifyVia, setNotifyVia] = useState(() => NOTIFY_CHANNELS.map((c) => c.value));
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * `?new=1` still opens intake - it now redirects to the form's own route.
   *
   * The `+ Create > Ticket` menu and the customer profile both link here with
   * that flag (and, from a profile, the customer's details as companions). The
   * form moved to `/admin/tickets/new`, so rather than teach every caller a new
   * URL this forwards the whole query string on arrival: one place changed, and
   * an old link somebody bookmarked still lands on the right screen.
   */
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const params = new URLSearchParams(searchParams);
    params.delete('new');
    const forwarded = params.toString();
    navigate(`/admin/tickets/new${forwarded ? `?${forwarded}` : ''}`, { replace: true });
  }, [searchParams, navigate]);

  const status = searchParams.get('status') ?? 'all';
  const priority = searchParams.get('priority') ?? 'all';
  const technician = searchParams.get('technician') ?? 'all';
  const perPage = searchParams.get('perPage') ?? String(DEFAULT_PER_PAGE);
  const page = Number(searchParams.get('page') ?? 1);

  const { data, isLoading } = useAdminTickets({
    status,
    q: query || undefined,
    priority: priority === 'all' ? undefined : priority,
    technician: technician === 'all' ? undefined : technician,
    limit: perPage,
    page,
  });

  const { createTicket, updateTicket, setTicketStatus, deleteTicket } = useAdminMutations();

  const tickets = data?.tickets ?? [];
  const counts = data?.counts ?? {};
  const technicians = data?.technicians ?? [];
  const slaDays = data?.slaDays ?? 7;

  /**
   * Every filter lives in the URL so a filtered board can be linked to. Any
   * change but the page itself resets to page 1 - staying on page 4 of a set
   * that now has two pages shows an empty table.
   */
  function setParam(key, value) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === 'all') params.delete(key);
    else params.set(key, value);
    if (key !== 'page') params.delete('page');
    setSearchParams(params, { replace: true });
  }

  const activeFilterCount =
    (priority === 'all' ? 0 : 1) + (technician === 'all' ? 0 : 1) + (perPage === String(DEFAULT_PER_PAGE) ? 0 : 1);

  const columns = [
    {
      key: 'ticketNumber',
      header: 'Ticket #',
      priority: 1,
      render: (ticket) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="font-mono text-sm font-medium text-ink-900">
            {ticket.ticketNumber}
          </span>
          {/*
            Where the ticket came from, and nothing more.

            I had this warning "Needs review" until a person cleared it; the
            client's call is that it does not. A counter works its queue by
            status - Diagnosis is already the list of jobs nobody has started -
            so a second thing to clear is a second queue to keep empty for no
            gain. The badge says how the ticket arrived, which is the part that
            stays true.
          */}
          {ticket.source === 'kiosk' && (
            <Badge tone="ok" size="sm" icon={Smartphone}>
              Kiosk
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      priority: 1,
      className: 'max-w-[170px]',
      sortValue: (ticket) => ticket.customer.name,
      render: (ticket) => (
        <>
          <span className="block truncate text-sm font-medium text-ink-900">
            {ticket.customer.name}
          </span>
          <span className="tnum block text-xs text-ink-400">{ticket.customer.phone}</span>
        </>
      ),
    },
    {
      key: 'device',
      header: 'Device & issue',
      priority: 1,
      className: 'max-w-[220px]',
      sortValue: (ticket) => `${ticket.device.brand ?? ''} ${ticket.device.model ?? ''}`,
      render: (ticket) => (
        <>
          <span className="block truncate text-sm">
            {ticket.device.brand && (
              <span className="font-medium text-ink-900">{ticket.device.brand}</span>
            )}
            {ticket.device.brand && ticket.device.model && (
              <span className="text-ink-300"> · </span>
            )}
            <span className="text-ink-500">{ticket.device.model ?? '-'}</span>
          </span>
          <span className="block truncate text-xs text-ink-500">{ticket.issue}</span>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      // The move a staff member makes most often, so it costs one click. The
      // server takes any status and records the move (invariant 13: this is a
      // convenience, never the control).
      render: (ticket) => (
        /**
         * The guard shrinks to the pill, rather than filling the cell.
         *
         * `stopPropagation` is what stops opening the menu from also opening
         * the ticket. On a block-level wrapper that was the whole cell, so the
         * empty space beside a short status swallowed the click and the row did
         * nothing - which reads as broken, because every other cell in the row
         * navigates. `inline-flex` makes the guarded area exactly the control
         * it is guarding, and the rest of the cell falls through to the row.
         */
        <div className="inline-flex" onClick={(event) => event.stopPropagation()}>
          <SelectMenu
            srLabel={`Status for ${ticket.ticketNumber}`}
            value={ticket.status}
            options={STATUS_OPTIONS}
            align="left"
            /**
             * A status pill, not a form field.
             *
             * The default trigger is a bordered box because it is normally a
             * `<select>` in a form. In a table cell that is wrong twice over: a
             * column of forty boxed controls reads as forty things demanding
             * input, and the border competes with the status colour, which is
             * the thing the reader is actually scanning for. So the box goes
             * and the tint carries the meaning - the same treatment the badge
             * on the detail page gets, with a chevron to say it opens.
             *
             * `twMerge` lets these win over the defaults, so the component
             * needs no variant for one screen's judgement.
             */
            buttonClassName={cn(
              // `h-7`, not padding: `SIZES` sets a fixed height on the trigger,
              // so `py-` cannot shrink it - it only pads inside a box that is
              // already 36px tall. A row of those reads as a column of controls
              // rather than a column of statuses.
              'h-7 w-auto gap-1 rounded-full border-0 px-2.5 text-xs font-semibold',
              'hover:border-0 focus:border-0 focus:ring-1',
              STATUS_PILL[ticket.status] ?? 'bg-surface-2 text-ink-700',
            )}
            menuTitle="Change status"
            /* The consequence the list cannot show. A status move messages the
               customer on their preferred channel, and a menu that looks like
               it only edits a field is one somebody uses to tidy a board at
               midnight. */
            menuFootnote={
              <>
                <Bell className="mt-px size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                {/*
                  Named as the channel the customer actually chose, not as a
                  list of every transport we own. "Email + SMS + WhatsApp"
                  promises three messages; one goes out, on the channel recorded
                  on their profile - and a staff member who believes the first
                  version will not think to check that the profile has one.
                */}
                <span>Changing this messages the customer on their preferred channel.</span>
              </>
            }
            // Opens the confirmation rather than moving the ticket. Every channel
            // starts ticked, so confirming with nothing touched is the behaviour
            // the picker had before.
            onChange={(next) => {
              if (next === ticket.status) return;
              setNotifyVia(NOTIFY_CHANNELS.map((channel) => channel.value));
              setStatusMove({ ticket, status: next });
            }}
          />
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      priority: 2,
      render: (ticket) => (
        <Badge tone={PRIORITY_TONES[ticket.priority]} size="sm">
          {titleize(ticket.priority)}
        </Badge>
      ),
    },
    {
      key: 'technician',
      header: 'Technician',
      priority: 2,
      className: 'max-w-[140px] truncate',
      sortValue: (ticket) => ticket.technician?.name ?? '',
      render: (ticket) =>
        ticket.technician?.name ? (
          <span className="text-sm text-ink-700">{ticket.technician.name}</span>
        ) : (
          <span className="text-sm italic text-ink-300">Unassigned</span>
        ),
    },
    {
      key: 'age',
      header: 'Age',
      priority: 1,
      align: 'right',
      className: 'tnum',
      sortValue: (ticket) => ticket.age,
      render: (ticket) => (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-sm',
            ticket.overSla
              ? 'font-medium text-danger'
              : ticket.closed
                ? 'text-ink-300'
                : 'text-ink-600',
          )}
        >
          {ticket.overSla && (
            <AlertTriangle className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          )}
          {ticket.age}d
        </span>
      ),
    },
  ];

  const rowMenu = [
    {
      key: 'open',
      label: 'Open ticket',
      icon: ClipboardList,
      onSelect: (ticket) => navigate(`/admin/tickets/${ticket.id}`),
    },
    {
      key: 'edit',
      label: 'Edit ticket',
      icon: Pencil,
      onSelect: (ticket) => navigate(`/admin/tickets/${ticket.id}/edit`),
    },
    {
      key: 'pdf',
      label: 'Download PDF',
      icon: Download,
      onSelect: (ticket) =>
        window.alert(
          `A printable job sheet for ${ticket.ticketNumber} arrives with the ticket detail screen.`,
        ),
    },
    {
      key: 'delete',
      label: 'Delete ticket',
      icon: Trash2,
      tone: 'danger',
      onSelect: (ticket) => setDeleting(ticket),
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <Button onClick={() => navigate('/admin/tickets/new')} icon={Plus}>
            New ticket
          </Button>
        }
      />

      <BadgeExplainer />

      <KpiRow
        tiles={[
          {
            key: 'open',
            label: 'Open repairs',
            value: formatCount(counts.open ?? 0),
            hint: 'Still on the workshop',
            tone: (counts.open ?? 0) > 0 ? 'warn' : 'ok',
            icon: Wrench,
          },
          {
            key: 'overdue',
            label: `Past ${slaDays} days`,
            value: formatCount(counts.overdue ?? 0),
            hint: 'Open longer than the SLA allows',
            tone: (counts.overdue ?? 0) > 0 ? 'danger' : 'ok',
            icon: Hourglass,
          },
          {
            key: 'pickup',
            label: 'Ready to pickup',
            value: formatCount(counts.ready_to_pickup ?? 0),
            hint: 'Fixed, waiting to be collected',
            tone: 'info',
            icon: ClipboardList,
          },
          {
            key: 'parts',
            label: 'Waiting for parts',
            value: formatCount(counts.waiting_for_parts ?? 0),
            hint: 'Blocked on stock',
            tone: (counts.waiting_for_parts ?? 0) > 0 ? 'warn' : 'neutral',
            icon: AlertTriangle,
          },
        ]}
      />

      <Panel flush>
        <FilterStrip
          search={query}
          onSearchChange={(next) => {
            setQuery(next);
            setParam('page', '');
          }}
          searchPlaceholder="Ticket #, customer, device…"
          stackPills
          pills={PILLS.map((pill) => ({ ...pill, count: counts[pill.value] }))}
          activePill={status}
          onPillChange={(next) => setParam('status', next)}
          activeFilterCount={activeFilterCount}
          onClearFilters={() => {
            const params = new URLSearchParams(searchParams);
            ['priority', 'technician', 'perPage', 'page'].forEach((key) => params.delete(key));
            setSearchParams(params, { replace: true });
          }}
          filters={
            <div className="space-y-3">
              <div>
                <p className="eyebrow mb-1.5 text-ink-400">Priority</p>
                <SelectMenu
                  srLabel="Filter by priority"
                  value={priority}
                  onChange={(next) => setParam('priority', next)}
                  options={[{ value: 'all', label: 'Any priority' }, ...PRIORITY_OPTIONS]}
                  align="left"
                  className="w-full"
                />
              </div>

              <div>
                <p className="eyebrow mb-1.5 text-ink-400">Technician</p>
                <SelectMenu
                  srLabel="Filter by technician"
                  value={technician}
                  onChange={(next) => setParam('technician', next)}
                  options={[
                    { value: 'all', label: 'Anyone' },
                    { value: 'unassigned', label: 'Unassigned' },
                    ...technicians.map((person) => ({ value: person.id, label: person.name })),
                  ]}
                  align="left"
                  className="w-full"
                />
              </div>

              <div>
                <p className="eyebrow mb-1.5 text-ink-400">Rows</p>
                <SelectMenu
                  srLabel="Rows per page"
                  value={perPage}
                  onChange={(next) => setParam('perPage', next)}
                  options={PER_PAGE_OPTIONS}
                  align="left"
                  className="w-full"
                />
              </div>
            </div>
          }
          onExport={(format) =>
            window.alert(
              `Export to ${format} arrives in phase 12. It will carry the current filters: ` +
                `status "${status}"${query ? `, search "${query}"` : ''}.`,
            )
          }
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={data?.total ?? tickets.length}
            shown={tickets.length}
            noun={(data?.total ?? tickets.length) === 1 ? 'ticket' : 'tickets'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={tickets}
          rowKey={(ticket) => ticket.id}
          rowMenu={rowMenu}
          onRowClick={(ticket) => navigate(`/admin/tickets/${ticket.id}`)}
          loading={isLoading}
          empty={
            <PanelEmpty
              icon={ClipboardList}
              title="No tickets match"
              body="Try a different filter, or open one at the counter."
            />
          }
        />

        {(data?.totalPages ?? 1) > 1 && (
          <div className="border-t border-line p-3">
            <Pagination
              page={data.page}
              pages={data.totalPages}
              onChange={(next) => setParam('page', String(next))}
            />
          </div>
        )}
      </Panel>


      {/* A status change messages a customer, so it confirms (§3.0.1) - and the
          confirmation is where the channels can be unticked, because "move it but
          do not tell them" is a real thing a counter needs: a device marked ready
          by mistake, or a customer already standing there being handed it.

          `tone="info"`, not the default danger: this is an ordinary, reversible
          move a technician makes many times a day, and a red alarm on every one
          teaches them to click through reds. */}
      <ConfirmDialog
        open={Boolean(statusMove)}
        onClose={() => setStatusMove(null)}
        tone="info"
        heading="Change status?"
        title={
          statusMove ? (
            <>
              Change <strong className="font-semibold text-ink-900">ticket {statusMove.ticket.ticketNumber}</strong>{' '}
              to{' '}
              <strong className="font-semibold text-ink-900">
                {TICKET_STATUS_LABELS[statusMove.status] ?? titleize(statusMove.status)}
              </strong>
              ?
            </>
          ) : (
            ''
          )
        }
        body={
          <div className="rounded-lg border border-line bg-surface-2 p-3.5">
            <p className="eyebrow mb-2.5 text-ink-400">Notify the customer via:</p>

            <div className="space-y-1">
              {NOTIFY_CHANNELS.map(({ value, label, icon: Icon }) => (
                <div key={value} className="flex items-center gap-2">
                  <Checkbox
                    checked={notifyVia.includes(value)}
                    onChange={(event) =>
                      setNotifyVia((current) =>
                        event.target.checked
                          ? [...current, value]
                          : current.filter((entry) => entry !== value),
                      )
                    }
                    label={
                      <span className="flex items-center gap-2">
                        <Icon
                          className="size-4 shrink-0 text-ink-400"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                        {label}
                      </span>
                    }
                    className="flex-1"
                  />
                </div>
              ))}
            </div>

            {/* Says what unticking DOES, because the checkboxes cannot: the
                customer is reached on the one channel they chose, so these are
                permissions rather than three separate messages. */}
            <p className="mt-3 text-xs leading-relaxed text-ink-400">
              Uncheck a channel to skip it. Uncheck all to change the status silently.
            </p>
          </div>
        }
        confirmLabel="Confirm change"
        loading={setTicketStatus.isPending}
        error={setTicketStatus.error?.message}
        onConfirm={() =>
          setTicketStatus.mutate(
            {
              id: statusMove.ticket.id,
              status: statusMove.status,
              channels: notifyVia,
            },
            {
              // The move can silently fail to reach the customer - no channel on
              // file, a declined one, no provider wired - and the staff member has
              // to learn that now, not when somebody rings to ask.
              onSuccess: (result) => {
                reportStatusOutcome(result);
                setStatusMove(null);
              },
            },
          )
        }
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          deleteTicket.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
        title={`Delete ${deleting?.ticketNumber ?? 'ticket'}?`}
        body="The repair history for the device goes with it."
        confirmLabel="Delete ticket"
        loading={deleteTicket.isPending}
        error={deleteTicket.error?.message}
      />
    </>
  );
}

export default AdminTicketsPage;
