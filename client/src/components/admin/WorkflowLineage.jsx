import { Link } from 'react-router';
import { ChevronRight, ClipboardList, FileSignature, FileText, GitBranch } from 'lucide-react';
import cn from '@/lib/cn';
import { pressableSurface } from '@/lib/motion';

/**
 * The chain a repair travels: quote → ticket → invoice.
 *
 * **Not a life cycle.** This says which *other records* are the same job, not
 * where one record sits inside its own states - the status badge in the header
 * carries that. The sales documents dropped their life-cycle strip from the foot
 * (client ruling 2026-10-05); this stays at the top, because "am I even looking
 * at the right record?" is the first question a staff member arrives with.
 *
 * ## Only the stations that exist
 *
 * Each step is optional going in and single going out: a ticket is raised from
 * **at most one** quote and an invoice from **at most one** ticket, but a
 * ticket taken at the counter has no quote and an invoice raised by hand has
 * neither. A record that was never quoted is not a chain with a hole in it
 * it is a shorter chain, so the quote station is **left out** rather than
 * drawn empty. Drawing it greyed described a step that never happened and
 * asked the staff member to go looking for a quote that does not exist.
 *
 * The one station that is drawn while still empty is the record's own **next**
 * step - an uninvoiced ticket shows the Invoice station in waiting, because
 * that is a step this job genuinely still has ahead of it. Callers pass
 * `pending` to say which, and nothing else is inferred.
 *
 * ## Why the current record is not a link
 *
 * The station you are standing on is marked and inert. Making it a link to the
 * page you are already on is a dead control, and dead controls teach a
 * staff member to stop trusting the live ones beside them.
 *
 * ## The icons are the sidebar's
 *
 * `FileSignature`, `ClipboardList`, `FileText` - the same glyphs Sales uses for
 * Quotes, Tickets and Invoices. A staff member has already learned those three
 * shapes from the nav they use all day, and inventing a second vocabulary here
 * would mean the same record type had two icons depending on where it appeared.
 */

/** One rung, sized and shaped as a button. */
function Station({ icon: Icon, label, number, to, current, pending }) {
  const body = (
    <>
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          current ? 'text-brand' : pending ? 'text-ink-300' : 'text-ink-400',
        )}
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">
        <span className={cn('font-semibold', pending ? 'text-ink-300' : 'text-ink-400')}>
          {label}
        </span>
        {/* The number rides on the label's own line rather than under it. Two
            stacked lines made each station a card; a chain of records is a row
            of controls, and one line is what keeps it reading as one. */}
        {number && (
          <span
            className={cn(
              'ml-1.5 font-mono font-semibold',
              current ? 'text-brand-700' : 'text-ink-900',
            )}
          >
            {number}
          </span>
        )}
      </span>
    </>
  );

  // Button metrics, not card metrics: `h-8` and `text-xs` are what a small
  // control in this panel measures, so the row reads as three things you can
  // press rather than three panels that happen to be clickable.
  const shared =
    'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs whitespace-nowrap';

  if (current) {
    return (
      <span aria-current="page" className={cn(shared, 'border-brand bg-brand-50')}>
        {body}
      </span>
    );
  }

  // A step still ahead of this job: named, quiet, and not a control - there is
  // nothing to press until the record exists.
  if (pending) {
    return <span className={cn(shared, 'border-dashed border-line bg-surface')}>{body}</span>;
  }

  return (
    <Link
      to={to}
      className={cn(
        pressableSurface,
        shared,
        'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
      )}
    >
      {body}
    </Link>
  );
}

/**
 * @param pending  Which station to draw as this job's next step, if any
 *                 `'ticket'` or `'invoice'`. A step that is neither reached nor
 *                 pending is not drawn at all.
 */
export function WorkflowLineage({ quote, ticket, invoice, current, pending, className }) {
  const stations = [
    {
      key: 'quote',
      icon: FileSignature,
      label: 'Quote',
      number: quote?.quoteNumber ?? null,
      to: quote ? `/admin/quotes/${quote.id ?? quote.quoteNumber}` : null,
    },
    {
      key: 'ticket',
      icon: ClipboardList,
      label: 'Ticket',
      number: ticket?.ticketNumber ?? null,
      to: ticket ? `/admin/tickets/${ticket.id ?? ticket.ticketNumber}` : null,
    },
    {
      key: 'invoice',
      icon: FileText,
      label: 'Invoice',
      number: invoice?.number ?? null,
      // Invoices are addressed by number, not by id - the detail route reads
      // `:number`, so an id here would 404 on a record that exists.
      to: invoice?.number ? `/admin/invoices/${invoice.number}` : null,
    },
  ]
    // A station earns its place by existing, by being the record you are on, or
    // by being the step this job still has ahead of it. Nothing else is drawn.
    .filter(
      (station) =>
        station.number || station.key === current || station.key === pending,
    )
    .map((station) => ({ ...station, pending: !station.number }));

  return (
    <section
      aria-label="Workflow lineage"
      className={cn('rounded-lg border border-line bg-surface-2 px-3.5 py-3', className)}
    >
      <h2 className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">
        <GitBranch className="size-3.5 text-brand" strokeWidth={2.25} aria-hidden="true" />
        Workflow lineage
      </h2>

      <ol className="flex flex-wrap items-center gap-y-1.5">
        {stations.map(({ key, ...station }, index) => (
          <li key={key} className="flex items-center">
            <Station {...station} current={current === key} />

            {index < stations.length - 1 && (
              <ChevronRight
                aria-hidden="true"
                className="mx-1 size-3.5 shrink-0 text-ink-300"
                strokeWidth={2.25}
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default WorkflowLineage;
