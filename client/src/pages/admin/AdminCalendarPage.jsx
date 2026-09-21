import { useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Clock, Inbox, Wrench } from 'lucide-react';

import cn from '@/lib/cn';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminAppointments } from '@/hooks/useAdmin';
import { TICKET_STATUS_LABELS } from '@shared/schemas/admin';
import { pressable } from '@/lib/motion';
import SelectMenu from '@/components/ui/SelectMenu';
import { Link } from 'react-router';
import { date, dateShort } from '@/lib/format';

/**
 * The scheduling board (§6.15 category 4 - **UI only, §6b U1**, phase 11e).
 *
 * Ships as interface: the weekly board, staff filter, status legend,
 * unscheduled tray and week navigation, reading from `Appointment`, which is
 * real and ships empty (§6b rule 3). **Nothing on this screen writes**, and the
 * notice says so rather than a disabled button implying it.
 *
 * **What Cellvix schedules is a reading, not a settled fact** (§12 Q1). A
 * wholesaler has no repair calendar, but it has pickups, deliveries and RMA
 * drop-offs, and the same board serves them. That is what the status legend and
 * the tray are built around - worth re-confirming before this is wired, because
 * changing it changes the model.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/calendar'], icon: adminIcon('CalendarDays') };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Monday of the week containing `date`. */
function startOfWeek(date) {
  const out = new Date(date);
  const day = (out.getDay() + 6) % 7; // Monday = 0
  out.setDate(out.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

const STATUS_TONE = {
  unscheduled: 'neutral',
  scheduled: 'info',
  in_progress: 'warn',
  done: 'ok',
  cancelled: 'danger',
};

/**
 * The tone a ticket status carries on a job card.
 *
 * Only the ones that mean something at a glance: work that is blocked
 * (waiting for parts) and work that is finished but still here (ready to
 * pick up). Everything else is neutral, because a board where every card is
 * coloured has no colour left to say anything with.
 */
const JOB_TONE = {
  waiting_for_parts: 'warn',
  ready_to_pickup: 'ok',
  diagnosis: 'info',
};

/**
 * One unscheduled repair.
 *
 * The ticket number leads because it is what a staff member says out loud
 * and what they search by; the device is what they recognise it as. The
 * technician line reads "Unassigned" rather than going blank, since nobody
 * being on it is the actionable state and an empty row hides that.
 */
function JobCard({ job }) {
  return (
    <Link
      to={`/admin/tickets/${job.id}`}
      className={cn(
        pressable,
        'flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-left',
        'hover:border-line-strong',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-ink-900">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              job.status === 'waiting_for_parts' ? 'bg-warn' : 'bg-brand',
            )}
            aria-hidden="true"
          />
          {job.ticketNumber}
        </span>
        <Badge tone={JOB_TONE[job.status] ?? "neutral"} size="sm">
          {TICKET_STATUS_LABELS[job.status] ?? job.status}
        </Badge>
      </div>

      <span className="truncate text-sm font-medium text-ink-900">{job.device}</span>

      <span className="truncate text-xs text-ink-400">
        {job.customerName || 'No name'} · {job.technician || 'Unassigned'}
      </span>
    </Link>
  );
}

/**
 * Every open repair with no date on it.
 *
 * **Full width, under the board, not in the sidebar tray.** The tray beside
 * the calendar showed appointments only and rendered each as a title on one
 * line, so a shop with twenty devices on the bench and no bookings saw an
 * empty board above an empty tray - exactly the case where "what still needs
 * a slot" is the question. These are tickets, they are the real backlog, and
 * at this width a card can carry the four facts somebody needs to decide what
 * to schedule next.
 */
function UnscheduledJobs({ jobs, isLoading }) {
  return (
    <Panel
      className="mt-4"
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Clock className="size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
          Unscheduled jobs
          {jobs.length > 0 && (
            <Badge tone="warn" size="sm">
              {jobs.length}
            </Badge>
          )}
        </span>
      }
      description="Open repairs with no due date yet. Set one on the ticket and it appears on the board above."
    >
      {isLoading ? (
        <p className="text-sm text-ink-500">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <Wrench className="size-4 text-ink-300" strokeWidth={2} aria-hidden="true" />
          Every open repair has a date on it.
        </p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AdminCalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [staffFilter, setStaffFilter] = useState('all');

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    return end;
  }, [weekStart]);

  const { data, isLoading } = useAdminAppointments({
    from: weekStart.toISOString(),
    to: weekEnd.toISOString(),
  });

  const days = useMemo(
    () =>
      DAYS.map((label, index) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + index);
        return { label, date };
      }),
    [weekStart],
  );

  const appointments = (data?.appointments ?? []).filter(
    (row) => staffFilter === 'all' || row.staff === staffFilter,
  );

  const today = new Date().toDateString();

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      {/* §6b rule 2: a persistent notice naming what is inactive and what
          unblocks it - not a tooltip, not a disabled button's title. */}
      <p className="mb-5 flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn-50 px-3.5 py-3 text-sm leading-relaxed text-ink-700">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
        <span>
          <strong className="font-semibold">This board is not wired up yet.</strong> It reads real
          appointments and there are none - nothing on this screen creates, moves or cancels
          anything. It is built around pickups, deliveries and RMA drop-offs; that reading is
          confirmed as the intent, and the scheduling itself lands in a later phase.
        </span>
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const previous = new Date(weekStart);
              previous.setDate(previous.getDate() - 7);
              setWeekStart(previous);
            }}
            aria-label="Previous week"
            className={cn(pressable, 'flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink-600 hover:border-ink-300 hover:bg-surface-2')}
          >
            <ChevronLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>

          <span className="font-display text-md font-semibold text-ink-900">
            {dateShort(weekStart)} - {date(days[6].date)}
          </span>

          <button
            type="button"
            onClick={() => {
              const next = new Date(weekStart);
              next.setDate(next.getDate() + 7);
              setWeekStart(next);
            }}
            aria-label="Next week"
            className={cn(pressable, 'flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink-600 hover:border-ink-300 hover:bg-surface-2')}
          >
            <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className={cn(pressable, 'ml-1 inline-flex h-9 items-center rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink-600 hover:border-ink-300 hover:bg-surface-2')}
          >
            This week
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-600">
          <span className="shrink-0">Staff</span>
          <SelectMenu
            srLabel="Filter by staff member"
            value={staffFilter}
            onChange={setStaffFilter}
            options={[
              { value: 'all', label: 'Everyone' },
              ...(data?.staff ?? []).map((person) => ({ value: person.id, label: person.name })),
            ]}
          />
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
        {/* The board scrolls inside itself rather than pushing the page sideways
 - seven columns cannot fit a phone, and the page must not scroll. */}
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <div className="grid min-w-[760px] grid-cols-7 gap-2">
            {days.map(({ label, date }) => {
              const isToday = date.toDateString() === today;
              const forDay = appointments.filter(
                (row) => row.startAt && new Date(row.startAt).toDateString() === date.toDateString(),
              );

              return (
                <div
                  key={label}
                  className={cn(
                    'min-h-[280px] rounded-lg border bg-surface p-2.5',
                    isToday ? 'border-brand' : 'border-line',
                  )}
                >
                  <p
                    className={cn(
                      'mb-2 font-display text-xs font-bold tracking-wide uppercase',
                      isToday ? 'text-brand' : 'text-ink-500',
                    )}
                  >
                    {label}{' '}
                    <span className="tnum font-medium text-ink-400">{date.getDate()}</span>
                  </p>

                  {forDay.length === 0 ? (
                    <p className="text-xs text-ink-300">-</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {forDay.map((row) => (
                        <li
                          key={row.id}
                          className="rounded-md bg-surface-2 px-2 py-1.5 text-xs text-ink-700"
                        >
                          {row.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <Panel title="Unscheduled" description="Waiting for a slot.">
            {(data?.unscheduled ?? []).length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-ink-500">
                <Inbox className="size-4 text-ink-300" strokeWidth={2} aria-hidden="true" />
                Nothing waiting.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.unscheduled.map((row) => (
                  <li key={row.id} className="rounded-md bg-surface-2 px-3 py-2 text-sm">
                    {row.title}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Statuses">
            <ul className="flex flex-wrap gap-1.5">
              {(data?.statuses ?? []).map((status) => (
                <li key={status.value}>
                  <Badge tone={STATUS_TONE[status.value] ?? 'neutral'}>{status.label}</Badge>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="What this board will hold">
            <ul className="space-y-1.5 text-sm text-ink-600">
              {(data?.kinds ?? []).map((kind) => (
                <li key={kind.value} className="flex items-center gap-2">
                  <CalendarDays className="size-3.5 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                  {kind.label}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <UnscheduledJobs jobs={data?.jobs ?? []} isLoading={isLoading} />
    </>
  );
}

export default AdminCalendarPage;
