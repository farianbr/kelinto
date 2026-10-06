import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Minus, MoreHorizontal } from 'lucide-react';
import cn from '@/lib/cn';
import ActionMenu from '@/components/ui/ActionMenu';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import Skeleton from '@/components/ui/Skeleton';
import useTableDensity from '@/hooks/useTableDensity';
import DensityToggle from '@/components/admin/DensityToggle';
import { pressable, pressableSurface } from '@/lib/motion';

/**
 * The admin list table. Fourteen planned screens are this table with different
 * columns, so it is built once (ERP rework §4).
 *
 * Columns are declared, not written as JSX:
 *
 *   { key, header, render?, sortValue?, align?, width?, priority?, className? }
 *
 * `priority` drives the responsive contract (§4, Responsive):
 *   1  always visible, including the stacked mobile card
 *   2  visible from 768 up
 *   3  visible from 1024 up
 * Anything hidden at the current width folds into the expandable row rather
 * than disappearing - a column you cannot reach is a column you have lost.
 *
 * Sorting is client-side over the rows given. A screen that paginates
 * server-side passes `sortable: false` on its columns and sorts upstream,
 * because sorting one page of twenty-five is a lie about the whole set.
 */

/**
 * The two densities.
 *
 * "comfortable" is the default and is what makes a table read as a product
 * surface rather than a spreadsheet: rows tall enough to have air around their
 * content, and no full-width rule between them. The rules are the thing that
 * makes a dense table feel like a ledger - thirty hairlines stacked down the
 * page draw the eye across the grid instead of down the column the staff member is
 * actually reading. Spacing separates rows perfectly well on its own, and the
 * hover state does the rest by making the row the staff member is on the only one
 * with a ground.
 *
 * "compact" exists because an ERP staff member scanning fifty orders wants density
 * more than they want air, and telling them otherwise would be design imposing
 * on work. It keeps a hairline, because at that height spacing alone is no
 * longer enough to separate one row from the next.
 */
const DENSITY = {
  comfortable: {
    cell: 'px-4 py-4',
    head: 'px-4 pb-2.5',
    row: 'border-0',
    expand: 'px-4 py-4',
  },
  compact: {
    cell: 'px-3 py-2',
    head: 'px-3 pb-2',
    row: 'border-b border-line last:border-0',
    expand: 'px-3 py-2.5',
  },
};

const ALIGN_CLASS = { right: 'text-right', center: 'text-center', left: 'text-left' };

/**
 * ## Every admin table looks the same (Instructions §3.2)
 *
 * `DataTable` is for **record lists** - a page of orders, clients, suppliers
 * and owns sorting, selection, the row menu and the responsive fold. A
 * **line-item table** is the other kind: the parts on one order, a settings
 * grid of editable rates. Those do not sort or select, often end in a totals
 * row and sometimes hold form inputs, so `DataTable` would run with most of
 * itself switched off, and they stay hand-written.
 *
 * **They must still be indistinguishable.** Which component rendered a table is
 * an implementation detail; a staff member looking at two tables on one screen
 * must not be able to tell. So this hook does not merely *resemble* the table
 * below - it returns `DENSITY`'s own values, at the density the staff member chose.
 *
 * That last part is the whole reason this is a hook and not a set of constants.
 * Density is live state, stored per browser and broadcast to every table on the
 * page; static classes would leave a hand-rolled table at one row height while
 * the `DataTable` beside it moved to another. An earlier version of these
 * helpers hard-coded `py-3` with a permanent hairline, which put three
 * different row heights on screen at once.
 *
 *   const t = useTableClasses();
 *
 *   <table className="w-full text-left">
 *     <thead><tr className={t.headRow}>
 *       <th scope="col" className={t.headCell()}>Item</th>
 *       <th scope="col" className={t.headCell('right')}>Total</th>
 *     </tr></thead>
 *     <tbody><tr className={t.row}>
 *       <td className={t.cell()}>…</td>
 *     </tr></tbody>
 *   </table>
 */
export function useTableClasses() {
  const [density] = useTableDensity();
  const d = DENSITY[density] ?? DENSITY.comfortable;

  return {
    /** The rule under the header - the one horizontal line a table needs. */
    headRow: 'border-b border-line',

    /** `eyebrow` type, muted, aligned. Identical to `DataTable`'s own header. */
    headCell: (align = 'left') =>
      cn(
        'eyebrow whitespace-nowrap pt-2.5 text-ink-400',
        d.head,
        ALIGN_CLASS[align] ?? ALIGN_CLASS.left,
      ),

    /**
     * A body row, carrying whatever rule the density carries - none at
     * comfortable, a hairline at compact. Matching `DataTable` matters more
     * than either choice on its own: two tables on one screen disagreeing about
     * whether rows have rules is exactly what reads as broken.
     */
    row: d.row,

    /** A body cell, on the same rhythm as the header. */
    cell: (align = 'left') => cn(d.cell, 'text-sm', ALIGN_CLASS[align] ?? ALIGN_CLASS.left),
  };
}

/**
 * A bare checkbox. `ui/Checkbox` is a labelled filter row and is the wrong shape
 * in a cell, but the **mark** is copied from it deliberately.
 *
 * `appearance-none` removes the platform tick along with the platform box, so a
 * checked row used to render as a filled brand square with nothing in it - the
 * colour was the only signal, which reads as a highlight rather than a
 * selection, and disappears entirely for anyone who cannot separate the two
 * tones. The glyph is drawn on top: a check when selected, a dash when the
 * header is partially selected, matching `ui/Checkbox`.
 */
function CellCheckbox({ checked, indeterminate, onChange, label }) {
  const ref = useRef(null);
  const isPartial = Boolean(indeterminate) && !checked;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = isPartial;
  }, [isPartial]);

  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
        className="peer absolute size-full cursor-pointer appearance-none rounded-sm border border-line-strong bg-surface transition-colors checked:border-brand checked:bg-brand indeterminate:border-brand indeterminate:bg-brand focus-visible:outline-none"
      />

      {isPartial ? (
        <Minus
          className="pointer-events-none relative size-2.5 text-white"
          strokeWidth={3.5}
          aria-hidden="true"
        />
      ) : (
        <Check
          className="pointer-events-none relative size-2.5 text-white opacity-0 transition-opacity peer-checked:opacity-100"
          strokeWidth={3.5}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

/** The row-actions menu. One implementation, shared with any record screen that needs the same control. */
function RowMenu({ items, row }) {
  return <ActionMenu items={items} context={row} label="Row actions" />;
}

const PRIORITY_CLASS = {
  1: '',
  2: 'hidden md:table-cell',
  3: 'hidden lg:table-cell',
};


function defaultSortValue(row, column) {
  const raw = column.sortValue ? column.sortValue(row) : row[column.key];
  return raw ?? '';
}

export function DataTable({
  columns,
  rows,
  rowKey = (row) => row.id ?? row._id,
  selectable = false,
  selected = [],
  onSelectionChange,
  rowMenu,
  onRowClick,
  sortable = true,
  defaultSort,
  empty,
  loading,
  footer,
  className,
  /**
   * Extra classes for one row, from the row: how a list tells its states apart
   * at a glance (an unanswered web quote tinted, a closed one recessed). A
   * selected row keeps the selection tint over it.
   */
  rowClassName,
}) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const [expanded, setExpanded] = useState(null);
  const [density] = useTableDensity();
  const d = DENSITY[density] ?? DENSITY.comfortable;

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;

    // Numbers compare numerically, everything else by locale - a string sort
    // over money puts $1,000 before $9.
    return [...rows].sort((a, b) => {
      const left = defaultSortValue(a, column);
      const right = defaultSortValue(b, column);
      const result =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true });
      return sort.direction === 'desc' ? -result : result;
    });
  }, [rows, sort, columns]);

  const allKeys = sorted.map(rowKey);
  const allSelected = allKeys.length > 0 && allKeys.every((key) => selected.includes(key));
  const someSelected = allKeys.some((key) => selected.includes(key));

  function toggleSort(column) {
    if (!sortable || column.sortable === false) return;
    setSort((current) => {
      if (current?.key !== column.key) return { key: column.key, direction: 'asc' };
      if (current.direction === 'asc') return { key: column.key, direction: 'desc' };
      return null;
    });
  }

  function toggleRow(key, checked) {
    if (!onSelectionChange) return;
    onSelectionChange(
      checked ? [...new Set([...selected, key])] : selected.filter((value) => value !== key),
    );
  }

  if (loading) {
    return (
      <div className={cn('space-y-2 p-4 sm:p-5', className)}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-14" />
        ))}
      </div>
    );
  }

  if (!sorted.length) return empty ?? null;

  // Columns folded away at the current width still have to be reachable, so the
  // expandable row renders every one that is not priority 1.
  const foldable = columns.filter((column) => (column.priority ?? 1) > 1);

  return (
    <div className={className}>
      <div className="overflow-x-auto">
        {/**
         * `table-fixed` whenever the caller has declared widths.
         *
         * Auto layout sizes every column by its content, which means a column's
         * width is decided by the longest cell that happens to be on the page
         * so a `width` on a column definition was quietly ignored, the money
         * column landed somewhere different on every table, and one long
         * description could swallow the row. Fixed layout honours the declared
         * widths and keeps a column of figures in a straight line down the page.
         *
         * Only when widths are declared: a table whose columns carry none still
         * wants auto layout, which is the right default for unknown content.
         *
         * `min-w` is what stops fixed layout from destroying the table on a
         * phone. Declared widths are percentages, and a percentage of 390px is
         * not enough for the content - every column collapsed at once, names
         * truncated to "Jordan …", and a two-button action cell overlapped the
         * column beside it. With a floor the table keeps its proportions and the
         * wrapper's `overflow-x-auto` lets the staff member swipe, which is the
         * normal way a wide table behaves on a narrow screen; the priority
         * classes have already folded the columns that were worth folding.
         */}
        <table
          className={cn(
            'w-full text-left',
            columns.some((column) => column.width) && 'table-fixed min-w-[720px]',
          )}
        >
          <thead>
            {/* The header keeps its rule in both densities. It is the one
                horizontal line the table needs: it separates the labels from
                the data, which is a real boundary, unlike the line between two
                adjacent rows of the same kind. */}
            <tr className="border-b border-line">
              {selectable && (
                <th scope="col" className={cn('w-10 pt-2.5', d.head)}>
                  {/* Select-all adds and removes **this page's** keys rather
                      than replacing the whole selection. On a paginated list
                      the old `checked ? allKeys : []` silently discarded rows
                      picked on another page the moment the header box was
                      touched - the staff member sees a count drop with no row
                      changing in front of them. */}
                  <CellCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={(checked) =>
                      onSelectionChange?.(
                        checked
                          ? [...new Set([...selected, ...allKeys])]
                          : selected.filter((key) => !allKeys.includes(key)),
                      )
                    }
                    label={allSelected ? 'Clear selection' : 'Select all rows'}
                  />
                </th>
              )}

              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                const canSort = sortable && column.sortable !== false;
                const Arrow = !isSorted
                  ? ChevronsUpDown
                  : sort.direction === 'asc'
                    ? ArrowUp
                    : ArrowDown;

                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={
                      isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    className={cn(
                      'eyebrow whitespace-nowrap pt-2.5 text-ink-400',
                      d.head,
                      PRIORITY_CLASS[column.priority ?? 1],
                      ALIGN_CLASS[column.align ?? 'left'],
                    )}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        // The arrow always trails the label. `flex-row-reverse`
                        // was tried here to right-align the pair and is wrong:
                        // it reverses the children, so the arrow landed on the
                        // *left* of a right-aligned column while every other
                        // column kept it on the right. The `th` already carries
                        // `text-right`, and an `inline-flex` button is an inline
                        // box - so it is pushed to the right edge by that
                        // text-align on its own, with nothing to do here.
                        className={cn(
                          pressable,
                          'eyebrow inline-flex items-center gap-1 hover:text-ink-700',
                          isSorted && 'text-ink-900',
                        )}
                      >
                        {column.header}
                        <Arrow
                          className={cn('size-3', isSorted ? 'text-brand' : 'text-ink-200')}
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}

              {/* Labelled, not blank. An unnamed trailing column reads as a
                  rendering gap - the `···` looks like it belongs to the last
                  data column rather than being an actions cell of its own. */}
              {rowMenu && (
                <th scope="col" className={cn('eyebrow w-20 pt-2.5 text-right text-ink-400', d.head)}>
                  Actions
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {sorted.map((row) => {
              const key = rowKey(row);
              const isSelected = selected.includes(key);
              const isExpanded = expanded === key;

              return (
                <Fragment key={key}>
                  <tr
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      d.row,
                      // A selected row is tinted; an unselected one gets its
                      // ground only on hover, which is what makes the row
                      // rather than the cell under the pointer - read as the
                      // unit being acted on.
                      isSelected ? 'bg-brand-50/60' : cn('hover:bg-surface-2', rowClassName?.(row)),
                      // Press feedback on a full-width row has to be far
                      // gentler than on a button: 0.97 on something 1100px wide
                      // is a visible lurch, so this is the 0.995 variant.
                      onRowClick && cn('cursor-pointer', pressableSurface),
                    )}
                  >
                    {selectable && (
                      <td className={d.cell} onClick={(event) => event.stopPropagation()}>
                        <CellCheckbox
                          checked={isSelected}
                          onChange={(checked) => toggleRow(key, checked)}
                          label={`Select row ${key}`}
                        />
                      </td>
                    )}

                    {columns.map((column, index) => (
                      <td
                        key={column.key}
                        className={cn(
                          'align-middle text-sm text-ink-700',
                          d.cell,
                          PRIORITY_CLASS[column.priority ?? 1],
                          ALIGN_CLASS[column.align ?? 'left'],
                          column.className,
                        )}
                      >
                        {/* Only the first cell needs the flex row, and only
                            when there is a disclosure to sit in it.

                            Every cell used to be wrapped in
                            `flex items-center`, which silently defeated
                            `align: 'right'` on every column that asked for it:
                            a flex container's children are laid out by
                            `justify-content`, so the inherited `text-align`
                            did nothing and money columns sat left under
                            right-aligned headers. Wrapping only where a
                            disclosure exists lets the `td`'s own text-align
                            apply everywhere else. */}
                        {index === 0 && foldable.length > 0 ? (
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpanded(isExpanded ? null : key);
                              }}
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? 'Hide details' : 'Show details'}
                              className="flex size-5 shrink-0 items-center justify-center rounded text-ink-300 hover:bg-surface-3 hover:text-ink-700 lg:hidden"
                            >
                              <ChevronsUpDown className="size-3" strokeWidth={2.5} aria-hidden="true" />
                            </button>
                            <span className="min-w-0">
                              {column.render ? column.render(row) : row[column.key]}
                            </span>
                          </span>
                        ) : (
                          column.render ? column.render(row) : row[column.key]
                        )}
                      </td>
                    ))}

                    {rowMenu && (
                      <td className={d.cell} onClick={(event) => event.stopPropagation()}>
                        <RowMenu items={rowMenu} row={row} />
                      </td>
                    )}
                  </tr>

                  {isExpanded && foldable.length > 0 && (
                    <tr className="border-b border-line bg-surface-2 lg:hidden">
                      <td
                        colSpan={columns.length + (selectable ? 1 : 0) + (rowMenu ? 1 : 0)}
                        className={d.expand}
                      >
                        <dl className="grid gap-2 sm:grid-cols-2">
                          {foldable.map((column) => (
                            <div key={column.key} className="flex items-baseline gap-2">
                              <dt className="eyebrow shrink-0 text-ink-400">{column.header}</dt>
                              <dd className="min-w-0 text-sm text-ink-700">
                                {column.render ? column.render(row) : row[column.key]}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {footer}
    </div>
  );
}

/**
 * The count line every list carries above its table (§4, convention 9):
 * `35 clients` · `Showing 1–25 of 27 tickets`.
 *
 * It also carries the density toggle, pushed to the right. This is the one row
 * every list screen already renders directly above its table, so putting the
 * control here reaches all thirteen of them without each page having to opt in
 * - and it lands beside the rows it changes rather than in a settings screen,
 * which is where a control that is adjusted while looking at data belongs.
 *
 * `density={false}` opts out, for the handful of small tables (a five-row
 * summary on a detail page) where a density switch is more chrome than the
 * table it governs.
 */
/**
 * `from` is the 1-based index of the first row on screen.
 *
 * It used to be hardcoded: the label read `Showing 1–${shown}` whatever page
 * you were on, so page three of ten claimed to be showing rows 1–10 while
 * displaying 21–30. Pass it whenever the table is paged; omit it and the label
 * falls back to a plain total, which is right for a table that shows everything.
 */
export function CountLine({ total, shown, from = 1, noun, density = true, className }) {
  const label =
    shown != null && total != null && shown < total
      ? `Showing ${from}–${from + shown - 1} of ${total} ${noun}`
      : `${total ?? shown ?? 0} ${noun}`;

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <p className="tnum text-sm text-ink-400">{label}</p>
      {density && <DensityToggle className="hidden sm:inline-flex" />}
    </div>
  );
}

export default DataTable;
