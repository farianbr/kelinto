import { useRef, useState } from 'react';
import { ChevronDown, Download, Search, SlidersHorizontal, X } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import useOnClickOutside from '@/hooks/useOnClickOutside';

/**
 * The filter strip above every admin list (ERP rework §4, convention 8):
 * search · segmented pills with counts · `Filters ▾` · `Export ▾`.
 *
 * Pills are the primary filter and carry their counts, because "Pending (3)" is
 * the number a staff member is actually looking for. `Filters ▾` holds the long
 * tail - province, terms, date - in a popover, so the strip stays one line.
 *
 * **Export honours the current filters.** The component passes them to the
 * handler rather than exporting the unfiltered set; an export that ignores the
 * active filters is a bug, not a shortcut (§7.4).
 */

function Popover({ label, icon: Icon, children, align = 'left', badge }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOnClickOutside(ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          pressable,
          'flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium',
          badge
            ? 'border-brand-100 bg-brand-50 text-brand-700'
            : 'border-line bg-surface text-ink-600 hover:border-line-strong hover:text-ink-900',
        )}
      >
        {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />}
        {label}
        {badge > 0 && (
          <span className="tnum rounded-full bg-brand px-1.5 text-2xs font-semibold leading-[16px] text-white">
            {badge}
          </span>
        )}
        <ChevronDown className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute top-full z-20 mt-1 min-w-[220px] rounded-md bg-surface p-3 shadow-card',
            // Never wider than the window. The panel is absolutely positioned,
            // so without a cap it pushes the document wider than the viewport
            // and the whole page gains a horizontal scrollbar - which is what
            // a filter panel opening near the right edge actually did.
            'max-w-[calc(100vw-24px)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onClick={(event) => {
            // A menu of one-shot actions closes on pick; a panel of filters
            // stays open so several can be set in one go.
            if (event.target.closest('[data-close-on-select]')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function FilterStrip({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  pills = [],
  activePill,
  onPillChange,
  filters,
  activeFilterCount = 0,
  onClearFilters,
  exportFormats = ['CSV', 'XLSX'],
  onExport,
  actions,
  /**
   * Put the status pills on their own row above the search.
   *
   * For a board with eight or nine statuses - the ticket queue - squeezing them
   * onto one line with a search box and two menus means they scroll sideways,
   * and a filter a staff member has to scroll to find is one they stop using. A
   * list with four pills reads better on a single line, so this is opt-in
   * rather than the default.
   */
  stackPills = false,
  className,
}) {
  const pillRow = pills.length > 0 && (
    <div className="scroll-slim flex max-w-full gap-1.5 overflow-x-auto">
      {pills.map((pill) => {
        const isActive = activePill === pill.value;

        return (
          <button
            key={pill.value}
            type="button"
            onClick={() => onPillChange?.(pill.value)}
            aria-pressed={isActive}
            className={cn(
              pressable,
              'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm font-medium',
              /**
               * The active pill carries the brand gradient.
               *
               * The COMPACT ramp, not the full one: the full ramp opens at
               * near-black, and across an 80px pill that first third reads as a
               * stray dark stripe down one side rather than as depth. The
               * compact ramp starts at the deep red instead - same identity, no
               * stripe.
               *
               * The active pill also has **no border at all**, not a
               * transparent one. `border-transparent` still reserves the border
               * box, so the two states would differ in width and the row would
               * shift as the filter changed; the inactive pill carries its own
               * `border` and the active one gets that pixel back as padding.
               */
              isActive
                ? 'bg-brand-gradient-compact px-2.75 text-white'
                : 'border border-line bg-surface text-ink-600 hover:border-line-strong hover:text-ink-900',
            )}
          >
            {pill.label}
            {/* The count is a fixed-width chip, not loose text beside the
                label. As bare digits it sat on the label's baseline and
                took its own width, so `All 128` and `Pending 3` put their
                numbers at different offsets and the pill row read as
                ragged. A centred chip with a `min-w` of two digits keeps
                every count in the same place regardless of magnitude, and
                `tabular-nums` stops 1s from being narrower than 8s. */}
            {pill.count != null && (
              <span
                className={cn(
                  'tnum inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-2xs font-semibold leading-none',
                  isActive ? 'bg-white/20 text-white' : 'bg-surface-3 text-ink-500',
                )}
              >
                {pill.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  if (stackPills) {
    return (
      <div className={className}>
        <div className="border-b border-line p-3 sm:px-4">{pillRow}</div>
        <FilterStrip
          search={search}
          onSearchChange={onSearchChange}
          searchPlaceholder={searchPlaceholder}
          filters={filters}
          activeFilterCount={activeFilterCount}
          onClearFilters={onClearFilters}
          exportFormats={exportFormats}
          onExport={onExport}
          actions={actions}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2 border-b border-line p-3 sm:px-4', className)}>
      {onSearchChange && (
        /* Sized, not stretched. `flex-1` let the field absorb every pixel the
           pills and menus did not use, so on a wide screen it became a
           600px-wide box for a search term nobody types more than three words
           into - and it pushed the pills, which are the primary filter, far
           from the eye. It stays flexible below its cap so a narrow screen can
           still shrink it. */
        <div className="relative w-full min-w-[180px] shrink sm:w-[260px]">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-300"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <input
            type="search"
            value={search ?? ''}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-8 text-sm text-ink-900 placeholder:text-ink-300"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-300 hover:text-ink-700"
            >
              <X className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {pillRow}

      <div className="ml-auto flex items-center gap-2">
        {actions}

        {/* Right-aligned, like Export beside it: this sits in the `ml-auto`
            group hard against the right edge, so a panel opening rightward
            from there opens off-screen. */}
        {filters && (
          <Popover
            label="Filters"
            icon={SlidersHorizontal}
            badge={activeFilterCount}
            align="right"
          >
            <div className="space-y-3">
              {filters}
              {activeFilterCount > 0 && onClearFilters && (
                <button
                  type="button"
                  data-close-on-select
                  onClick={onClearFilters}
                  className={cn(pressable, 'w-full rounded-sm border border-line px-2 py-1.5 text-sm text-ink-500 hover:border-line-strong hover:text-ink-900')}
                >
                  Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </Popover>
        )}

        {onExport && (
          <Popover label="Export" icon={Download} align="right">
            <div className="-m-1 flex flex-col">
              {exportFormats.map((format) => (
                <button
                  key={format}
                  type="button"
                  data-close-on-select
                  onClick={() => onExport(format)}
                  className={cn(pressable, 'rounded-sm px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-surface-2 hover:text-ink-900')}
                >
                  Export {format}
                </button>
              ))}
              <p className="mt-1 border-t border-line px-2.5 pt-2 text-xs leading-snug text-ink-400">
                Exports the current filters and date range, not the whole table.
              </p>
            </div>
          </Popover>
        )}
      </div>
    </div>
  );
}

export default FilterStrip;
