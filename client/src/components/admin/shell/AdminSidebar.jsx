import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { NavLink, useLocation } from 'react-router';
import { ChevronDown, LogOut, Search, X } from 'lucide-react';
import cn from '@/lib/cn';
import { ADMIN_NAV } from '@shared/schemas/admin';
import { activeNavKeys } from '@/lib/adminRoutes';
import { adminIcon } from './adminIcons';
import { visibleNav } from '@/lib/permissions';
import { useAuth } from '@/hooks/useAuth';
import { pressable } from '@/lib/motion';
import { getBusiness, getBusinessName, subscribeBusiness } from '@/store/businessStore';
import { useAdminBusinesses } from '@/hooks/useAdmin';

/**
 * The ERP sidebar (§4). Three shapes, one component:
 *
 *   <768    off-canvas drawer, opened by the top bar hamburger
 *   768–1023 64px icon rail, group icons only, tooltips on hover
 *   1024+   full tree, one group expanded at a time
 *
 * `--color-ink-deep` is the background at every width (§2b) - the warm
 * near-black already defined for exactly this, so the panel reads as Cellvix
 * rather than as generic admin chrome.
 */

/**
 * The business being worked in, not a hard-coded name.
 *
 * **This said "Cellvix" whatever business was selected**, so a tenant switched
 * to CellShoppe saw the wholesaler's name at the top of their own repair shop's
 * panel. One tenant may own several businesses (SAAS_PLATFORM §1), and the
 * corner of the screen that names where you are is the last place that should
 * be guessing - it is the same wayfinding question the switcher answers, asked
 * in the place the eye lands first.
 *
 * Falls back to the platform's own name while the business list is still
 * loading, rather than flashing a wrong one.
 */
function useActiveBusiness() {
  const selected = useSyncExternalStore(subscribeBusiness, getBusiness, getBusiness);
  const cachedName = useSyncExternalStore(subscribeBusiness, getBusinessName, getBusinessName);
  const { data } = useAdminBusinesses();

  const record = (data?.businesses ?? []).find((business) => business.id === selected) ?? null;

  /**
   * The record when it has loaded, the cached name until then.
   *
   * Without the cache this returned null for the length of one fetch and the
   * rail fell back to the platform word - so every reload flashed Operations
   * before settling into the shop name, in the one place whose entire job is
   * saying which business you are in. Same fix, same store and same reasoning
   * as the colour: see `store/businessStore.js`.
   */
  return record ?? (cachedName ? { name: cachedName } : null);
}

function BrandBlock({ compact }) {
  const business = useActiveBusiness();
  const { branding } = useAuth();
  const name = business?.name ?? 'Operations';
  const initial = (name.trim()[0] ?? 'O').toUpperCase();

  /**
   * The business's own logo, uploaded in Settings › Business info, on a white
   * tile: the sidebar is near-black and most logos are drawn for a light
   * background. The name stays for screen readers, since the logo already
   * says it to everyone else. Collapsed, the tile is the favicon; with
   * neither uploaded, the lettered square as before.
   */
  if (branding?.logoUrl && !compact) {
    return (
      <div className="flex flex-col items-center gap-2 border-b border-white/10 px-4 py-4 text-center">
        <span className="flex w-full items-center justify-center rounded-md bg-white px-3 py-2">
          <img src={branding.logoUrl} alt="" className="h-10 w-auto max-w-full object-contain" decoding="async" />
        </span>
        <span className="sr-only">{name}</span>
        <span className="eyebrow block text-ink-200">ERP system</span>
      </div>
    );
  }
  if (compact && branding?.faviconUrl) {
    return (
      <div className="flex justify-center border-b border-white/10 py-4">
        <span className="flex size-9 items-center justify-center rounded-md bg-white p-1">
          <img src={branding.faviconUrl} alt={name} className="size-full object-contain" decoding="async" />
        </span>
      </div>
    );
  }

  return (
    <div
      /**
       * Stacked and centred, not a row.
       *
       * The name was `truncate`d beside its mark, which is right for a label
       * and wrong for an identity: "CellShoppe Phone & Laptop Fix" came out as
       * "CellShoppe Phone &…" and the one thing the panel's header is for -
       * saying which business you are in - was the part cut off. A business
       * name is not a table cell; it gets the width of the rail and as many
       * lines as it needs.
       *
       * Two lines is the cap. Past that a name is long enough that the reader
       * has already identified it, and a four-line header pushes the nav down.
       */
      className={cn(
        'border-b border-white/10 px-4 py-4',
        compact ? 'flex justify-center px-0' : 'flex flex-col items-center gap-2 text-center',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-gradient-compact font-display text-lg font-bold text-white">
        {initial}
      </span>
      {!compact && (
        <span className="min-w-0">
          <span className="block line-clamp-2 font-display text-sm font-bold leading-tight text-white">
            {name}
          </span>
          <span className="eyebrow mt-1 block text-ink-200">ERP system</span>
        </span>
      )}
    </div>
  );
}

function QuickSearch({ onOpenSearch }) {
  return (
    <div className="px-3 py-3">
      <button
        type="button"
        onClick={onOpenSearch}
        className={cn(pressable, 'flex w-full items-center gap-2 rounded-md border border-white/12 bg-white/[0.06] px-2.5 py-2 text-sm text-ink-200 hover:border-white/25 hover:text-white')}
      >
        <Search className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
        <span className="flex-1 text-left">Quick search</span>
        <kbd className="rounded border border-white/15 px-1 py-px font-sans text-2xs leading-none text-ink-200">
          Ctrl K
        </kbd>
      </button>
    </div>
  );
}

/** A resting/hover/active nav row. The gradient fill is the active state (§2b). */
function navRowClass(isActive, extra) {
  return cn(
    pressable,
    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium',
    isActive ? 'bg-brand-gradient text-white' : 'text-ink-200 hover:bg-white/[0.08] hover:text-white',
    extra,
  );
}

/**
 * The count beside a nav row.
 *
 * **A bare number is unreadable twice over**, and both halves were broken here.
 * A sighted staff member saw "Inventory 189" with no way to tell whether 189 was a
 * total, an alert or an unread count - and landing on the page showed 420 rows,
 * so the number could not even be checked. A screen reader announced
 * "Inventory 189" with no noun at all.
 *
 * `label` fixes both: it names what is being counted, in the words the staff member
 * would use. It becomes the accessible name ("189 out of stock or running low")
 * and the native `title`, so the answer is available on hover, on focus and to
 * assistive tech - never hover alone, which no keyboard user can reach.
 *
 * The number stays visually quiet. It is a wayfinding hint, not an alarm: the
 * dashboard's "things to do today" is where work is actually triaged, and a
 * sidebar of loud red pills would compete with it while saying less.
 */
function Badge({ count, label, description: full }) {
  if (!count) return null;

  const shown = count > 99 ? '99+' : String(count);
  // Two callers, two shapes. A child row passes `label` - the bare noun - and
  // the count is prefixed here: "3 waiting for approval". A collapsed group
  // passes `description`, already a complete sentence enumerating its parts,
  // because its own total ("109") is a sum of unlike things and prefixing it
  // would say the number twice.
  const description = full ?? (label ? `${count} ${label}` : String(count));

  return (
    <span
      className="tnum ml-auto min-w-[20px] shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-center text-2xs font-semibold leading-none text-white"
      title={description}
    >
      {/* The digits are decorative to a screen reader - the sentence beside
          them is the real content, so the glyphs are hidden and the phrase is
          announced instead. Without this the reader hears "189" twice. */}
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{description}</span>
    </span>
  );
}

function NavTree({ badges, onNavigate }) {
  const location = useLocation();
  const { permissions, features } = useAuth();

  // A group the role cannot reach, or the business does not have, is not
  // rendered. The server refuses both anyway - with a 403 and a 404
  // respectively; hiding them stops a staff member clicking into a wall (§7.6).
  const nav = useMemo(
    () => visibleNav(ADMIN_NAV, permissions, features),
    [permissions, features],
  );
  const { group: activeGroup, child: activeChild } = activeNavKeys(location.pathname, location.search);

  // One parent expanded at a time (§2, convention 2). Kept in state rather than
  // derived so a deliberate collapse survives until the route changes.
  const [openGroup, setOpenGroup] = useState(activeGroup);
  useEffect(() => setOpenGroup(activeGroup), [activeGroup]);

  return (
    <nav aria-label="Admin sections" className="min-h-0 flex-1 overflow-y-auto scroll-slim px-3 pb-3">
      <ul className="flex flex-col gap-0.5">
        {nav.map((item) => {
          const Icon = adminIcon(item.icon);

          if (!item.children) {
            return (
              <li key={item.key}>
                <NavLink
                  to={item.to}
                  end
                  // The destination goes with the click so the shell can tell
                  // "go there" from "I am already there" - the second is a
                  // no-op in the router and has to be handled by hand.
                  onClick={() => onNavigate?.(item.to)}
                  className={({ isActive }) => navRowClass(isActive)}
                >
                  {Icon && <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />}
                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          }

          const isOpen = openGroup === item.key;
          /**
           * The collapsed group's roll-up.
           *
           * The number alone is close to meaningless - "Sales 14" adds pending
           * customers to open tickets to overdue invoices, four different kinds
           * of work summed into one figure that matches nothing on any screen.
           * It stays, because a collapsed group does need to say "there is
           * something in here", but it now carries the breakdown as its
           * accessible name and tooltip: "3 customers waiting for approval,
           * 6 tickets open, 4 returns still to resolve".
           *
           * That is the honest reading of the number, and it is what makes it
           * safe to keep: the digit is the signal, the sentence is the meaning.
           */
          const groupParts = item.children
            .map((child) => {
              const count = child.badge ? (badges[child.badge] ?? 0) : 0;
              if (!count) return null;
              const phrase = child.badgePhrase
                ? child.badgePhrase[count === 1 ? 0 : 1]
                : child.label.toLowerCase();
              return `${count} ${phrase}`;
            })
            .filter(Boolean);

          const groupBadge = item.children.reduce(
            (sum, child) => sum + (child.badge ? (badges[child.badge] ?? 0) : 0),
            0,
          );

          return (
            <li key={item.key} className="mt-1">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenGroup(isOpen ? null : item.key)}
                className={cn(
                  pressable,
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold',
                  /**
                   * An open group is tinted, not only brightened.
                   *
                   * White text alone said "this is the section you are in" and
                   * nothing said where that section ENDS - so an open group's
                   * children read as a continuation of the rail rather than as
                   * belonging to the heading above them. A faint ground on the
                   * header, matched by the one behind its children, draws the
                   * group as a block: the reader sees the boundary rather than
                   * inferring it from indentation.
                   *
                   * Faint on purpose. It is structure, not emphasis - the
                   * active ITEM still has to be the brightest thing in the rail.
                   */
                  isOpen || activeGroup === item.key
                    ? 'bg-white/6 text-white'
                    : 'text-ink-200 hover:bg-white/[0.08] hover:text-white',
                )}
              >
                {Icon && <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />}
                <span className="flex-1 text-left">{item.label}</span>
                {/* A DOT, not the sum.
                
                    Adding 109 low-stock products to 4 returns to 1 overdue
                    invoice produces a number in no unit at all, and past a
                    hundred it rendered as "99+" - a cap on a quantity that was
                    already meaningless. What a collapsed group actually needs
                    to say is "there is something in here", which is a boolean,
                    so it is drawn as one.
                
                    The real counts are one click away on the children, and the
                    breakdown is on this dot as its accessible name, so nothing
                    is hidden - only the false precision is gone. */}
                {!isOpen && groupBadge > 0 && (
                  <span
                    className="ml-auto flex size-4 shrink-0 items-center justify-center"
                    title={groupParts.join(', ')}
                  >
                    <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
                    <span className="sr-only">{groupParts.join(', ')}</span>
                  </span>
                )}
                <ChevronDown
                  className={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')}
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
              </button>

              {isOpen && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-white/10 pl-2.5 ml-[17px]">
                  {item.children.map((child) => {
                    const ChildIcon = adminIcon(child.icon);
                    const isActive = activeChild === child.key;

                    return (
                      <li key={child.key}>
                        <NavLink
                          to={child.to}
                          onClick={() => onNavigate?.(child.to)}
                          className={navRowClass(isActive, 'text-sm')}
                        >
                          {ChildIcon && (
                            <ChildIcon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                          )}
                          <span className="min-w-0 truncate">{child.label}</span>
                          <Badge
                            count={child.badge ? badges[child.badge] : 0}
                            label={child.badgeLabel}
                          />
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
    </nav>
  );
}

/**
 * The 768–1023 rail: group icons only, each linking to its first child. A
 * tooltip carries the label, because an icon alone is not a name.
 */
function IconRail({ badges, onNavigate }) {
  const location = useLocation();
  const { permissions, features } = useAuth();
  const nav = useMemo(
    () => visibleNav(ADMIN_NAV, permissions, features),
    [permissions, features],
  );
  const { group: activeGroup } = activeNavKeys(location.pathname, location.search);

  return (
    <nav aria-label="Admin sections" className="min-h-0 flex-1 overflow-y-auto scroll-slim py-3">
      <ul className="flex flex-col items-center gap-1">
        {nav.map((item) => {
          const Icon = adminIcon(item.icon);
          const to = item.to ?? item.children?.[0]?.to;
          const isActive = activeGroup === item.key;
          const count = item.children
            ? item.children.reduce((sum, c) => sum + (c.badge ? (badges[c.badge] ?? 0) : 0), 0)
            : 0;

          // What the dot is about, so the rail is not a row of unexplained
          // marks. Same phrasing as the full sidebar's roll-up.
          const parts = (item.children ?? [])
            .map((child) => {
              const n = child.badge ? (badges[child.badge] ?? 0) : 0;
              if (!n) return null;
              const phrase = child.badgePhrase
                ? child.badgePhrase[n === 1 ? 0 : 1]
                : child.label.toLowerCase();
              return `${n} ${phrase}`;
            })
            .filter(Boolean)
            .join(', ');

          return (
            <li key={item.key} className="group relative">
              <NavLink
                to={to}
                end={item.to === '/admin'}
                // The label carries the reason for the dot, because the dot
                // itself is decorative and a rail row is otherwise announced
                // as a bare section name with an unexplained mark on it.
                aria-label={parts ? `${item.label} - ${parts}` : item.label}
                title={parts ? `${item.label} - ${parts}` : item.label}
                onClick={() => onNavigate?.(to)}
                className={cn(
                  pressable,
                  'relative flex size-10 items-center justify-center rounded-md',
                  isActive ? 'bg-brand-gradient text-white' : 'text-ink-200 hover:bg-white/[0.08] hover:text-white',
                )}
              >
                {Icon && <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />}
                {count > 0 && (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-brand" aria-hidden="true" />
                )}
              </NavLink>

              <span
                role="tooltip"
                className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 -translate-y-1/2 whitespace-nowrap rounded-sm bg-ink-900 px-2 py-1 text-xs text-white opacity-0 shadow-card transition-opacity group-hover:opacity-100"
              >
                {item.label}
              </span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function UserFooter({ user, onSignOut, compact }) {
  // The business's icon (Settings › Business info) stands in the round badge
  // when it has one, so the rail carries the business's mark top and bottom.
  const { branding } = useAuth();
  const initials = (user?.contactName ?? user?.businessName ?? 'A')
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  if (compact) {
    return (
      <div className="border-t border-white/10 p-2">
        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          className={cn(pressable, 'flex size-10 items-center justify-center rounded-md text-ink-200 hover:bg-danger/20 hover:text-white')}
        >
          <LogOut className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-white/10 px-3 py-3">
      <div className="flex items-center gap-2.5">
        {branding?.faviconUrl ? (
          <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1">
            <img src={branding.faviconUrl} alt="" className="size-full object-contain" decoding="async" />
          </span>
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-xs font-semibold text-white">
            {initials}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">
            {user?.contactName ?? 'Admin'}
          </span>
          <span className="block truncate text-xs text-ink-200">{user?.email}</span>
        </span>
      </div>

      {/*
        A labelled button on its own line, not an icon beside the name.

        The bare glyph had two problems. It sat immediately right of the email,
        so the most destructive control in the rail was the easiest thing to hit
        while aiming at the account - and it said nothing: an arrow leaving a
        bracket is only "sign out" to somebody who already knows. Giving it a
        border, a width and the word makes it deliberate to press and obvious to
        read, which is the right trade for an action that ends the session.
      */}
      <button
        type="button"
        onClick={onSignOut}
        className={cn(
          pressable,
          'mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border border-white/12 bg-white/6 px-3 py-2',
          'text-sm font-semibold text-ink-200',
          'hover:border-white/25 hover:bg-white/10 hover:text-white',
        )}
      >
        <LogOut className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        Sign out
      </button>
    </div>
  );
}

export function AdminSidebar({
  user,
  badges = {},
  onSignOut,
  onOpenSearch,
  mobileOpen,
  onCloseMobile,
  /** Called when a nav row for the route already open is clicked. */
  onSameRoute,
}) {
  const { pathname } = useLocation();

  /**
   * One handler for every nav row.
   *
   * Navigating to the route you are already on is a no-op in the router - no
   * render, no scroll, nothing - so a reader at the bottom of a long page who
   * clicks the section they are in gets no response at all. The one useful
   * reading of that click is "back to the top", which is what this does.
   */
  const handleNavigate = (to) => {
    onCloseMobile?.();
    if (to === pathname) onSameRoute?.();
  };

  return (
    <>
      {/* 1024+ - the full tree. */}
      <aside className="hidden h-dvh w-[220px] shrink-0 flex-col bg-ink-deep lg:flex xl:w-[250px] print:hidden">
        <BrandBlock />
        <QuickSearch onOpenSearch={onOpenSearch} />
        <NavTree badges={badges} onNavigate={handleNavigate} />
        <UserFooter user={user} onSignOut={onSignOut} />
      </aside>

      {/* 768–1023 - the icon rail. */}
      <aside className="hidden h-dvh w-16 shrink-0 flex-col items-center bg-ink-deep md:flex lg:hidden print:hidden">
        <BrandBlock compact />
        <IconRail badges={badges} onNavigate={handleNavigate} />
        <UserFooter user={user} onSignOut={onSignOut} compact />
      </aside>

      {/* <768 - off-canvas drawer. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onCloseMobile}
            className="absolute inset-0 bg-ink-900/55"
          />
          <div className="relative flex h-dvh w-[264px] max-w-[85vw] flex-col bg-ink-deep">
            <div className="flex items-center justify-between border-b border-white/10 pr-2">
              <div className="flex-1 border-b-0">
                <BrandBlock />
              </div>
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close navigation"
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-200 hover:bg-white/10 hover:text-white"
              >
                <X className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <QuickSearch
              onOpenSearch={() => {
                onCloseMobile?.();
                onOpenSearch?.();
              }}
            />
            <NavTree badges={badges} onNavigate={handleNavigate} />
            <UserFooter user={user} onSignOut={onSignOut} />
          </div>
        </div>
      )}
    </>
  );
}

export default AdminSidebar;
