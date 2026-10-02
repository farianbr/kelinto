import { Link, useLocation } from 'react-router';
import { AnimatePresence, motion } from '@/lib/motionReact';
import { Home, Menu, Search, ShoppingCart, User } from 'lucide-react';
import cn from '@/lib/cn';
import { BOTTOM_NAV_REVEAL_AT } from '@/lib/constants';
import useUiStore from '@/store/uiStore';
import useScrollProgress from '@/hooks/useScrollProgress';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useAccountMenuTrigger } from '@/components/account/AccountMenu';
import { ease } from '@/lib/motion';
import { useCatalogueLink } from '@/hooks/useCatalog';

/**
 * Phone/tablet bottom bar (brief §4.2).
 *
 * Deliberately absent at the top of a page - the header already carries the
 * logo, search and cart there. It slides up once the header has scrolled away,
 * which is the point at which search and cart become unreachable.
 *
 * z-30 keeps it under every overlay (z-50), so a drawer's scrim covers it.
 */
export function MobileBottomNav() {
  const link = useCatalogueLink();
  const { pathname } = useLocation();
  const { y } = useScrollProgress();

  const openMobileNav = useUiStore((s) => s.openMobileNav);
  const focusSearch = useUiStore((s) => s.focusSearch);
  const openCart = useUiStore((s) => s.openCart);
  const openAccount = useUiStore((s) => s.openAccount);
  const accountTrigger = useAccountMenuTrigger();
  const cartOpen = useUiStore((s) => s.cartFlyoutOpen);
  const accountMenuOpen = useUiStore((s) => s.accountMenuOpen);

  const { count: cartCount } = useCart();
  const { isAuthenticated, isPending } = useAuth();

  const visible = y > BOTTOM_NAV_REVEAL_AT;
  const accountTo = '/account';

  return (
    <AnimatePresence>
      {visible && (
        <motion.nav
          aria-label="Quick navigation"
          initial={{ y: '110%' }}
          animate={{ y: 0 }}
          exit={{ y: '110%' }}
          transition={{ duration: 0.24, ease: ease.entrance }}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          <ul className="mx-auto flex max-w-[560px] items-stretch">
            <BarItem
              as={Link}
              to={link('/shop')}
              icon={Home}
              label="Shop"
              active={pathname === link('/shop')}
            />

            {/* Was Categories. The drill-down moved under Menu › Shop › Parts
                when the drawer's second tab became Account (2026-09-30). */}
            <BarItem icon={Menu} label="Menu" onClick={() => openMobileNav('menu')} />

            {/* The one raised control: search is the primary way into a
                200k-SKU catalogue, so it does not look like the others. It puts
                the cursor in the header's search field - that bar is sticky and
                never leaves the screen, so a second one would be a duplicate. */}
            <li className="flex flex-1 justify-center">
              <button
                type="button"
                onClick={focusSearch}
                aria-label="Search parts"
                className="-mt-5 flex size-14 flex-col items-center justify-center rounded-full bg-brand-gradient text-white shadow-pop ring-4 ring-surface transition-[filter] duration-press active:brightness-95"
              >
                <Search className="size-[22px]" strokeWidth={2.25} aria-hidden="true" />
              </button>
            </li>

            {/* `active` while the panel is open, so the bar says which button
                put it there - the same signal the header buttons carry. */}
            <BarItem
              icon={ShoppingCart}
              label="Cart"
              onClick={openCart}
              active={cartOpen}
              badge={cartCount}
            />

            {isAuthenticated ? (
              // Opens the same account menu the headers use, so the eight
              // account sections are one tap from the bar rather than two.
              <BarItem
                icon={User}
                label="Account"
                active={accountMenuOpen || pathname.startsWith(accountTo)}
                dot={isPending}
                {...accountTrigger}
              />
            ) : (
              <BarItem icon={User} label="Sign in" onClick={() => openAccount('signin')} />
            )}
          </ul>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

/** One 44px-tall tap target. Renders as a Link or a button depending on `as`. */
function BarItem({ as: As = 'button', icon: Icon, label, active = false, badge = 0, dot = false, ...props }) {
  return (
    <li className="flex-1">
      <As
        {...(As === 'button' ? { type: 'button' } : {})}
        aria-current={active && As !== 'button' ? 'page' : undefined}
        className={cn(
          'relative flex h-full w-full flex-col items-center justify-center gap-1 px-1 py-2 transition-colors',
          active ? 'text-brand' : 'text-ink-400 active:text-ink-900',
        )}
        {...props}
      >
        <span className="relative">
          <Icon className="size-[21px]" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
          {badge > 0 && (
            <span className="tnum absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-display text-2xs font-bold text-white ring-2 ring-surface">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
          {dot && (
            <span
              className="absolute -right-1 -top-0.5 size-2 rounded-full bg-warn ring-2 ring-surface"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="font-display text-2xs font-semibold leading-none">{label}</span>
        {active && (
          <span className="rule-brand-gradient absolute inset-x-4 top-0 h-0.5 rounded-full" aria-hidden="true" />
        )}
      </As>
    </li>
  );
}

export default MobileBottomNav;
