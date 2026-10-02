import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from '@/lib/motionReact';
import { Link } from 'react-router';
import cn from '@/lib/cn';
import { money, count as formatCount } from '@/lib/format';
import { useSearchSuggestions } from '@/hooks/useCatalog';
import useDebouncedValue from '@/hooks/useDebouncedValue';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import { useApplyFilterPath, useApplySearchQuery } from '@/hooks/useApplyFilterPath';
import { PartVisual } from '@/components/product/PartFrame';
import Skeleton from '@/components/ui/Skeleton';
import { ease, pressable } from '@/lib/motion';

/**
 * Header search with a live type-ahead panel (brief §4.3).
 *
 * Left column: model matches, popular part-type suggestions, matching pages.
 * Right column: live product results. Footer: "View all N items".
 *
 * Picking a model on the left writes into the shared filter store - it filters
 * the grid rather than navigating.
 */
export function LiveSearch({
  className,
  autoFocus = false,
  focusToken = 0,
  onNavigate,
  onValueChange,
}) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedValue(value, 220);

  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // LiveSearch renders in three places (desktop header, mobile header, mobile
  // drawer), so the ids have to be per-instance - a fixed id would duplicate.
  const inputId = useId();
  const panelId = `${inputId}-results`;

  const { data, isFetching } = useSearchSuggestions(debounced);
  const setPath = useApplyFilterPath();
  const setQuery = useApplySearchQuery();

  useOnClickOutside(containerRef, () => setOpen(false), open);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // The mobile bottom bar's search button bumps a token in the ui store rather
  // than opening a second search field: this bar is inside the sticky header, so
  // it is already on screen - it just does not have the cursor.
  useEffect(() => {
    if (!focusToken) return;
    inputRef.current?.focus();
    setOpen(true);
  }, [focusToken]);

  // Reported up rather than owned up there: the field's text belongs to this
  // component, but the mobile header needs to know whether it is empty before it
  // decides to fold the row away on the next scroll.
  useEffect(() => {
    onValueChange?.(value);
  }, [value, onValueChange]);

  const showPanel = open && debounced.trim().length >= 2;
  const hasResults = (data?.products?.length ?? 0) > 0;

  // Below md the product column is hidden (see the panel), so the left column is
  // the whole panel and needs its own empty state.
  const hasFacets =
    (data?.models?.length ?? 0) + (data?.suggestions?.length ?? 0) + (data?.pages?.length ?? 0) > 0;

  function commitSearch(term = value) {
    setQuery(term.trim());
    setOpen(false);
    onNavigate?.();
  }

  function chooseModel(model) {
    setPath(
      {
        deviceType: model.path?.deviceType ?? null,
        brand: model.path?.brand ?? null,
        series: model.path?.series ?? null,
        model: model.slug,
      },
      { model: model.name },
    );
    setValue('');
    setOpen(false);
    onNavigate?.();
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          commitSearch();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Search parts, models or SKUs
        </label>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink-400"
            strokeWidth={2}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search by model, part or SKU…"
            autoComplete="off"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={panelId}
            className={cn(
              // 16px on a phone, 14 from sm up. Mobile Safari zooms the whole
              // page in when a focused input's text is under 16px, and it does
              // not zoom back out - the sticky header ends up wider than the
              // viewport and the layout is stuck skewed until a reload.
              'h-11 w-full rounded-md border border-line bg-surface-2 pl-11 pr-10 text-lg text-ink-900 sm:text-md',
              'placeholder:text-ink-300',
              'transition-[border-color,background,box-shadow] duration-press',
              'hover:border-line-strong',
              'focus:border-ink-400 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-ink-900/15',
              '[&::-webkit-search-cancel-button]:appearance-none',
            )}
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                setValue('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className={cn(pressable, 'absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 hover:bg-surface-3 hover:text-ink-900')}
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </form>

      <AnimatePresence>
        {showPanel && (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: ease.entrance }}
            className={cn(
              'absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-lg bg-surface shadow-flyout',
              // The field is only as wide as the header gap allows, and a panel
              // that width clips part names two words in. From md the panel
              // stops matching the input and takes the width the results need,
              // anchored to the input's right edge so it cannot run off the
              // viewport on a 1024 laptop.
              'md:left-auto md:w-[min(720px,calc(100vw-24px))]',
            )}
          >
            <div className="grid max-h-[70vh] grid-cols-1 overflow-hidden md:grid-cols-[minmax(190px,214px)_1fr]">
              {/* ---- left: facets --------------------------------------
                  On a phone this is the entire panel. Product rows carry a
                  price, and prices are gated per account - a stack of them
                  under the keyboard is the wrong thing to spend a small screen
                  on. Models and part types narrow the grid in one tap; the
                  footer button goes to the full result set. */}
              <div className="scroll-slim overflow-y-auto border-line bg-surface p-3 md:border-r md:bg-surface-2">
                {data?.models?.length > 0 && (
                  <div className="mb-4">
                    <p className="eyebrow mb-1.5 px-1 text-ink-400">Models</p>
                    <ul>
                      {data.models.map((model) => (
                        <li key={model.slug}>
                          <button
                            type="button"
                            onClick={() => chooseModel(model)}
                            className={cn(pressable, 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-700 hover:bg-surface-3 hover:text-ink-900')}
                          >
                            <span className="min-w-0 flex-1 truncate">{model.name}</span>
                            <span className="tnum shrink-0 text-xs text-ink-300">
                              {formatCount(model.count)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data?.suggestions?.length > 0 && (
                  <div className="mb-4">
                    <p className="eyebrow mb-1.5 px-1 text-ink-400">Popular suggestions</p>
                    <ul>
                      {data.suggestions.map((suggestion) => (
                        <li key={suggestion.value}>
                          <button
                            type="button"
                            onClick={() => commitSearch(`${value} ${suggestion.label}`)}
                            className={cn(pressable, 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-700 hover:bg-surface-3 hover:text-ink-900')}
                          >
                            <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
                            <span className="tnum shrink-0 text-xs text-ink-300">
                              {formatCount(suggestion.count)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data?.pages?.length > 0 && (
                  <div>
                    <p className="eyebrow mb-1.5 px-1 text-ink-400">Pages</p>
                    <ul>
                      {data.pages.map((page) => (
                        <li key={page.href}>
                          <Link
                            to={page.href}
                            onClick={() => setOpen(false)}
                            className={cn(pressable, 'block truncate rounded-lg px-2 py-1.5 text-sm text-ink-700 hover:bg-surface-3 hover:text-ink-900')}
                          >
                            {page.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!hasFacets && (
                  <p className="px-2 py-8 text-center text-md text-ink-400 md:hidden">
                    {isFetching && !data ? 'Searching…' : `No parts match “${debounced}”.`}
                  </p>
                )}
              </div>

              {/* ---- right: live product results (md and up only) ------- */}
              <div className="scroll-slim hidden overflow-y-auto p-3 md:block">
                {isFetching && !data ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={index} className="h-16 w-full" />
                    ))}
                  </div>
                ) : hasResults ? (
                  <ul className="space-y-1">
                    {data.products.map((product) => (
                      <li key={product.id}>
                        <Link
                          to={`/product/${product.slug}`}
                          onClick={() => setOpen(false)}
                          className={cn(pressable, 'flex items-center gap-3 rounded-md p-2 hover:bg-surface-2')}
                        >
                          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 p-1.5">
                            <PartVisual product={product} />
                          </span>

                          <span className="min-w-0 flex-1">
                            {/* Wrap rather than truncate - "Galaxy S23 Back …"
                                tells a buyer nothing about which part it is. */}
                            <span className="line-clamp-2 text-md font-medium leading-snug text-ink-900">
                              {product.name}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-2xs text-ink-300">
                              {product.sku}
                            </span>
                          </span>

                          <span className="w-[92px] shrink-0 text-right">
                            <span className="tnum block font-display text-md font-bold text-ink-900">
                              {product.priceVisible ? money(product.price) : '-'}
                            </span>
                            <span
                              className={cn(
                                'tnum block text-2xs',
                                product.inStock ? 'text-ok' : 'text-ink-300',
                              )}
                            >
                              {product.inStock ? 'In stock' : 'Out of stock'}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 py-8 text-center text-md text-ink-400">
                    No parts match “{debounced}”.
                  </p>
                )}
              </div>
            </div>

            {hasResults && (
              <button
                type="button"
                onClick={() => commitSearch()}
                className={cn(pressable, 'flex w-full items-center justify-center gap-2 border-t border-line bg-surface-2 py-3 font-display text-sm font-semibold text-ink-900 hover:bg-surface-3')}
              >
                View all {formatCount(data.total)} items
                <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default LiveSearch;
