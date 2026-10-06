import { zodResolver } from '@hookform/resolvers/zod';

/**
 * A resolver that validates what the form is going to SEND, not what it holds.
 *
 * ## The problem this exists for
 *
 * The three device forms - intake, estimate, service invoice - all keep more
 * in their state than they submit. A fresh device block seeds one blank priced
 * line so there is a row to type into, and every `onSubmit` filters those blank
 * rows back out before the payload goes anywhere. The line schemas require a
 * name (`'Name the line.'`), and a catalogue reference is either 24 characters
 * or absent, never the empty string a `<select>` emits.
 *
 * Point a plain `zodResolver` at that state and a brand-new estimate is invalid
 * the moment it opens: one untouched row, one "Name the line." against a field
 * the person was never asked to fill, and a submit that refuses over a line the
 * payload would have dropped. The form would be stricter than the server.
 *
 * So the values are normalised here first, with the same rules `onSubmit` uses,
 * and zod judges the result. What the form refuses is then exactly what the
 * server would refuse - no more, and no less.
 *
 * ## The error paths still have to line up
 *
 * Dropping a row shifts the indices of the rows after it, and RHF matches an
 * error to a field by path - so an error reported against `services.0` after a
 * filter would land on whatever row is now first, marking a line nobody
 * touched. A blank row is therefore **replaced in place** by a placeholder
 * that satisfies the line schema, rather than removed: it validates, it
 * produces no error, and every real row keeps its real index.
 *
 * ## The placeholder must not look like billable work
 *
 * That placeholder is a lie told to the line schema, and the invoice schema
 * asks a question it would otherwise answer wrongly: `requireAmountOrLines`
 * refuses an invoice that bills from neither lines nor a typed amount, and it
 * decides by counting rows. Counting placeholders, an invoice for nothing
 * looks itemised - so it submits, and fails on the server instead, which is
 * the exact failure this file exists to prevent.
 *
 * So the rule is checked here, against the real rows, before the placeholders
 * go in. The caller asks for it with `billable`, rather than this file
 * sniffing the schema for an `amount` field: reaching through `_def.schema
 * .shape` to tell an invoice from an estimate works today and is exactly the
 * kind of thing a zod upgrade breaks silently, leaving the check switched off
 * with nothing failing to say so.
 *
 * @param schema              the zod schema to validate against
 * @param options.billable    true for a document that must bill from lines or
 *                            a typed amount - the service invoice, not the
 *                            ticket or the estimate
 * @param options.optionalIds id fields whose empty string means "none" rather
 *                            than a malformed id - see `OPTIONAL_IDS`
 */
export function deviceFormResolver(schema, { billable = false, optionalIds = [] } = {}) {
  const validate = zodResolver(schema);

  return async (values, context, options) => {
    const validated = await validate(normalise(values, optionalIds), context, options);

    /*
      The placeholders come back OUT before anything is submitted.

      react-hook-form hands `onSubmit` the values this resolver returns, not the
      ones the form holds - so a blank row replaced by its placeholder below was
      posted as a real line called "x" at $0. Every form's own filter keeps a
      row with a name, and "x" has one. The placeholder only exists to get past
      zod; once zod has passed, the rows nobody touched are dropped here, by
      the same rule that made them placeholders.
    */
    const result = Object.keys(validated.errors ?? {}).length
      ? validated
      : { ...validated, values: dropBlankLines(validated.values, values) };

    if (!billable) return result;

    const errors = { ...result.errors };

    if (hasBillableLines(values) || Number(values?.amount) > 0) {
      /*
        Cleared explicitly, because nothing else will clear it.

        This error is added by hand rather than raised by zod, and RHF's
        incremental revalidation only refreshes the fields it is revalidating -
        so once a refused submit has put it in the tree, typing the very line
        that satisfies it leaves the message on screen, still telling somebody
        to add a service they have just added.
      */
      delete errors.amount;
      return { ...result, errors };
    }

    // Reported against `amount` and worded as the schema words it, so the
    // summary beside the submit reads the same whichever side caught it.
    return {
      ...result,
      errors: { ...errors, amount: { type: 'custom', message: 'Enter an amount, or add a service or part.' } },
    };
  };
}

/** Whether any row on any device has actually been filled in. */
function hasBillableLines(values) {
  return (values?.devices ?? []).some((device) =>
    [...(device?.services ?? []), ...(device?.parts ?? [])].some(isStarted),
  );
}

/**
 * The date fields that mean "not set" when they are blank.
 *
 * An empty `<input type="date">` hands back `''`, and these are all declared as
 * a `YYYY-MM-DD` pattern that is `.optional()` without also accepting an empty
 * string - so an untouched date box fails its own regex with "Use a calendar
 * date." against a field nobody filled in. Every `onSubmit` already sends these
 * as `undefined` rather than `''`, precisely because the schema wants a date or
 * nothing, so dropping them here makes the form agree with the payload.
 *
 * A due date matters most: blank is not a missing answer there, it is the
 * instruction to derive the date from the terms.
 */
const OPTIONAL_DATES = ['issuedAt', 'dueDate', 'quoteDate', 'validUntil'];

/**
 * Fields that hold a record id and mean "none" when they are blank.
 *
 * `user` on a ticket is the account the repair belongs to, and a walk-in has
 * none - the picker sits above free-text contact fields precisely so an
 * account is not required. Its schema is `length(24).optional()`, so an
 * untouched picker's `''` fails with "String must contain exactly 24
 * character(s)" - zod's own words, about a field the form calls optional.
 *
 * `onSubmit` already sends `undefined` here for the same reason, so this is
 * the payload's rule applied one step earlier.
 *
 * **Per form, not global.** `user` is optional on a ticket and REQUIRED on an
 * estimate and an invoice, which are documents addressed to somebody. Dropping
 * it everywhere would turn the quote's "Choose a customer." into a bare
 * "Required" against a field with no name - so the caller says which of its
 * own id fields are optional, and the default is none.
 */

/**
 * Form state as the payload will look: blank lines neutralised, empty
 * catalogue references dropped, unset dates omitted.
 */
function normalise(values, optionalIds = []) {
  if (!values || typeof values !== 'object') return values;

  const next = {
    ...values,
    devices: (values.devices ?? []).map((device) => ({
      ...device,
      /*
        An ungraded component is "not recorded", which is not a grade.

        The intake grid seeds every component with ''. Every part is required
        since 2026-10-02, and a blank dropped here reaches the schema as a
        missing key, so the select says "Record the screen condition." rather
        than "Pick one of the listed answers." for an answer nobody gave.
        `TicketForm`'s own submit strips the blanks too; this is the same
        filter, one step earlier, so what validates is what gets sent.
      */
      condition: Object.fromEntries(
        Object.entries(device?.condition ?? {}).filter(([, grade]) => grade),
      ),
      services: (device?.services ?? []).map(line),
      parts: (device?.parts ?? []).map(line),
    })),
  };

  for (const key of [...OPTIONAL_DATES, ...optionalIds]) {
    if (key in next && !String(next[key] ?? '').trim()) delete next[key];
  }

  return next;
}

/**
 * One priced line, cleaned.
 *
 * A row nobody has typed into becomes a placeholder that passes the line
 * schema, because it is a row the payload drops rather than a row the person
 * got wrong. A row that HAS been started is validated as it stands, so a price
 * typed against a line with no name is still reported - that one is a genuine
 * half-filled line, not an untouched one.
 *
 * `service` and `product` are the catalogue references. A picker that has not
 * been used leaves `''` behind, and both are declared as exactly 24 characters
 * or absent, so the empty string has to go rather than be sent as a malformed
 * id.
 */
/**
 * The parsed values minus every row that was blank in the form.
 *
 * Index-aligned with the form's own rows, which is why the placeholders were
 * replaced in place rather than removed: row `j` of the parsed result is row
 * `j` of what the person saw.
 */
function dropBlankLines(parsed, original) {
  if (!parsed || !Array.isArray(parsed.devices)) return parsed;

  return {
    ...parsed,
    devices: parsed.devices.map((device, index) => {
      const source = original?.devices?.[index] ?? {};
      return {
        ...device,
        services: (device.services ?? []).filter((_, j) => isStarted(source.services?.[j])),
        parts: (device.parts ?? []).filter((_, j) => isStarted(source.parts?.[j])),
      };
    }),
  };
}

function line(entry) {
  const cleaned = { ...entry };

  if (!String(cleaned.service ?? '').trim()) delete cleaned.service;
  if (!String(cleaned.product ?? '').trim()) delete cleaned.product;

  if (!isStarted(entry)) return { ...cleaned, name: 'x', priceDollars: 0, qty: 1 };

  return cleaned;
}

/**
 * Whether anybody has touched this line.
 *
 * `qty` is excluded on purpose: it seeds at 1, so counting it would make every
 * blank row look started and put "Name the line." back under all of them.
 */
function isStarted(entry) {
  if (!entry || typeof entry !== 'object') return false;

  return Boolean(
    String(entry.name ?? '').trim() ||
      String(entry.description ?? '').trim() ||
      String(entry.priceDollars ?? '').trim() ||
      String(entry.service ?? '').trim() ||
      String(entry.product ?? '').trim(),
  );
}

export default deviceFormResolver;
