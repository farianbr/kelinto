import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { componentIconFor, iconFor } from '@/lib/icons';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import cn from '@/lib/cn';
import { count as formatCount } from '@/lib/format';
import { useTaxonomy, usePartTypes } from '@/hooks/useCatalog';
import useApplyFilterPath from '@/hooks/useApplyFilterPath';
import useFilterStore from '@/store/filterStore';
import useUiStore from '@/store/uiStore';
import Skeleton from '@/components/ui/Skeleton';
import { ease, pressable } from '@/lib/motion';

/**
 * The desktop mega menu (brief §4.1).
 *
 * Critically: these are LIVE FILTERS, not links. Clicking a category writes to
 * the shared filter store and closes the panel - on the Shop page the grid
 * updates in place and the route never changes.
 *
 * Off the Shop page the store has no grid subscribed to it, so `useApplyFilterPath`
 * carries the user back to `/` with the filter applied. The header is on every
 * page; a Categories menu that silently did nothing on /about was the bug.
 */
export function MegaMenu() {
  const open = useUiStore((s) => s.megaMenuOpen);
  const closeMegaMenu = useUiStore((s) => s.closeMegaMenu);
  const setPath = useApplyFilterPath();

  const { data: tree, isLoading } = useTaxonomy();
  const { data: componentTypes, isLoading: loadingComponents } = usePartTypes();
  const [hoveredType, setHoveredType] = useState(null);

  // The component type is a FACET, not a level of the tree, so it cannot go
  // through `setPath` - it has its own store action. That action leaves the
  // chosen category path alone: the two are independent filters over one query,
  // and a buyer who has drilled to a model and then ticks a component wants
  // that model's component, not a trip back to the top of the tree.
  const toggleComponentType = useFilterStore((s) => s.toggleComponentType);
  const activeComponents = useFilterStore((s) => s.facets.partType);

  const applyComponentType = useCallback(
    (slug, label) => {
      // The menu STAYS OPEN. Component type is multi-select, and closing the
      // panel on the first tick would make the second one a second trip through
      // the header. The grid behind updates on every tick, so the buyer can see
      // the selection working while they build it.
      //
      // No navigation here either, for the same reason: jumping to the Shop page
      // mid-selection would close the menu out from under them. The Shop links
      // already in this panel are the way there, and they carry the store's
      // state with them.
      toggleComponentType(slug, label);
    },
    [toggleComponentType],
  );

  const activeType = tree?.find((t) => t.slug === hoveredType) ?? tree?.[0] ?? null;

  // The mega menu is anchored to the header rather than portalled, so it does
  // not go through Overlay - it needs its own Escape handler. Every overlay in
  // the app closes on Escape; this one was the exception.
  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape') closeMegaMenu();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeMegaMenu]);

  function applyFilter(partial, labels) {
    setPath(partial, labels);
    closeMegaMenu();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim sits below the header so the trigger stays visible and clickable. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeMegaMenu}
            className="fixed inset-0 top-[var(--header-h,116px)] z-30 bg-ink-900/30"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24, ease: ease.entrance }}
            onClick={closeMegaMenu}
            className="absolute left-0 right-0 top-full z-40 origin-top"
          >
            {/* The wrapper runs the full width of the viewport while the panel
                inside it is a centred max-w-[1400px] box, so the gutters either
                side of the panel sat ABOVE the scrim on z-40 and swallowed the
                click that should have closed the menu. The wrapper closes on
                click and the panel stops the event, so those gutters behave like
                the scrim they look like. */}
            <div
              className="mx-auto max-w-[1400px] px-4 lg:px-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="overflow-hidden rounded-b-lg border border-t-0 border-line bg-surface shadow-flyout">
                {/* ---- component types ------------------------------- */}
                {/* First, and across the full width, because it is the first
                    step of the wizard and it cuts ACROSS the tree below: a
                    battery exists for phones, tablets and watches alike, so it
                    cannot be a column beside them. Flat `bg-brand` when active
                    the gradient is reserved for the promo block on this panel,
                    and two gradients on one surface is two signatures. */}
                <div className="border-b border-line bg-surface-2 px-5 py-3">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <p className="eyebrow text-ink-300">
                      Component type
                    </p>

                    {/* Ticking no longer navigates, so off the Shop page this is
                        the way through. `applyFilter({})` writes an empty path,
                        which leaves the component ticks alone and lets
                        useApplyFilterPath carry the whole store to the grid. */}
                    {activeComponents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => applyFilter({}, {})}
                        className={cn(pressable, 'inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand hover:text-brand-700')}
                      >
                        Shop {formatCount(activeComponents.length)} selected
                        <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {loadingComponents
                      ? Array.from({ length: 8 }).map((_, index) => (
                          <Skeleton key={index} className="h-8 w-28" />
                        ))
                      : componentTypes?.map((component) => {
                          const Icon = componentIconFor(component.value);
                          const isActive = activeComponents.includes(component.value);

                          return (
                            <button
                              key={component.value}
                              type="button"
                              aria-pressed={isActive}
                              onClick={() => applyComponentType(component.value, component.label)}
                              className={cn(
                                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-display text-sm font-semibold transition-colors active:scale-[0.97]',
                                isActive
                                  ? 'border-brand bg-brand text-white'
                                  : 'border-line bg-surface text-ink-700 hover:border-line-strong hover:text-brand',
                              )}
                            >
                              <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                              {component.label}
                              <span
                                className={cn(
                                  'tnum text-2xs font-medium',
                                  isActive ? 'text-white/70' : 'text-ink-300',
                                )}
                              >
                                {formatCount(component.count)}
                              </span>
                            </button>
                          );
                        })}
                  </div>
                </div>

                <div className="grid grid-cols-[minmax(200px,230px)_1fr_minmax(220px,260px)]">
                  {/* ---- device types ---------------------------------- */}
                  <nav aria-label="Device categories" className="border-r border-line bg-surface-2 p-2.5">
                    {isLoading
                      ? Array.from({ length: 6 }).map((_, index) => (
                          <Skeleton key={index} className="mb-1.5 h-10 w-full" />
                        ))
                      : tree?.map((type) => {
                          const Icon = iconFor(type.icon);
                          const isActive = activeType?.slug === type.slug;

                          return (
                            <button
                              key={type.slug}
                              type="button"
                              onMouseEnter={() => setHoveredType(type.slug)}
                              onFocus={() => setHoveredType(type.slug)}
                              onClick={() =>
                                applyFilter({ deviceType: type.slug }, { deviceType: type.name })
                              }
                              className={cn(
                                pressable,
                                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left',
                                isActive
                                  ? 'bg-surface text-ink-900 shadow-card'
                                  : 'text-ink-700 hover:bg-surface-3',
                              )}
                            >
                              <span
                                className={cn(
                                  'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                                  isActive ? 'bg-brand-gradient text-white' : 'bg-surface-3 text-ink-500',
                                )}
                                aria-hidden="true"
                              >
                                <Icon className="size-4" strokeWidth={2} />
                              </span>

                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-display text-md font-semibold">
                                  {type.name}
                                </span>
                                <span className="tnum block text-xs text-ink-400">
                                  {formatCount(type.count)} parts
                                </span>
                              </span>

                              <ChevronRight
                                className={cn(
                                  'size-4 shrink-0 transition-colors',
                                  isActive ? 'text-brand' : 'text-ink-300',
                                )}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                            </button>
                          );
                        })}
                  </nav>

                  {/* ---- brands + series columns ----------------------- */}
                  <div className="scroll-slim max-h-[62vh] overflow-y-auto p-5">
                    {activeType && (
                      <>
                        <div className="mb-4 flex items-baseline justify-between gap-3">
                          <h3 className="text-lg">{activeType.name} parts</h3>
                          <button
                            type="button"
                            onClick={() =>
                              applyFilter(
                                { deviceType: activeType.slug },
                                { deviceType: activeType.name },
                              )
                            }
                            className={cn(pressable, 'inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-700')}
                          >
                            Shop all
                            <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-3">
                          {activeType.children?.map((brand) => (
                            <div key={brand.slug}>
                              <button
                                type="button"
                                onClick={() =>
                                  applyFilter(
                                    { deviceType: activeType.slug, brand: brand.slug },
                                    { deviceType: activeType.name, brand: brand.name },
                                  )
                                }
                                className={cn(pressable, 'mb-1.5 flex w-full items-center gap-1.5 text-left font-display text-sm font-bold text-ink-900 hover:text-brand')}
                              >
                                {brand.name}
                                <span className="tnum text-2xs font-medium text-ink-300">
                                  {formatCount(brand.count)}
                                </span>
                              </button>

                              <ul className="space-y-0.5">
                                {brand.children?.slice(0, 6).map((series) => (
                                  <li key={series.slug}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        applyFilter(
                                          {
                                            deviceType: activeType.slug,
                                            brand: brand.slug,
                                            series: series.slug,
                                          },
                                          {
                                            deviceType: activeType.name,
                                            brand: brand.name,
                                            series: series.name,
                                          },
                                        )
                                      }
                                      className={cn(pressable, 'block w-full truncate text-left text-sm text-ink-500 hover:text-brand')}
                                    >
                                      {series.name}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* ---- promo panel: the one gradient block on the page -- */}
                  <aside className="border-l border-line p-5">
                    <div className="flex h-full flex-col justify-between gap-6 rounded-lg bg-brand-gradient p-5 text-white">
                      <div>
                        <p className="eyebrow mb-2 opacity-70">Partner programme</p>
                        <h4 className="text-xl leading-tight text-white">
                          Net 30 terms for approved accounts
                        </h4>
                        <p className="mt-2 text-sm leading-relaxed text-white/75">
                          Approved accounts unlock wholesale pricing, credit terms and
                          same-day dispatch from our Canadian warehouse.
                        </p>
                      </div>

                      <div>
                        <ul className="space-y-1.5 text-sm text-white/85">
                          <li>· 400+ SKUs in stock</li>
                          <li>· Graded pulls, tested before dispatch</li>
                          <li>· 90-day warranty on new and OEM</li>
                        </ul>

                        {/* A route, not a filter - the offers page is its own
                            surface, so this one closes the menu and navigates. */}
                        <Link
                          to="/offers"
                          onClick={closeMegaMenu}
                          className={cn(pressable, 'mt-4 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-surface font-display text-md font-semibold text-ink-900 hover:bg-surface-2')}
                        >
                          See running offers
                          <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default MegaMenu;
