import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import cn from '@/lib/cn';
import { count as formatCount } from '@/lib/format';
import { GRADE_ORDER, gradeMeta } from '@/lib/constants';
import Checkbox from '@/components/ui/Checkbox';
import Skeleton from '@/components/ui/Skeleton';
import useFilterStore from '@/store/filterStore';
import { useTaxonomy } from '@/hooks/useCatalog';
import { useCatalogConfig } from '@/lib/catalogs';
import { pressable } from '@/lib/motion';
import { TREE_LEVEL_KEYS } from '@shared/catalog';

// Every finder level, the two a product type may add included (2026-10-02).
const LEVEL_BY_DEPTH = TREE_LEVEL_KEYS;

/** Facet rows shown before the list folds behind "See more". */
const FACET_PREVIEW = 8;

/**
 * Walks the tree down the currently selected path.
 *
 * Returns the trail of selected nodes and the choices sitting at the bottom of
 * it - the roots when nothing is picked, otherwise the deepest selection's
 * children. Tolerates a slug that no longer exists in the tree (a stale deep
 * link) by stopping where it loses the thread.
 */
function drillDown(tree, path) {
  const trail = [];
  let options = tree ?? [];

  for (const level of LEVEL_BY_DEPTH) {
    const slug = path[level];
    if (!slug) break;
    const node = options.find((entry) => entry.slug === slug);
    if (!node) break;
    trail.push({ level, node });
    options = node.children ?? [];
  }

  return { trail, options };
}

/**
 * The category filter, as a drill-down (brief §5.1).
 *
 * Was a nested accordion that rendered every root with an indented, rule-ruled
 * sub-tree hanging off whichever one was open. At four levels and 177 nodes it
 * gave a 264px rail a horizontal structure it had no room for: by the model
 * level the labels were indented into a 120px gutter and truncating.
 *
 * Amazon's department rail is the shape that fits - one level at a time. What
 * is chosen is a breadcrumb at the top, what is choosable is a flat list of
 * plain links below it, and every crumb goes back up. Nothing indents past one
 * step, so the deepest level reads at the same width as the shallowest.
 *
 * It still writes through the same store actions as the mega menu and the
 * wizard, and `setPathLevel` still cascades - so going back up a crumb clears
 * every level under it in the same tick.
 */
function CategoryTree({ tree, path, onSelect }) {
  const { trail, options } = drillDown(tree, path);

  return (
    <div className="px-2 pb-1">
      {trail.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => onSelect('deviceType', null, null)}
            className={cn(pressable, 'flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-brand hover:bg-brand-50')}
          >
            <ChevronLeft className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            All categories
          </button>

          <ul className="mt-0.5">
            {trail.map(({ level, node }, index) => {
              const isCurrent = index === trail.length - 1;

              return (
                <li key={level} style={{ paddingLeft: index * 10 }}>
                  {isCurrent ? (
                    // The bottom of the trail is where you are, so it is a
                    // heading, not a link back to itself.
                    <p className="flex items-center gap-2 px-2 py-1.5 text-md font-bold text-ink-900">
                      <span className="min-w-0 flex-1 truncate">{node.name}</span>
                      <span className="tnum shrink-0 text-xs font-medium text-ink-300">
                        {formatCount(node.count)}
                      </span>
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(level, node.slug, node.name)}
                      className={cn(pressable, 'flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm text-ink-500 hover:bg-surface-2 hover:text-ink-900')}
                    >
                      <ChevronLeft className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{node.name}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {options.length > 0 && (
        <ul className={cn(trail.length > 0 && 'mt-0.5 pl-2.5')}>
          {options.map((node) => {
            const level = LEVEL_BY_DEPTH[trail.length];
            const hasChildren = (node.children?.length ?? 0) > 0;

            return (
              <li key={node.slug}>
                <button
                  type="button"
                  onClick={() => onSelect(level, node.slug, node.name)}
                  className={cn(pressable, 'group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-md text-ink-700 hover:bg-surface-2 hover:text-brand-700')}
                >
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  <span className="tnum shrink-0 text-xs text-ink-300">
                    {formatCount(node.count)}
                  </span>
                  {/* A chevron only where there is another level under it, so
                      the list says which rows drill and which just filter. */}
                  {hasChildren && (
                    <ChevronRight
                      className="size-3.5 shrink-0 text-ink-200 transition-colors group-hover:text-brand"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {trail.length > 0 && options.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-ink-300">Narrowed to a single model.</p>
      )}
    </div>
  );
}

/**
 * A checkbox facet list.
 *
 * Part types run past twenty options on a broad result set, which pushed grade
 * and availability under the fold on a laptop. Everything past `FACET_PREVIEW`
 * folds behind a "See more" - the same tradeoff Amazon makes - with anything
 * already ticked kept visible so a live filter is never hidden.
 *
 * **The rows do not move when you tick one.** This used to re-sort ticked
 * options to the top on every render, so the row you clicked jumped out from
 * under the cursor and the one below took its place - which is how a second
 * click lands on the wrong filter. The list keeps the server's order.
 *
 * The guarantee the sort was there for is kept a cheaper way: the preview is
 * the first `FACET_PREVIEW` options PLUS any ticked option that falls outside
 * them, appended in the list's own order. So a tick near the bottom stays
 * visible without disturbing anything above it, and untickng it removes a row
 * from the end rather than reshuffling the whole column.
 */
function FacetList({ options, isChecked, onToggle, renderLabel }) {
  const [expanded, setExpanded] = useState(false);

  const preview = options.slice(0, FACET_PREVIEW);
  const checkedBeyond = options
    .slice(FACET_PREVIEW)
    .filter((option) => isChecked(option.value));

  const shown = expanded ? options : [...preview, ...checkedBeyond];
  const hidden = options.length - shown.length;

  return (
    <>
      {shown.map((option) => (
        <Checkbox
          key={option.value}
          label={renderLabel ? renderLabel(option) : option.label}
          count={option.count}
          checked={isChecked(option.value)}
          onChange={() => onToggle(option.value, option)}
        />
      ))}

      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={cn(pressable, 'mt-0.5 flex items-center gap-1 px-2 py-1 text-sm font-medium text-brand hover:text-brand-700')}
        >
          <ChevronDown
            className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-180')}
            strokeWidth={2.25}
            aria-hidden="true"
          />
          {expanded ? 'See less' : `See ${hidden} more`}
        </button>
      )}
    </>
  );
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-line py-3 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-1 flex w-full items-center justify-between gap-2 px-2 py-1 text-left"
      >
        {/* Amazon's rail headings are dark and bold rather than a grey
            eyebrow: they are the labels you scan the column by, and at
            uppercase-11px-grey they sat quieter than the options under them. */}
        <span className="font-display text-md font-bold text-ink-900">{title}</span>
        <ChevronDown
          className={cn(
            'size-4 text-ink-300 transition-transform duration-200',
            !open && '-rotate-90',
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      {open && children}
    </div>
  );
}

export function SidebarFilter({ facets, className }) {
  const { data: tree, isLoading } = useTaxonomy();
  // Section titles and which sections exist follow the catalogue in context.
  const catalog = useCatalogConfig();

  const { path, facetState, setPathLevel, toggleFacet, toggleComponentType, toggleAttribute, setFacet } = useFilterStore(
    useShallow((s) => ({
      path: s.path,
      facetState: s.facets,
      setPathLevel: s.setPathLevel,
      toggleFacet: s.toggleFacet,
      toggleComponentType: s.toggleComponentType,
      toggleAttribute: s.toggleAttribute,
      setFacet: s.setFacet,
    })),
  );

  // A product type's grades read in the type's own order and names (grades per
  // type, 2026-10-02: Parts' five, Phones' Excellent, Good, Fair); services
  // arrive ordered and labelled by the server.
  const order = catalog.grades?.length ? catalog.grades.map((grade) => grade.value) : GRADE_ORDER;
  const rank = (value) => (order.includes(value) ? order.indexOf(value) : order.length);
  const gradeOptions =
    catalog.kind === 'part'
      ? [...(facets?.grade ?? [])]
          // A type with no grades leaves its products without one: no option for it.
          .filter((option) => option.value)
          .sort((a, b) => rank(a.value) - rank(b.value))
          .map((option) => ({
            value: option.value,
            label: gradeMeta(option.value, catalog.grades).label,
            count: option.count,
          }))
      : (facets?.grade ?? []);

  return (
    <aside className={cn('rounded-lg border border-line bg-surface', className)}>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <SlidersHorizontal className="size-4 text-ink-400" strokeWidth={2} aria-hidden="true" />
        <h2 className="font-display text-md font-bold">Filters</h2>
      </header>

      {/* pb-4, not py-1: the last section drops its bottom rule, so without it
          the closing row of options sits on the rail's own border. */}
      <div className="px-2 pb-4 pt-1">
        {/* Component type leads, matching the wizard's order (Component Type >
            Device Type > Brand > Series > Model). Multi-select on all three
            surfaces now - a buyer sourcing a repair kit ticks screen AND
            battery, and the wizard and mega menu take the same ticks.

            `toggleComponentType`, not `toggleFacet`, so the label is recorded
            for the chips and the wizard's first tab. It does NOT clear the
            category path: a buyer who has drilled to a model and then ticks
            Battery wants that model's battery, and resetting them to the top of
            the tree throws away the more specific thing they said. */}
        {catalog.facetLabel && facets?.partType?.length > 0 && (
          <Section title={catalog.facetLabel}>
            <FacetList
              options={facets.partType}
              isChecked={(value) => facetState.partType.includes(value)}
              onToggle={(value, option) => toggleComponentType(value, option?.label ?? null)}
            />
          </Section>
        )}

        <Section title="Category">
          {isLoading ? (
            <div className="space-y-2 px-2 py-1">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            <CategoryTree tree={tree} path={path} onSelect={setPathLevel} />
          )}
        </Section>

        {/* The product type's own features marked "Website filter" in ERP ›
            Settings (2026-10-02), each counted without its own ticks. */}
        {(facets?.attributes ?? []).map((feature) => (
          <Section key={feature.key} title={feature.label}>
            <FacetList
              options={feature.options}
              isChecked={(value) => (facetState.attrs?.[feature.key] ?? []).includes(value)}
              onToggle={(value) => toggleAttribute(feature.key, value)}
            />
          </Section>
        ))}

        {gradeOptions.length > 0 && (
          <Section title={catalog.gradeTitle}>
            <FacetList
              options={gradeOptions}
              isChecked={(value) => facetState.grade.includes(value)}
              onToggle={(value) => toggleFacet('grade', value)}
            />
          </Section>
        )}

        {catalog.hasAvailability && (
          <Section title="Availability">
            <Checkbox
              label="In stock"
              count={facets?.availability?.inStock}
              checked={facetState.inStockOnly}
              onChange={(event) => setFacet('inStockOnly', event.target.checked)}
            />
          </Section>
        )}
      </div>
    </aside>
  );
}

export default SidebarFilter;
