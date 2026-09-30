import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import useFilterStore, { toQueryParams } from '@/store/filterStore';

/**
 * Applies a taxonomy path from anywhere in the app.
 *
 * The filter UIs write to the store and the grid re-renders over AJAX - which
 * works perfectly while the grid is on screen. It is the ONLY thing that used
 * to happen, though, so picking a category from the header on /about, /blog or
 * /checkout wrote state nobody was subscribed to and the click did nothing at
 * all. The store is only the whole answer on the Shop page; everywhere else the
 * filter has to bring the user to the grid it filters.
 *
 * So: set the store either way - that is what the grid reads and what keeps the
 * sidebar, mega menu and wizard in step - and navigate to the Shop page only
 * when we are not already on it. Staying put on `/shop` preserves the no-reload
 * behaviour the filter architecture is built around.
 *
 * **The grid lives at `/shop`, not `/`** (2026-09-14). Both the guard and the
 * destination below said `/` while that was the catalogue, and neither moved
 * when the homepage took the root: the guard then matched the HOMEPAGE, so a
 * mega-menu tick made there set the store, decided it was already on the grid,
 * and navigated nowhere - the menu closed and nothing happened. The same
 * mistake sent every other page's filter click to the homepage, which does not
 * read the filter store at all.
 *
 * The URL we navigate with carries the same query string `useFilterUrlSync`
 * would have written, so a mid-navigation refresh or a copied link lands on the
 * same filtered grid, and the Shop page's URL->store hydration reads back
 * exactly what we just set.
 */
function useGoToFilteredShop() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return useCallback(() => {
    if (pathname === '/shop') return;

    // Built from the store's own serializer rather than from the caller's
    // argument, so a facet or a search term already in play survives the jump.
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(toQueryParams(useFilterStore.getState()))) {
      if (value === null || value === undefined || value === '') continue;
      if (Array.isArray(value)) {
        if (value.length) params.set(key, value.join(','));
      } else {
        params.set(key, String(value));
      }
    }

    const query = params.toString();
    navigate(query ? `/shop?${query}` : '/shop');
  }, [navigate, pathname]);
}

export function useApplyFilterPath() {
  const setPath = useFilterStore((s) => s.setPath);
  const goToShop = useGoToFilteredShop();

  return useCallback(
    (partial, labels = {}) => {
      setPath(partial, labels);
      goToShop();
    },
    [setPath, goToShop],
  );
}

/**
 * A component type plus a path beneath it, applied together - the mobile
 * menu's Shop › Parts drill-down, which walks the same order as the tab
 * wizard (Component Type → Device Type → Brand → Series → Model).
 *
 * `setComponentTypes` resets the path, so it runs first and the path is laid
 * over it; the other way round the component would wipe the path it was just
 * given.
 */
export function useApplyPartsPath() {
  const setComponentTypes = useFilterStore((s) => s.setComponentTypes);
  const setPath = useFilterStore((s) => s.setPath);
  const goToShop = useGoToFilteredShop();

  return useCallback(
    (component, partial = {}, labels = {}) => {
      setComponentTypes(component ? [component.slug] : null, component ? { [component.slug]: component.name } : {});
      setPath(partial, labels);
      goToShop();
    },
    [setComponentTypes, setPath, goToShop],
  );
}

/**
 * The same escape hatch for the header's search field, which has the identical
 * problem: submitting a search from /about set `q` on a store with no grid
 * listening, and the field just cleared itself.
 */
export function useApplySearchQuery() {
  const setQuery = useFilterStore((s) => s.setQuery);
  const goToShop = useGoToFilteredShop();

  return useCallback(
    (term) => {
      setQuery(term);
      goToShop();
    },
    [setQuery, goToShop],
  );
}

export default useApplyFilterPath;
