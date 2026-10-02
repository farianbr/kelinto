import { createContext, createElement, useContext } from 'react';
import { SYSTEM_CATEGORIES } from '@shared/catalog';
import { SORT_OPTIONS } from '@/lib/constants';

/**
 * Which catalogue a shop page is showing (2026-10-01).
 *
 * Parts, Phones, Services and any category a business adds are all built like
 * the Parts page: the finder, the filter rail, the grid. They share the one
 * filter store, the one URL sync and the same three filter UIs, so what
 * differs is said once, here: which endpoint answers, which tree the finder
 * walks, what its steps are called, and what the first, cross-cutting step is
 * (Component Type for parts, Repair Type for services, none for phones).
 *
 * Provided by `CatalogProvider` around a shop page. Everything outside one
 * (the mega menu, the homepage finder, the ERP's pickers) reads the default,
 * which is Parts, so none of those changed.
 */

/**
 * What one item is called on a page. By kind, except that Phones are products
 * like Parts since 2026-10-02 and still read as phones, and a type a business
 * adds reads as products until it is named otherwise.
 */
const NOUNS = {
  parts: { one: 'part', many: 'parts' },
  phones: { one: 'phone', many: 'phones' },
  service: { one: 'service', many: 'services' },
  part: { one: 'product', many: 'products' },
};

const SORTS = {
  part: SORT_OPTIONS,
  service: [
    { value: 'relevance', label: 'Most booked' },
    { value: 'name-asc', label: 'Name: A–Z' },
    { value: 'price-asc', label: 'Price: low–high' },
    { value: 'price-desc', label: 'Price: high–low' },
  ],
};

const FINDER = { service: 'Find your repair' };

/** A category record (or a system one) as a page's configuration. */
export function catalogFrom(category) {
  const system = SYSTEM_CATEGORIES.find((entry) => entry.slug === category?.slug);
  const source = { ...system, ...category };
  // `phone` was a kind until 2026-10-02; an old payload still reads as products.
  const kind = source.kind === 'service' ? 'service' : 'part';
  const nouns = NOUNS[source.slug] ?? NOUNS[kind];
  const levels = (source.levels?.length ? source.levels : SYSTEM_CATEGORIES[0].levels).map((level) => ({
    key: level.key,
    label: level.label,
    short: level.label.split(' ')[0],
  }));
  const facetLabel = source.facetLabel ?? '';

  return {
    slug: source.slug ?? 'parts',
    kind,
    title: source.name ?? 'Parts',
    description: source.description ?? '',
    // The endpoint that answers the grid's query, and the key its list rides on.
    endpoint: kind === 'service' ? '/services' : '/products',
    itemsKey: kind === 'part' ? 'products' : 'items',
    facetLabel,
    facetShort: facetLabel ? facetLabel.split(' ')[0] : '',
    levels,
    // The finder's steps: the cross-cutting facet first when there is one.
    steps: facetLabel
      ? [{ key: 'componentType', label: facetLabel, short: facetLabel.split(' ')[0] }, ...levels]
      : levels,
    finderTitle: FINDER[kind] ?? `Find your ${nouns.one}`,
    noun: nouns.one,
    nouns: nouns.many,
    sortOptions: SORTS[kind],
    // Only products carry a stock count the rail can filter on.
    hasAvailability: kind === 'part',
    // The type's own grades, in its order, with their names (grades per type).
    grades: source.grades ?? [],
    gradeTitle: source.slug === 'parts' ? 'Condition Grade' : 'Condition',
  };
}

export const PARTS_CATALOG = catalogFrom({ slug: 'parts' });

const CatalogContext = createContext(PARTS_CATALOG);

export function CatalogProvider({ catalog, children }) {
  return createElement(CatalogContext.Provider, { value: catalog }, children);
}

export function useCatalogConfig() {
  return useContext(CatalogContext);
}
