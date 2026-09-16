import { create } from 'zustand';
import { TREE_LEVELS } from '@/lib/constants';

/**
 * THE unified filter state (PROJECT_INSTRUCTIONS.md §4).
 *
 * Three UIs write to this one store - the sidebar accordion, the header mega
 * menu, and the tab wizard. They never mutate state directly; they call the
 * actions below. The product grid is the only subscriber that triggers a fetch.
 */

const LEVELS = TREE_LEVELS.map((l) => l.key); // deviceType, brand, series, model

const emptyPath = () => ({ deviceType: null, brand: null, series: null, model: null });

const emptyFacets = () => ({
  partType: [],
  grade: [],
  inStockOnly: false,
  priceMin: null,
  priceMax: null,
});

const initial = {
  path: emptyPath(),
  // Display names for the chosen component types, keyed by slug, so the wizard's
  // first tab reads "Battery" rather than "battery" without a lookup.
  //
  // A MAP rather than a single string: component type is multi-select, and a
  // buyer who has ticked Battery and Screen needs both names - the old scalar
  // could only ever name one of them.
  componentLabels: {},
  // Human-readable labels for the active path, so chips and completed wizard
  // tabs can render "Galaxy S23 Ultra" without another lookup.
  labels: emptyPath(),
  facets: emptyFacets(),
  q: '',
  sort: 'relevance',
  page: 1,
};

export const useFilterStore = create((set, get) => ({
  ...initial,

  /**
   * Sets one level of the hierarchy and CASCADES: every level below it is
   * cleared. This is what makes out-of-order wizard edits safe - picking a new
   * brand can never leave a stale model attached to it.
   */
  setPathLevel(level, value, label = null) {
    const index = LEVELS.indexOf(level);
    if (index === -1) return;

    set((state) => {
      const path = { ...state.path };
      const labels = { ...state.labels };

      path[level] = value;
      labels[level] = label;

      for (const below of LEVELS.slice(index + 1)) {
        path[below] = null;
        labels[below] = null;
      }

      return { path, labels, page: 1 };
    });
  },

  /**
   * Step 1 of the wizard: the component types it is walking.
   *
   * Multi-select - a buyer wanting Battery AND Screen is a legitimate thing to
   * want, and the sidebar always allowed it. The wizard, the mega menu and the
   * sidebar now all read and write this one list, so a tick in any of them is
   * the same tick.
   */
  componentTypes() {
    return get().facets.partType;
  },

  /**
   * Adds or removes one component type. The chosen path is KEPT.
   *
   * Component type is a facet that cuts across the tree, not a level above it.
   * A buyer who has drilled to "iPhone 15 Pro" and then ticks Battery is asking
   * for that model's battery - the most specific thing they have said is the
   * model, and clearing it throws away the better answer to honour the newer
   * one. This used to reset the path on every tick, which sent anyone filtering
   * in that order back to step 1.
   *
   * Nor does keeping it risk an empty grid. The path and the component types are
   * independent filters over one product query: a model that stocks no battery
   * simply returns nothing for that pair, which is a true answer, and the
   * sidebar's own counts show it coming. `ActiveFilterChips` lists both, so
   * whichever the buyer wants to drop is one click away.
   *
   * The wizard is the exception and handles it itself - see `wizardComponentType`,
   * which is what step 1 calls. There the tree below is genuinely re-derived
   * from the component, so a stale path would be offered from a tree it was
   * never chosen in.
   */
  toggleComponentType(slug, label = null) {
    if (!slug) return;

    set((state) => {
      const current = state.facets.partType;
      const has = current.includes(slug);
      const partType = has ? current.filter((v) => v !== slug) : [...current, slug];

      const componentLabels = { ...state.componentLabels };
      if (has) delete componentLabels[slug];
      else if (label) componentLabels[slug] = label;

      return {
        facets: { ...state.facets, partType },
        componentLabels,
        page: 1,
      };
    });
  },

  /**
   * Step 1 of the WIZARD: the same toggle, but cascading the tree beneath it.
   *
   * Only the wizard resets the path, and only because it then walks the buyer
   * back down a tree that has been re-pruned to the new component - offering
   * step 2 from one tree while step 5 still holds an answer from another is how
   * the wizard ends up proposing a combination that stocks nothing. The sidebar
   * and mega menu are not walking anybody anywhere, so they keep the path.
   */
  wizardComponentType(slug, label = null) {
    if (!slug) return;

    get().toggleComponentType(slug, label);
    set({ path: emptyPath(), labels: emptyPath() });
  },

  /**
   * Replaces the whole component-type selection at once.
   *
   * `null` clears it - which is what `clearLevel('componentType')` wants, and
   * what the wizard's "start over" does.
   */
  setComponentTypes(slugs, labels = {}) {
    const list = Array.isArray(slugs) ? slugs.filter(Boolean) : slugs ? [slugs] : [];

    set((state) => ({
      facets: { ...state.facets, partType: list },
      componentLabels: list.length ? { ...labels } : {},
      path: emptyPath(),
      labels: emptyPath(),
      page: 1,
    }));
  },

  /** Applies a whole path at once - used when the mega menu jumps straight to a model. */
  setPath(partial, labels = {}) {
    set((state) => {
      const path = { ...emptyPath(), ...partial };
      const nextLabels = { ...emptyPath(), ...labels };
      return { path, labels: nextLabels, page: 1, q: state.q };
    });
  },

  clearLevel(level) {
    // Clearing step 1 clears everything below it, since the whole tree the
    // lower steps were chosen from was pruned to that component.
    if (level === 'componentType') {
      get().setComponentTypes(null);
      return;
    }
    get().setPathLevel(level, null, null);
  },

  /**
   * Fills in display names for levels that only have a slug - the case after a
   * deep link or a refresh, where the URL carries slugs but no labels.
   * Does not touch the path, so it never triggers a refetch.
   */
  setLabels(partial) {
    set((state) => ({ labels: { ...state.labels, ...partial } }));
  },

  toggleFacet(key, value) {
    set((state) => {
      const current = state.facets[key];
      if (!Array.isArray(current)) return state;
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { facets: { ...state.facets, [key]: next }, page: 1 };
    });
  },

  setFacet(key, value) {
    set((state) => ({ facets: { ...state.facets, [key]: value }, page: 1 }));
  },

  clearFacets() {
    set({ facets: emptyFacets(), page: 1 });
  },

  setQuery(q) {
    set({ q, page: 1 });
  },

  setSort(sort) {
    set({ sort, page: 1 });
  },

  setPage(page) {
    set({ page });
  },

  resetAll() {
    set({
      ...initial,
      path: emptyPath(),
      labels: emptyPath(),
      facets: emptyFacets(),
      componentLabels: {},
    });
  },

  /**
   * How many wizard steps are answered, component type included - it is step 1,
   * so a set path with no component is depth 1, not depth 2.
   */
  depth() {
    const { path } = get();
    if (get().componentTypes().length === 0) return 0;

    let depth = 1;
    for (const level of LEVELS) {
      if (!path[level]) break;
      depth += 1;
    }
    return depth;
  },

  hasAnyFilter() {
    const { path, facets, q } = get();
    return (
      LEVELS.some((l) => path[l]) ||
      facets.partType.length > 0 ||
      facets.grade.length > 0 ||
      facets.inStockOnly ||
      facets.priceMin !== null ||
      facets.priceMax !== null ||
      q.length > 0
    );
  },
}));

/** The serialized query the API and the URL both consume. */
export function toQueryParams(state) {
  return {
    deviceType: state.path.deviceType,
    brand: state.path.brand,
    series: state.path.series,
    model: state.path.model,
    partType: state.facets.partType,
    grade: state.facets.grade,
    inStockOnly: state.facets.inStockOnly || null,
    priceMin: state.facets.priceMin,
    priceMax: state.facets.priceMax,
    q: state.q || null,
    sort: state.sort === 'relevance' ? null : state.sort,
    page: state.page > 1 ? state.page : null,
  };
}

/**
 * The filter state as a query string.
 *
 * **One serialiser, two callers**, and they must not drift: `useFilterUrlSync`
 * writes the URL with it while the Shop page is open, and the homepage builds
 * the link it navigates to with it. A second copy that spelled one facet
 * differently would produce a URL the hook then re-hydrates into a DIFFERENT
 * filter - and because that hook treats the URL as the whole state, the
 * difference would not be a missing filter but a silently wrong one.
 *
 * Empty string is dropped alongside null: an absent value and a blank one mean
 * the same thing to every facet here, and `?q=` in a shared link is noise.
 */
export function toSearchParams(state) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(toQueryParams(state))) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
      continue;
    }
    params.set(key, String(value));
  }

  return params;
}

export default useFilterStore;
