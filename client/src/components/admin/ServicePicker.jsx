import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search } from 'lucide-react';
import cn from '@/lib/cn';
import { money } from '@/lib/format';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import useAnchoredPosition from '@/hooks/useAnchoredPosition';

const ROW_H = 44;

/**
 * The add bar for services: type to search the shop's price book, pick, and
 * the line is on the document.
 *
 * Built to sit beside `InventoryPicker` and read as the same control - the
 * same field, the same list, the same keyboard - so adding a service and
 * adding a part are one gesture learned once. It lists the price book on focus
 * (a counter often scans the list rather than typing), narrows as you type,
 * and when nothing matches offers the two ways out a counter actually needs:
 * add the typed name to the price book, or bill it once without doing so.
 *
 * It never holds a value. Each pick is handed up, the field clears and the
 * list closes (client, 2026-10-06: a list left open after a pick read as the
 * pick not having landed). Focus stays on the field, so typing or a click on
 * it opens the list again for the next service.
 */
export function ServicePicker({ catalogue = [], onPick, onCreate, onCustom, placeholder, className }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listId = `${useId()}-services`;

  const typed = query.trim();

  const matches = useMemo(() => {
    const needle = typed.toLowerCase();
    const found = needle
      ? catalogue.filter((entry) => entry.name.toLowerCase().includes(needle))
      : catalogue;
    return found.slice(0, 30);
  }, [catalogue, typed]);

  // What the list offers after the matches, when something has been typed that
  // is not already an exact entry.
  const exact = matches.some((entry) => entry.name.toLowerCase() === typed.toLowerCase());
  const extras = typed && !exact
    ? [
        onCreate && { key: 'create', label: `Add “${typed}” to the service list`, run: () => onCreate(typed) },
        onCustom && { key: 'custom', label: `Bill “${typed}” once, without adding it`, run: () => onCustom(typed) },
      ].filter(Boolean)
    : [];

  const rows = [
    ...matches.map((entry) => ({ key: entry.id, entry, run: () => onPick(entry) })),
    ...extras,
  ];

  const showPanel = open && rows.length > 0;
  const [panelStyle] = useAnchoredPosition(containerRef, showPanel, {
    maxHeight: ROW_H * 7,
    padding: 8,
    matchWidth: true,
  });

  useOnClickOutside([containerRef, panelRef], () => setOpen(false), open);
  useEffect(() => setHighlight(0), [typed]);

  function choose(row) {
    row.run();
    setQuery('');
    setOpen(false);
    // No refocus here: it fired onFocus, which reopened the list in the same
    // render. The list's mousedown is cancelled instead (below), so a click on
    // a row never takes focus off the field in the first place.
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      // Enter in a search with a list open is choosing, not submitting the form.
      if (showPanel && rows[highlight]) {
        event.preventDefault();
        choose(rows[highlight]);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <span className="relative block">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400"
          strokeWidth={2.25}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Focus survives a pick, so onFocus will not fire again: a click on
          // the field is how the closed list comes back.
          onClick={() => setOpen(true)}
          // Tabbing or clicking elsewhere closes it. A click inside the list
          // never blurs the field (its mousedown is cancelled).
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-9 w-full rounded-md border border-dashed border-line-strong bg-surface pl-8 pr-2.5',
            'text-base text-ink-900 placeholder:text-ink-400 sm:text-sm',
            'transition-[border-color,box-shadow] duration-press',
            'focus:border-solid focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
          )}
        />
      </span>

      {showPanel &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            // Keeps focus on the field while a row is pressed, so the pick
            // closes the list and nothing reopens it.
            onMouseDown={(event) => event.preventDefault()}
            className="z-70 overflow-hidden rounded-md bg-surface shadow-pop"
          >
            <ul id={listId} role="listbox" className="scroll-slim max-h-78 overflow-y-auto py-1">
              {rows.map((row, index) =>
                row.entry ? (
                  <li
                    key={row.key}
                    role="option"
                    aria-selected={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(row)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2',
                      index === highlight ? 'bg-surface-2' : 'bg-transparent',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-900">{row.entry.name}</span>
                      {row.entry.description && (
                        <span className="block truncate text-2xs text-ink-400">{row.entry.description}</span>
                      )}
                    </span>
                    <span className="tnum shrink-0 text-xs font-medium text-ink-700">
                      {row.entry.price ? money(Math.round(row.entry.price * 100)) : 'No list price'}
                    </span>
                  </li>
                ) : (
                  <li
                    key={row.key}
                    role="option"
                    aria-selected={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(row)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 border-t border-line px-3 py-2 text-sm font-medium text-brand',
                      index === highlight ? 'bg-surface-2' : 'bg-transparent',
                    )}
                  >
                    <Plus className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                    <span className="min-w-0 truncate">{row.label}</span>
                  </li>
                ),
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default ServicePicker;
