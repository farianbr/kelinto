import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { iconFor } from '@/lib/icons';
import { ChevronLeft, ChevronRight, LogOut, Mail, MapPin, Phone } from 'lucide-react';
import cn from '@/lib/cn';
import { count as formatCount } from '@/lib/format';
import { socialIcon } from '@/lib/socialIcons';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import Drawer from '@/components/ui/Drawer';
import LiveSearch from '@/components/search/LiveSearch';
import useUiStore from '@/store/uiStore';
import useApplyFilterPath from '@/hooks/useApplyFilterPath';
import { useTaxonomy } from '@/hooks/useCatalog';
import { useAuth, useSignOut } from '@/hooks/useAuth';
import { pressable } from '@/lib/motion';

/**
 * The drawer is the SITE's menu, not the account's.
 *
 * The account sections deliberately are not here. They live one tap away in the
 * bottom bar's account slot (`MobileBottomNav`), which opens the full
 * `AccountMenu` - all nine of them, always current. Mirroring four of the nine
 * into this list gave the drawer a second, permanently incomplete copy of a
 * menu that already exists, and made "where do I find my invoices" a question
 * with two different answers.
 */
const NAV_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'Shop all parts', to: '/shop' },
  { label: 'Combo deals', to: '/offers' },
  { label: 'Stock clearance', to: '/clearance' },
  { label: 'Blog', to: '/blog' },
  { label: 'FAQ', to: '/faq' },
  { label: 'About us', to: '/about' },
  { label: 'Contact us', to: '/contact' },
  // Both point at /contact, which is where the footer's own Privacy and Terms
  // links already go: neither page has been written yet. Pointed at a real page
  // rather than a route that 404s, and both move to their own paths the moment
  // the copy exists.
  //
  // `neverActive` because the active test below is an exact path match, and
  // three entries sharing /contact would otherwise all light up at once - the
  // highlight is meant to say "you are here", not "one of these three".
  { label: 'Privacy policy', to: '/contact', neverActive: true },
  { label: 'Terms & conditions', to: '/contact', neverActive: true },
];

// Staff get one door into the console rather than the buyer dashboard links.
// The ERP has its own sidebar and its own thirty-odd screens - mirroring that
// tree into the storefront drawer would be a second, worse copy of it.
const ADMIN_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'Shop all parts', to: '/shop' },
  { label: 'Admin console', to: '/admin' },
  { label: 'Combo deals', to: '/offers' },
  { label: 'Blog', to: '/blog' },
  { label: 'FAQ', to: '/faq' },
  { label: 'About us', to: '/about' },
  { label: 'Contact us', to: '/contact' },
];

/**
 * Left slide-in navigation drawer (brief §4.2).
 *
 * Two tabs: Menu (site links) and Categories (a drill-down of the same tree the
 * desktop mega menu renders). Categories entries filter the grid and close the
 * drawer - they do not navigate.
 */
export function MobileDrawer() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const close = useUiStore((s) => s.closeMobileNav);
  const setPath = useApplyFilterPath();
  const info = useBusinessInfo();

  // The tab lives in the store, not here: the bottom bar's Categories button
  // opens this drawer straight onto the drill-down.
  const tab = useUiStore((s) => s.mobileNavTab);
  const setTab = useUiStore((s) => s.setMobileNavTab);

  // Drill-down stack of nodes, deepest last.
  const [stack, setStack] = useState([]);

  const { pathname } = useLocation();

  const { data: tree } = useTaxonomy();
  const { isAdmin, isAuthenticated } = useAuth();
  const signOut = useSignOut();
  const navLinks = isAdmin ? ADMIN_LINKS : NAV_LINKS;

  const currentNodes = stack.length === 0 ? (tree ?? []) : (stack[stack.length - 1].children ?? []);
  const levelKeys = ['deviceType', 'brand', 'series', 'model'];

  function applyAndClose(nodes) {
    const partial = {};
    const labels = {};
    nodes.forEach((node, index) => {
      partial[levelKeys[index]] = node.slug;
      labels[levelKeys[index]] = node.name;
    });
    setPath(partial, labels);
    setStack([]);
    close();
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      side="left"
      header={
        <div>
          {/* The business's own mark, the bundled artwork for the house
              business only, then its name as a wordmark - the same ladder both
              headers use. */}
          {info.logoUrl ? (
            <img src={info.logoUrl} alt={info.name} className="h-7 w-auto" />
          ) : info.isHouse !== false ? (
            <img
              src="/brand/logo.png"
              alt={info.name}
              width="1000"
              height="254"
              className="h-7 w-auto"
            />
          ) : (
            <span className="block font-display text-lg font-bold text-ink-900">{info.name}</span>
          )}
          {info.tagline && <p className="eyebrow mt-1.5 text-ink-400">{info.tagline}</p>}
        </div>
      }
      bodyClassName="flex flex-col"
      footer={
        <div className="space-y-3 bg-surface-2 p-4">
          {info.social.length > 0 && (
            <div className="flex gap-2">
              {info.social.map((row) => {
                const { icon: Icon, label } = socialIcon(row.network);
                return (
                  <a
                    key={row.network}
                    href={row.url}
                    aria-label={label}
                    className={cn(pressable, 'flex size-9 items-center justify-center rounded-full border border-line bg-surface text-ink-500 hover:border-brand hover:text-brand')}
                  >
                    <Icon className="size-4" strokeWidth={2} />
                  </a>
                );
              })}
            </div>
          )}

          {/* Each row is dropped when the business has not entered it, rather
              than printing an icon beside nothing. */}
          <ul className="space-y-1.5 text-sm text-ink-500">
            {info.phone && (
              <li className="flex items-center gap-2">
                <Phone className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                {info.phone}
              </li>
            )}
            {info.email && (
              <li className="flex items-center gap-2">
                <Mail className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                {info.email}
              </li>
            )}
            {info.address?.city && (
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                <span>
                  {[info.address.line1, info.address.city, info.address.region]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </li>
            )}
          </ul>
        </div>
      }
    >
      <div className="border-b border-line p-3">
        <LiveSearch onNavigate={close} />
      </div>

      <div className="grid shrink-0 grid-cols-2 border-b border-line">
        {[
          { key: 'menu', label: 'Menu' },
          { key: 'categories', label: 'Categories' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={cn(
              pressable,
              'relative py-3 font-display text-sm font-semibold',
              tab === item.key
                ? 'bg-brand/6 text-ink-900'
                : 'text-ink-400 hover:text-ink-700',
            )}
          >
            {item.label}
            {tab === item.key && (
              <span className="rule-brand-gradient absolute inset-x-0 bottom-0 h-0.5" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {tab === 'menu' ? (
        <nav aria-label="Site navigation" className="p-2">
          {navLinks.map((link) => {
            // Exact match only: a prefix test would light up "Shop all parts"
            // on every page in the catalogue. `neverActive` opts out the
            // entries that share a destination with another entry.
            const active = !link.neverActive && pathname === link.to;

            return (
              <Link
                key={link.to + link.label}
                to={link.to}
                onClick={close}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  pressable,
                  'relative flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-md',
                  active
                    ? 'bg-brand/8 font-semibold text-brand-700'
                    : 'font-medium text-ink-700 hover:bg-surface-2 hover:text-ink-900',
                )}
              >
                {active && (
                  <span
                    className="bg-brand-gradient absolute inset-y-1.5 left-0 w-[3px] rounded-full"
                    aria-hidden="true"
                  />
                )}
                {link.label}
                <ChevronRight
                  className={cn('size-4', active ? 'text-brand' : 'text-ink-300')}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </Link>
            );
          })}

          {isAuthenticated && (
            <button
              type="button"
              onClick={() => {
                close();
                signOut();
              }}
              className={cn(pressable, 'mt-1 flex w-full items-center gap-2 border-t border-line px-3 py-2.5 pt-3.5 text-md font-medium text-ink-500 hover:text-danger')}
            >
              <LogOut className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              Sign out
            </button>
          )}
        </nav>
      ) : (
        <div className="p-2">
          {stack.length > 0 && (
            <button
              type="button"
              onClick={() => setStack((s) => s.slice(0, -1))}
              className={cn(pressable, 'mb-1 flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-ink-500 hover:bg-surface-2')}
            >
              <ChevronLeft className="size-4" strokeWidth={2} aria-hidden="true" />
              {stack.length === 1 ? 'All categories' : stack[stack.length - 2].name}
            </button>
          )}

          {stack.length > 0 && (
            <button
              type="button"
              onClick={() => applyAndClose(stack)}
              className={cn(pressable, 'mb-2 flex w-full items-center justify-between rounded-md bg-brand-50 px-3 py-2.5 text-md font-semibold text-brand-700 hover:bg-brand-100')}
            >
              Shop all {stack[stack.length - 1].name}
              <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          )}

          <ul>
            {currentNodes.map((node) => {
              const Icon = node.icon ? iconFor(node.icon) : null;
              const hasChildren = (node.children?.length ?? 0) > 0;
              const nextStack = [...stack, node];

              return (
                <li key={node.slug}>
                  <button
                    type="button"
                    onClick={() => (hasChildren ? setStack(nextStack) : applyAndClose(nextStack))}
                    className={cn(pressable, 'flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left hover:bg-surface-2')}
                  >
                    {Icon && (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-500" aria-hidden="true">
                        <Icon className="size-4" strokeWidth={2} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-md font-medium text-ink-900">
                        {node.name}
                      </span>
                      <span className="tnum block text-xs text-ink-400">
                        {formatCount(node.count)} parts
                      </span>
                    </span>
                    {hasChildren && (
                      <ChevronRight className="size-4 shrink-0 text-ink-300" strokeWidth={2} aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

export default MobileDrawer;
