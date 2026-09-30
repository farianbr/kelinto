import { create } from 'zustand';

/** Everything anchored to the header shares one dropdown slot. */
const DESKTOP = '(min-width: 1024px)';

/**
 * Overlay coordination. Only one of these should be open at a time - opening any
 * of them closes the others, so the header never stacks a mega menu behind an
 * account popup.
 */
export const useUiStore = create((set) => ({
  megaMenuOpen: false,
  mobileNavOpen: false,
  mobileNavTab: 'menu', // menu | account
  cartFlyoutOpen: false,
  accountMenuOpen: false,
  accountPopupOpen: false,
  accountPopupTab: 'signin', // signin | signup | contact
  mobileFiltersOpen: false,
  signOutConfirmOpen: false,
  announcementDismissed: false,

  // Bumped, never read for its value: the mobile header's LiveSearch focuses
  // itself whenever this changes. The bottom bar's search button is the only
  // caller.
  searchFocusToken: 0,

  // The mobile header's search row folds away once the page has scrolled past
  // BOTTOM_NAV_REVEAL_AT - a full row of chrome over a grid the buyer is
  // reading. This flag is what the bottom bar's search button raises to unfold
  // it again; the header drops it back on its own when the page returns to the
  // top, so the default behaviour is never left latched on.
  mobileSearchOpen: false,

  openMegaMenu: () =>
    set({ megaMenuOpen: true, cartFlyoutOpen: false, accountPopupOpen: false, accountMenuOpen: false }),
  closeMegaMenu: () => set({ megaMenuOpen: false }),
  toggleMegaMenu: () =>
    set((s) => ({
      megaMenuOpen: !s.megaMenuOpen,
      cartFlyoutOpen: false,
      accountPopupOpen: false,
      accountMenuOpen: false,
    })),

  // `tab` picks which of the drawer's two tabs opens: `menu` (the site) or
  // `account` (the account's own menu, or a way to sign in).
  openMobileNav: (tab = 'menu') =>
    set({ mobileNavOpen: true, mobileNavTab: tab, cartFlyoutOpen: false, accountMenuOpen: false }),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  setMobileNavTab: (mobileNavTab) => set({ mobileNavTab }),

  focusSearch: () =>
    set((s) => ({
      searchFocusToken: s.searchFocusToken + 1,
      mobileSearchOpen: true,
      mobileNavOpen: false,
      cartFlyoutOpen: false,
      megaMenuOpen: false,
      accountPopupOpen: false,
      accountMenuOpen: false,
    })),

  closeMobileSearch: () => set({ mobileSearchOpen: false }),

  openCart: () =>
    set({ cartFlyoutOpen: true, megaMenuOpen: false, accountPopupOpen: false, accountMenuOpen: false }),
  closeCart: () => set({ cartFlyoutOpen: false }),
  // The cart is a dropdown anchored under its own trigger, so that button has
  // to close it again - the scrim never covers the header.
  toggleCart: () =>
    set((s) => ({
      cartFlyoutOpen: !s.cartFlyoutOpen,
      megaMenuOpen: false,
      accountPopupOpen: false,
      accountMenuOpen: false,
    })),

  /**
   * Add to Cart opens the mini-cart on desktop only.
   *
   * On a phone the dropdown covers the grid you are still shopping, so adding a
   * second part means dismissing it first. The card's own "Added" state, its
   * in-cart pill and the bottom bar's badge already confirm the add there.
   */
  openCartAfterAdd: () => {
    if (typeof window !== 'undefined' && window.matchMedia(DESKTOP).matches) {
      set({ cartFlyoutOpen: true, megaMenuOpen: false, accountPopupOpen: false, accountMenuOpen: false });
    }
  },

  openAccountMenu: () =>
    set({ accountMenuOpen: true, cartFlyoutOpen: false, megaMenuOpen: false, accountPopupOpen: false }),
  closeAccountMenu: () => set({ accountMenuOpen: false }),
  toggleAccountMenu: () =>
    set((s) => ({
      accountMenuOpen: !s.accountMenuOpen,
      cartFlyoutOpen: false,
      megaMenuOpen: false,
      accountPopupOpen: false,
    })),

  openAccount: (tab = 'signin') =>
    set({
      accountPopupOpen: true,
      accountPopupTab: tab,
      megaMenuOpen: false,
      cartFlyoutOpen: false,
      accountMenuOpen: false,
    }),
  closeAccount: () => set({ accountPopupOpen: false }),
  setAccountTab: (accountPopupTab) => set({ accountPopupTab }),

  openMobileFilters: () => set({ mobileFiltersOpen: true }),
  closeMobileFilters: () => set({ mobileFiltersOpen: false }),

  /**
   * Sign-out confirmation.
   *
   * Lives in the store rather than in each of the four places that offer a Sign
   * out button (account menu, account layout, mobile drawer, admin sidebar),
   * because a confirmation that has to be remembered at every call site is one
   * that eventually is not. `useSignOut` raises this flag; a single dialog at
   * the app root renders it and calls back on confirm.
   *
   * Every panel that could be covering the dialog closes with it - the account
   * menu in particular, since that is where the button usually is.
   */
  askSignOut: () =>
    set({
      signOutConfirmOpen: true,
      accountMenuOpen: false,
      mobileNavOpen: false,
      cartFlyoutOpen: false,
      megaMenuOpen: false,
    }),
  closeSignOutConfirm: () => set({ signOutConfirmOpen: false }),

  dismissAnnouncement: () => set({ announcementDismissed: true }),
}));

export default useUiStore;
