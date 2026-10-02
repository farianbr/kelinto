import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useFilterStore, toSearchParams } from '@/store/filterStore';

/**
 * Mirrors the filter store into the URL, and hydrates it from the URL on mount.
 * The store is the source of truth after that - the URL is a projection, which
 * keeps deep links, refresh and the back button all working without the two
 * ever fighting each other.
 *
 * **Hydration runs BEFORE paint, and it is a full reset.** Both halves of that
 * were bugs.
 *
 * The store is a module-level Zustand store, so it outlives any one mount of
 * the Shop page; the "have I hydrated yet" ref does not. Arriving at
 * `/shop?deviceType=smartphone` from a link on another page therefore mounted
 * a fresh ShopPage against a store still holding whatever the last visit left
 * in it - and `useProducts` reads the store during that first render, so an
 * UNFILTERED request went out before the hydrating effect had run. The URL said
 * one thing, the grid showed another, and the chip row showed a filter that was
 * not applied. `useLayoutEffect` closes that window: the store is correct
 * before anything renders against it.
 *
 * And hydration now writes every key, including the ones the URL does not
 * carry. Setting only what was present meant a filter left over from a previous
 * visit survived a navigation that never mentioned it, so `/shop` could show a
 * narrowed catalogue with nothing on screen explaining why. A URL is the whole
 * filter state, not a patch over it.
 *
 * ## One owner at a time (2026-10-02)
 *
 * Parts, Phones and Services are all `CatalogPage`, so moving between two of
 * them unmounts one copy of this hook and mounts another against the same
 * store. React runs the arriving page's layout effects (its hydration) BEFORE
 * the leaving page's passive cleanup, so for one commit both were live:
 *
 * - the leaving page's subscription saw the arriving page's hydration and
 *   called its own `setSearchParams`, which resolves `?…` against the page it
 *   was rendered on. That navigated BACK to the page being left; its hydration
 *   then did the same to the other one, and the website bounced between
 *   /services and /pre-owned until something broke the tie.
 * - the leaving page's cleanup then called `resetAll()`, wiping the filter the
 *   arriving page had just read from its URL.
 *
 * So the page that hydrated last owns the store (`owner`), and only the owner
 * writes the URL or resets on the way out. The URL write also checks that the
 * browser is still on this page's pathname, which covers a page that never
 * claims the store (the homepage clearing it on arrival).
 */
let owner = null;

export function useFilterUrlSync() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const hydrated = useRef(false);
  const token = useRef(null);
  if (token.current === null) token.current = Symbol('filter-url-sync');
  const ownPath = useRef(pathname);
  ownPath.current = pathname;

  // The query string this hook last wrote out. Used to tell OUR OWN url
  // updates apart from a real navigation - without it, re-hydrating on every
  // `searchParams` change would fight the store-to-URL effect below.
  const lastWritten = useRef(null);

  // ---- URL -> store ------------------------------------------------------
  useLayoutEffect(() => {
    const current = searchParams.toString();

    // A change this hook caused itself. The store already holds it.
    if (hydrated.current && current === lastWritten.current) return;

    // Claimed before the store is touched, so a leaving page's subscription
    // sees it has lost the store as soon as the first write below lands.
    owner = token.current;

    const store = useFilterStore.getState();
    const get = (key) => searchParams.get(key) || null;

    const path = {
      deviceType: get('deviceType'),
      brand: get('brand'),
      series: get('series'),
      model: get('model'),
      level5: get('level5'),
      level6: get('level6'),
    };
    // Always, not only when something is present: an absent level has to be
    // cleared, or it survives from the last visit.
    store.setPath(path);

    // setFacet, not setComponentType: hydrating must not cascade away the very
    // path the same URL is restoring. The wizard's label for it is filled in
    // once the taxonomy lands (see TabWizard's componentLabel effect).
    const partType = get('partType');
    const grade = get('grade');
    store.setFacet('partType', partType ? partType.split(',') : []);
    store.setFacet('grade', grade ? grade.split(',') : []);
    store.setFacet('inStockOnly', Boolean(get('inStockOnly')));
    store.setFacet('priceMin', get('priceMin') ? Number(get('priceMin')) : null);
    store.setFacet('priceMax', get('priceMax') ? Number(get('priceMax')) : null);
    // Feature filters, `a.<key>=v1,v2` (2026-10-02).
    const attrs = {};
    for (const [name, value] of searchParams.entries()) {
      if (name.startsWith('a.') && value) attrs[name.slice(2)] = value.split(',').filter(Boolean);
    }
    store.setFacet('attrs', attrs);
    store.setQuery(get('q') ?? '');
    store.setSort(get('sort') ?? 'relevance');
    store.setPage(get('page') ? Number(get('page')) : 1);

    hydrated.current = true;
    lastWritten.current = current;
  }, [searchParams]);

  // ---- store -> URL, on every change -------------------------------------
  useEffect(() => {
    /**
     * Stops this writing the URL of a page it no longer belongs to.
     *
     * **This trapped the reader on /shop.** React runs an arriving page's layout
     * effects BEFORE the leaving page's cleanup, so a layout effect on the
     * homepage that cleared the store fired while this subscription was still
     * attached. `setSearchParams` by then addressed the route just navigated TO,
     * writing catalogue parameters onto `/` - and `HomeOrShop` forwards any `/`
     * carrying one straight back to `/shop`. Home became unreachable from the
     * shop.
     *
     * The unsubscribe below was already correct; the window is the ordering, not
     * a leak. A flag closes it, because a store change arriving in that window
     * is by definition not about this page any more.
     */
    let live = true;

    const unsubscribe = useFilterStore.subscribe((state) => {
      if (!live || !hydrated.current || owner !== token.current) return;
      // Navigated away, and the cleanup has not run yet.
      if (window.location.pathname !== ownPath.current) return;

      // Shared with the homepage, which builds its `/shop` link the same way.
      const next = toSearchParams(state);
      const serialised = next.toString();
      // Remember what we are about to write, so the hydrating effect above
      // recognises the resulting `searchParams` change as our own.
      lastWritten.current = serialised;

      // replace: filtering should not stack fifty history entries.
      setSearchParams(next, { replace: true });
    });

    return () => {
      live = false;
      unsubscribe();

      // Another shop page has already hydrated the store from its own URL;
      // resetting now would throw that filter away.
      if (owner !== token.current) {
        hydrated.current = false;
        lastWritten.current = null;
        return;
      }
      owner = null;

      /**
       * The filter dies with the page that owned it.
       *
       * The store is a module singleton, so without this it survives into
       * every later screen - and the homepage's part finder opened with all
       * five steps already answered from the last visit to the shop, a
       * section headed "Find your part" with nothing left to ask.
       *
       * **It is cleared HERE rather than on the homepage**, and the ordering is
       * the whole reason. React runs an arriving page's layout effects before
       * the leaving page's cleanup, so a reset on the homepage fired while this
       * subscription was still attached: `setSearchParams` then addressed the
       * route just navigated TO, writing catalogue parameters onto `/`, and
       * `HomeOrShop` forwards any `/` carrying one straight back to `/shop`.
       * Home became unreachable from the shop. Clearing after `unsubscribe()`
       * means nothing is listening when it happens.
       *
       * Nothing is lost on a return trip: the hydrating effect above re-reads
       * the whole filter from the URL on every mount, so Back into
       * `/shop?deviceType=…` restores exactly what the link says.
       */
      useFilterStore.getState().resetAll();

      /**
       * **Cleared WITH the store, or the next mount reads a filter that is gone.**
       *
       * These two refs are what tells one of our own URL writes apart from a
       * real navigation, and they are only meaningful while the store still
       * holds what they describe. `resetAll()` above has just emptied it, so
       * leaving them set says "the store already holds this query string" about
       * a store that holds nothing.
       *
       * StrictMode is where that became a bug rather than a theory: it mounts,
       * unmounts and remounts every effect, so the reset fires BETWEEN two
       * mounts of the same page. The second mount then found `hydrated` true and
       * `lastWritten` equal to the URL it was about to hydrate from, took the
       * early return, and left the store empty - `/shop?deviceType=…` rendered
       * the whole catalogue with no chips, and so did every shared filter link.
       *
       * The same window exists without StrictMode on any remount at the same
       * URL, which is exactly what the wizard's "see parts" navigation is.
       */
      hydrated.current = false;
      lastWritten.current = null;
    };
  }, [setSearchParams]);
}

export default useFilterUrlSync;
