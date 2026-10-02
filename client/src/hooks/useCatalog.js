import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { LEGACY_PATHS, SYSTEM_SLUGS } from '@shared/catalog';
import { useShallow } from 'zustand/react/shallow';
import api from '@/lib/api';
import { useFilterStore, toQueryParams } from '@/store/filterStore';
import { catalogFrom, useCatalogConfig } from '@/lib/catalogs';

/**
 * The tree request for the catalogue in context (`lib/catalogs.js`). Parts
 * keeps its bare `/taxonomy` and its old query key, so every cached Parts
 * tree and every invalidation of `['taxonomy']` behave as before.
 */
function taxonomyRequest(category, partType) {
  const params = {
    ...(category && category !== 'parts' ? { category } : {}),
    ...(partType ? { partType } : {}),
  };
  return () => api.get('/taxonomy', Object.keys(params).length ? params : undefined);
}

const treeKey = (category) => (category && category !== 'parts' ? ['taxonomy', 'category', category] : ['taxonomy']);

/** The full category tree. One request feeds sidebar, mega menu and wizard. */
export function useTaxonomy() {
  const { slug } = useCatalogConfig();
  return useQuery({
    queryKey: treeKey(slug),
    queryFn: taxonomyRequest(slug),
    staleTime: 10 * 60 * 1000,
    select: (data) => data.tree,
  });
}

/**
 * The component types, from the same request the tree comes on.
 *
 * **A second hook rather than a wider `useTaxonomy`.** `GET /api/taxonomy`
 * answers `{ tree, componentTypes }`, but `useTaxonomy` selects `data.tree` and
 * six callers rely on its result *being* the tree array - widening the select
 * would break all of them to fix one. Two hooks over one query key means one
 * request still serves both, and each caller gets the shape it expects.
 *
 * This existing gap is why the component-type picker rendered its empty state:
 * it read `.componentTypes` off the bare tree array and always found nothing,
 * so the purchase-order form offered no types and the supplier picker below it
 * had nothing to filter on.
 */
export function useComponentTypes() {
  const { slug } = useCatalogConfig();
  return useQuery({
    queryKey: treeKey(slug),
    queryFn: taxonomyRequest(slug),
    staleTime: 10 * 60 * 1000,
    select: (data) => data.componentTypes ?? [],
  });
}

/**
 * The taxonomy as the wizard needs it: the component types for step 1, and a
 * tree pruned to the chosen component for steps 2-5.
 *
 * Pruning is the server's job (`?partType=`) because only it can tell which
 * branches actually stock a component. Without a component chosen this is the
 * full tree, so the wizard's first step renders against real data too.
 *
 * `keepPreviousData` so switching component type does not blank the steps
 * below while the new tree is in flight - they are about to be reset anyway,
 * and a flash of empty cards reads as a bug.
 */
export function useWizardTaxonomy(partType) {
  const { slug } = useCatalogConfig();
  return useQuery({
    queryKey: [...treeKey(slug), partType ?? null],
    queryFn: taxonomyRequest(slug, partType),
    staleTime: 10 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

/**
 * Every part type the catalogue actually carries, with its label.
 *
 * Read from the unfiltered facet counts rather than a hardcoded list, so an
 * admin form can never target a part type that does not exist. One row of
 * products is requested because the facets ride along with any product response.
 */
export function usePartTypes() {
  return useQuery({
    queryKey: ['facets', 'partType'],
    queryFn: () => api.get('/products', { limit: 1 }),
    select: (data) => data.facets?.partType ?? [],
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * The product grid query.
 *
 * `placeholderData: keepPreviousData` is load-bearing: the previous grid stays
 * on screen while the next one loads, so changing a filter reads as instant
 * rather than as a flash of empty page.
 */
export function useProducts() {
  const catalog = useCatalogConfig();
  // useShallow is required: zustand v5 compares with Object.is, so returning a
  // fresh object from the selector without it re-renders on every store touch.
  const state = useFilterStore(
    useShallow((s) => ({
      path: s.path,
      facets: s.facets,
      q: s.q,
      sort: s.sort,
      page: s.page,
    })),
  );

  // Another part-kind category asks `/products` for its own; phones and
  // services ask their own endpoints the same question.
  const params = {
    ...toQueryParams(state),
    ...(catalog.kind === 'part' && catalog.slug !== 'parts' ? { category: catalog.slug } : {}),
  };

  return useQuery({
    queryKey: catalog.slug === 'parts' ? ['products', params] : ['catalog', catalog.slug, params],
    queryFn: ({ signal }) => api.get(catalog.endpoint, params, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

/** Header type-ahead. Only fires from two characters up. */
export function useSearchSuggestions(q) {
  return useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => api.get('/products/search', { q }, { signal }),
    enabled: q.trim().length >= 2,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Everything the homepage renders, in one request.
 *
 * Kept generous on `staleTime`: these are merchandising rows, not stock levels,
 * and refetching them because somebody tabbed away and back would repaint the
 * page under a reader for no new information.
 */
export function useHomeSections() {
  return useQuery({
    queryKey: ['home'],
    queryFn: ({ signal }) => api.get('/products/home', undefined, { signal }),
    staleTime: 5 * 60 * 1000,
  });
}

/** The clearance page. Paged like the catalogue, filtered by nothing else. */
export function useClearance({ page = 1, sort = 'newest' } = {}) {
  return useQuery({
    queryKey: ['clearance', { page, sort }],
    queryFn: ({ signal }) => api.get('/products/clearance', { page, sort }, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

/**
 * A catalogue category as its shop page is configured (`lib/catalogs.js`).
 *
 * The three system pages render at once from the built-in definition and pick
 * up the business's own names (a renamed "Repair Type", say) when the record
 * lands; a category a business added has no built-in definition, so its page
 * waits for the record and `isError` covers a slug that does not exist.
 */
export function useCatalogCategory(slug) {
  const query = useQuery({
    queryKey: ['catalog-category', slug],
    queryFn: () => api.get(`/catalog/categories/${slug}`),
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const catalog = useMemo(
    // A type switched off answers 404 and has no page, Parts, Phones and
    // Services included (2026-10-02); while the answer is on its way, theirs
    // is drawn from the defaults so the page does not flash.
    () =>
      query.data?.category
        ? catalogFrom(query.data.category)
        : !query.isError && SYSTEM_SLUGS.includes(slug)
          ? catalogFrom({ slug })
          : null,
    [query.data, query.isError, slug],
  );
  return { catalog, isLoading: query.isLoading, isError: query.isError, error: query.error };
}

/** The website's active categories, for the Shop menu. */
export function useCatalogCategories() {
  return useQuery({
    queryKey: ['catalog-categories'],
    queryFn: () => api.get('/catalog/categories'),
    staleTime: 5 * 60 * 1000,
    select: (data) => data.categories ?? [],
  });
}

/**
 * A link written against a type's old address (`/shop`, `/pre-owned`,
 * `/services`), turned into its page under `/catalogue` (2026-10-03), so a
 * menu points at the live address and can tell when it is the page open.
 * Anything else, or an old address before the types have loaded, is returned
 * as it is (the old addresses redirect).
 */
export function useCatalogueLink() {
  const { data: categories = [] } = useCatalogCategories();
  return (to) => {
    const [path, query = ''] = String(to ?? '').split('?');
    const slug = Object.entries(LEGACY_PATHS).find(([, legacy]) => legacy === path)?.[0];
    const category = slug ? categories.find((entry) => entry.slug === slug) : null;
    return category ? `${category.path}${query ? `?${query}` : ''}` : to;
  };
}

/** One service's page on the website (`/services/:slug`, 2026-10-02). */
export function useServiceDetail(slug) {
  return useQuery({
    queryKey: ['service', slug],
    queryFn: () => api.get(`/services/${slug}`),
    enabled: Boolean(slug),
    staleTime: 60 * 1000,
    retry: false,
  });
}
