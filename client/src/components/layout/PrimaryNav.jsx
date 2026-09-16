import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Layers, Sparkles, TicketPercent } from 'lucide-react';
import cn from '@/lib/cn';
import { useAuth } from '@/hooks/useAuth';
import { useOffers } from '@/hooks/useContent';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import { ease, popover, pressable } from '@/lib/motion';

/**
 * The static-page navigation strip, below the header.
 *
 * It exists because the header is a WORKING bar - search, cart, account,
 * categories - and had no room for the pages a buyer reads rather than shops:
 * about, blog, FAQ, contact. Those lived only in the mobile drawer and the
 * footer, so on desktop the only route to them was scrolling to the bottom of
 * whatever page you were already on.
 *
 * Deliberately NOT a second header. The links are 13px medium in ink-500, the
 * active one is ink-900 over a gradient underline, and nothing here is filled:
 * a strip of nine buttons competing with the Categories button above it would
 * turn one navigation into two that disagree about which is primary.
 *
 * lg+ only. Below that the drawer and the bottom bar already carry every one of
 * these links, and a third surface on a phone is not more navigation, it is a
 * contradiction.
 */

/** Left of the dropdown. Order is the reading order of a buyer's visit. */
const LINKS = [
  { label: 'Home', to: '/' },
  { label: 'Shop', to: '/shop' },
  { label: 'About us', to: '/about' },
  { label: 'Blog', to: '/blog' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Contact us', to: '/contact' },
];

/**
 * How far the page must move in one direction before the row reacts.
 *
 * **The row is shown by DEFAULT and hides on the way down**, which is the
 * opposite of what it used to do: it used to be absent at the top and appear
 * past 96px. Showing it by default means the nav is there when the page loads,
 * which is where somebody looks for it first.
 *
 * A direction flip needs a dead zone or the row oscillates. Trackpads and
 * momentum scrolling emit tiny deltas in both directions around a resting
 * point, so reacting to any non-zero movement would strobe the row through
 * every settle. 8px of travel is below what a deliberate scroll gesture ever
 * produces and above what jitter does.
 */
const DIRECTION_DEADZONE = 8;

/**
 * How far down the page hiding is allowed to start at all.
 *
 * Near the top the header is still in view and the row is part of it, so
 * retracting it there reads as the chrome coming apart rather than as making
 * room. Past this the reader is into the body and the row is genuinely
 * overlaying content.
 */
const HIDE_BELOW = 96;

/**
 * The row's height, in pixels.
 *
 * Exported because Header.jsx adds it to the measured header height to publish
 * `--chrome-h`, the offset a sticky element in the page has to clear. The row
 * overlays the body rather than sitting in the layout, so it cannot be measured
 * as part of the header - and two hardcoded 45s that drift apart is exactly how
 * a sticky sidebar ends up parked under it.
 */
export const NAV_STRIP_H = 45;

/** Shared by every link and the dropdown trigger, so the row is one row. */
const ITEM =
  'relative flex h-11 items-center gap-1.5 px-3 font-display text-sm font-medium ' +
  'text-ink-500 hover:text-ink-900';

/**
 * The active marker: a gradient underline, never a fill.
 *
 * Same reasoning as pagination (Instructions §2.2) - a nav item is a place, not
 * an action, so filling one makes it look more pressable than its six
 * neighbours. The underline is 2px and takes the COMPACT ramp: at that height
 * the standard ramp's near-black opening is a third of the visible run and
 * reads as a dark blot on the left end rather than as the brand.
 */
function ActiveBar() {
  return (
    <motion.span
      layoutId="primary-nav-active"
      transition={{ duration: 0.22, ease: ease.entrance }}
      // Lifted 6px off the bottom edge. Flush against the row's own border the
      // 2px bar merges with it and reads as a locally thicker divider rather
      // than as a marker pointing at one item.
      className="absolute inset-x-2 bottom-1.5 h-0.5 rounded-full bg-brand-gradient-compact"
      aria-hidden="true"
    />
  );
}

/**
 * Offers, as a dropdown over the three surfaces that sell.
 *
 * They are three separate pages for good reasons - a combo is priced as a unit,
 * clearance is an admin flag on a product, an exclusive deal has its own page
 * with a clock on it - and a buyer does not hold that distinction in their
 * head. One parent named Offers lets them find all three without us collapsing
 * them into a list that would have to explain itself.
 */
function OffersMenu({ pathname, shown }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  /**
   * Hover open, with intent on the way in and grace on the way out.
   *
   * Both delays exist for the same reason: a pointer crossing the row on its
   * way somewhere else is not a request. Opening on the raw `mouseenter` makes
   * the panel flash at anybody sweeping the nav, and closing on the raw
   * `mouseleave` snatches it away while the pointer is travelling the 6px of
   * dead space between the trigger and the panel.
   *
   * The close grace is longer than the open intent, because the cost is
   * asymmetric - a panel that lingers 200ms is unnoticeable, one that closes
   * under a moving pointer means the user has to go back and try again.
   */
  const timer = useRef(0);

  // The panel is portalled to the body, so it is NOT a DOM descendant of the
  // wrapper: `contains()` cannot see it, and both the click-outside test and
  // the blur test have to be told about it separately or a click inside the
  // panel reads as a click outside the menu.
  const panelRef = useRef(null);

  /**
   * The panel is FIXED and measured, not absolutely positioned inside the row.
   *
   * The strip clips its own overflow so the row can slide up out of it, and the
   * sliding element carries a `transform` - which makes it the containing block
   * for any fixed descendant, so the clip catches those too. Measuring the
   * trigger and rendering against the viewport is the approach AccountMenu
   * takes; the portal below is what actually escapes the clip.
   */
  const [anchor, setAnchor] = useState(null);

  const { isApproved } = useAuth();
  const { data } = useOffers(isApproved);

  const close = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
  }, []);

  // Memoised: the hook re-subscribes whenever this identity changes, and a
  // fresh array literal every render would tear the listener down and rebuild
  // it on each one.
  const outsideRefs = useMemo(() => [ref, panelRef], []);
  useOnClickOutside(outsideRefs, close, open);

  // Touch and pen fall through to the click handler, which is the right
  // interaction for them: a touch fires `mouseenter` on tap, so an ungated
  // hover would open the panel and let the tap immediately toggle it shut
  // again - the classic touch double-fire.
  //
  // Written as "reject touch and pen" rather than "require mouse" on purpose.
  // A synthetic or assistive-tech pointer event carries an EMPTY pointerType,
  // and requiring an explicit 'mouse' silently dropped those - which is a real
  // accessibility gap, not only a test artefact.
  const hoverIntent = useCallback((event, next) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), next ? 90 : 220);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Retracting the strip under an open panel would leave it floating against
  // nothing, pointing at a trigger that is no longer on screen.
  useEffect(() => {
    if (!shown) close();
  }, [shown, close]);

  useLayoutEffect(() => {
    if (!open) return undefined;

    function measure() {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left });
    }

    measure();
    // The header is sticky, so the trigger moves under the user while the panel
    // is open. Without this the panel detaches and floats over the page.
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  // Closing on a route change rather than on the click gives the panel one
  // behaviour for all three items, including a click on the page you are
  // already on - where nothing navigates and a click-only close would leave the
  // panel hanging.
  useEffect(close, [pathname, close]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        close();
        ref.current?.querySelector('button')?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  /**
   * There is no index of exclusive deals, only a page per offer, so the item
   * has to resolve to a live slug. `/offers` answers grouped rather than flat,
   * which is why all three buckets are searched.
   *
   * No live exclusive means no item. A nav entry that lands on a 404 is worse
   * than an absent one, and an "Exclusive deals" page that says "none running"
   * advertises the gap every time somebody opens the menu.
   */
  const exclusive = [
    ...(data?.featured ? [data.featured] : []),
    ...(data?.deals ?? []),
    ...(data?.combos ?? []),
  ].find((offer) => offer.isExclusive);

  const items = [
    {
      to: '/offers',
      icon: Layers,
      label: 'Combo deals',
      note: 'Parts priced as one unit',
    },
    {
      to: '/clearance',
      icon: TicketPercent,
      label: 'Stock clearance',
      note: 'Marked down while stock lasts',
    },
    ...(exclusive
      ? [
          {
            to: `/deals/${exclusive.slug}`,
            icon: Sparkles,
            // SINGULAR. An exclusive deal is one product at a time, by
            // definition - the plural would promise a list that does not and
            // cannot exist.
            label: 'Exclusive deal',
            note: exclusive.title,
          },
        ]
      : []),
  ];

  const active = items.some((item) => pathname === item.to || pathname.startsWith('/deals/'));

  return (
    <div
      ref={ref}
      className="relative"
      onPointerEnter={(event) => hoverIntent(event, true)}
      onPointerLeave={(event) => hoverIntent(event, false)}
      // Keyboard parity: hover opens for a pointer, so focus opens for a Tab.
      // `focus`/`blur` bubble where `focusin` conventions do not, and testing
      // `relatedTarget` against the wrapper is what keeps the panel open while
      // focus moves THROUGH it rather than closing on the first link.
      onFocus={() => {
        clearTimeout(timer.current);
        setOpen(true);
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        // The panel is portalled, so it has to be tested on its own - focus
        // moving from the trigger into the panel is focus staying in the menu.
        if (event.currentTarget.contains(next) || panelRef.current?.contains(next)) return;
        close();
      }}
    >
      <button
        type="button"
        onClick={() => {
          clearTimeout(timer.current);
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(pressable, ITEM, (active || open) && 'text-ink-900')}
      >
        Offers
        <ChevronDown
          className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')}
          strokeWidth={2.25}
          aria-hidden="true"
        />
        {active && <ActiveBar />}
      </button>

      {/* PORTALLED to the body.
          The strip clips its own overflow so the row can slide up out of it,
          and the sliding element carries a `transform` - which makes it the
          containing block for its fixed descendants, so the clip applies to
          them too and the panel was in the DOM but never painted. A portal is
          the only way out of a clipping ancestor. It stays a React child, so
          the focus handlers above still see it through `contains()`. */}
      {createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            {...popover}
            ref={panelRef}
            style={{ top: anchor?.top, left: anchor?.left }}
            // The panel is fixed, so it is NOT inside the trigger's hover
            // region and needs its own handlers - without them the pointer
            // leaving the button closes the panel it is moving towards.
            onPointerEnter={(event) => hoverIntent(event, true)}
            onPointerLeave={(event) => hoverIntent(event, false)}
            className="fixed z-50 w-[268px] origin-top-left"
          >
            {/* Bridges the 6px of dead space between trigger and panel. The
                close grace alone would cover it, but a hover region with a
                literal hole in it is the kind of thing that fails on a slow
                diagonal approach. */}
            <span className="absolute inset-x-0 -top-2 h-2" aria-hidden="true" />

            <ul className="overflow-hidden rounded-lg border border-line bg-surface p-1.5 shadow-flyout">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className={cn(
                        pressable,
                        'flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-surface-2',
                      )}
                    >
                      <Icon
                        className="mt-0.5 size-4 shrink-0 text-brand"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block font-display text-sm font-semibold text-ink-900">
                          {item.label}
                        </span>
                        {/* The note is what separates three pages that a buyer
                            would otherwise read as three words for the same
                            thing. */}
                        <span className="mt-0.5 block truncate text-xs text-ink-400">
                          {item.note}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </div>
  );
}

export function PrimaryNav() {
  // Shown by default: the nav is there on load, and scrolling DOWN is what
  // takes it away.
  const [shown, setShown] = useState(true);
  const { pathname } = useLocation();

  useEffect(() => {
    // Read on a rAF rather than in the listener: a scroll handler that touches
    // scrollY synchronously on every event is the classic way to make a sticky
    // header stutter on a trackpad.
    let frame = 0;
    // The position the last DECISION was made at, not the last scroll position.
    // Comparing against the previous frame would make the dead zone meaningless:
    // a slow drag moves 1-2px per frame and would never cross it, so the row
    // would never react to a genuine slow scroll.
    let anchor = window.scrollY;

    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const moved = y - anchor;

        // Back at the top, the row belongs to the header again - shown, whatever
        // direction got us here. Without this a page restored mid-scroll and
        // flicked to the top could sit with the nav retracted at y=0.
        if (y <= HIDE_BELOW) {
          anchor = y;
          setShown(true);
          return;
        }

        if (Math.abs(moved) < DIRECTION_DEADZONE) return;
        anchor = y;
        // Down hides, up shows.
        setShown(moved < 0);
      });
    }

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    // The strip OVERLAYS the page body. It is absolutely positioned against the
    // header shell and takes NO space in it at any scroll position.
    //
    // Three cuts got here. The first animated `height` between 0 and auto and
    // painted the chrome on the wrapper, so retracting it pulled the document
    // up and the background stayed behind while the links left. The second kept
    // a permanent 45px slot and moved the surface and rule onto the row, which
    // fixed the abandoned background but left 45px of empty white under the
    // header at the top of every page. The third animated that slot 0 <-> 45,
    // which closed the gap and reintroduced the original fault in a smaller
    // form: the slot is inside the sticky header, so every frame of the height
    // change resized the header and nudged the body a few pixels as the row
    // left.
    //
    // A strip that appears over content on scroll does not belong in the
    // layout at all. Positioned absolutely at `top-full` it hangs off the
    // bottom edge of the header, so the header's height is the same whether the
    // row is shown, hidden or mid-animation, and the body never moves by a
    // pixel in either direction. Nothing is reserved and nothing collapses,
    // because there is no box in flow to reserve or collapse.
    //
    // WHAT THIS COSTS. The row now paints over the top ~45px of the page body
    // instead of pushing it down, which is the behaviour asked for and is how
    // a reveal-on-scroll bar normally works. It only ever appears past
    // `SHOW_AT`, where what is under it is mid-page content the reader is
    // scrolling through rather than the top of the page.
    //
    // `--header-h` (measured in Header.jsx) therefore no longer counts this
    // row, which is correct for every consumer of it: the mega menu, cart and
    // account scrims start below the HEADER, and the strip is drawn above them
    // on its own stacking level rather than being something they have to dim
    // around.
    //
    // `pointer-events-none` on the wrapper while retracted so the invisible row
    // cannot swallow clicks aimed at the content it is sitting on top of; the
    // row itself takes them back when it is up.
    <div
      className={cn(
        // z-30, under the mega menu and cart panels (both `top-full z-40` in
        // this same header) so an opened panel covers the row rather than
        // being sliced by it, and over the page body it now sits on.
        // `clip-path` rather than `overflow-hidden`, and the box runs 24px
        // PAST the row.
        //
        // The wrapper has to clip upward, so the row can hide by sliding out
        // of it, and must NOT clip downward, or it cuts the drop shadow off
        // flush with the row's bottom edge - which is the one place the shadow
        // is doing the work. `overflow-hidden` on a 45px box does both, so the
        // row had a hard-cropped shadow that read as a second border.
        //
        // An inset clip is directional: it opens 40px below the box (room for
        // `shadow-pop`, which reaches ~24px) and stays tight at the top, where
        // the retracted row must disappear cleanly under the header.
        'pointer-events-none absolute inset-x-0 top-full z-30 hidden [clip-path:inset(0_-40px_-40px_-40px)] lg:block',
        shown && 'pointer-events-auto',
      )}
      style={{ height: NAV_STRIP_H }}
      aria-hidden={shown ? undefined : true}
    >
      <motion.nav
        aria-label="Site"
        initial={false}
        animate={{
          // The row slides up out of its own box rather than collapsing it.
          // Percentage rather than pixels so it stays correct if the row's
          // height ever changes.
          transform: shown ? 'translateY(0%)' : 'translateY(-100%)',
          opacity: shown ? 1 : 0,
        }}
        // 340ms with a soft curve, not 260ms with a snappy one. This is
        // ambient chrome arriving unasked, not a response to a click: an
        // entrance the user did not request should be gentler than one they
        // did, or it reads as the interface twitching at them. The curve is
        // the standard ease-out with its tail lengthened, which is what takes
        // the robotic edge off the stop.
        transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        // A BOTTOM BORDER AND A LIFTED SHADOW, because the row floats over the
        // page rather than sitting in the header stack.
        //
        // `shadow-card` alone was not separation. The row is `bg-surface` and
        // most of what it passes over is also `bg-surface` - the hero panel,
        // every product card, every section frame - and that shadow is 4% at
        // 1px with a -12px spread on the ambient layer, which is chosen to sit
        // a card on a tinted page. White on white it disappears, so the row
        // ran straight into the panel beneath it with no edge at all.
        //
        // The border is what guarantees an edge: a hairline is visible against
        // white where a soft shadow is not, and it matches the rule the header
        // above already closes with, so the two read as the same kind of
        // boundary. The shadow moves up to `shadow-pop` to say which side of
        // that boundary is in front - a line alone would make the row look
        // welded into the page rather than laid over it.
        style={{ height: NAV_STRIP_H }}
        className="border-y border-line bg-surface shadow-pop motion-reduce:transition-none"
      >
        {/* Centred, so the row reads as one object rather than as a list that
            happens to start at the logo. `justify-center` on the inner row
            keeps it centred against the page, not against the max-width box. */}
        <div className="mx-auto flex h-full max-w-[1400px] items-center justify-center gap-0.5 px-6">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              // `/blog` matches its post pages, which is right - a reader
              // inside a post is still in the blog. `/` must not, or Home
              // would be lit on every page in the site.
              end={link.to === '/'}
              // Unreachable while retracted, or Tab would walk an invisible
              // row of links.
              tabIndex={shown ? undefined : -1}
              className={({ isActive }) => cn(pressable, ITEM, isActive && 'text-ink-900')}
            >
              {({ isActive }) => (
                <>
                  {link.label}
                  {isActive && <ActiveBar />}
                </>
              )}
            </NavLink>
          ))}

          <OffersMenu pathname={pathname} shown={shown} />
        </div>
      </motion.nav>
    </div>
  );
}

export default PrimaryNav;
