import { useLayoutEffect, useRef } from 'react';
import AnnouncementBar from './AnnouncementBar';
import HeaderDesktop from './HeaderDesktop';
import HeaderMobile from './HeaderMobile';
import PrimaryNav, { NAV_STRIP_H } from './PrimaryNav';
import MobileDrawer from './MobileDrawer';
import CartDropdown from '@/components/cart/CartDropdown';
import AccountMenu from '@/components/account/AccountMenu';
import { useKioskShopping } from '@/lib/kioskShopping';
import KioskShoppingBar from './KioskShoppingBar';

/**
 * Header shell.
 *
 * Desktop and mobile headers are two different layouts (Woodmart vs Unimart per
 * the brief) swapped by CSS visibility, never by a JS width check - that keeps
 * the correct one painted on the first frame.
 */
export function Header() {
  const ref = useRef(null);
  const kiosk = useKioskShopping();

  // TWO measurements, because there are two different questions to answer.
  //
  // `--header-h` is the header shell itself. The mega menu and cart dropdown
  // hang off it and dim everything below, so their scrims need its real
  // height. It changes with the breakpoint and when the announcement bar is
  // dismissed, so measure it rather than hard-coding - a stale value leaves an
  // undimmed strip.
  //
  // `--chrome-h` is the header PLUS the sliding nav row, which is what a
  // sticky element in the page has to clear. The row is absolutely positioned
  // and overlays the body (see PrimaryNav.jsx), so it contributes nothing to
  // `--header-h` - correct for a scrim that starts below the header, and wrong
  // for a sticky sidebar, which would otherwise park under the row and have
  // its top 45px covered. That is exactly what happened to the deal page
  // price.
  //
  // The row is lg-only and a fixed 45px, so this adds that below lg rather
  // than measuring a second element: a sticky offset is only ever consumed
  // inside an `lg:` utility, but the variable is read at every width and must
  // not over-reserve on a phone where the row does not exist.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const lg = window.matchMedia('(min-width: 1024px)');

    function update() {
      const h = el.offsetHeight;
      const root = document.documentElement;
      root.style.setProperty('--header-h', `${h}px`);
      root.style.setProperty('--chrome-h', `${h + (lg.matches ? NAV_STRIP_H : 0)}px`);
    }

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    // The strip appears and disappears at the lg boundary, so the sum changes
    // on a resize that does not change the header height at all.
    lg.addEventListener('change', update);
    return () => {
      observer.disconnect();
      lg.removeEventListener('change', update);
    };
  }, []);

  return (
    <>
      <header ref={ref} className="sticky top-0 z-40 border-b border-line bg-surface">
        {/* A customer shopping from the in-store kiosk gets the kiosk's strip in
            the announcement's place: see KioskShoppingBar. */}
        {kiosk ? <KioskShoppingBar /> : <AnnouncementBar />}
        <HeaderDesktop />
        <HeaderMobile />

        {/* Below both headers and inside the measured shell, because revealing
            it changes the header's height and the mega menu and cart scrims are
            positioned off that measurement. Mounted outside, the scrims would
            dim the strip they are meant to start below. */}
        <PrimaryNav />

        {/* Anchored to the header shell, not to either header, so one dropdown
            serves both layouts and stays put while the header is sticky. */}
        <CartDropdown />
        <AccountMenu />
      </header>
      <MobileDrawer />
    </>
  );
}

export default Header;
