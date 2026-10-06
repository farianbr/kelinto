import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import cn from '@/lib/cn';
import { money, count as formatCount } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';
import { useAdminInventory } from '@/hooks/useAdmin';
import useDebouncedValue from '@/hooks/useDebouncedValue';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import useAnchoredPosition from '@/hooks/useAnchoredPosition';
import { pressable } from '@/lib/motion';

/** Height of one result row - a two-line row at `p-2`. */
const ROW_H = 52;

/**
 * The item field on a purchase-order line: search by name, SKU or barcode, or
 * scan straight into it.
 *
 * **Not `ProductPicker`.** That one is the buyer's quick-order pad and reads
 * the storefront catalogue: it carries no cost and no barcode, and it answers
 * with what a customer may buy. A purchase order needs the opposite of that
 * the part's *cost*, its barcode, and above all the out-of-stock rows, because
 * restocking something that has run out is the single most common reason to
 * raise a PO. So this reads `/admin/inventory`, which already searches all
 * three fields and returns cost, barcode and stock.
 *
 * **A scanner is just a very fast keyboard.** It types the barcode and presses
 * Enter, so the field needs no scanner integration: the search matches barcodes,
 * and Enter commits the highlighted row. A single exact barcode match commits
 * itself, which is what makes scanning a line feel like scanning rather than
 * like searching.
 *
 * `onChange` receives the whole inventory row (or `null`), so the caller can
 * fill SKU, barcode and unit cost from one selection rather than looking any of
 * them up again.
 *
 * **Also the part picker on a ticket, a quote and a service invoice**
 * (client ruling 2026-10-05: "Add part will be barcode or SKU searchable").
 * Those sell the part rather than buy it, so `amount="price"` shows what the
 * customer pays instead of what the shop paid.
 */
export function InventoryPicker({
  value,
  onChange,
  autoFocus = false,
  className,
  amount = 'cost',
  placeholder = 'Search or scan sku / barcode…',
  /**
   * The device the part is for, `{ brand, model }` (client ruling 2026-10-06:
   * "if the device is selected, show only the parts for the selected
   * device"). With a model, the list opens on that device's parts before
   * anything is typed, and a search stays inside them until "Show all parts"
   * is pressed - a part the catalogue has filed under no model, or under the
   * wrong one, must still be reachable.
   */
  fits = null,
  /**
   * Refuse a part with nothing on the shelf (client ruling 2026-10-06). On for
   * the ticket and the service invoice, which take the part off the shelf; off
   * for a purchase order, where a part at zero is the reason for the order,
   * and for a quote, which may price a part still to be ordered.
   */
  requireStock = false,
  /**
   * `add` draws the field as an add bar - a dashed outline that goes solid on
   * focus - for the line lists where it sits under the lines it adds to, the
   * same as `ServicePicker` beside it. The default is a plain field.
   */
  appearance = 'field',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const debounced = useDebouncedValue(query, 220);

  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = `${useId()}-inventory`;

  const device = fits?.model ? [fits.brand, fits.model].filter(Boolean).join(' ') : '';
  const fitting = Boolean(device) && !showAll;
  const typed = debounced.trim();

  // Two characters to search the whole shelf; nothing at all to list one
  // device's parts, which is a short list worth showing on focus.
  const ready = typed.length >= 2 || fitting;
  const { data, isFetching } = useAdminInventory(
    {
      q: typed || undefined,
      ...(fitting ? { fitBrand: fits.brand || undefined, fitModel: fits.model, category: 'parts' } : {}),
    },
    ready,
  );

  const products = ready ? (data?.products ?? []).slice(0, 20) : [];
  const showPanel = open && ready;

  const [panelStyle] = useAnchoredPosition(containerRef, showPanel, {
    maxHeight: ROW_H * 6 + 40,
    padding: 8,
    matchWidth: true,
  });

  // The list is portalled, so it has to count as inside too: without it a
  // press on a row closed the list before the row's click could land.
  useOnClickOutside([containerRef, panelRef], () => setOpen(false), open);

  useEffect(() => {
    setHighlight(0);
  }, [debounced]);

  /**
   * An exact barcode or SKU match commits itself.
   *
   * This is what separates scanning from searching: a scanner types the whole
   * code and the staff member's hands are already on the next box, so making them
   * confirm a list of one defeats the point. Only an exact, unique match
   * auto-commits - a partial or ambiguous one still opens the list. The SKU
   * counts too, because a shop that labels its own shelves prints the SKU as
   * the barcode.
   */
  useEffect(() => {
    if (!ready || products.length !== 1) return;
    const only = products[0];
    const typed = debounced.trim().toLowerCase();
    if ([only.barcode, only.sku].some((code) => code && code.toLowerCase() === typed)) {
      commit(only);
    }
    // `commit` is stable enough for this: it only closes the panel and calls up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, products.length, ready]);

  const unavailable = (product) => requireStock && !((product?.stock ?? 0) > 0);

  function commit(product) {
    if (unavailable(product)) return;
    onChange?.(product);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(event) {
    if (!showPanel) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((index) => Math.min(index + 1, products.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      // The row wins over the form: Enter in a search box that has results is
      // choosing one, not submitting a half-filled purchase order.
      event.preventDefault();
      if (products[highlight]) commit(products[highlight]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  // A chosen line shows what it is, with a clear button - the search box is for
  // finding, and leaving it in place after a choice invites re-searching a row
  // that is already filled in.
  if (value) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink-900">{value.name}</span>
          <span className="block truncate font-mono text-2xs text-ink-400">{value.sku}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange?.(null)}
          aria-label={`Clear ${value.name}`}
          className={cn(pressable, 'flex size-7 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-surface-2 hover:text-ink-700')}
        >
          <X className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
    );
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
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // A pick closes the list with focus still here, so onFocus will not
          // fire again: a click on the field brings the list back.
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-9 w-full rounded-md border bg-surface pl-8 pr-2.5',
            appearance === 'add'
              ? 'border-dashed border-line-strong focus:border-solid'
              : 'border-line',
            // 16px on a phone: below it mobile Safari zooms in and never back out.
            'text-base text-ink-900 placeholder:text-ink-400 sm:text-sm',
            'transition-[border-color,box-shadow] duration-press',
            'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
          )}
        />
      </span>

      {showPanel &&
        createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            // Focus stays on the field while a row or "Show all parts" is
            // pressed, so the field's blur only ever means leaving it.
            onMouseDown={(event) => event.preventDefault()}
            className="z-70 overflow-hidden rounded-md bg-surface shadow-pop"
          >
            {/* Which shelf the list is reading, and the way off it. Shown only
                when a device narrows the list, so a purchase order's picker is
                unchanged. */}
            {device && (
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-xs">
                <span className="min-w-0 truncate text-ink-500">
                  {showAll ? 'All parts' : (
                    <>
                      Parts for <span className="font-medium text-ink-900">{device}</span>
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setShowAll((current) => !current)}
                  className={cn(pressable, 'shrink-0 font-medium text-brand hover:text-brand-700')}
                >
                  {showAll ? `Only ${fits.model}` : 'Show all parts'}
                </button>
              </div>
            )}

            <ul ref={listRef} id={listId} role="listbox" className="scroll-slim max-h-78 overflow-y-auto py-1">
              {isFetching && products.length === 0 && (
                <li className="p-2">
                  <Skeleton className="h-9" rounded="md" />
                </li>
              )}

              {!isFetching && products.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-ink-400">
                  {typed
                    ? `Nothing matches “${typed}”${fitting ? ` for ${device}` : ''}.`
                    : `No parts are filed under ${device} yet.`}
                </li>
              )}

              {products.map((product, index) => (
                <li
                  key={product.id}
                  role="option"
                  aria-selected={index === highlight}
                  aria-disabled={unavailable(product) || undefined}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => commit(product)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2',
                    unavailable(product) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                    index === highlight ? 'bg-surface-2' : 'bg-transparent',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-900">{product.name}</span>
                    <span className="block truncate font-mono text-2xs text-ink-400">
                      {product.sku}
                      {product.barcode && ` · ${product.barcode}`}
                    </span>
                  </span>

                  {/* On a purchase order a part at zero is the most likely thing
                      to order, so the count only warns; where the part comes
                      off the shelf (`requireStock`) zero says it cannot. */}
                  <span
                    className={cn(
                      'tnum shrink-0 text-2xs',
                      product.stock > 0 ? 'text-ink-400' : unavailable(product) ? 'font-semibold text-danger' : 'text-warn',
                    )}
                  >
                    {product.stock > 0 ? `${formatCount(product.stock)} in stock` : 'Out of stock'}
                  </span>
                  <span className="tnum shrink-0 text-xs font-medium text-ink-700">
                    {money(product[amount] > 0 ? product[amount] : 0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default InventoryPicker;
