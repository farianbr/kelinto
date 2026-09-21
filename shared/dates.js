/**
 * The one date format in the product: `DD-MMM-YY` - `02-Jan-26`.
 *
 * Every date a person reads goes through here - a table cell, a chart axis, an
 * invoice PDF, an email, a toast. One shape everywhere means a date is never
 * ambiguous about which number is the day: Canadian convention puts the day
 * first, and the padded day beside a three-letter month stops any reader (or
 * any locale) taking `02-01` for February.
 *
 * This is display only. A date that a machine consumes - an `<input type=
 * "date">` value, an API query parameter, a CSV column, a filename, an
 * aggregation key - stays ISO `YYYY-MM-DD`, because those are sorted, parsed
 * and round-tripped rather than read.
 *
 * `Intl` cannot emit this shape on its own: it has no dash joiner, and a
 * 2-digit year beside a short month still comes back as `Jan 2, 26`. So the
 * parts are formatted and joined by hand. `en-CA` still supplies the month
 * abbreviation, which keeps a table of month names out of this file.
 */

const DATE_PARTS = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
});

const TIME = new Intl.DateTimeFormat('en-CA', {
  hour: 'numeric',
  minute: '2-digit',
});

function parts(value) {
  const found = DATE_PARTS.formatToParts(new Date(value));
  const get = (type) => found.find((part) => part.type === type)?.value ?? '';
  // The month comes back as `Jan` in most runtimes but `Jan.` in some ICU
  // builds, and a trailing period would sit in the middle of the string.
  return { day: get('day'), month: get('month').replace('.', ''), year: get('year') };
}

/** "02-Jan-26" */
export function formatDate(value, fallback = '-') {
  if (!value) return fallback;
  const { day, month, year } = parts(value);
  if (!day) return fallback;
  return `${day}-${month}-${year}`;
}

/**
 * "02-Jan" - the same shape with the year dropped.
 *
 * Only where the surrounding context already fixes the year: a chart axis
 * walking a single range, or a notification from inside the last week.
 */
export function formatDateShort(value, fallback = '-') {
  if (!value) return fallback;
  const { day, month } = parts(value);
  if (!day) return fallback;
  return `${day}-${month}`;
}

/** "02-Jan-26, 3:20 p.m." */
export function formatDateTime(value, fallback = '-') {
  if (!value) return fallback;
  const stamp = formatDate(value, '');
  if (!stamp) return fallback;
  return `${stamp}, ${TIME.format(new Date(value))}`;
}

/**
 * Just the clock - `08:27:32`.
 *
 * For a log table that stacks the day over the time: the date repeats down the
 * page while the time is the part being scanned, so they carry different weight
 * and cannot share one line. `formatDateTime` remains the one-line form for
 * everywhere that wants a single stamp.
 */
export function formatClockTime(value, fallback = '-') {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return TIME.format(parsed);
}

/**
 * `31-Aug-26` from a `2026-08-31` string, read as a local date.
 *
 * `new Date('2026-08-31')` is UTC midnight, which prints as the 30th anywhere
 * west of Greenwich. A date-only string names a calendar day, not an instant,
 * so it is split and rebuilt in local time.
 */
export function formatIsoDate(value, fallback = '-') {
  if (!value) return fallback;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return fallback;
  return formatDate(new Date(year, month - 1, day), fallback);
}

/**
 * The inverse: a local `Date` as the ISO `YYYY-MM-DD` a date input, a query
 * parameter or an export column wants, without the UTC shift above.
 */
export function toIsoDate(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * A date RANGE as a person would say it: `Sep 1 – Sep 4, 2026`.
 *
 * The one deliberate exception to `DD-MMM-YY`. That format exists so a date in
 * a table, a cell or a document is unambiguous and sorts by eye; this is a
 * heading, read as prose, where `01-Sep-26 – 04-Sep-26` makes the reader parse
 * two padded codes to learn something they would have understood instantly in
 * words.
 *
 * The year is stated ONCE, at the end, when both ends share it - repeating it
 * is the noisiest half of the string and it carries no information the second
 * time. A range spanning a year boundary states both, because then it does.
 *
 * Both bounds are read as local calendar days, never UTC instants, for the same
 * reason `formatIsoDate` is careful about it.
 */
const RANGE_PARTS = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' });

function localDay(value) {
  if (value instanceof Date) return value;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/** `Sep 1 – Sep 4, 2026` · `Dec 28, 2025 – Jan 3, 2026` · `Sep 5, 2026` */
export function formatDateRange(from, to, fallback = '-') {
  const start = from ? localDay(from) : null;
  const end = to ? localDay(to) : null;
  if (!start && !end) return fallback;

  const part = (date) => RANGE_PARTS.format(date).replace('.', '');
  const year = (date) => date.getFullYear();

  if (start && !end) return `From ${part(start)}, ${year(start)}`;
  if (end && !start) return `Up to ${part(end)}, ${year(end)}`;

  // One day, said once.
  if (start.getTime() === end.getTime()) return `${part(start)}, ${year(start)}`;

  return year(start) === year(end)
    ? `${part(start)} – ${part(end)}, ${year(end)}`
    : `${part(start)}, ${year(start)} – ${part(end)}, ${year(end)}`;
}
