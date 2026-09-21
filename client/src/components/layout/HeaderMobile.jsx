import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Menu, ShoppingCart, User } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import cn from '@/lib/cn';
import { BOTTOM_NAV_REVEAL_AT } from '@/lib/constants';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import LiveSearch from '@/components/search/LiveSearch';
import useUiStore from '@/store/uiStore';
import useScrollProgress from '@/hooks/useScrollProgress';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useAccountMenuTrigger } from '@/components/account/AccountMenu';
import { ease, pressable } from '@/lib/motion';

/**
 * Tablet / mobile header (brief §4.2, Unimart pattern):
 * hamburger - centred logo - cart, with the search bar on its own row beneath.
 */
export function HeaderMobile() {
  const openMobileNav = useUiStore((s) => s.openMobileNav);
  const toggleCart = useUiStore((s) => s.toggleCart);
  const cartOpen = useUiStore((s) => s.cartFlyoutOpen);
  const openAccount = useUiStore((s) => s.openAccount);
  const accountTrigger = useAccountMenuTrigger();
  const info = useBusinessInfo();
  const accountMenuOpen = useUiStore((s) => s.accountMenuOpen);
  const searchFocusToken = useUiStore((s) => s.searchFocusToken);
  const mobileSearchOpen = useUiStore((s) => s.mobileSearchOpen);
  const closeMobileSearch = useUiStore((s) => s.closeMobileSearch);
  const { count: cartCount } = useCart();
  const { isAuthenticated, isPending } = useAuth();

  const { y } = useScrollProgress();

  /**
   * The search row folds away once the page has scrolled past the point where
   * the bottom bar takes over (BOTTOM_NAV_REVEAL_AT) - it is a whole row of
   * chrome sitting on top of the grid the buyer came to read, and the bar's
   * raised search button reaches it from anywhere. Above that point the bar is
   * not on screen yet, so the row stays: there is never a moment with neither.
   *
   * The bottom bar's button unfolds it again and drops the cursor in it.
   */
  const scrolled = y > BOTTOM_NAV_REVEAL_AT;
  const searchVisible = !scrolled || mobileSearchOpen;

  // Back at the top the row belongs to the header again, so the raised flag is
  // dropped - otherwise it would stay latched for the rest of the session and
  // the row would never fold on the next scroll.
  useEffect(() => {
    if (!scrolled && mobileSearchOpen) closeMobileSearch();
  }, [scrolled, mobileSearchOpen, closeMobileSearch]);

  /**
   * Raised search folds again on the next scroll, once the field is empty.
   *
   * Without this it only ever folded once: the flag went up on the first tap
   * and only came down at the top of the page, so a buyer who opened search,
   * cleared it and carried on scrolling kept the row for the rest of the visit.
   *
   * An empty field is the signal that the search is over. While there is a term
   * in it the row stays put whatever the page does - scrolling with a query is
   * reading results, not dismissing them.
   */
  const [searchTerm, setSearchTerm] = useState('');
  const openedAtY = useRef(0);

  useEffect(() => {
    if (mobileSearchOpen) openedAtY.current = window.scrollY;
  }, [mobileSearchOpen]);

  // The field unmounts with the row, so the term it was holding has to go too
  // a stale one left here would keep the next raise from ever folding.
  useEffect(() => {
    if (!searchVisible) setSearchTerm('');
  }, [searchVisible]);

  useEffect(() => {
    if (!mobileSearchOpen || !scrolled) return;
    if (searchTerm.trim()) return;
    // A threshold, not any movement: the row opening shifts the page under the
    // reader by its own height, and that shift must not close it again.
    if (Math.abs(y - openedAtY.current) < 64) return;
    closeMobileSearch();
  }, [y, scrolled, mobileSearchOpen, searchTerm, closeMobileSearch]);

  // The row is clipped only while it is actually moving. Left clipped, it would
  // cut off the type-ahead panel, which hangs out of this box by design.
  const [collapsing, setCollapsing] = useState(false);

  // Open, a trigger takes the accent rather than the hover grey - on a phone the
  // panel covers most of the screen, and the lit icon is the only thing left
  // saying which button put it there.
  const iconButton = (open) =>
    cn(
      pressable,
      'relative flex size-10 shrink-0 items-center justify-center rounded-md',
      open ? 'bg-brand-50 text-brand' : 'text-ink-700 hover:bg-surface-2',
    );

  return (
    <div className="lg:hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => openMobileNav()}
          aria-label="Open menu"
          className={iconButton(false)}
        >
          <Menu className="size-[22px]" strokeWidth={2} />
        </button>

        {/* Same fallback ladder as the desktop header: the business's own mark,
            then the bundled artwork for the house business only, then its name
            as a wordmark. `truncate` because a long name has one narrow row
            between two buttons here. */}
        <Link to="/" className="mx-auto min-w-0" aria-label={`${info.name} home`}>
          {info.logoUrl ? (
            <img src={info.logoUrl} alt={info.name} className="h-8 w-auto" />
          ) : info.isHouse !== false ? (
            <img
              src="/brand/logo.png"
              srcSet="/brand/logo.png 1x, /brand/logo@2x.png 2x"
              alt={`${info.name} - ${info.tagline}`}
              width="1000"
              height="254"
              className="h-8 w-auto"
            />
          ) : (
            <span className="block truncate font-display text-lg font-bold text-ink-900">
              {info.name}
            </span>
          )}
        </Link>

        {/* Signed in, this opens the account menu - the same dropdown the
            desktop header uses - rather than reopening the sign-in popup. */}
        {isAuthenticated ? (
          <button
            type="button"
            {...accountTrigger}
            aria-label="Account"
            className={iconButton(accountMenuOpen)}
          >
            <User className="size-[21px]" strokeWidth={1.75} />
            {isPending && (
              <span
                className="absolute right-1.5 top-1.5 size-2 rounded-full bg-warn ring-2 ring-surface"
                aria-hidden="true"
              />
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openAccount('signin')}
            aria-label="Account"
            className={iconButton(false)}
          >
            <User className="size-[21px]" strokeWidth={1.75} />
          </button>
        )}

        <button
          type="button"
          onClick={toggleCart}
          aria-expanded={cartOpen}
          aria-haspopup="dialog"
          aria-label={`Cart, ${cartCount} items`}
          className={iconButton(cartOpen)}
        >
          <ShoppingCart className="size-[21px]" strokeWidth={1.75} />
          {cartCount > 0 && (
            <span className="tnum absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-display text-2xs font-bold text-white ring-2 ring-surface">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {/* The bottom bar's search button raises this row and focuses THIS field
          see uiStore. `initial={false}` so a reload deep down the page does not
          animate the row open just to fold it shut. */}
      <AnimatePresence initial={false}>
        {searchVisible && (
          <motion.div
            key="mobile-search"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: ease.entrance }}
            onAnimationStart={() => setCollapsing(true)}
            onAnimationComplete={() => setCollapsing(false)}
            className={collapsing ? 'overflow-hidden' : undefined}
          >
            <div className="px-3 pb-3">
              <LiveSearch
                focusToken={searchFocusToken}
                onNavigate={closeMobileSearch}
                onValueChange={setSearchTerm}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default HeaderMobile;
