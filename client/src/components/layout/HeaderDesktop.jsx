import { Link } from 'react-router';
import { ChevronDown, Grid3x3, Headphones, ShoppingCart, User } from 'lucide-react';
import cn from '@/lib/cn';
import { money } from '@/lib/format';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import LiveSearch from '@/components/search/LiveSearch';
import MegaMenu from './MegaMenu';
import useUiStore from '@/store/uiStore';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useAccountMenuTrigger } from '@/components/account/AccountMenu';
import { pressable } from '@/lib/motion';

/**
 * Account control. Guests get the sign-in popup; a signed-in user gets the
 * account menu, which routes staff to the admin console and buyers (approved or
 * pending) into the /account sections.
 */
function AccountControl() {
  const openAccount = useUiStore((s) => s.openAccount);
  const accountTrigger = useAccountMenuTrigger();
  const accountMenuOpen = useUiStore((s) => s.accountMenuOpen);
  const { user, isAuthenticated, isApproved, isPending, isAdmin } = useAuth();

  // Open, the trigger takes the accent rather than the hover grey: three panels
  // hang off this cluster and the lit button is what says which one you opened.
  const open = isAuthenticated && accountMenuOpen;
  const className = cn(
    pressable,
    'flex items-center gap-2.5 rounded-md px-3 py-2',
    open ? 'bg-brand-50' : 'hover:bg-surface-2',
  );

  const content = (
    <>
      <span className="relative shrink-0">
        <User
          className={cn('size-5', open ? 'text-brand' : 'text-ink-400')}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        {isPending && (
          <span
            className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-warn ring-2 ring-surface"
            aria-hidden="true"
          />
        )}
      </span>
      <span className="max-w-[140px] text-left leading-tight">
        <span className="eyebrow block text-ink-300">
          {!user ? 'Sign in' : isAdmin ? 'Staff' : isApproved ? 'Account' : 'Pending'}
        </span>
        <span className="block truncate font-display text-sm font-semibold text-ink-900">
          {user ? user.displayName : 'My account'}
        </span>
      </span>
    </>
  );

  // Signed in, this opens the account menu rather than jumping to the dashboard:
  // the eight destinations behind /account are the point, and sign-out lives in
  // there too rather than as a bare icon next to the name.
  if (isAuthenticated) {
    return (
      <button
        type="button"
        {...accountTrigger}
        className={className}
      >
        {content}
        <ChevronDown
          className={cn(
            'size-4 shrink-0 transition-transform duration-200',
            open ? 'rotate-180 text-brand' : 'text-ink-300',
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
    );
  }

  return (
    <button type="button" onClick={() => openAccount('signin')} className={className}>
      {content}
    </button>
  );
}

/**
 * Desktop header (brief §4.1, Woodmart order):
 * logo -> Categories mega-menu button -> search -> utility cluster.
 */
export function HeaderDesktop() {
  const megaMenuOpen = useUiStore((s) => s.megaMenuOpen);
  const toggleMegaMenu = useUiStore((s) => s.toggleMegaMenu);
  const toggleCart = useUiStore((s) => s.toggleCart);
  const cartOpen = useUiStore((s) => s.cartFlyoutOpen);

  const { count: cartCount, subtotal } = useCart();
  const info = useBusinessInfo();
  const isHouse = info.isHouse !== false;

  return (
    <div className="relative hidden lg:block">
      <div className="mx-auto flex max-w-[1400px] items-center gap-5 px-6 py-3.5">
        {/* A business that has uploaded a mark gets it; one that has not gets
            its name set as a wordmark. The bundled Cellvix PNG is the fallback
            only for the house business - serving it to every business made
            CellShoppe's storefront carry the wholesaler's logo. */}
        <Link to="/" className="shrink-0" aria-label={`${info.name} home`}>
          {info.logoUrl ? (
            <img src={info.logoUrl} alt={info.name} className="h-9 w-auto" />
          ) : isHouse ? (
            <img
              src="/brand/logo.png"
              srcSet="/brand/logo.png 1x, /brand/logo@2x.png 2x"
              alt={`${info.name} - ${info.tagline}`}
              width="1000"
              height="254"
              className="h-9 w-auto"
            />
          ) : (
            <span className="font-display text-xl font-bold text-ink-900">{info.name}</span>
          )}
        </Link>

        <button
          type="button"
          onClick={toggleMegaMenu}
          aria-expanded={megaMenuOpen}
          aria-haspopup="true"
          className={cn(
            'inline-flex h-11 shrink-0 items-center gap-2 rounded-md px-4 font-display text-md font-semibold transition-[background,filter] duration-press',
            'bg-brand-gradient text-white hover:brightness-110',
          )}
        >
          <Grid3x3 className="size-4" strokeWidth={2} aria-hidden="true" />
          Categories
          <ChevronDown
            className={cn('size-4 transition-transform duration-200', megaMenuOpen && 'rotate-180')}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>

        <LiveSearch className="min-w-0 flex-1" />

        {/* ---- utility cluster ------------------------------------------- */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Dropped entirely for a business with no number on file, rather
              than rendered as a `tel:` that dials nothing. */}
          {info.phone && (
            <a
              href={`tel:${info.phone.replace(/[^\d+]/g, '')}`}
              className={cn(pressable, 'hidden items-center gap-2.5 rounded-md px-3 py-2 hover:bg-surface-2 xl:flex')}
            >
              <Headphones className="size-5 shrink-0 text-ink-400" strokeWidth={1.5} aria-hidden="true" />
              <span className="leading-tight">
                <span className="eyebrow block text-ink-300">Sales desk</span>
                <span className="block font-display text-sm font-semibold text-ink-900">
                  {info.phone}
                </span>
              </span>
            </a>
          )}

          <AccountControl />

          <button
            type="button"
            onClick={toggleCart}
            aria-expanded={cartOpen}
            aria-haspopup="dialog"
            className={cn(
              pressable,
              'flex items-center gap-2.5 rounded-md px-3 py-2',
              cartOpen ? 'bg-brand-50' : 'hover:bg-surface-2',
            )}
            aria-label={`Cart, ${cartCount} items`}
          >
            <span className="relative shrink-0">
              <ShoppingCart
                className={cn('size-5', cartOpen ? 'text-brand' : 'text-ink-400')}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              {cartCount > 0 && (
                <span className="tnum absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-display text-2xs font-bold text-white ring-2 ring-surface">
                  {cartCount}
                </span>
              )}
            </span>
            <span className="text-left leading-tight">
              <span className="eyebrow block text-ink-300">Cart</span>
              <span className="tnum block font-display text-sm font-semibold text-ink-900">
                {subtotal === null ? '-' : money(subtotal)}
              </span>
            </span>
          </button>
        </div>
      </div>

      <MegaMenu />
    </div>
  );
}

export default HeaderDesktop;
