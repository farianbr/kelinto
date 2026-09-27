import { useEffect, useId, useLayoutEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { ArrowUpRight, LogOut, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import cn from '@/lib/cn';
import { ACCOUNT_NAV_ITEMS } from '@shared/schemas/account';
import { accountIcon } from './accountIcons';
import useUiStore from '@/store/uiStore';
import { useAuth, useSignOut } from '@/hooks/useAuth';
import { ease, pressable } from '@/lib/motion';
import { panelUrl } from '@/lib/surface';

/**
 * Panel width. Was 280, which fit the longest label and nothing else: the rows
 * are icon + text + nothing, so every one of them ended in a run of empty
 * surface whose width was however much "Payment methods" happened to leave. The
 * panel now has room for the text to sit in a padded box rather than against
 * the left edge of one.
 */
const PANEL_W = 296;

/**
 * The inset every row in the panel shares.
 *
 * The header, the nav rows and sign-out used to be padded independently - the
 * header at 14px, the rows at 10px inside a 6px-padded scroller - so nothing
 * lined up down the left, and the text read as pushed into the corner while the
 * right side ran empty. One value across all three sections gives the panel a
 * single left margin and, because each row is a full-width block, an equal one
 * on the right.
 */
const INSET = 'px-3';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Props for any button that opens the account menu.
 *
 * Marking the pressed button is what lets the panel anchor to the control the
 * user actually touched - three of them are mounted at once, and two are
 * visible together on a phone.
 */
export function useAccountMenuTrigger() {
  const toggle = useUiStore((s) => s.toggleAccountMenu);
  const open = useUiStore((s) => s.accountMenuOpen);

  return {
    'data-account-trigger': '',
    'aria-expanded': open,
    'aria-haspopup': 'dialog',
    onClick(event) {
      const pressed = event.currentTarget;
      for (const element of document.querySelectorAll('[data-account-active]')) {
        element.removeAttribute('data-account-active');
      }
      pressed.setAttribute('data-account-active', '');
      toggle();
    },
  };
}

/**
 * The signed-in account menu, anchored under the header account button.
 *
 * Reaching order history used to mean landing on /account first and finding the
 * sidebar; the same eight destinations are one click from any page now. It
 * reads `ACCOUNT_NAV_ITEMS` - the shared list the sidebar is built from - so the two cannot
 * fall out of step.
 *
 * Rendered inside <header> next to CartDropdown, and behaves the same way: no
 * portal, scrim below the header, its own Escape handler.
 */
export function AccountMenu() {
  const open = useUiStore((s) => s.accountMenuOpen);
  const close = useUiStore((s) => s.closeAccountMenu);

  const { user, isApproved, isPending, isPanelAccount } = useAuth();
  const signOut = useSignOut();

  const titleId = useId();

  // Three different buttons open this - desktop header, mobile header, bottom
  // bar - and they sit in different places. The panel is positioned against the
  // one that was actually pressed (see useAccountMenuTrigger), so it always
  // reads as belonging to that control rather than to the page edge.
  const [anchor, setAnchor] = useState(null);

  useLayoutEffect(() => {
    if (!open) return undefined;

    function measure() {
      const visible = [...document.querySelectorAll('[data-account-trigger]')].filter(
        (element) => element.offsetParent !== null,
      );
      const trigger = visible.find((element) => element.hasAttribute('data-account-active')) ?? visible[0];
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      // A trigger in the lower half of the screen - the bottom bar - gets the
      // panel above it; hanging it below would put it off-screen.
      const below = rect.top < window.innerHeight / 2;

      // Clamped so a trigger near the screen edge cannot push the panel off it.
      const right = Math.max(12, window.innerWidth - rect.right);

      setAnchor({
        top: below ? rect.bottom + 9 : undefined,
        bottom: below ? undefined : window.innerHeight - rect.top + 9,
        right,
        // Where the tail sits, measured in from the panel's right edge, so it
        // lands under the middle of the button that was pressed. Right-aligning
        // the panel is not enough on its own: the account button has the cart
        // button to its right, so the panel hangs off-centre and reads as
        // belonging to the header rather than to a control. The tail says which.
        // Kept off both corners so it never fouls the panel's rounding.
        caret: clamp(window.innerWidth - (rect.left + rect.width / 2) - right, 16, PANEL_W - 16),
      });
    }

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape') close();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  if (!user) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="fixed inset-0 top-[var(--header-h,116px)] z-30 bg-ink-900/40 backdrop-blur-[1px]"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.24, ease: ease.entrance }}
            style={{ top: anchor?.top, bottom: anchor?.bottom, right: anchor?.right ?? 12 }}
            className={cn('fixed z-40', anchor?.bottom ? 'origin-bottom-right' : 'origin-top-right')}
          >
            <div className="relative flex justify-end">
              {/* The tail. Sits outside the panel's own box, which is clipped. */}
              <span
                style={{ right: anchor?.caret ?? 24 }}
                className={cn(
                  'absolute z-10 size-3 rotate-45 rounded-sm border-line bg-surface',
                  anchor?.bottom
                    ? '-bottom-[6px] border-b border-r'
                    : '-top-[6px] border-l border-t',
                )}
                aria-hidden="true"
              />

              <div
                role="dialog"
                aria-labelledby={titleId}
                style={{ width: `min(${PANEL_W}px, calc(100vw - 24px))` }}
                className="flex max-h-[min(72vh,620px)] flex-col overflow-hidden rounded-lg bg-surface shadow-flyout"
              >
                <header id={titleId} className={cn('shrink-0 border-b border-line py-3', INSET)}>
                  <p className="truncate font-display text-md font-bold text-ink-900">
                    {user.displayName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-400">{user.email}</p>

                  <span
                    className={cn(
                      'mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                      isPanelAccount
                        ? 'bg-surface-3 text-ink-700'
                        : isApproved
                          ? 'bg-ok-50 text-ok'
                          : 'bg-warn-50 text-warn',
                    )}
                  >
                    <ShieldCheck className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                    {isPanelAccount ? 'Staff account' : isApproved ? 'Wholesale account approved' : 'Under review'}
                  </span>
                </header>

                {/* The rounded hover fill needs to sit off the panel edge, so
                    the container keeps a small inset and the ROWS give back the
                    same amount - 6px + 6px lands the label on the header's
                    12px. Previously 6px + 10px put every label 4px right of the
                    business name above it, which is the misalignment that made
                    the text look shoved into the corner. */}
                <div className="scroll-slim flex-1 overflow-y-auto overscroll-contain p-1.5">
                  {isPanelAccount ? (
                    // Staff have no buyer orders, invoices or credit - the buyer
                    // nav would be eight dead ends. A full navigation: the ERP
                    // is its own host with its own session.
                    <a
                      href={panelUrl('/admin')}
                      onClick={close}
                      className={cn(pressable, 'flex items-center gap-3 rounded-md px-1.5 py-2 text-sm font-medium text-ink-700 hover:bg-surface-2 hover:text-ink-900')}
                    >
                      <ArrowUpRight className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                      Go to the ERP
                    </a>
                  ) : (
                    <ul className="space-y-0.5">
                      {ACCOUNT_NAV_ITEMS.map((item) => {
                        const Icon = accountIcon(item.icon);
                        return (
                          <li key={item.key}>
                            <NavLink
                              to={item.to}
                              end={item.to === '/account'}
                              onClick={close}
                              className={({ isActive }) =>
                                cn(
                                  pressable,
                                  'flex items-center gap-3 rounded-md px-1.5 py-2 text-sm font-medium',
                                  isActive
                                    ? 'bg-brand-50 text-brand-700'
                                    : 'text-ink-700 hover:bg-surface-2 hover:text-ink-900',
                                )
                              }
                            >
                              <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                              {item.label}
                            </NavLink>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Same 6px + 6px as the scroller above, so sign-out sits on
                    the same left line as the nav rows and the header. */}
                <footer className="shrink-0 border-t border-line p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      signOut();
                    }}
                    className={cn(pressable, 'flex w-full items-center gap-3 rounded-md px-1.5 py-2 text-left text-sm font-medium text-ink-500 hover:bg-danger-50 hover:text-danger')}
                  >
                    <LogOut className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                    Sign out
                  </button>
                </footer>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default AccountMenu;
