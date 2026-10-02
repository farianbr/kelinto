import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowRight, ChevronRight, CircuitBoard, Package, Smartphone, Wrench } from 'lucide-react';
import { categoryPath } from '@shared/catalog';
import { componentIconFor, iconFor } from '@/lib/icons';
import { AnimatePresence, motion } from '@/lib/motionReact';
import cn from '@/lib/cn';
import { count as formatCount } from '@/lib/format';
import { CatalogProvider, catalogFrom, useCatalogConfig } from '@/lib/catalogs';
import { useCatalogCategories, useComponentTypes, useTaxonomy } from '@/hooks/useCatalog';
import { useApplyCatalogFilter } from '@/hooks/useApplyFilterPath';
import useFilterStore from '@/store/filterStore';
import useUiStore from '@/store/uiStore';
import Skeleton from '@/components/ui/Skeleton';
import { ease, pressable } from '@/lib/motion';

/** What each kind of catalogue looks like as a tile. A category a business adds is products. */
const KIND_ICONS = { part: CircuitBoard, phone: Smartphone, service: Wrench };

/**
 * The desktop mega menu (brief §4.1), product type first (client ruling,
 * 2026-10-02).
 *
 * ## What it is opened for
 *
 * To get to the right shelf in two moves. The website sells three different
 * things (parts, pre-owned phones and repairs, plus any category the business
 * adds), and each has its own tree: a phone is found by brand and model, a
 * repair by the device it is done to. One tree for all of them was a parts
 * menu with the other two missing. So the first row is the catalogues, as big
 * tiles, and picking one draws THAT catalogue's own filters underneath: its
 * first step (Component Type, Repair Type, or nothing for phones), its device
 * list, and its brands and series.
 *
 * The tile row is the one thing that must read at a glance, so it gets the
 * size; the filters below keep the dense two-column shape buyers already know.
 * The tile under the page you are on starts selected, so on /services the menu
 * opens on repairs.
 *
 * ## Still live filters, not links
 *
 * On a catalogue's own page a pick writes to the shared filter store and the
 * grid re-renders in place (`useApplyCatalogFilter`). Anywhere else, the pick
 * travels in the URL to that catalogue's page, and the store is left to the
 * page that owns it.
 */
export function MegaMenu() {
  const open = useUiStore((s) => s.megaMenuOpen);
  const closeMegaMenu = useUiStore((s) => s.closeMegaMenu);
  const { pathname } = useLocation();
  const { data: categories, isLoading } = useCatalogCategories();

  const here = categories?.find((category) => categoryPath(category) === pathname)?.slug ?? null;
  const [chosen, setChosen] = useState(null);
  const selectedSlug = chosen ?? here ?? categories?.[0]?.slug ?? null;
  const selected = categories?.find((category) => category.slug === selectedSlug) ?? null;
  const catalog = useMemo(() => (selected ? catalogFrom(selected) : null), [selected]);

  // Each opening starts from the page you are on, not from the last tile you
  // looked at a minute ago on another page.
  useEffect(() => {
    if (open) setChosen(null);
  }, [open]);

  // The mega menu is anchored to the header rather than portalled, so it does
  // not go through Overlay - it needs its own Escape handler.
  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape') closeMegaMenu();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeMegaMenu]);

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
                inside it is a centred box, so the wrapper closes on click and
                the panel stops the event: the gutters behave like the scrim
                they look like. */}
            <div className="mx-auto max-w-[1400px] px-4 lg:px-6" onClick={(event) => event.stopPropagation()}>
              <div className="overflow-hidden rounded-b-lg border border-t-0 border-line bg-surface shadow-flyout">
                {/* ---- catalogues: the first choice ------------------------- */}
                <div className="border-b border-line bg-surface-2 p-4">
                  <p className="eyebrow mb-3 text-ink-400">Shop by type</p>
                  <div
                    role="tablist"
                    aria-label="What are you shopping for"
                    className={cn(
                      'grid gap-3',
                      (categories?.length ?? 3) >= 4 ? 'grid-cols-4' : 'grid-cols-3',
                    )}
                  >
                    {isLoading
                      ? Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-21 rounded-lg" />)
                      : categories?.map((category) => (
                          <CategoryTile
                            key={category.slug}
                            category={category}
                            active={category.slug === selectedSlug}
                            onSelect={() => setChosen(category.slug)}
                          />
                        ))}
                  </div>
                </div>

                {catalog && (
                  // Keyed: a tile's own facet ticks never carry into another's.
                  <CatalogProvider key={catalog.slug} catalog={catalog}>
                    <CatalogFilters category={selected} onDone={closeMegaMenu} />
                  </CatalogProvider>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** One catalogue, as a big tile. Selecting it draws its filters; it does not navigate. */
function CategoryTile({ category, active, onSelect }) {
  const Icon = KIND_ICONS[category.kind] ?? Package;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      onFocus={onSelect}
      className={cn(
        pressable,
        'flex min-h-21 items-center gap-3.5 rounded-lg border bg-surface p-4 text-left',
        active ? 'border-brand' : 'border-line hover:border-line-strong',
      )}
    >
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-md',
          active ? 'bg-brand-gradient-compact text-white' : 'bg-surface-3 text-ink-500',
        )}
        aria-hidden="true"
      >
        <Icon className="size-5" strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-lg font-bold text-ink-900">{category.name}</span>
        {category.description && (
          <span className="mt-0.5 block truncate text-sm text-ink-500">{category.description}</span>
        )}
      </span>
    </button>
  );
}

/**
 * The selected catalogue's own filters: its first step across the top, then
 * its tree. Reads the catalogue from context, so the tree, the step names and
 * the facet are all that catalogue's.
 */
function CatalogFilters({ category, onDone }) {
  const catalog = useCatalogConfig();
  const { pathname } = useLocation();
  const onItsPage = pathname === categoryPath(category);
  const apply = useApplyCatalogFilter();

  const { data: tree, isLoading } = useTaxonomy();
  const { data: facetOptions, isLoading: loadingFacet } = useComponentTypes();
  const [hovered, setHovered] = useState(null);

  // On its own page the facet is the store's, live, like the rail beside the
  // grid. Elsewhere it is held here until the buyer goes to the page.
  const storeFacet = useFilterStore((s) => s.facets.partType);
  const toggleStoreFacet = useFilterStore((s) => s.toggleComponentType);
  const [localFacet, setLocalFacet] = useState([]);
  const ticked = onItsPage ? storeFacet : localFacet;
  const labelOf = useCallback(
    (slug) => facetOptions?.find((option) => option.slug === slug)?.name ?? slug,
    [facetOptions],
  );

  const toggle = (option) => {
    // The menu STAYS OPEN: the facet is multi-select, and closing on the first
    // tick would make the second a second trip through the header.
    if (onItsPage) toggleStoreFacet(option.slug, option.name);
    else
      setLocalFacet((current) =>
        current.includes(option.slug) ? current.filter((slug) => slug !== option.slug) : [...current, option.slug],
      );
  };

  /** Go, with the held facet when off the page. On the page the store already has it. */
  const go = (path = {}, labels = {}) => {
    apply(category, {
      path,
      labels,
      facet: onItsPage ? undefined : localFacet,
      facetLabels: Object.fromEntries(localFacet.map((slug) => [slug, labelOf(slug)])),
    });
    onDone();
  };

  const [first, second, third] = catalog.levels.map((level) => level.key);
  const activeTop = tree?.find((node) => node.slug === hovered) ?? tree?.[0] ?? null;
  const showFacet = Boolean(catalog.facetLabel) && (loadingFacet || facetOptions?.length > 0);

  return (
    <>
      {/* ---- the catalogue's first step (Component Type, Repair Type) ---- */}
      {showFacet && (
        <div className="border-b border-line px-5 py-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="eyebrow text-ink-400">{catalog.facetLabel}</p>
            {ticked.length > 0 && (
              <button
                type="button"
                onClick={() => go()}
                className={cn(pressable, 'inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand hover:text-brand-700')}
              >
                Shop {formatCount(ticked.length)} selected
                <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {loadingFacet
              ? Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-8 w-28" />)
              : facetOptions.map((option) => {
                  const Icon = catalog.kind === 'part' ? componentIconFor(option.slug) : null;
                  const isActive = ticked.includes(option.slug);
                  return (
                    <button
                      key={option.slug}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => toggle(option)}
                      className={cn(
                        pressable,
                        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-display text-sm font-semibold transition-colors',
                        isActive
                          ? 'border-transparent bg-brand-gradient-compact text-white'
                          : 'border-line bg-surface text-ink-700 hover:border-line-strong hover:text-brand',
                      )}
                    >
                      {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />}
                      {option.name}
                      <span className={cn('tnum text-2xs font-medium', isActive ? 'text-white/75' : 'text-ink-300')}>
                        {formatCount(option.count)}
                      </span>
                    </button>
                  );
                })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[minmax(200px,230px)_1fr]">
        {/* ---- the tree's first level ------------------------------------ */}
        <nav aria-label={`${catalog.title}: ${catalog.levels[0]?.label ?? 'categories'}`} className="border-r border-line bg-surface-2 p-2.5">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="mb-1.5 h-10 w-full" />)
          ) : tree?.length ? (
            tree.map((node) => {
              const Icon = iconFor(node.icon);
              const isActive = activeTop?.slug === node.slug;
              return (
                <button
                  key={node.slug}
                  type="button"
                  onMouseEnter={() => setHovered(node.slug)}
                  onFocus={() => setHovered(node.slug)}
                  onClick={() => go({ [first]: node.slug }, { [first]: node.name })}
                  className={cn(
                    pressable,
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left',
                    isActive ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-700 hover:bg-surface-3',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                      isActive ? 'bg-brand-gradient-compact text-white' : 'bg-surface-3 text-ink-500',
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="size-4" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-md font-semibold">{node.name}</span>
                    <span className="tnum block text-xs text-ink-400">
                      {formatCount(node.count)} {node.count === 1 ? catalog.noun : catalog.nouns}
                    </span>
                  </span>
                  <ChevronRight
                    className={cn('size-4 shrink-0 transition-colors', isActive ? 'text-brand' : 'text-ink-300')}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
              );
            })
          ) : (
            <p className="px-2.5 py-3 text-sm text-ink-500">Nothing listed yet.</p>
          )}
        </nav>

        {/* ---- the levels under it --------------------------------------- */}
        <div className="scroll-slim max-h-[56vh] overflow-y-auto p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h3 className="text-lg">{activeTop ? `${activeTop.name} ${catalog.nouns}` : catalog.title}</h3>
            <div className="flex shrink-0 items-center gap-4">
              {activeTop && (
                <button
                  type="button"
                  onClick={() => go({ [first]: activeTop.slug }, { [first]: activeTop.name })}
                  className={cn(pressable, 'inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-700')}
                >
                  Shop all {activeTop.name}
                  <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                </button>
              )}
              <Link
                to={categoryPath(category)}
                onClick={onDone}
                className={cn(pressable, 'inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-brand')}
              >
                All {catalog.nouns}
              </Link>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4">
              {activeTop?.children?.map((node) => (
                <div key={node.slug}>
                  <button
                    type="button"
                    onClick={() =>
                      go(
                        { [first]: activeTop.slug, [second]: node.slug },
                        { [first]: activeTop.name, [second]: node.name },
                      )
                    }
                    className={cn(pressable, 'mb-1.5 flex w-full items-center gap-1.5 text-left font-display text-sm font-bold text-ink-900 hover:text-brand')}
                  >
                    {node.name}
                    <span className="tnum text-2xs font-medium text-ink-300">{formatCount(node.count)}</span>
                  </button>
                  <ul className="space-y-0.5">
                    {node.children?.slice(0, 6).map((leaf) => (
                      <li key={leaf.slug}>
                        <button
                          type="button"
                          onClick={() =>
                            go(
                              { [first]: activeTop.slug, [second]: node.slug, [third]: leaf.slug },
                              { [first]: activeTop.name, [second]: node.name, [third]: leaf.name },
                            )
                          }
                          className={cn(pressable, 'block w-full truncate text-left text-sm text-ink-500 hover:text-brand')}
                        >
                          {leaf.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default MegaMenu;
