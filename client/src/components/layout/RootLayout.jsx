import { Navigate, Outlet } from 'react-router';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import Header from './Header';
import { NAV_STRIP_H } from './PrimaryNav';
import Footer from './Footer';
import MobileBottomNav from './MobileBottomNav';
import BackToTop from './BackToTop';
import ScrollToTop from './ScrollToTop';
import AccountPopup from '@/components/account/AccountPopup';
import SignOutConfirm from '@/components/account/SignOutConfirm';
import RouteFallback from './RouteFallback';
import { useAuth } from '@/hooks/useAuth';

/** Chrome shared by every route: header, footer, and the global overlays. */
export function RootLayout() {
  // The browser tab, per route. One call per surface rather than one per
  // page: the titles live in the route table beside the breadcrumbs.
  useDocumentTitle();
  const { isLoading, isAdmin, isStaff } = useAuth();

  // Cellvix people have no buyer side. The catalogue, cart and checkout all
  // assume a business account behind them, so any staff account is sent to the
  // console
  // from any storefront URL - typed, bookmarked or followed from an email.
  //
  // The wait on `isLoading` is what keeps a hard refresh at `/` from painting
  // the shop for a beat before `/auth/me` answers.
  if (isLoading) return <RouteFallback />;
  if (isAdmin || isStaff) return <Navigate to="/admin" replace />;

  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink-900 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <Header />

      {/* Clears the sliding nav row, which OVERLAYS the body rather than sitting
          in the layout (see PrimaryNav.jsx).

          Needed since the row became visible by default. While it only appeared
          past a scroll threshold, what it painted over was mid-page content the
          reader was already scrolling through, and reserving space would have
          left 45px of empty white under the header at the top of every page. Now
          it is up on load, so with no reservation it covers the first 45px of
          every page instead - the top of the first section, which is exactly what
          the reader is looking at.

          `lg:` only, matching the row itself: it does not exist below that, and
          padding a phone for a row that is not there is 45px of nothing.

          Off `NAV_STRIP_H` rather than a literal: two hardcoded 45s that drift
          apart is precisely what that constant exists to prevent, and it is an
          inline style because a Tailwind arbitrary value cannot read a JS
          binding. */}
      <main
        id="main"
        className="flex-1 lg:[padding-top:var(--nav-strip-h)]"
        style={{ '--nav-strip-h': `${NAV_STRIP_H}px` }}
      >
        <Outlet />
      </main>

      <Footer />

      {/* The bottom bar floats over content, so the last of the footer needs
          clearance or it can never be reached. */}
      <div className="h-[calc(64px+env(safe-area-inset-bottom))] shrink-0 lg:hidden" aria-hidden="true" />

      <AccountPopup />
      <SignOutConfirm />
      <MobileBottomNav />
      <BackToTop />
    </div>
  );
}

export default RootLayout;
