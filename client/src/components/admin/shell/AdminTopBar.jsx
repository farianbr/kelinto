import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft, Globe, Menu, Search } from 'lucide-react';
import cn from '@/lib/cn';
import { matchAdminRoute } from '@/lib/adminRoutes';
import CreateMenu from './CreateMenu';
import BusinessSwitcher from './BusinessSwitcher';
import NotificationMenu from './NotificationMenu';
import { pressable } from '@/lib/motion';
import useOpenWebsite from '@/hooks/useOpenWebsite';
import { useAuth } from '@/hooks/useAuth';

/**
 * The ERP top bar (§4, convention 4): page-title chip with a back arrow,
 * global search, `+ Create`, notification bell, user chip.
 *
 * The bell is `NotificationMenu`, which owns its own query, badge and panel
 * the top bar does not thread a count through, because a count computed here
 * and a list fetched there are two answers to one question.
 */
export function AdminTopBar({ user, onOpenSearch, onOpenMobileNav }) {
  const location = useLocation();
  const navigate = useNavigate();
  const meta = matchAdminRoute(location.pathname);
  const isHome = location.pathname === '/admin';
  const website = useOpenWebsite();
  // A support session is nobody the website could sign in.
  const { isImpersonating } = useAuth();

  const initials = (user?.contactName ?? user?.businessName ?? 'A')
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4 print:hidden">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-surface-2 hover:text-ink-900 md:hidden"
      >
        <Menu className="size-[18px]" strokeWidth={2} aria-hidden="true" />
      </button>

      <div className="flex min-w-0 items-center gap-1.5">
        {!isHome && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-surface-2 hover:text-ink-900"
          >
            <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        <span className="min-w-0 truncate rounded-full bg-surface-2 px-3 py-1 font-display text-sm font-semibold text-ink-700">
          {meta?.title ?? 'Admin'}
        </span>
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        className={cn(pressable, 'ml-auto hidden max-w-[380px] flex-1 items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink-300 hover:border-line-strong hover:text-ink-500 lg:flex')}
      >
        <Search className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
        <span className="flex-1 text-left">Search clients, orders, products…</span>
        <kbd className="rounded border border-line px-1 py-px text-2xs leading-none text-ink-300">
          Ctrl K
        </kbd>
      </button>

      <div className={cn('flex shrink-0 items-center gap-1.5', 'ml-auto lg:ml-2')}>
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search"
          className="flex size-9 items-center justify-center rounded-md text-ink-500 hover:bg-surface-2 hover:text-ink-900 lg:hidden"
        >
          <Search className="size-[18px]" strokeWidth={2} aria-hidden="true" />
        </button>

        {/* Which shop the panel is looking at. Left of Create because it
            qualifies everything to its right - what you create lands in the
            business you are in. */}
        <BusinessSwitcher />

        {/* This business's website, in a new tab, signed in as this person so
            they see it with prices and a way back here. */}
        {!isImpersonating && (
          <button
            type="button"
            // The signed link is minted while the pointer is on its way, so
            // the click opens a finished link (see useOpenWebsite).
            onPointerEnter={() => website.prepare('/')}
            onFocus={() => website.prepare('/')}
            onClick={() => website.open('/')}
            disabled={website.opening}
            aria-label="Open the website"
            title="Open the website, signed in as you"
            className={cn(pressable, 'flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-500 hover:bg-surface-2 hover:text-ink-900 disabled:opacity-60')}
          >
            <Globe className="size-[18px]" strokeWidth={2} aria-hidden="true" />
            <span className="hidden xl:inline">Website</span>
          </button>
        )}

        <CreateMenu />

        <NotificationMenu />

        <span
          className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-ink-700"
          title={user?.email}
        >
          {initials}
        </span>
      </div>
    </header>
  );
}

export default AdminTopBar;
