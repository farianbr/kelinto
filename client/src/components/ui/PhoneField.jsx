import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ChevronDown, Search } from 'lucide-react';
import { AnimatePresence, motion } from '@/lib/motionReact';
import { COUNTRIES, DEFAULT_DIAL } from '@shared/countries';
import cn from '@/lib/cn';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import useAnchoredPosition from '@/hooks/useAnchoredPosition';
import { ease, pressable } from '@/lib/motion';
import { useDensity, fieldSize, labelSize, hintSize } from './density';

/**
 * The dial codes offered: every country, from the one shared list.
 *
 * This was a hand-picked seven - Canada, the US and five places suppliers were
 * expected to call from - on the reasoning that a 200-row list makes the common
 * case slower. That holds only while the list is a plain `<select>` you scroll.
 * With a search box the common case is `+1`, already selected, and the long tail
 * costs one keystroke instead of being impossible: a customer in Lagos or Lima
 * simply could not enter their number before.
 */
export { COUNTRIES };

/** Kept for callers that imported the old constant. Now every country. */
export const DIAL_CODES = COUNTRIES.map((entry) => ({
  code: entry.dial,
  label: entry.name,
}));

const DEFAULT_CODE = DEFAULT_DIAL;

/**
 * The country menu's sizes, by density.
 *
 * The menu used to be one size everywhere, a 36px row of 13px text. That is
 * right beside a desktop form and too small on the kiosk, where the field above
 * it is 64px and somebody is reaching out to a tablet on a stand: the rows were
 * a third of the height of every other target on the screen. Only `touch`
 * grows; the storefront and the ERP keep the size they always had.
 *
 * `rowH` is the row's real height (padding plus line), so the panel's height
 * cap stays in step with the rows it holds.
 */
const MENU_SIZES = {
  touch: {
    rowH: 56,
    panel: 'w-96',
    list: 'max-h-84',
    row: 'px-4 py-3.5 text-lg',
    dial: 'w-16',
    search: 'h-12 pl-10 pr-3 text-lg',
    searchIcon: 'left-3.5 size-4',
    note: 'px-4 py-3 text-md',
  },
  default: {
    rowH: 36,
    panel: 'w-[300px]',
    list: 'max-h-72',
    row: 'px-3 py-2 text-sm',
    dial: 'w-[52px]',
    search: 'h-9 pl-8 pr-2.5 text-sm',
    searchIcon: 'left-2.5 size-3.5',
    note: 'px-3 py-2 text-xs',
  },
};

/**
 * How many countries render before somebody searches.
 *
 * Deep enough that scrolling still feels like a list rather than a stub, small
 * enough that opening the menu is not 240 row mounts. Everything past it is one
 * keystroke away in the search box, which is where a country this far down the
 * alphabet was always going to be found.
 */
const VISIBLE_WITHOUT_SEARCH = 40;

/**
 * Formats the national part as it is typed.
 *
 * NANP (`+1`) is the only plan formatted, because it is the only one whose
 * grouping is fixed at 3-3-4 - every other code here groups differently by
 * region, and guessing wrong is worse than not guessing. So the rest are
 * digits-only with a length cap, which still stops letters and stray
 * punctuation reaching the server.
 */
export function formatNational(value, dial = DEFAULT_CODE) {
  const digits = String(value ?? '').replace(/\D/g, '');

  if (dial !== '+1') return digits.slice(0, 15);

  const local = digits.slice(0, 10);
  if (local.length <= 3) return local;
  if (local.length <= 6) return `${local.slice(0, 3)} ${local.slice(3)}`;
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

/** `+1` + `780 123 4567` -> `+1 780 123 4567`. Empty national part means empty. */
export function composePhone(dial, national) {
  const trimmed = String(national ?? '').trim();
  return trimmed ? `${dial} ${trimmed}` : '';
}

/**
 * Splits a stored phone back into a dial code and a national part.
 *
 * Needed because the two halves are a UI affordance over one stored string:
 * `User.phone` is a single field that invoices, orders and the admin screens
 * all read, and splitting it in the model would have rippled through every one
 * of them for no gain. So the form composes on the way out and this splits on
 * the way back in.
 *
 * **Only the code comes back, not the country.** `+1` is Canada, the US and
 * eighteen others; a stored number cannot say which, so guessing one would show
 * a customer in Barbados that we think they are Canadian. The picker shows the
 * code, and the country is only ever what somebody actually chose this session.
 */
export function splitPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { dial: DEFAULT_CODE, national: '' };

  // Longest code first, so `+1` cannot claim a `+1...` prefix of a longer code.
  const codes = [...new Set(COUNTRIES.map((entry) => entry.dial))].sort(
    (a, b) => b.length - a.length,
  );
  const match = codes.find((code) => raw.startsWith(code));

  if (!match) return { dial: DEFAULT_CODE, national: formatNational(raw, DEFAULT_CODE) };

  const rest = raw.slice(match.length);
  return { dial: match, national: formatNational(rest, match) };
}

/**
 * The country-code picker: a searchable listbox, not a native `<select>`.
 *
 * A native popup was fine for seven rows and is unusable for two hundred - the
 * platform gives no way to type past the first letter, so finding Switzerland
 * meant scrolling through everything above it. The search box is the whole
 * reason the full list is affordable, and it matches on **both** the name and
 * the code, because somebody who knows they are `+44` should not have to
 * remember what we called their country.
 *
 * Portalled and anchored for the same reason `SelectMenu` is: this field lives
 * inside a modal with its own scroll container, and a menu in the normal flow
 * would be clipped by it.
 */
function CountryCodeMenu({ dial, onSelect, disabled, density }) {
  const size = MENU_SIZES[density] ?? MENU_SIZES.default;
  const touch = density === 'touch';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const listId = `${useId()}-countries`;

  /**
   * The rows to draw. Capped, because mounting all ~240 at once is what made
   * opening the menu feel slow - every one is a flex row with its own text
   * nodes, and only eight are ever on screen.
   *
   * The cap applies to the **unsearched** list only, and it is not a limit on
   * what is reachable: the search box is the way past row 40, and a query
   * always filters the full list. So the long tail costs a keystroke rather
   * than a stutter on every open.
   */
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return COUNTRIES.slice(0, VISIBLE_WITHOUT_SEARCH);
    // A leading `+` is noise for matching - `+44` and `44` are the same query.
    const bare = needle.replace(/^\+/, '');
    return COUNTRIES.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) || entry.dial.replace('+', '').startsWith(bare),
    );
  }, [search]);

  /** True when the cap is hiding countries a search would still find. */
  const capped = !search.trim() && COUNTRIES.length > VISIBLE_WITHOUT_SEARCH;

  const [panelStyle] = useAnchoredPosition(buttonRef, open, {
    align: 'left',
    maxHeight: size.rowH * (touch ? 6 : 8) + (touch ? 76 : 60),
    padding: 8,
    // The panel sizes itself rather than matching the trigger: the code button
    // is about 64px wide and the list has to fit "Saint Vincent and the
    // Grenadines" without truncating every long name in it.
    matchWidth: false,
  });

  useOnClickOutside([containerRef, panelRef], () => setOpen(false), open);

  // Opening focuses the search box, so the list is typeable straight away
  // that is the point of it. The highlight starts at the top of the matches.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setActiveIndex(0);
    // After the panel has painted, or there is nothing to focus yet.
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  /**
   * Keep the arrow-highlighted row in view - **without** `scrollIntoView`.
   *
   * `scrollIntoView` scrolls every scrollable ancestor, not just the list, so
   * opening the menu yanked the page underneath it: the panel is portalled to
   * `document.body`, and "bring this row into view" is then partly a statement
   * about the document. It also ran on open, when the highlight is already at
   * the top and nothing needs moving at all.
   *
   * Setting `scrollTop` on the list touches that one element and nothing else.
   * The guard makes the common case free: while the row is already visible
   * which it is for every keystroke that does not walk off an edge - this
   * writes nothing.
   */
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const row = list?.children?.[activeIndex];
    if (!list || !row) return;

    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;

    if (rowTop < list.scrollTop) list.scrollTop = rowTop;
    else if (rowBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowBottom - list.clientHeight;
    }
  }, [activeIndex, open]);

  function close({ refocus = true } = {}) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function commit(index) {
    const entry = matches[index];
    if (!entry) return;
    onSelect(entry.dial);
    close();
  }

  function onSearchKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit(activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(matches.length - 1);
    }
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country calling code, ${dial}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          touch ? 'gap-1.5 pl-4 pr-3' : 'gap-1 pl-3 pr-2.5',
          // The code takes the number's size from the shell, like the input
          // beside it. It had its own 16/14px, which on the kiosk put a small
          // `+1` next to a 20px number and read as two different fields.
          'flex h-full items-center py-0 tnum text-[length:inherit] text-ink-900',
          pressable,
          // Same clipped-ring problem as the number input. The shell rings on
          // focus either way, so the tint is what says the code has it.
          'focus:shadow-none focus:outline-none focus-visible:bg-surface-2',
          'hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-ink-400',
        )}
      >
        {dial}
        <ChevronDown
          className={cn(
            touch ? 'size-4' : 'size-3.5',
            'shrink-0 text-ink-400 transition-transform duration-press',
            open && 'rotate-180',
          )}
          strokeWidth={2.25}
          aria-hidden="true"
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12, ease: ease.entrance }}
              style={panelStyle}
              className={cn(
                'z-[70] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg bg-surface shadow-pop',
                size.panel,
              )}
            >
              {/* The search box is pinned above the scrolling list rather than
                  scrolling with it: it is the control that makes a 200-row list
                  usable, and one that scrolls out of reach is not there when it
                  is needed. */}
              <div className="border-b border-line p-2">
                <div className="relative">
                  <Search
                    className={cn(
                      'pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-400',
                      size.searchIcon,
                    )}
                    strokeWidth={2.25}
                    aria-hidden="true"
                  />
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      matches[activeIndex] ? `${listId}-${matches[activeIndex].code}` : undefined
                    }
                    placeholder="Search country or code"
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setActiveIndex(0);
                    }}
                    onKeyDown={onSearchKeyDown}
                    className={cn(
                      'w-full rounded-md border border-line bg-surface',
                      size.search,
                      'text-ink-900 placeholder:text-ink-300',
                      'transition-[border-color,box-shadow] duration-press',
                      'focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900/15',
                    )}
                  />
                </div>
              </div>

              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label="Country calling code"
                className={cn('scroll-slim overflow-y-auto py-1', size.list)}
              >
                {matches.map((entry, index) => (
                  <li
                    key={entry.code}
                    id={`${listId}-${entry.code}`}
                    role="option"
                    aria-selected={entry.dial === dial}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3',
                      size.row,
                      index === activeIndex ? 'bg-surface-2' : 'bg-transparent',
                    )}
                  >
                    <span
                      className={cn(
                        'tnum shrink-0 font-medium',
                        size.dial,
                        entry.dial === dial ? 'text-brand' : 'text-ink-500',
                      )}
                    >
                      {entry.dial}
                    </span>
                    <span className="truncate text-ink-900">{entry.name}</span>
                  </li>
                ))}

                {matches.length === 0 && (
                  <li className={cn(size.row, 'py-6 text-center text-ink-400')}>
                    No country matches “{search}”.
                  </li>
                )}

              </ul>

              {/* Outside the listbox, not a row in it: a `<li>` here would be
                  an option the arrow keys could land on and `commit` could not
                  resolve. It says the short list is deliberate - without it the
                  menu looks like it simply does not have your country. */}
              {capped && (
                <p className={cn('border-t border-line text-ink-400', size.note)}>
                  Type to search all {COUNTRIES.length} countries.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/**
 * A phone field split into a country code and an auto-formatted number.
 *
 * One control, not two form fields: `value` in and out is the single composed
 * string the schema and the model already expect (`+1 780 123 4567`), so
 * nothing downstream has to know this is two inputs. The caller holds one
 * value, exactly as it would for a plain `Input`.
 *
 * The two halves share one bordered shell so they read as one field rather than
 * as a select that happens to sit beside a text box - the divider is an inner
 * border, and focus rings the whole shell.
 */
export const PhoneField = forwardRef(function PhoneField(
  {
    label,
    value = '',
    onChange,
    onBlur,
    error,
    hint,
    required,
    name,
    id: idProp,
    disabled,
    placeholder = '780 123 4567',
    containerClassName,
  },
  ref,
) {
  const generatedId = useId();
  const id = idProp || generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  /**
   * Height, label and hint from the density in scope - like every other field.
   *
   * This component hardcoded `h-11` and a 14px label, so inside `/admin` it
   * stood 8px taller than the `Input`s beside it: on the ticket intake form the
   * Phone control sat visibly low against Customer name and Email, and its
   * label was a step larger than theirs. A field that ignores the density
   * context breaks the row it is in, and the row is what the staff member reads.
   */
  const density = useDensity();

  const { dial: parsedDial, national } = splitPhone(value);

  /**
   * The chosen code, remembered while the number is still empty.
   *
   * `value` is one composed string and `composePhone` returns `''` when there
   * is no number yet - there is no `+44 ` to store - so a code picked before
   * the digits were typed round-tripped straight back to `+1`. Somebody
   * choosing their country first, which is the natural order, watched the
   * field undo their choice.
   *
   * The stored value still wins whenever there is one, so this never disagrees
   * with what the form holds: it only fills the gap while the number is blank.
   */
  const [pendingDial, setPendingDial] = useState(null);
  const dial = national ? parsedDial : (pendingDial ?? parsedDial);

  return (
    <div className={cn('w-full', containerClassName)}>
      {label && (
        <label
          htmlFor={id}
          className={cn(labelSize(density), 'block font-medium text-ink-700')}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div
        className={cn(
          'flex w-full items-stretch overflow-hidden rounded-md border bg-surface',
          'transition-[border-color,box-shadow] duration-press',
          // The same hover and focus as `Input`, `Textarea` and `Select`.
          // This field alone went brand purple on focus, so in any form with a
          // phone in it one field lit up in a different colour from the rest.
          'hover:border-line-strong',
          'focus-within:border-ink-400 focus-within:ring-2 focus-within:ring-ink-900/15',
          error ? 'border-danger focus-within:border-danger focus-within:ring-danger/20' : 'border-line',
          disabled && 'cursor-not-allowed bg-surface-2',
          // `fieldSize` carries the height AND the text size; the height
          // belongs on this wrapper and the text on the `input` inside it, so
          // the pair is applied across both rather than duplicated.
          fieldSize(density),
        )}
      >
        <CountryCodeMenu
          dial={dial}
          disabled={disabled}
          density={density}
          onSelect={(next) => {
            setPendingDial(next);
            onChange?.(composePhone(next, formatNational(national, next)));
          }}
        />

        <span className="my-1.5 w-px shrink-0 bg-line" aria-hidden="true" />

        <input
          ref={ref}
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onBlur={onBlur}
          onChange={(event) => onChange?.(composePhone(dial, formatNational(event.target.value, dial)))}
          className={cn(
            // No font size of its own: `text-[length:inherit]` takes whatever
            // `fieldSize` put on the wrapper, so the number matches the other
            // fields at both densities and one place decides it. The `length:`
            // hint is load-bearing - a bare `text-inherit` is a COLOUR utility
            // in Tailwind and would fight `text-ink-900` beside it.
            'h-full min-w-0 flex-1 bg-transparent px-3 text-[length:inherit] text-ink-900',
            // `focus:shadow-none` clears the global `:focus-visible` ring,
            // which the shell's `overflow-hidden` clipped to a purple sliver
            // down the divider. Focus stays visible: the shell rings instead.
            'placeholder:text-ink-300 focus:shadow-none focus:outline-none',
            'disabled:cursor-not-allowed disabled:text-ink-400',
          )}
        />
      </div>

      {error ? (
        <p id={`${id}-error`} className={cn(hintSize(density), 'flex items-center gap-1.5 text-danger')}>
          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={cn(hintSize(density), 'text-ink-400')}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default PhoneField;
