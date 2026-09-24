import { Suspense } from 'react';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Building2, LayoutGrid, LifeBuoy, LogOut, Layers } from 'lucide-react';

import cn from '@/lib/cn';
import Skeleton from '@/components/ui/Skeleton';
import { pressable } from '@/lib/motion';
import { useSuperAdminSession, useSuperAdminMutations } from '@/hooks/useSuperAdmin';
import SuperAdminLoginPage from '@/pages/superadmin/SuperAdminLoginPage';

/**
 * The platform console's shell (SAAS_PLATFORM §4.5, §0.1).
 *
 * ## A separate identity, on purpose
 *
 * **This wears none of Cellvix's brand.** Cellvix is tenant #1; the console sits
 * above every tenant, and painting it in one tenant's colours quietly asserts
 * that the platform *is* that tenant. It is not, and it has no name yet - so the
 * console reads PLATFORM in cool graphite with one indigo accent, and an
 * operator can tell in peripheral vision whether they are in the platform or
 * inside a customer's shop. That distinction is the whole reason the palette is
 * separate rather than merely a darker version of the same one.
 *
 * ## Why a sidebar rather than a top bar
 *
 * The console has three destinations and will gain more. A persistent rail
 * answers "where am I, where can I go" without the operator having to look - the
 * wayfinding rule - and leaves the horizontal band free for the thing being
 * worked on. A row of tabs across the top starts to wrap at the fourth item.
 *
 * ## Materials
 *
 * The rail is the heavier structural material and the topbar is the lighter
 * floating one, which is the hierarchy Apple's material weights encode: darker
 * separates regions, lighter draws attention to what is interactive. Content
 * scrolls *under* the topbar rather than being clipped by an opaque strip, so
 * the chrome reads as a layer above the page rather than a slice taken out of
 * it.
 */

const NAV = [
  {
    key: 'tenants',
    label: 'Tenants',
    to: '/superadmin',
    end: true,
    icon: Building2,
    // Named for what is inside rather than an umbrella: "Tenants" is specific
    // and predictable in a way "Home" never is.
    hint: 'Accounts and their businesses',
  },
  { key: 'plans', label: 'Plans', to: '/superadmin/plans', icon: LayoutGrid, hint: 'Tiers and features' },
  { key: 'support', label: 'Support', to: '/superadmin/support', icon: LifeBuoy, hint: 'Conversations and access' },
];

function NavItem({ item }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          pressable,
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
          'transition-colors duration-fast',
          isActive
            ? 'bg-plat-accent/15 text-plat-text'
            : 'text-plat-muted hover:bg-white/[0.04] hover:text-plat-text',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/*
            The active marker is a bar at the rail's edge, not a full-width
            fill: it anchors the selection to the structure it belongs to and
            stays legible when the row's background is barely tinted.
          */}
          <span
            className={cn(
              'absolute -left-3 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-r-full',
              'transition-opacity duration-fast',
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
        </>
      )}
    </NavLink>
  );
}

export function SuperAdminLayout() {
  // The browser tab, per route. One call per surface rather than one per
  // page: the titles live in the route table beside the breadcrumbs.
  useDocumentTitle();
  const navigate = useNavigate();
  const { admin, isLoading } = useSuperAdminSession();
  const { signOut } = useSuperAdminMutations();
  const { pathname } = useLocation();

  // The deepest matching section, so /superadmin/plans beats the index route.
  const current =
    [...NAV].reverse().find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to))) ??
    NAV[0];

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-plat-bg">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-4 h-40 w-full" />
        </div>
      </div>
    );
  }

  if (!admin) return <SuperAdminLoginPage />;

  return (
    <div className="flex min-h-dvh bg-plat-bg text-plat-text">
      {/* ---- the rail ---------------------------------------------------- */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-plat-line bg-plat-surface md:flex">
        <div className="flex h-16 items-center gap-3 px-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-plat-accent">
            <Layers className="size-[18px] text-white" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight tracking-[-0.01em]">
              Kelinto
            </span>
            {/* The platform is Kelinto; this is the panel that runs it. */}
            <span className="block text-xs leading-tight text-plat-dim">Super admin</span>
          </span>
        </div>

        <nav aria-label="Console" className="relative flex-1 px-3 py-2">
          <p className="px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-plat-dim">
            Manage
          </p>
          <div className="relative space-y-0.5">
            {NAV.map((item) => (
              <div key={item.key} className="relative">
                <NavItem item={item} />
              </div>
            ))}
          </div>
        </nav>

        {/* The operator's own identity, at the foot of the rail where a system
            account lives on every desktop platform - familiar placement beats a
            novel one. */}
        <div className="border-t border-plat-line-soft p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-plat-raised text-xs font-semibold text-plat-muted">
              {(admin.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-tight">{admin.name}</span>
              <span className="block truncate text-xs leading-tight text-plat-dim">
                {admin.email}
              </span>
            </span>
            <button
              type="button"
              onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/superadmin') })}
              aria-label="Sign out"
              className={cn(
                pressable,
                'rounded-md p-1.5 text-plat-dim transition-colors duration-fast',
                'hover:bg-white/[0.06] hover:text-plat-text',
              )}
            >
              <LogOut className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- the floating topbar ---------------------------------------
            Translucent with content scrolling beneath, rather than an opaque
            strip: the chrome reads as a layer above the page. `supports` guards
            the blur so a browser without `backdrop-filter` gets a solid bar
            rather than a washed-out one. */}
        <header
          className={cn(
            'sticky top-0 z-40 flex h-16 shrink-0 items-center gap-4 px-4 sm:px-6',
            'border-b border-plat-line-soft bg-plat-bg/80',
            'supports-[backdrop-filter]:bg-plat-bg/60 supports-[backdrop-filter]:backdrop-blur-xl',
          )}
        >
          {/* The rail is hidden below md, so the sections move into the bar
              rather than disappearing behind a menu nobody opens. */}
          <nav aria-label="Console" className="flex items-center gap-1 md:hidden">
            {NAV.map((item) => (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    pressable,
                    'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-fast',
                    isActive
                      ? 'bg-plat-accent/15 text-plat-text'
                      : 'text-plat-muted hover:text-plat-text',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* On desktop the rail carries the sections, so the bar states where
              you are and what this console is for. An empty 64px strip is worse
              than no strip: it reads as a component that failed to load. */}
          <span className="hidden min-w-0 flex-1 md:block">
            <span className="block text-sm font-medium leading-tight text-plat-text">
              {current?.label ?? 'Super admin'}
            </span>
            <span className="block truncate text-xs leading-tight text-plat-dim">
              {current?.hint ?? 'Every tenant on the platform'}
            </span>
          </span>

          <span className="ml-auto flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/superadmin') })}
              aria-label="Sign out"
              className={cn(pressable, 'rounded-md p-2 text-plat-dim hover:text-plat-text')}
            >
              <LogOut className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        </header>

        <main className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-9">
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

export default SuperAdminLayout;
