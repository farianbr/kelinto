import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import cn from '@/lib/cn';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import { useDensity, labelSize, hintSize } from './density';
import useAnchoredPosition from '@/hooks/useAnchoredPosition';
import { popover } from '@/lib/motion';

/**
 * The listbox we draw ourselves. **This is the site's dropdown** - a native
 * `<select>` is not used anywhere a Cellvix control is expected to look like a
 * Cellvix control.
 *
 * Why it exists: the browser sizes and places a native popup itself. Against
 * the right edge of a narrow screen it renders the option list wider than its
 * trigger and lets it run off; inside a modal it is styled by the platform and
 * matches nothing around it. This panel is anchored to the trigger, clamped to
 * the viewport, and rendered in a **portal** so no scrolling or overflow-hidden
 * ancestor - a `Panel`, a modal body, a table wrapper - can clip it.
 *
 * Two shapes, one component:
 *   - **toolbar control** - `srLabel` only, no visible label. Filters, sorts.
 *   - **form field** - `label`, and `hint` / `error` under it, matching `Input`.
 *
 * Keyboard contract is the ARIA listbox one: Enter/Space/Arrow opens, Arrow keys
 * and Home/End move the active option, Enter selects, Escape closes and returns
 * focus to the trigger.
 *
 * For a field inside a react-hook-form form, use `SelectField` - it wires this
 * to a `Controller` rather than to `register`, which a non-native control cannot
 * accept.
 */
const SIZES = {
  sm: 'h-9 pl-3 pr-2.5 text-sm rounded-md',
  md: 'h-11 pl-3.5 pr-3 text-md rounded-md',
  /**
   * `md` at admin density - same padding, one step shorter.
   *
   * Not a size a caller passes: `md` resolves to this inside the panel, so a
   * select lines up with the `Input` beside it in a two-column row. A 44px
   * select next to a 36px field is exactly the ragged edge this pass exists to
   * remove, and it would appear the moment one of the two compacted alone.
   */
  mdCompact: 'h-9 pl-3.5 pr-3 text-sm rounded-md',
};

/** Height of one option row - px-2.5 py-2 around a 13px line. */
const OPTION_H = 33;

/**
 * Past this many options a menu grows its own search box.
 *
 * Nine is what fits on screen at once (the panel's max height is nine rows), so
 * the threshold is "the reader would have to scroll to see everything". Below
 * it a search box is a control in front of a list you can already read; above
 * it, scanning is the only way to find a row and that stops working long before
 * anybody files a bug about it.
 */
const SEARCH_THRESHOLD = 9;

/**
 * An option's tally, if it carries one. Rendered as its own muted column rather
 * than baked into the label, so a long label truncates without taking the
 * number with it.
 */
function Count({ value, muted }) {
  if (value === undefined || value === null) return null;
  return (
    <span className={cn('tnum shrink-0 text-xs', muted ? 'text-ink-300' : 'text-brand-700')}>
      {value}
    </span>
  );
}

export function SelectMenu({
  options = [],
  value,
  onChange,
  onBlur,
  /** Visible field label, as on `Input`. Omit for a toolbar control. */
  label,
  /** Accessible name when there is no visible label. */
  srLabel,
  hint,
  error,
  placeholder,
  disabled = false,
  size = 'sm',
  align = 'right',
  /**
   * Show a search box above the options.
   *
   * **Opt-in, and it should be on for anything backed by records.** A picker of
   * four statuses does not need one; a picker of every customer, supplier or
   * product does, and the difference is not the current row count - it is
   * whether the list grows with the business. A customer picker that is
   * comfortable at eight rows is unusable at eight hundred, and nothing warns
   * you on the way there.
   *
   * Auto-enabled past `SEARCH_THRESHOLD` rows so a list that quietly grows
   * gains the box without anybody remembering to pass this.
   */
  searchable,
  searchPlaceholder = 'Search…',
  /** A heading inside the menu, for a trigger that shows a value not a label. */
  menuTitle,
  /** A note under the options, for a consequence the list cannot show. */
  menuFootnote,
  /**
   * Let the reader add a value the list does not have, from inside the menu.
   *
   * Called with the current search text (often `''`), and the menu closes
   * straight after. What "add" means is the caller's: open a modal, push a
   * free-typed name onto the form, POST a record. This only provides the row.
   *
   * **Why it belongs in the picker.** The alternative is a separate "+ Add"
   * beside every field, which is a second control for a thing somebody only
   * wants at the moment they discover the list is missing it. They discover
   * that HERE, having just searched and found nothing - so this is where the
   * answer goes, and the query they typed is handed over rather than retyped.
   */
  onCreate,
  /** The create row's wording. `{q}` is replaced with the current search. */
  createLabel = 'Add "{q}"',
  /** The create row's wording when nothing has been typed. */
  createLabelEmpty = 'Add new',
  name,
  id: idProp,
  className,
  containerClassName,
  buttonClassName,
  /**
   * Marks the field mandatory: the red asterisk beside the label, and
   * `aria-required` on the control. Matches `Input`, so a form built from
   * both marks its required fields the same way rather than only the ones
   * that happen to be text.
   */
  required,
  /**
   * The focus target react-hook-form reaches for on a failed submit.
   *
   * A dropdown is a `<button>` and a listbox rather than a form element, so
   * `register` cannot reach it and RHF had nothing to focus - a form whose
   * only invalid field was a select reported the error and left the page
   * where it was, which is the "it throws an error and does not take me to
   * the field" complaint. `SelectField` hands `field.ref` down to here.
   */
  fieldRef,
}) {
  const density = useDensity();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [search, setSearch] = useState('');

  const containerRef = useRef(null);
  const buttonRef = useRef(null);

  /*
    One node, two refs.

    `buttonRef` is this component's own - it positions the panel and restores
    focus when the menu closes - and `fieldRef` is react-hook-form's handle on
    the same button. Assigning both from one callback keeps the internal
    behaviour untouched while letting RHF focus the field on a failed submit.
  */
  const setButtonRef = (node) => {
    buttonRef.current = node;
    if (typeof fieldRef === 'function') fieldRef(node);
    else if (fieldRef) fieldRef.current = node;
  };
  const listRef = useRef(null);
  const searchRef = useRef(null);

  const generatedId = useId();
  const id = idProp || generatedId;
  const listId = `${id}-listbox`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  /**
   * Whether this menu searches, and the rows it is showing.
   *
   * **Every index below runs against `rows`, not `options`.** Keyboard
   * movement, `aria-activedescendant` and `commit` all address the list the
   * reader can see - indexing the unfiltered array while displaying a filtered
   * one is how Enter selects a row nobody is looking at.
   */
  const hasSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    // Matched on the label because that is what the reader is reading. An
    // option whose value is an id has nothing searchable in it.
    return options.filter((option) => String(option.label ?? '').toLowerCase().includes(needle));
  }, [options, search]);

  const selectedIndex = rows.findIndex((option) => option.value === value);
  // With a placeholder an unmatched value shows the placeholder; without one it
  // falls back to the first option, which is what a filter control wants.
  const selectedOption = options.find((option) => option.value === value);
  const selected = selectedOption ?? (placeholder ? null : options[0]);

  const [panelStyle, placement] = useAnchoredPosition(buttonRef, open, {
    align,
    /**
     * Room for nine options, **plus whatever the chrome takes**.
     *
     * A title and a footnote are each about a row tall, so a menu carrying both
     * had nine rows of space for eleven rows of content and scrolled at seven
     * options - a scrollbar on a list that fits, which reads as clipped. They
     * are counted here rather than being left to push the options out.
     */
    maxHeight: OPTION_H * 9 + 8 + (menuTitle ? OPTION_H : 0) + (menuFootnote ? OPTION_H : 0),
    // Snapped to whole options: a list cut mid-row reads as clipped rather than
    // as scrollable.
    rowHeight: OPTION_H,
    padding: 8,
    matchWidth: true,
  });

  // The list is portalled, so it is not inside `containerRef` - both refs have
  // to count as "inside" or the first click on an option closes the menu.
  useOnClickOutside([containerRef, listRef], () => setOpen(false), open);

  /**
   * Opening lands the highlight on the current value, not the top of the list,
   * and puts focus where the reader is about to work - the search box when
   * there is one, the list otherwise.
   *
   * **Focused on the next frame, not in the effect body.** The panel is
   * portalled and mounts with the animation, so on the tick this effect runs
   * `searchRef` is still null - focusing it here silently did nothing and left
   * focus on the trigger, where every keystroke went to the button instead of
   * the box. The list happened to work because it is the element the effect
   * already had a ref to.
   */
  useEffect(() => {
    if (!open) return undefined;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    const frame = requestAnimationFrame(() => {
      if (hasSearch) searchRef.current?.focus();
      else listRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, selectedIndex, hasSearch]);

  // Every open starts from an empty query. A menu reopened on the last search
  // shows a filtered list with no obvious reason for the rows that are missing.
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  // Typing moves the highlight back to the top: after a keystroke the row that
  // was active is usually gone, and leaving the index where it was points it at
  // whatever happens to have shifted into that position.
  useEffect(() => {
    setActiveIndex(0);
  }, [search]);

  function close({ refocus = true } = {}) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
    onBlur?.();
  }

  function commit(index) {
    const option = rows[index];
    if (!option) return;
    onChange?.(option.value);
    close();
  }

  function onListKeyDown(event) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(rows.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        // Focus goes back to the trigger, not to nothing: the list is portalled
        // out of the DOM it belongs to, so leaving focus on <body> would step a
        // Tab out of the modal or form the control lives in. The default Tab
        // then moves on from the trigger, which is where the reader expects to
        // continue from.
        close();
        break;
      default:
        break;
    }
  }

  function onButtonKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  }

  const panel = (
    <AnimatePresence>
      {open && panelStyle && (
        <motion.ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label || srLabel}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          onKeyDown={onListKeyDown}
          variants={popover}
          initial="initial"
          animate="animate"
          exit="exit"
          style={panelStyle}
          className={cn(
            // w-max sizes to the longest label; the style's maxWidth clamps that
            // to the room actually left on screen, so it can never run off.
            'scroll-slim z-60 w-max overflow-y-auto overflow-x-hidden rounded-lg',
            // Shadowed, not bordered. A flyout sits over arbitrary page content
            // and the shadow is what separates it from whatever is underneath;
            // a hairline cannot do that over a photograph or a chart, and §2
            // allows one or the other.
            'bg-surface p-1 shadow-flyout focus:outline-none',
            // Scale from the trigger, not from the panel's own centre. The menu
            // grows out of the control that opened it - downward menus from
            // their top edge, a menu that flipped upward from its bottom - so
            // the relationship between button and panel is visible in the
            // motion rather than only in the final position. Whether anyone
            // consciously notices is not the point; details like this are what
            // separate an interface that feels considered from one that does
            // not.
            placement === 'top' ? 'origin-bottom' : 'origin-top',
          )}
        >
          {/*
            An optional heading above the options.

            For a menu whose trigger is a value rather than a label - a status
            pill on a table row shows "Diagnosis", so the menu it opens has to
            say what picking one of these does. A labelled field does not need
            it, which is why it is opt-in.
          */}
          {menuTitle && (
            // No rule under it. The panel is one quiet surface and the eyebrow
            // is already set apart by its size, weight and colour - a hairline
            // as well divides a menu of seven items into two regions, which is
            // structure this does not have.
            <li role="none" className="eyebrow px-2.5 pb-1.5 pt-1 text-ink-400">
              {menuTitle}
            </li>
          )}

          {hasSearch && (
            // Sticky, so the box stays reachable once the list scrolls. Inside
            // the listbox rather than above it, because the panel is one
            // portalled element and a box outside it would not move with it.
            <li role="none" className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 bg-surface px-1 pt-1">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={onListKeyDown}
                placeholder={searchPlaceholder}
                aria-label={`Search ${label || srLabel || 'options'}`}
                aria-controls={listId}
                autoComplete="off"
                spellCheck="false"
                className={cn(
                  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-900',
                  'placeholder:text-ink-300',
                  // The global :focus-visible ring is a box-shadow, and it would
                  // draw a brand ring inside a flyout that is already separated
                  // by its shadow. The border carries focus here instead.
                  'focus:border-ink-400 focus:shadow-none focus:outline-none',
                )}
              />
            </li>
          )}

          {rows.length === 0 && !onCreate && (
            <li role="none" className="px-2.5 py-3 text-center text-sm text-ink-400">
              Nothing matches “{search.trim()}”.
            </li>
          )}

          {/* Nothing matched, and this picker can add things.

              The sentence and the action are one row rather than a message
              with a button under it: at this moment there is exactly one
              useful thing to do, and making the reader read a dead line first
              is a step that buys nothing. */}
          {rows.length === 0 && onCreate && !search.trim() && (
            <li role="none" className="px-2.5 py-3 text-center text-sm text-ink-400">
              Nothing here yet.
            </li>
          )}

          {rows.map((option, index) => {
            const isSelected = option.value === value;

            return (
              <li key={option.value} role="none">
                <button
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onClick={() => commit(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    index === activeIndex ? 'bg-surface-2' : 'bg-transparent',
                    isSelected ? 'font-semibold text-brand-700' : 'text-ink-700',
                  )}
                >
                  {/*
                    An optional colour dot, for a list whose values already
                    carry a colour elsewhere on the screen.

                    Ticket statuses are the case: the row's own badge is
                    coloured, and a menu of plain text made the reader map
                    "Waiting for Parts" back onto amber by memory. The dot is
                    the same mark, so the menu and the row agree at a glance.

                    Opt-in per option, so a menu with no colour vocabulary
                    (provinces, methods) is unaffected.
                  */}
                  {option.dotClass && (
                    <span
                      className={cn('size-2.5 shrink-0 rounded-full', option.dotClass)}
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <Count value={option.count} muted={!isSelected} />
                  {/* The tick always holds its column - dropping it from the
                      unselected rows pulled their counts 22px right of the
                      selected one's and made the list read as ragged. */}
                  <Check
                    className={cn('size-3.5 shrink-0 text-brand', !isSelected && 'invisible')}
                    strokeWidth={2.25}
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}

          {/*
            "Add new", pinned under the options.

            Last rather than first, and ruled off: it is the answer when the
            list did not have what somebody wanted, so it sits where they end
            up after reading, not in front of the rows they came to read. It
            carries the typed query so the thing they searched for is what
            gets created, rather than making them type it a second time into
            whatever opens next.
          */}
          {onCreate && (
            <li role="none" className={cn(rows.length > 0 && 'mt-1 border-t border-line pt-1')}>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  const query = search.trim();
                  close({ refocus: false });
                  onCreate(query);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-brand-700 transition-colors hover:bg-surface-2',
                )}
              >
                <Plus className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {search.trim()
                    ? createLabel.replace('{q}', search.trim())
                    : createLabelEmpty}
                </span>
              </button>
            </li>
          )}

          {/*
            An optional note under the options.

            Reserved for a consequence the reader cannot see from the list
            itself. The ticket status menu is the case that needed it: picking
            a status messages the customer, and a menu that looks like it only
            edits a field is a menu somebody uses to tidy a board at midnight.
          */}
          {menuFootnote && (
            // Unruled, like the title. It is set apart by being smaller and
            // quieter than the options, which is enough - and a line above it
            // would read as a section break rather than as a footnote.
            <li
              role="none"
              className="mt-0.5 flex items-start gap-1.5 px-2.5 pb-1 pt-1.5 text-2xs leading-snug text-ink-400"
            >
              {menuFootnote}
            </li>
          )}
        </motion.ul>
      )}
    </AnimatePresence>
  );

  return (
    <div className={cn(label && 'w-full', containerClassName, className)}>
      {label && (
        <label
          id={`${id}-label`}
          htmlFor={id}
          className={cn(labelSize(density), 'block font-medium text-ink-700')}
          onClick={(event) => {
            // A <label> cannot forward a click to a <button>, so do it here.
            event.preventDefault();
            buttonRef.current?.focus();
          }}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div ref={containerRef} className="relative">
        <button
          ref={setButtonRef}
          id={id}
          name={name}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onButtonKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-controls={open ? listId : undefined}
          // <label for> only names a labelable element, and a button is not
          // one - without this the field's accessible name would be whichever
          // option happens to be selected. Naming it from the label AND the
          // button announces "Province, Ontario", which is both halves.
          aria-labelledby={label ? `${id}-label ${id}` : undefined}
          aria-label={label ? undefined : srLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex w-full min-w-0 cursor-pointer items-center gap-1.5 border bg-surface text-ink-900',
            'transition-[border-color,box-shadow] duration-press',
            'hover:border-line-strong',
            'focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900/15',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-400',
            // `md` becomes `mdCompact` inside the admin panel; `sm` is already
            // that height, so it is left alone.
            SIZES[size === 'md' && density === 'compact' ? 'mdCompact' : size],
            error ? 'border-danger' : 'border-line',
            open && !error && 'border-brand ring-2 ring-brand/25',
            buttonClassName,
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left',
              !selected && 'text-ink-300',
            )}
          >
            {selected?.label ?? placeholder}
          </span>
          <Count value={selected?.count} muted />
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-ink-400 transition-transform duration-fast',
              open && 'rotate-180',
            )}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </div>

      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-400">
          {hint}
        </p>
      ) : null}

      {typeof document !== 'undefined' && createPortal(panel, document.body)}
    </div>
  );
}

export default SelectMenu;
