import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ArrowUpRight, ChevronDown, Clock, LogOut } from 'lucide-react';
import cn from '@/lib/cn';
import { ACCOUNT_NAV, ACCOUNT_NAV_ITEMS } from '@shared/schemas/account';
import { accountIcon } from './accountIcons';
import Button from '@/components/ui/Button';
import SelectMenu from '@/components/ui/SelectMenu';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth, useSignOut } from '@/hooks/useAuth';
import { useAccountSummary } from '@/hooks/useAccount';
import useUiStore from '@/store/uiStore';
import { pressable } from '@/lib/motion';
import { panelUrl } from '@/lib/surface';
import useBusinessInfo from '@/hooks/useBusinessInfo';

/**
 * Which group and which leaf the current URL is in.
 *
 * Longest match wins: `/account` is a prefix of every other account route, so a
 * plain `startsWith` would report Overview as active on all of them.
 */
function activeNavKeys(pathname) {
  let match = null;

  for (const group of ACCOUNT_NAV) {
    for (const child of group.children ?? [group]) {
      const exact = child.to === '/account' ? pathname === '/account' : pathname.startsWith(child.to);
      if (exact && (!match || child.to.length > match.child.to.length)) {
        match = { group: group.key, child };
      }
    }
  }

  return { group: match?.group ?? 'overview', child: match?.child ?? null };
}

/** What each badge counts, for the screen-reader text beside the digit. */
const BADGE_LABELS = {
  openOrders: 'open',
  outstandingInvoices: 'outstanding',
};

/**
 * The count beside a nav row. Absent and zero both render nothing.
 *
 * The digit is `aria-hidden` and the meaning is carried by visually-hidden text
 * instead. The badge sits inside the row's own button or link, so its text
 * becomes part of that control's accessible name - without this a collapsed
 * group announced as "Orders & billing 3", a bare number with no unit.
 */
function NavBadge({ count, label }) {
  if (!count) return null;
  return (
    <>
      <span
        className="tnum ml-auto mr-0.5 min-w-[20px] rounded-full bg-surface-3 px-1.5 py-0.5 text-center text-2xs font-semibold leading-none text-ink-600"
        aria-hidden="true"
      >
        {count > 99 ? '99+' : count}
      </span>
      <span className="sr-only">{`, ${count} ${label}`}</span>
    </>
  );
}

/**
 * The account sidebar: a flat Overview row and three expandable groups, the
 * same two-level tree the admin shell uses.
 *
 * One group open at a time, and the open one follows the route - so arriving on
 * a page always shows you where you are, and the sidebar stays one screen
 * rather than ten rows a buyer reads end to end to find anything. A deliberate
 * collapse is kept in state until the route changes, so clicking a heading
 * closed does not immediately spring back open.
 */
function NavTree({ badges, activeGroup, activeChildKey }) {
  const [openGroup, setOpenGroup] = useState(activeGroup);
  useEffect(() => setOpenGroup(activeGroup), [activeGroup]);

  return (
    <ul className="hidden lg:flex lg:flex-col lg:gap-0.5">
      {ACCOUNT_NAV.map((item) => {
        const Icon = accountIcon(item.icon);

        if (!item.children) {
          return (
            <li key={item.key}>
              <NavLink
                to={item.to}
                end
                className={({ isActive }) =>
                  cn(
                    pressable,
                    'flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2.5 text-md font-medium',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-ink-600 hover:bg-surface-2 hover:text-ink-900',
                  )
                }
              >
                <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          );
        }

        const isOpen = openGroup === item.key;
        const groupBadge = item.children.reduce(
          (sum, child) => sum + (child.badge ? (badges[child.badge] ?? 0) : 0),
          0,
        );

        return (
          <li key={item.key} className="mt-1 first:mt-0">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenGroup(isOpen ? null : item.key)}
              className={cn(
                pressable,
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-md font-semibold',
                isOpen || activeGroup === item.key
                  ? 'text-ink-900'
                  : 'text-ink-600 hover:bg-surface-2 hover:text-ink-900',
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="flex-1 text-left">{item.label}</span>
              {/* Only while closed: open, the counts are on the rows themselves,
                  and showing both makes the heading look like a third number. */}
              {!isOpen && <NavBadge count={groupBadge} label="needing attention" />}
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 text-ink-400 transition-transform',
                  isOpen && 'rotate-180',
                )}
                strokeWidth={2.25}
                aria-hidden="true"
              />
            </button>

            {isOpen && (
              <ul className="ml-[19px] mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2.5">
                {item.children.map((child) => {
                  const ChildIcon = accountIcon(child.icon);
                  const isActive = activeChildKey === child.key;

                  return (
                    <li key={child.key}>
                      <NavLink
                        to={child.to}
                        className={cn(
                          pressable,
                          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium',
                          isActive
                            ? 'bg-brand-50 text-brand-700'
                            : 'text-ink-600 hover:bg-surface-2 hover:text-ink-900',
                        )}
                      >
                        <ChildIcon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                        <span className="min-w-0 truncate">{child.label}</span>
                        <NavBadge count={child.badge ? badges[child.badge] : 0} label={BADGE_LABELS[child.badge] ?? 'items'} />
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Account shell (brief §8.3): ERP-grade information density in Cellvix's clean
 * visual language - sidebar navigation, not a raw admin panel.
 *
 * Also the auth gate for everything under /account. Guests get a sign-in prompt,
 * pending businesses get the "under review" state rather than a bare 403.
 */
export function AccountLayout() {
  const { user, isLoading, isAuthenticated, isApproved, isPanelAccount } = useAuth();
  const info = useBusinessInfo();
  const signOut = useSignOut();
  const openAccount = useUiStore((s) => s.openAccount);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const { group: activeGroup, child: activeChild } = activeNavKeys(pathname);

  // Below lg the section list is a dropdown, not a horizontal scroller. Eight
  // pills in a swipe strip hid half the account behind a gesture nothing on the
  // page advertised - the two sections furthest right were effectively unreachable
  // on a 360px phone. It lists the leaves, not the groups: a dropdown is already
  // a one-level-at-a-time control, so grouping it would add a step rather than
  // remove one.
  const activeNav = activeChild?.to ?? '/account';

  /**
   * Sidebar counts, keyed by the `badge` names in `ACCOUNT_NAV`.
   *
   * Mapped here rather than named after the payload's own paths because the
   * summary nests them under `stats` and `invoices`, and a nav schema that
   * hard-codes another module's object shape breaks the moment that shape
   * changes. The schema names what the number *means*; this says where it lives.
   */
  const { data: summary } = useAccountSummary();
  const badges = {
    openOrders: summary?.stats?.openOrders ?? 0,
    outstandingInvoices: summary?.invoices?.outstandingCount ?? 0,
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-8 lg:px-6">
        <Skeleton className="mb-6 h-10 w-56" />
        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="mt-4 h-96 lg:mt-0" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
        <h1 className="text-2xl">Sign in to your account</h1>
        <p className="mt-3 text-md leading-relaxed text-ink-500">
          Order history, invoices, credit and the quick order pad live behind your {info.name}{' '}
          account.
        </p>
        <Button className="mt-7" size="lg" onClick={() => openAccount('signin')}>
          Sign in
        </Button>
      </div>
    );
  }

  // Staff accounts have no buyer-side orders, invoices or credit, so /account
  // has nothing to show them. Said in place rather than redirected: a redirect
  // off the website is what used to make it impossible to view while signed in.
  if (isPanelAccount) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl">This is the customer dashboard</h1>
        <p className="mt-3 text-md leading-relaxed text-ink-500">
          {user.displayName} is a staff account at {info.name}, so there are no orders, invoices or
          credit of its own to show here. Customers' records are in the ERP.
        </p>
        <Button
          className="mt-7"
          size="lg"
          iconRight={ArrowUpRight}
          onClick={() => window.location.assign(panelUrl('/admin/clients'))}
        >
          Open customers in the ERP
        </Button>
      </div>
    );
  }

  if (!isApproved) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
        <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-warn-50 text-warn">
          <Clock className="size-7" strokeWidth={1.5} />
        </span>
        <h1 className="text-2xl">Your account is under review</h1>
        <p className="mt-3 text-md leading-relaxed text-ink-500">
          We are verifying <span className="font-medium text-ink-900">{user.displayName}</span>.
          Once that is done, wholesale pricing, ordering and this dashboard all unlock - usually within
          one business day.
        </p>
        <p className="mt-6 rounded-md bg-surface-2 px-4 py-3 text-sm text-ink-500">
          Questions? Email{' '}
          <a href={`mailto:${info.supportEmail}`} className="font-medium text-brand hover:underline">
            {info.supportEmail}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] px-3 py-5 sm:px-4 lg:px-6 lg:py-7">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1 text-ink-400">Wholesale account</p>
          <h1 className="truncate text-2xl sm:text-3xl">{user.displayName}</h1>
        </div>
        {/* The company beside the person, not the person twice: the heading is
            now the account holder's name, so repeating `contactName` here said
            nothing. An account with no company name shows just the email. */}
        <p className="text-sm text-ink-500">
          {user.businessName && (
            <>
              {user.businessName} <span className="text-ink-300">·</span>{' '}
            </>
          )}
          <span className="text-ink-400">{user.email}</span>
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start lg:gap-6">
        {/* ---- navigation ------------------------------------------------- */}
        <nav
          aria-label="Account sections"
          className="mb-4 lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)] lg:mb-0 lg:rounded-lg lg:border lg:border-line lg:bg-surface lg:p-2"
        >
          {/* ---- dropdown below lg ---------------------------------------- */}
          <div className="flex items-center gap-2 lg:hidden">
            <SelectMenu
              srLabel="Account section"
              size="md"
              align="left"
              value={activeNav}
              onChange={(to) => navigate(to)}
              options={ACCOUNT_NAV_ITEMS.map((item) => ({ value: item.to, label: item.label }))}
              className="min-w-0 flex-1"
            />
            <Button variant="outline" icon={LogOut} onClick={signOut} className="shrink-0">
              Sign out
            </Button>
          </div>

          {/* ---- sidebar from lg ------------------------------------------ */}
          <NavTree badges={badges} activeGroup={activeGroup} activeChildKey={activeChild?.key} />

          <ul className="hidden lg:block">
            <li className="mt-2 border-t border-line pt-2">
              <button
                type="button"
                onClick={signOut}
                className={cn(pressable, 'flex w-full items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2.5 text-md font-medium text-ink-500 hover:bg-danger-50 hover:text-danger')}
              >
                <LogOut className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                Sign out
              </button>
            </li>
          </ul>
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default AccountLayout;
