import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import useAdoptBusinessFromUrl from '@/hooks/useAdoptBusinessFromUrl';
import { Navigate, Outlet, useLocation } from 'react-router';
import Skeleton from '@/components/ui/Skeleton';
import RouteFallback from '@/components/layout/RouteFallback';
import Breadcrumbs from '@/components/admin/Breadcrumbs';
import { useAuth, useSignOut } from '@/hooks/useAuth';
import { useAdminStats, useAdminBusinesses } from '@/hooks/useAdmin';
import useBusinessTheme from '@/hooks/useBusinessTheme';
import {
  getBusiness,
  getBusinessColor,
  rememberBusiness,
  subscribeBusiness,
} from '@/store/businessStore';
import { matchAdminRoute } from '@/lib/adminRoutes';
import { featureEnabled } from '@shared/schemas/features';
import { DensityProvider } from '@/components/ui/density';
import SettingsTabs from '@/components/admin/settings/SettingsTabs';
import SignOutConfirm from '@/components/account/SignOutConfirm';
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';
import AdminSidebar from './AdminSidebar';
import AdminTopBar from './AdminTopBar';
import CommandPalette from './CommandPalette';
import { RecordLabelProvider } from './recordLabel';

// Only ever drawn for somebody the ERP turns away, so it is not in the chunk
// every staff member downloads.
const PanelSignInPage = lazy(() => import('@/pages/PanelSignInPage'));

/**
 * The ERP shell (§4). `/admin` mounts this instead of the storefront
 * `RootLayout` - the panel is a different application and should not carry the
 * shop header, mega menu or footer.
 *
 * It is also the UI half of the route guard. `requireAdmin` enforces it
 * server-side; this exists so a non-admin gets an honest wall rather than a
 * screen full of failed requests.
 */
export function AdminShell() {
  /**
   * `?business=` from the URL, before anything fetches.
   *
   * FIRST, and deliberately above `useAuth`: `sessionStorage` is per-tab and
   * empty in a new one, so opening any admin page in a new tab arrived with no
   * business selected and fell back to the default - a CellShoppe staff member
   * opening an invoice in a new tab watched the panel turn into Cellvix. This
   * runs in an initialiser rather than an effect so the id is in the store
   * before the first query reads it.
   */
  useAdoptBusinessFromUrl();

  // The browser tab, per route. One call per surface rather than one per
  // page: the titles live in the route table beside the breadcrumbs.
  const { user, isLoading, canUseAdmin, impersonation, features } = useAuth();
  // The shell's effect runs after its children's, so it has to agree with the
  // sign-in door it draws for a visitor or the tab reads "Dashboard" over it.
  useDocumentTitle(!isLoading && !canUseAdmin ? 'Sign in' : undefined);
  const signOut = useSignOut();
  const { data: stats } = useAdminStats();
  const location = useLocation();

  /**
   * The panel's accent, per business (SAAS_PLATFORM §1.1).
   *
   * Read from the same store the switcher writes and `lib/api.js` reads, so the
   * colour and the records can never disagree about which business is on
   * screen. A staff account never sees the switcher - their business is fixed
   * server-side - but they still get their business's colour, which is the
   * point: the panel should look like the business you are working in.
   *
   * `useAdminBusinesses` is already in flight for the switcher, so this shares
   * its cache rather than adding a request.
   *
   * **Before it resolves, the token comes from `sessionStorage`, not from
   * nowhere.** It used to come from nowhere, and the panel opened in the house
   * ramp for the length of one fetch: a CellShoppe admin reloading their own
   * panel saw it flash Cellvix red and then settle into indigo. The store
   * caches the token beside the id it already persists, so the first paint is
   * the right colour and the fetch only ever confirms it. See
   * `store/businessStore.js`.
   */
  const selectedBusiness = useSyncExternalStore(subscribeBusiness, getBusiness, getBusiness);
  const cachedColorToken = useSyncExternalStore(
    subscribeBusiness,
    getBusinessColor,
    getBusinessColor,
  );
  const { data: businessData } = useAdminBusinesses(
    canUseAdmin ? { status: 'all' } : undefined,
  );
  const businesses = businessData?.businesses ?? [];
  const activeBusiness =
    businesses.find((business) => business.id === selectedBusiness) ??
    // Staff are pinned and never select one, and an admin's first paint lands
    // here too, before the switcher has written its fallback.
    businesses.find((business) => business.id === String(user?.business ?? '')) ??
    businesses.find((business) => business.isDefault);
  /**
   * The record's own token wins the moment it exists; the cache covers the gap
   * before it does. They agree on every reload but the first after a change,
   * and where they disagree the record is the one telling the truth.
   */
  const colorToken = activeBusiness?.colorToken ?? cachedColorToken ?? undefined;
  const theme = useBusinessTheme(colorToken);

  // Keep the cache honest for the next reload. A no-op unless the token moved.
  useEffect(() => {
    if (activeBusiness) {
      rememberBusiness({ colorToken: activeBusiness.colorToken, name: activeBusiness.name });
    }
  }, [activeBusiness?.colorToken, activeBusiness?.name]);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  /**
   * The panel scrolls INSIDE `<main>`, not on the document, so none of the
   * browser's own scroll handling applies to it.
   *
   * Two things follow, and neither worked before. Arriving at a new route left
   * the reader wherever the last page happened to be scrolled to - halfway down
   * a screen they had never seen. And clicking the section you are already in
   * did nothing at all, when the one thing it can usefully mean is "take me
   * back to the top of this".
   */
  const mainRef = useRef(null);

  const scrollToTop = useCallback((behavior = 'smooth') => {
    const main = mainRef.current;
    if (!main) return;
    // `smooth` for a deliberate re-click, instant for a route change: the
    // second is a new page, and animating a scroll the reader did not ask for
    // just delays the content.
    main.scrollTo({ top: 0, behavior });
  }, []);

  // A drawer that survives a route change is a drawer covering the page the
  // user just asked for.
  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  // A new route starts at its own beginning.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  // Ctrl+K / ⌘K anywhere in the panel. The palette itself owns Escape and the
  // arrow keys once it is open.
  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (isLoading) {
    return (
      <div style={theme} data-business-theme="admin" className="flex h-dvh">
        <div className="hidden w-[220px] shrink-0 bg-ink-deep md:block" />
        <div className="flex-1 p-6">
          <Skeleton className="mb-6 h-10 w-56" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  /**
   * Anybody the ERP will not open for meets its sign-in door, right here.
   *
   * It used to be a wall reading "Admin access only" with nothing to press,
   * drawn in the business's colours before anybody knew which business - and a
   * signed-out owner, a customer holding the wrong session and a failed
   * `/auth/me` all met the same sentence. The door tells those apart (sign in;
   * go to the website or sign out; try again) and wears Kelinto, like the
   * shared sign-in it is.
   *
   * Drawn in place rather than redirected, so the address stays in the bar:
   * signing in re-renders this shell with the screen that was asked for, where
   * a redirect would have dropped them on the dashboard. That also covers a
   * host with no sign-in page of its own - a website host, or plain localhost.
   */
  if (!canUseAdmin) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <PanelSignInPage />
      </Suspense>
    );
  }

  /**
   * A screen this business does not have is not a screen (SAAS_PLATFORM §3.1
   * rule 1).
   *
   * The card grid and the command palette already drop these, so the only way
   * to arrive here is a typed URL or an old bookmark - which is exactly the
   * path that used to render the whole screen around a 404. A device list that
   * fails to load looks identical to an empty one, so a service screen opened
   * by a parts wholesaler read as "no devices yet" rather than as a feature
   * nobody granted them.
   *
   * It redirects rather than drawing a wall, and to `/admin` - the same place
   * the catch-all sends an address that does not exist. That is the point: off
   * means invisible, so a switched-off feature and a nonexistent path should be
   * indistinguishable from the outside. A "you do not have this feature" page
   * would answer the question the 404 gate is refusing to answer.
   */
  const routeFeature = matchAdminRoute(location.pathname)?.feature;
  if (routeFeature && features && !featureEnabled(features, routeFeature)) {
    return <Navigate to="/admin" replace />;
  }

  // Badge counters the sidebar reads by name. These are the unranged figures
  // the dashboard asks the same endpoint for a date range, and a badge that
  // moved when you changed the dashboard's dates would be nonsense.
  //
  // `openRmas` has no source until phase 7; a missing key renders no badge
  // rather than a zero.
  const badges = {
    pendingUsers: stats?.users?.pending ?? 0,
    overdueInvoices: stats?.receivables?.overdueCount ?? 0,
    lowStock: (stats?.inventory?.lowStock ?? 0) + (stats?.inventory?.outOfStock ?? 0),
    openRmas: stats?.rma?.open ?? 0,
    openTickets: stats?.tickets?.open ?? 0,
  };

  const openSearch = () => setPaletteOpen(true);

  return (
    // The provider wraps both the trail and the business: a detail page publishes
    // its record name, and the breadcrumb - a sibling, not a child - reads it.
    <DensityProvider value="compact">
    <RecordLabelProvider>
      {/*
        The panel is a fixed-height app on screen and a flowing document on
        paper. `h-dvh` with `overflow-hidden` is right for the former and fatal
        for the latter - it would clip the Business Overview to a single page
        so both are unwound under `print:` (ERP rework §6.11).
      */}
      {/*
        A support session's banner spans the whole application above the
        sidebar, and sits outside the scrolling `<main>` so it cannot be
        scrolled away from. It renders nothing for everybody else, which is
        every session but a platform operator's (SAAS_PLATFORM §4.5).
      */}
      {/*
        The business's accent, set once on the outermost element.

        CSS variables inherit, so every `bg-brand` / `text-brand-700` /
        `bg-brand-gradient` below this point repaints without knowing why - see
        `hooks/useBusinessTheme.js`. It is scoped HERE rather than on `:root`
        deliberately: the storefront must keep the Cellvix brand whatever
        business an admin happens to be looking at in another tab.
      */}
      <div
        style={theme}
        data-business-theme="admin"
        className="flex h-dvh flex-col overflow-hidden bg-surface-2 print:block print:h-auto print:overflow-visible print:bg-white"
      >
        <ImpersonationBanner impersonation={impersonation} />

        <div className="flex min-h-0 flex-1 print:block">
        <AdminSidebar
          user={user}
          badges={badges}
          onSignOut={signOut}
          onOpenSearch={openSearch}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
          onSameRoute={scrollToTop}
        />

        <div className="flex min-w-0 flex-1 flex-col print:block">
          <AdminTopBar
            user={user}
            onOpenSearch={openSearch}
            onOpenMobileNav={() => setMobileNavOpen(true)}
          />
          <Breadcrumbs />

          <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
            <div className="mx-auto w-full max-w-[1600px] px-3 py-5 sm:px-4 lg:px-6 lg:py-7 print:max-w-none print:p-0">
              {/* An EMPTY fallback, deliberately.
              
                  A page-shaped skeleton here meant every navigation repainted
                  twice - content, then a skeleton in a different shape, then
                  the real page - which is the "jump". The chunk for a route
                  usually arrives in a few frames, and `RouteProgress` is
                  already reporting the wait at the top of the window, so the
                  honest thing to render meanwhile is nothing at all rather than
                  a placeholder that resembles neither the page leaving nor the
                  one arriving.
              
                  The skeleton still earns its place on a first paint, where the
                  screen is genuinely empty - the screens keep their own
                  `isLoading` skeletons for that. */}
              {/* Above the outlet rather than inside each screen: twenty
                  settings pages would otherwise each import and place the same
                  row, and the twentieth would be the one that forgot. It
                  renders nothing outside settings. */}
              <SettingsTabs />

              <Suspense fallback={null}>
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

        {/* The admin shell does not sit inside RootLayout, so it mounts its own
            copy - otherwise the sidebar's Sign out would raise a flag with
            nothing listening. */}
        <SignOutConfirm />
      </div>
    </RecordLabelProvider>
    </DensityProvider>
  );
}

export default AdminShell;
