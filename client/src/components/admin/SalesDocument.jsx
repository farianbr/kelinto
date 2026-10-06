import { Link } from 'react-router';
import {
  ArrowRight,
  ClipboardCheck,
  History,
  Info,
  Lock,
  Mail,
  Phone,
  Smartphone,
  StickyNote,
  UserRound,
  Wallet,
  Wrench,
} from 'lucide-react';

import { INVOICE_SERVICE_TYPES } from '@shared/schemas/admin';
import {
  CONDITION_PARTS,
  conditionAnswered,
  conditionLabel,
  conditionProblems,
  isConditionGood,
} from '@shared/deviceCondition';
import cn from '@/lib/cn';
import { money, dateTime } from '@/lib/format';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import { useTableClasses } from '@/components/admin/DataTable';

/**
 * The parts of a sales document's detail page: the ticket, the quote and
 * the invoice.
 *
 * **One set, because they are one job** (client ruling 2026-10-05: "front-end
 * design for ticket, quote and invoice would be the same"). The three screens
 * had grown three layouts for the same facts - the ticket a single column with
 * the totals inside its lines panel, the quote a KPI strip over two columns,
 * the invoice a payments page that never showed what was billed - so a staff
 * member following a repair from quote to invoice re-learned the page at
 * every step.
 *
 * ## The layout, and why it is this one
 *
 * Two columns at desktop. **The wide one is the work**: what is being done to
 * which device, in the order a technician reads it, then the notes, then the
 * history. **The narrow one answers the three questions somebody at the
 * counter is asked**: what does it come to, whose is it, and when. Each page
 * puts its own working panel first in the wide column (a ticket's status, an
 * invoice's payments); everything after it is these components, in this order.
 *
 * Below `lg` the narrow column drops under the wide one rather than squeezing
 * beside it, so a phone reads the work first and the totals after.
 */

/** Two columns: the work, and the facts beside it. */
export function DocumentLayout({ main, aside }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">{main}</div>
      <div className="min-w-0 space-y-4">{aside}</div>
    </div>
  );
}

/** "Walk-in", "On-site Repair" - the label a select shows, never the stored key. */
export function serviceTypeLabel(value) {
  return INVOICE_SERVICE_TYPES.find((entry) => entry.value === value)?.label ?? null;
}

/**
 * A device's name as the counter says it.
 *
 * The series is left out when the model already says it: the device tree
 * stores "iPhone 15" and then "iPhone 15 Pro Max" beneath it, and joining all
 * three read "Apple iPhone 15 iPhone 15 Pro Max".
 */
function deviceName(device, index) {
  const model = device.model ?? '';
  const series = device.series && !model.toLowerCase().includes(device.series.toLowerCase()) ? device.series : '';
  return [device.brand, series, model].filter(Boolean).join(' ') || `Device ${index + 1}`;
}

/**
 * Problem, solution and the device's own note, side by side.
 *
 * The problem is what the customer came in with, so it leads and is the only
 * one shown when the others are blank - an empty "Solution" box on a ticket
 * nobody has diagnosed yet is a heading for a fact that does not exist.
 */
function DeviceText({ device }) {
  const blocks = [
    { key: 'problem', label: 'Problem', value: device.problem },
    { key: 'solution', label: 'Solution', value: device.solution },
    { key: 'notes', label: 'Notes', value: device.notes },
  ].filter((block) => String(block.value ?? '').trim());

  if (!blocks.length) return null;

  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {blocks.map((block) => (
        <div key={block.key} className={cn(blocks.length === 1 && 'sm:col-span-3')}>
          <dt className="eyebrow text-ink-400">{block.label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">{block.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The drop-off grid, as recorded.
 *
 * Every part is listed, the good ones in plain ink and the rest in warn, so a
 * dispute about the back glass is answered by reading one row rather than by
 * working out that a missing row meant "fine".
 */
function ConditionGrid({ condition }) {
  if (!conditionAnswered(condition)) return null;

  return (
    <div>
      <p className="eyebrow mb-1.5 flex items-center gap-1.5 text-ink-400">
        <ClipboardCheck className="size-3.5 text-brand" strokeWidth={2.25} aria-hidden="true" />
        Condition at drop-off
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        {CONDITION_PARTS.map((part) => {
          const value = condition?.[part.key];
          return (
            <div key={part.key} className="flex min-w-0 items-baseline justify-between gap-2 sm:block">
              <dt className="text-ink-400">{part.label}</dt>
              <dd className={cn('font-medium', value && !isConditionGood(value) ? 'text-warn' : 'text-ink-700')}>
                {value ? conditionLabel(part.key, value) : '–'}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/**
 * The condition as the CUSTOMER described it at the kiosk.
 *
 * A claim, not a test, so it is labelled as whose it is and kept out of the
 * counter's own grid. Only the parts that are not "works" are listed, because
 * those are the ones worth checking first.
 */
function CustomerCondition({ condition }) {
  if (!conditionAnswered(condition)) return null;
  return (
    <p className="border-l-2 border-line-strong pl-2.5 text-sm text-ink-600">
      <span className="font-medium text-ink-900">Customer says: </span>
      {conditionProblems(condition) || 'everything is good'}
    </p>
  );
}

/** The priced lines on one device, as a line-item table (§3.2). */
function DeviceLinesTable({ device }) {
  const t = useTableClasses();
  const lines = [
    ...(device.services ?? []).map((line) => ({ ...line, kind: 'Service' })),
    ...(device.parts ?? []).map((line) => ({ ...line, kind: 'Part' })),
  ];

  if (!lines.length) {
    return <p className="text-sm text-ink-400">Nothing priced on this device yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-105 text-left">
        <thead>
          <tr className={t.headRow}>
            <th scope="col" className={t.headCell()}>
              Item
            </th>
            <th scope="col" className={cn(t.headCell('right'), 'w-14')}>
              Qty
            </th>
            <th scope="col" className={cn(t.headCell('right'), 'w-24')}>
              Price
            </th>
            <th scope="col" className={cn(t.headCell('right'), 'w-24')}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.kind}-${index}`} className={t.row}>
              <td className={t.cell()}>
                <span className="flex items-baseline gap-2">
                  <Badge tone={line.kind === 'Service' ? 'info' : 'neutral'} size="sm">
                    {line.kind}
                  </Badge>
                  <span className="min-w-0 text-sm text-ink-900">{line.name}</span>
                </span>
                {line.description && (
                  <span className="mt-0.5 block text-xs text-ink-400">{line.description}</span>
                )}
              </td>
              <td className={cn(t.cell('right'), 'tnum text-ink-500')}>{line.qty ?? 1}</td>
              <td className={cn(t.cell('right'), 'tnum text-ink-500')}>{money(line.priceCents ?? 0)}</td>
              <td className={cn(t.cell('right'), 'tnum font-medium text-ink-900')}>
                {money((line.priceCents ?? 0) * (line.qty ?? 1))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every device on the document: what it is, what is wrong with it, what is
 * being done, and what that costs.
 *
 * `showCondition` is the ticket's: the grid is graded with the hardware on the
 * counter, which a quote never had and an invoice is not describing.
 */
export function DocumentDevices({ devices = [], showCondition = false, showPasscode = false }) {
  return (
    <Panel icon={Wrench} title="Devices and services">
      {devices.length === 0 ? (
        <p className="text-sm text-ink-400">No devices on this document.</p>
      ) : (
        <div className="space-y-5">
          {devices.map((device, index) => (
            <article
              key={index}
              className={cn('space-y-3', index > 0 && 'border-t border-line pt-5')}
            >
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 font-display text-md font-bold text-ink-900">
                    <Smartphone className="size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
                    {deviceName(device, index)}
                  </h3>
                  {(device.serial || (showPasscode && device.passcode)) && (
                    <p className="mt-0.5 text-xs text-ink-500">
                      {device.serial && (
                        <>
                          Serial <span className="font-mono text-ink-700">{device.serial}</span>
                        </>
                      )}
                      {device.serial && showPasscode && device.passcode && ' · '}
                      {showPasscode && device.passcode && (
                        <>
                          Passcode <span className="font-mono text-ink-700">{device.passcode}</span>
                        </>
                      )}
                    </p>
                  )}
                </div>
                {device.category && <Badge tone="neutral">{device.category}</Badge>}
              </header>

              <DeviceText device={device} />
              {showCondition && <CustomerCondition condition={device.customerCondition} />}
              {showCondition && <ConditionGrid condition={device.condition} />}
              <DeviceLinesTable device={device} />
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * The document's three notes, by audience.
 *
 * The two the customer sees come first and read as the document's own text;
 * the internal one is set apart by a rule on its leading edge and says it
 * never prints, which is the whole point of there being three. A rule rather
 * than a tinted box (§2.0): coloured text on its own wash is this app's least
 * readable pairing, and it would make a technician's note read as an alarm.
 */
export function DocumentNotes({ clientNotes, technicianNotes, internalNotes, clientLabel = 'Client notes' }) {
  const shown = [clientNotes, technicianNotes, internalNotes].some((note) => String(note ?? '').trim());
  if (!shown) return null;

  return (
    <Panel icon={StickyNote} title="Notes">
      <div className="space-y-4">
        {String(clientNotes ?? '').trim() && (
          <div>
            <p className="eyebrow text-ink-400">{clientLabel}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">{clientNotes}</p>
          </div>
        )}
        {String(technicianNotes ?? '').trim() && (
          <div>
            <p className="eyebrow text-ink-400">Technician notes</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">{technicianNotes}</p>
          </div>
        )}
        {String(internalNotes ?? '').trim() && (
          <div className="border-l-2 border-warn pl-3">
            <p className="eyebrow flex items-center gap-1.5 text-warn">
              <Lock className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              Internal notes · never printed
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">{internalNotes}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * What the document comes to.
 *
 * `rows` lead to the total, which is the one figure set large: it is the
 * number somebody reads out across a counter. `after` is what follows the
 * total without being part of it - money already taken, and what is left.
 */
export function DocumentSummary({ rows = [], total, after = [], footnote }) {
  return (
    <Panel icon={Wallet} title="Summary">
      <dl className="space-y-1.5 text-sm">
        {rows
          .filter(Boolean)
          .map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">
                {row.label}
                {row.hint && <span className="ml-1 text-xs text-ink-400">{row.hint}</span>}
              </dt>
              <dd className={cn('tnum', row.tone === 'ok' ? 'text-ok' : 'text-ink-900')}>{row.value}</dd>
            </div>
          ))}

        <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
          <dt className="font-display font-bold text-ink-900">{total.label ?? 'Total'}</dt>
          <dd className="tnum font-display text-xl font-bold text-ink-900">{total.value}</dd>
        </div>

        {after.filter(Boolean).map((row) => (
          <div
            key={row.label}
            className={cn(
              'flex items-baseline justify-between gap-3',
              row.strong && 'border-t border-line pt-1.5 font-semibold text-ink-900',
            )}
          >
            <dt className={row.strong ? undefined : 'text-ink-500'}>{row.label}</dt>
            <dd className={cn('tnum', row.tone === 'danger' && 'text-danger')}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {footnote && <p className="mt-3 text-xs text-ink-400">{footnote}</p>}
    </Panel>
  );
}

/** Whose document it is, and how to reach them. */
export function DocumentCustomer({ name, phone, email, userId, business, phoneNote }) {
  return (
    <Panel
      icon={UserRound}
      title="Customer"
      action={
        userId && (
          <Link
            to={`/admin/clients/${userId}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
          >
            Profile
            <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          </Link>
        )
      }
    >
      <p className="font-display text-md font-bold text-ink-900">{name || 'No customer'}</p>
      {business && business !== name && <p className="text-sm text-ink-500">{business}</p>}

      {(phone || email) && (
        <div className="mt-2 space-y-1.5 text-sm text-ink-600">
          {phone && (
            <p className="flex items-center gap-1.5">
              <Phone className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
              <a href={`tel:${phone}`} className="hover:text-ink-900">
                {phone}
              </a>
              {phoneNote && <span className="text-ink-400">· {phoneNote}</span>}
            </p>
          )}
          {email && (
            <p className="flex min-w-0 items-center gap-1.5">
              <Mail className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
              <a href={`mailto:${email}`} className="truncate hover:text-ink-900">
                {email}
              </a>
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/** The document's dates and labels, as one short list. Blank rows are left out. */
export function DocumentFacts({ items = [] }) {
  const shown = items.filter((item) => item && item.value != null && item.value !== '');
  if (!shown.length) return null;

  return (
    <Panel icon={Info} title="Details">
      <dl className="space-y-2 text-sm">
        {shown.map((item) => (
          <div key={item.label} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-ink-500">{item.label}</dt>
            <dd className="min-w-0 truncate text-right text-ink-900">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/**
 * What happened to the document, newest first.
 *
 * `entries` are `{ key, title, note, at, by }`. One shape for the ticket's
 * timeline, the quote's and the invoice's audit trail, so the three read as
 * one list rather than three.
 */
export function DocumentHistory({ entries = [], empty = 'No history yet.', description }) {
  return (
    <Panel icon={History} title="History" description={description} flush={entries.length > 0}>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.key} className="flex items-start gap-2.5 px-4 py-2.5 sm:px-5">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">{entry.title}</p>
                {entry.note && <p className="mt-0.5 text-sm text-ink-500">{entry.note}</p>}
              </div>
              <p className="shrink-0 text-right text-xs text-ink-400">
                {dateTime(entry.at)}
                {entry.by && <span className="block">{entry.by}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
