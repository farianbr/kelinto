import { Suspense, useState } from 'react';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import { Outlet, useNavigate } from 'react-router';
import { Menu } from 'lucide-react';
import cn from '@/lib/cn';
import Skeleton from '@/components/ui/Skeleton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { pressable } from '@/lib/motion';
import {
  useSupplierSession,
  useSupplierPortalMutations,
  useSupplierOrders,
} from '@/hooks/useSupplierPortal';
import SupplierLoginPage from '@/pages/supplier/SupplierLoginPage';
import useBusinessTheme from '@/hooks/useBusinessTheme';
import SupplierSidebar from './SupplierSidebar';

/**
 * The supplier portal's shell (§6.8a).
 *
 * **The admin panel's shape.** This was ninety lines and one nav item, on the
 * reasoning that a supplier opens the portal to answer one question and leave.
 * That held while there was one screen; it stopped holding once a supplier had
 * orders to price, proformas to issue and deliveries to report - five screens
 * with no way to move between them is a worse answer than chrome.
 *
 * **Still outside `RootLayout`, like the admin panel.** A supplier is not a
 * customer: the shop header, the mega menu, the cart and the price gate all
 * belong to a buyer's session, and putting a supplier inside them would offer
 * them a catalogue they cannot order from and a cart they can never check out.
 *
 * **Signed out renders the sign-in page in place**, rather than redirecting.
 * A supplier arriving on `/supplier/orders/<id>` from an emailed link and being
 * bounced to `/supplier` would lose the order they were sent, and coming back
 * to it means finding the email again. Signing in here leaves them exactly
 * where they were headed.
 */
export function SupplierPortalLayout() {
  // The browser tab, per route. One call per surface rather than one per
  // page: the titles live in the route table beside the breadcrumbs.
  useDocumentTitle();
  const navigate = useNavigate();
  const { supplier, business, isLoading } = useSupplierSession();

  /**
   * The buying business's accent (SAAS_PLATFORM §1.1).
   *
   * A supplier prices orders for one business, and the portal should look like
   * that business rather than like whichever one shipped first. Resolved from
   * the host server-side, so it is known before sign-in and the sign-in screen
   * carries it too.
   *
   * Called before the early returns below, because a hook cannot run
   * conditionally - and it is wanted on every branch anyway: the loading
   * skeleton, the sign-in page and the portal proper.
   */
  const theme = useBusinessTheme(business?.colorToken);
  const { signOut } = useSupplierPortalMutations();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  // Drives the sidebar's counts. Loaded here rather than in each screen so the
  // badge is right on arrival, whichever screen that is.
  const { data } = useSupplierOrders();
  const orders = data?.orders ?? [];

  if (isLoading) {
    return (
      <div style={theme} data-business-theme="supplier" className="mx-auto max-w-3xl px-4 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    );
  }

  // Themed here rather than inside the page: the sign-in screen is a branch of
  // this shell, not a route of its own, and the business is already resolved.
  if (!supplier) {
    return (
      <div style={theme} data-business-theme="supplier" className="contents">
        <SupplierLoginPage businessName={business?.name ?? null} />
      </div>
    );
  }

  // Ordinary rather than critical: signing out is undone by signing back in.
  // It still asks, because losing a half-typed price to a misplaced click is a
  // real cost (Instructions §3.0.1).
  function handleSignOut() {
    setConfirmingSignOut(true);
  }

  function signOutNow() {
    signOut.mutate(undefined, {
      onSuccess: () => {
        setConfirmingSignOut(false);
        navigate('/supplier');
      },
    });
  }

  const signOutDialog = (
    <ConfirmDialog
      open={confirmingSignOut}
      onClose={() => setConfirmingSignOut(false)}
      onConfirm={signOutNow}
      tone="warn"
      title="Sign out of the supplier portal?"
      confirmLabel="Sign out"
      loading={signOut.isPending}
    />
  );

  const badges = {
    // What actually needs them: an order they have not priced, or one we have
    // queried. Anything else is history and should not carry a number.
    orders: orders.filter(
      (order) =>
        order.state === 'open' &&
        ['invited', 'viewed', 'negotiating'].includes(order.myBid.status),
    ).length,
    deliveries: orders.filter(
      (order) => order.state === 'won' && order.myBid.delivery?.status !== 'delivered',
    ).length,
  };

  return (
    <div style={theme} data-business-theme="supplier" className="flex h-dvh overflow-hidden bg-surface-2">
      <SupplierSidebar
        supplier={supplier}
        badges={badges}
        onSignOut={handleSignOut}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className={cn(pressable, 'rounded-md p-2 text-ink-500 hover:text-ink-900 md:hidden')}
          >
            <Menu className="size-5" strokeWidth={2} aria-hidden="true" />
          </button>

          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-md font-semibold text-ink-900">
              {supplier.name}
            </span>
            {/* Whose portal this is. A supplier to several businesses on
                Kelinto has a separate portal at each one's address, so the
                name is said on every page. */}
            <span className="block truncate text-xs text-ink-400">{business?.name} supplier portal</span>
          </span>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1200px] px-3 py-5 sm:px-4 lg:px-6 lg:py-7">
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          </div>
        </main>

        <footer className="shrink-0 border-t border-line bg-surface px-4 py-2.5 text-xs text-ink-400 sm:px-6">
          Questions about an order? Reply to the email it came from and it reaches our purchasing
          team.
        </footer>
      </div>

      {signOutDialog}
    </div>
  );
}

export default SupplierPortalLayout;
