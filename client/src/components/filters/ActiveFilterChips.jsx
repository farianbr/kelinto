import { useShallow } from 'zustand/react/shallow';
import Chip from '@/components/ui/Chip';
import { gradeMeta } from '@/lib/constants';
import { useCatalogConfig } from '@/lib/catalogs';
import useFilterStore from '@/store/filterStore';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * A single readout of everything the three filter systems have set. Without it
 * a user who filtered via the mega menu has no idea why the grid is narrow.
 */
export function ActiveFilterChips({ facetMeta }) {
  // Chip labels follow the catalogue in context: "Repair" on Services, "Model"
  // everywhere, and no facet chip on Phones, which has no such step.
  const catalog = useCatalogConfig();
  const { path, labels, facets, q, clearLevel, toggleFacet, toggleAttribute, setFacet, setQuery, resetAll } =
    useFilterStore(
      useShallow((s) => ({
        path: s.path,
        labels: s.labels,
        facets: s.facets,
        q: s.q,
        clearLevel: s.clearLevel,
        toggleFacet: s.toggleFacet,
        toggleAttribute: s.toggleAttribute,
        setFacet: s.setFacet,
        setQuery: s.setQuery,
        resetAll: s.resetAll,
      })),
    );

  const chips = [];

  if (q) chips.push({ key: `q`, label: 'Search', value: q, onRemove: () => setQuery('') });

  // Component type leads, matching the filter hierarchy the wizard and sidebar
  // both present (Component Type > Device Type > Brand > Series > Model).
  for (const value of facets.partType) {
    const meta = facetMeta?.partType?.find((p) => p.value === value);
    chips.push({
      key: `part-${value}`,
      label: catalog.facetShort || 'Type',
      value: meta?.label ?? value,
      onRemove: () => toggleFacet('partType', value),
    });
  }

  for (const level of catalog.levels) {
    if (!path[level.key]) continue;
    chips.push({
      key: `path-${level.key}`,
      label: level.short,
      value: labels[level.key] ?? path[level.key],
      onRemove: () => clearLevel(level.key),
    });
  }

  // Feature filters (2026-10-02), named and worded from the facet the server sent.
  for (const [key, values] of Object.entries(facets.attrs ?? {})) {
    const meta = facetMeta?.attributes?.find((feature) => feature.key === key);
    for (const value of values) {
      chips.push({
        key: `attr-${key}-${value}`,
        label: meta?.label ?? key,
        value: meta?.options?.find((option) => option.value === value)?.label ?? value,
        onRemove: () => toggleAttribute(key, value),
      });
    }
  }

  for (const value of facets.grade) {
    chips.push({
      key: `grade-${value}`,
      label: 'Grade',
      value: facetMeta?.grade?.find((g) => g.value === value)?.label ?? gradeMeta(value, catalog.grades).label,
      onRemove: () => toggleFacet('grade', value),
    });
  }

  if (facets.inStockOnly) {
    chips.push({
      key: 'stock',
      label: null,
      value: 'In stock',
      onRemove: () => setFacet('inStockOnly', false),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Chip key={chip.key} label={chip.label} value={chip.value} onRemove={chip.onRemove} />
      ))}

      {chips.length > 1 && (
        <button
          type="button"
          onClick={resetAll}
          className={cn(pressable, 'ml-1 text-sm font-medium text-ink-400 underline-offset-2 hover:text-brand hover:underline')}
        >
          Clear all
        </button>
      )}
    </div>
  );
}

export default ActiveFilterChips;
