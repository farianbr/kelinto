import { Suspense, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  Building2,
  CreditCard,
  Gauge,
  Globe,
  LifeBuoy,
  LogOut,
  ShieldCheck,
  Store,
} from 'lucide-react';

import cn from '@/lib/cn';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import { pressable } from '@/lib/motion';
import { useSuperAdminSession, useSuperAdminMutations } from '@/hooks/useSuperAdmin';
import { PlatformPageSkeleton } from '@/components/superadmin/PlatformUI';
import { usePlatformPulse } from '@/components/superadmin/platformData';
import SuperAdminLoginPage from '@/pages/superadmin/SuperAdminLoginPage';
import KelintoLogo from '@/components/platform/KelintoLogo';

/**
 * The platform console's shell (SAAS_PLATFORM §4.5, §0.1).
 *
 * **This wears none of a tenant's brand.** The console sits above every
 * tenant, and painting it in one tenant's colours would quietly assert that the
 * platform IS that tenant. Cool graphite with one indigo accent, so an operator
 * can tell in peripheral vision whether they are in Kelinto or inside a
 * customer's business.
 *
 * **Grouped by what an operator is doing**, not by data type: looking at the
 * platform (Overview), looking after customers (Tenants, Businesses, Domains),
 * charging them (Plans), and helping them (Support, Access log). A flat list
 * of seven reads as a menu; four short groups read as a map.
 *
 * **Counts in the rail are work waiting**, never totals. "Support 2" means two
 * unread threads; a rail that also counted tenants would teach the eye to
 * ignore numbers, and then miss the ones that matter.
 */

function useNav() {
  const pulse = usePlatformPulse();
  return [
    {
      group: null,
      items: [{ key: 'overview', label: 'Overview', to: '/superadmin', end: true, icon: Gauge }],
    },
    {
      group: 'Customers',
      items: [
        { key: 'tenants', label: 'Tenants', to: '/superadmin/tenants', icon: Building2 },
        { key: 'businesses', label: 'Businesses', to: '/superadmin/businesses', icon: Store },
        {
          key: 'domains',
          label: 'Domains',
          to: '/superadmin/domains',
          icon: Globe,
          // Requests are somebody waiting on us; DNS is them, not us, so it is
          // shown on the page rather than counted here.
          count: pulse.pendingRequests.length,
        },
      ],
    },
    {
      group: 'Billing',
      items: [{ key: 'plans', label: 'Plans', to: '/superadmin/plans', icon: CreditCard }],
    },
    {
      group: 'Operations',
      items: [
        {
          key: 'support',
          label: 'Support',
          to: '/superadmin/support',
          icon: LifeBuoy,
          count: pulse.unreadThreads.length,
        },
        {
          key: 'access',
          label: 'Access log',
          to: '/superadmin/access',
          icon: ShieldCheck,
          // Somebody inside a customer's records right now: the one count here
          // that is about us, and red for that reason.
          count: pulse.liveGrants.length,
          tone: 'danger',
        },
      ],
    },
  ];
}

function Count({ value, tone }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        'tnum ml-auto rounded-full px-1.5 text-2xs font-semibold leading-5',
        tone === 'danger' ? 'bg-plat-danger/15 text-plat-danger' : 'bg-plat-warn/15 text-plat-warn',
      )}
    >
      {value}
    </span>
  );
}

function NavItem({ item }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          pressable,
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-md font-medium',
          'transition-colors duration-fast',
          isActive ? 'bg-plat-mark text-plat-text' : 'text-plat-muted hover:bg-plat-text/5 hover:text-plat-text',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* The active marker is a bar at the rail's edge, not a full-width
              fill: it anchors the selection to the structure it belongs to. */}
          <span
            className={cn(
              'absolute -left-3 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-r-full transition-opacity duration-fast',
              isActive ? 'bg-plat-accent opacity-100' : 'opacity-0',
            )}
            aria-hidden="true"
          />
          <item.icon
            className={cn('size-4 shrink-0', isActive ? 'text-plat-accent-soft' : 'text-plat-dim')}
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <Count value={item.count} tone={item.tone} />
        </>
      )}
    </NavLink>
  );
}

function Wordmark() {
  return <KelintoLogo size="sm" subtitle="Console" />;
}

export function SuperAdminLayout() {
  useDocumentTitle();
  const navigate = useNavigate();
  const { admin, isLoading } = useSuperAdminSession();
  const { signOut } = useSuperAdminMutations();
  const { pathname } = useLocation();
  const nav = useNav();

  // A new page starts at its top. The console scrolls the window, and without
  // this a record opened from far down a list opened scrolled past its header.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (isLoading) {
    return (
      <div className="kelinto min-h-dvh bg-plat-bg">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <PlatformPageSkeleton />
        </div>
      </div>
    );
  }

  if (!admin) return <SuperAdminLoginPage />;

  const signOutNow = () => signOut.mutate(undefined, { onSuccess: () => navigate('/superadmin') });
  const flat = nav.flatMap((section) => section.items);

  return (
    <div className="kelinto flex min-h-dvh bg-plat-bg text-plat-text">
      {/* ---- the rail ---------------------------------------------------- */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-plat-line bg-plat-surface md:flex">
        <div className="flex h-16 items-center px-5">
          <Wordmark />
        </div>

        <nav aria-label="Console" className="scroll-slim flex-1 overflow-y-auto px-3 pb-4">
          {nav.map((section) => (
            <div key={section.group ?? 'top'} className="mt-3 first:mt-1">
              {section.group && <p className="eyebrow px-3 pb-2 pt-3 text-plat-dim">{section.group}</p>}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavItem key={item.key} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* The operator's own identity, at the foot of the rail where a system
            account lives on every desktop platform. */}
        <div className="border-t border-plat-line-soft p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-plat-raised text-xs font-semibold text-plat-muted">
              {(admin.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-tight">{admin.name}</span>
              <span className="block truncate text-xs leading-tight text-plat-dim">{admin.email}</span>
            </span>
            <button
              type="button"
              onClick={signOutNow}
              aria-label="Sign out"
              className={cn(pressable, 'rounded-md p-1.5 text-plat-dim transition-colors duration-fast hover:bg-plat-text/5 hover:text-plat-text')}
            >
              <LogOut className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- phone chrome ----------------------------------------------
            Below md the rail is gone, so the sections become one scrolling
            strip under the wordmark rather than a menu nobody opens. */}
        <header className="sticky top-0 z-40 border-b border-plat-line-soft bg-plat-bg/85 backdrop-blur-xl md:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <Wordmark />
            <button
              type="button"
              onClick={signOutNow}
              aria-label="Sign out"
              className={cn(pressable, 'rounded-md p-2 text-plat-dim hover:text-plat-text')}
            >
              <LogOut className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="Console" className="scroll-slim flex gap-1 overflow-x-auto px-3 pb-2">
            {flat.map((item) => (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    pressable,
                    'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium',
                    isActive ? 'bg-plat-mark text-plat-text' : 'text-plat-muted',
                  )
                }
              >
                {item.label}
                <Count value={item.count} tone={item.tone} />
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
            <Suspense fallback={<PlatformPageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

export default SuperAdminLayout;
