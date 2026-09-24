import { NavLink, useLocation } from 'react-router';
import {
  FileSignature,
  FileText,
  Building2,
  LayoutDashboard,
  LogOut,
  Package,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import cn from '@/lib/cn';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import { useSupplierSession } from '@/hooks/useSupplierPortal';
import { pressable } from '@/lib/motion';

/**
 * The supplier portal's sidebar.
 *
 * **The admin panel's shape, not its contents.** Same three widths, same
 * `--color-ink-deep` ground, same active-row treatment - a supplier signing in
 * should recognise a real application rather than a form on a page. What it
 * does *not* share is `ADMIN_NAV`: a supplier has five screens and no
 * permission map, so the nav is a flat list defined here.
 *
 * Deliberately flat, with no groups. `AdminSidebar` expands one group at a time
 * because it carries forty rows; five rows in an accordion would be chrome
 * hiding a list shorter than the chrome.
 */

const NAV = [
  { key: 'dashboard', label: 'Dashboard', to: '/supplier', icon: LayoutDashboard, end: true },
  { key: 'orders', label: 'Purchase Orders', to: '/supplier/orders', icon: Package },
  { key: 'proformas', label: 'Proforma Invoices', to: '/supplier/proformas', icon: FileText },
  { key: 'deliveries', label: 'Deliveries', to: '/supplier/deliveries', icon: Truck },
  { key: 'agreement', label: 'Agreement', to: '/supplier/agreement', icon: FileSignature },
  { key: 'profile', label: 'Profile & Access', to: '/supplier/profile', icon: UserRound },
  // Every business this login supplies, and the invitations waiting on it.
  { key: 'businesses', label: 'Businesses', to: '/supplier/businesses', icon: Building2 },
];

function BrandBlock({ compact, supplier }) {
  // The portal is branded by the business whose portal it IS, resolved from the
  // host like every other public read. It printed the hardcoded name before, so
  // a CellShoppe supplier signed in to a panel badged Cellvix.
  const info = useBusinessInfo();
  // The business being worked in, from the session - on the shared admin host
  // the host names no business, and the one it falls back to is not this one.
  const { business } = useSupplierSession();
  const name = business?.name ?? info.name;

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 border-b border-white/10 px-4 py-4',
        compact && 'justify-center px-0',
      )}
    >
      {/* The compact ramp on a small glyph - the full ramp's near-black opening
          reads as a stripe at this size (Instructions §2.2). */}
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-gradient-compact font-display text-lg font-bold text-white">
        {name.charAt(0)}
      </span>
      {!compact && (
        <span className="min-w-0">
          <span className="block truncate font-display text-lg font-bold leading-none text-white">
            {name}
          </span>
          {/* Says whose portal this is, because a supplier works with several
              customers and the tab alone does not tell them which. */}
          <span className="eyebrow mt-1 block truncate text-ink-200">
            {supplier?.name ?? 'Supplier portal'}
          </span>
        </span>
      )}
    </div>
  );
}

function NavRows({ compact, badges, onNavigate }) {
  const location = useLocation();

  return (
    <nav aria-label="Supplier sections" className="min-h-0 flex-1 overflow-y-auto scroll-slim py-2">
      <ul className={cn('flex flex-col gap-0.5', compact ? 'items-center px-2' : 'px-3')}>
        {NAV.map((item) => {
          const Icon = item.icon;
          const count = badges?.[item.key] ?? 0;

          return (
            <li key={item.key} className={compact ? '' : 'w-full'}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                title={compact ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    pressable,
                    'flex items-center gap-2.5 rounded-md text-sm font-medium',
                    compact ? 'size-10 justify-center' : 'w-full px-2.5 py-2',
                    isActive
                      ? // The active row carries the brand, as the admin panel's
                        // does. Compact ramp: at 40px the full one is a stripe.
                        'bg-brand-gradient-compact text-white'
                      : 'text-ink-200 hover:bg-white/[0.08] hover:text-white',
                  )
                }
              >
                <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {!compact && <span className="flex-1 truncate">{item.label}</span>}
                {!compact && count > 0 && (
                  <span className="tnum inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white/20 px-1 text-2xs font-semibold leading-none text-white">
                    {count}
                  </span>
                )}
                {/* A count still has to reach the rail, or the one number that
                    says "something needs you" is invisible at that width. */}
                {compact && count > 0 && (
                  <span
                    className="absolute ml-6 -mt-5 size-2 rounded-full bg-brand"
                    aria-hidden="true"
                  />
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SignOutRow({ compact, onSignOut }) {
  return (
    <div className={cn('border-t border-white/10 p-3', compact && 'px-2')}>
      <button
        type="button"
        onClick={onSignOut}
        title={compact ? 'Sign out' : undefined}
        className={cn(
          pressable,
          'flex items-center gap-2.5 rounded-md text-sm font-medium text-ink-200 hover:bg-white/[0.08] hover:text-white',
          compact ? 'size-10 justify-center' : 'w-full px-2.5 py-2',
        )}
      >
        <LogOut className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        {!compact && <span>Sign out</span>}
      </button>
    </div>
  );
}

export function SupplierSidebar({ supplier, badges, onSignOut, mobileOpen, onCloseMobile }) {
  return (
    <>
      {/* Desktop: full tree at 1024+, icon rail between 768 and 1023. */}
      <aside className="hidden shrink-0 flex-col bg-ink-deep md:flex md:w-16 lg:w-[220px] xl:w-[250px]">
        <div className="hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <BrandBlock supplier={supplier} />
          <NavRows badges={badges} />
          <SignOutRow onSignOut={onSignOut} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:hidden">
          <BrandBlock compact supplier={supplier} />
          <NavRows compact badges={badges} />
          <SignOutRow compact onSignOut={onSignOut} />
        </div>
      </aside>

      {/* Below 768 the sidebar is an off-canvas drawer, opened from the top bar. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={onCloseMobile}
            className="absolute inset-0 bg-ink-900/50"
          />
          <div className="absolute inset-y-0 left-0 flex w-[264px] flex-col bg-ink-deep">
            <div className="flex items-center justify-between border-b border-white/10 pr-2">
              <BrandBlock supplier={supplier} />
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close menu"
                className={cn(pressable, 'rounded-md p-2 text-ink-200 hover:text-white')}
              >
                <X className="size-5" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <NavRows badges={badges} onNavigate={onCloseMobile} />
            <SignOutRow onSignOut={onSignOut} />
          </div>
        </div>
      )}
    </>
  );
}

export default SupplierSidebar;
