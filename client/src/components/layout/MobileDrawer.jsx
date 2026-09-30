import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { ArrowUpRight, ChevronLeft, ChevronRight, LogOut, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react';
import cn from '@/lib/cn';
import { count as formatCount } from '@/lib/format';
import { socialIcon } from '@/lib/socialIcons';
import { panelUrl } from '@/lib/surface';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import LiveSearch from '@/components/search/LiveSearch';
import useUiStore from '@/store/uiStore';
import { useApplyPartsPath } from '@/hooks/useApplyFilterPath';
import { useComponentTypes, useWizardTaxonomy } from '@/hooks/useCatalog';
import { findExclusive, useOffers, usePublicServices } from '@/hooks/useContent';
import { useAuth, useSignOut } from '@/hooks/useAuth';
import { ACCOUNT_NAV } from '@shared/schemas/account';
import { accountIcon } from '@/components/account/accountIcons';
import { pressable } from '@/lib/motion';
import BusinessMark from './BusinessMark';

/**
 * Left slide-in navigation drawer (brief §4.2), reworked 2026-09-30.
 *
 * ## Two tabs: Menu and Account
 *
 * **Menu** is the site. Shop and Offers open a level of their own rather than
 * listing everything at once, because Shop is three different catalogues:
 * parts drill down the same order as the tab wizard (Component Type → Device
 * Type → Brand → Series → Model) and land on a filtered `/shop`; services
 * drill by category and land on `/services`; phones open `/pre-owned`.
 *
 * **Account** replaced the old Categories tab: the account's own menu, the
 * same `ACCOUNT_NAV` the account sidebar is built from so the two cannot
 * drift, or a way to sign in. The drill-down categories now live under
 * Shop › Parts, which is where a buyer looks for them.
 */
const PRIMARY = [
  { key: 'home', label: 'Home', to: '/' },
  { key: 'shop', label: 'Shop', panel: 'shop' },
  { key: 'membership', label: 'Membership', to: '/membership' },
  { key: 'blog', label: 'Blog', to: '/blog' },
  { key: 'contact', label: 'Contact us', to: '/contact' },
  { key: 'offers', label: 'Offers', panel: 'offers' },
];

/**
 * Below the divider: pages a visitor needs occasionally, not to shop.
 *
 * Privacy and Terms point at /contact, where the footer's own links already
 * go, until their copy exists. `neverActive` because three rows sharing
 * /contact would otherwise all light up at once.
 */
const SECONDARY = [
  { label: 'FAQ', to: '/faq' },
  { label: 'About us', to: '/about' },
  { label: 'Privacy policy', to: '/contact', neverActive: true },
  { label: 'Terms & conditions', to: '/contact', neverActive: true },
];

/** One row: a link, or a button that opens a level. Same shape either way. */
function Row({ label, hint, to, onClick, active = false, drills = false, onNavigate }) {
  const className = cn(
    pressable,
    'relative flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-md',
    active ? 'bg-brand/8 font-semibold text-brand-700' : 'font-medium text-ink-700 hover:bg-surface-2 hover:text-ink-900',
  );

  const body = (
    <>
      {active && (
        <span className="bg-brand-gradient-compact absolute inset-y-1.5 left-0 w-0.75 rounded-full" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="tnum block text-xs font-normal text-ink-400">{hint}</span>}
      </span>
      <ChevronRight
        className={cn('size-4 shrink-0', active ? 'text-brand' : drills ? 'text-ink-500' : 'text-ink-300')}
        strokeWidth={2}
        aria-hidden="true"
      />
    </>
  );

  if (to) {
    return (
      <Link to={to} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

/** The top of a sub-level: where Back goes, and the one "everything here" action. */
function LevelHead({ backLabel, onBack, allLabel, onAll }) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className={cn(pressable, 'mb-1 flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-ink-500 hover:bg-surface-2')}
      >
        <ChevronLeft className="size-4" strokeWidth={2} aria-hidden="true" />
        {backLabel}
      </button>
      {allLabel && (
        <button
          type="button"
          onClick={onAll}
          className={cn(pressable, 'mb-2 flex w-full items-center justify-between rounded-md bg-brand-50 px-3 py-2.5 text-md font-semibold text-brand-700 hover:bg-brand-100')}
        >
          {allLabel}
          <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

function Empty({ children }) {
  return <p className="px-3 py-6 text-sm text-ink-400">{children}</p>;
}

function MenuTab({ close }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const applyParts = useApplyPartsPath();
  const { isApproved, isPanelAccount } = useAuth();

  // Which level is open, and where the parts drill-down has got to.
  const [panel, setPanel] = useState('root'); // root | shop | offers | parts | services
  const [component, setComponent] = useState(null);
  const [stack, setStack] = useState([]);

  const { data: componentTypes = [] } = useComponentTypes();
  // The hook keeps the previous tree on screen while the next loads, which
  // suits the wizard but here would show the unpruned tree's counts under a
  // component for a moment. A placeholder counts as still loading.
  const { data: pruned, isPlaceholderData: prunedStale } = useWizardTaxonomy(component?.slug);
  const { data: offers } = useOffers(isApproved);
  const services = usePublicServices(isApproved || isPanelAccount);

  const exclusive = findExclusive(offers);
  const levelKeys = ['deviceType', 'brand', 'series', 'model'];

  function go(to) {
    navigate(to);
    close();
  }

  function applyAndClose(nodes) {
    const partial = {};
    const labels = {};
    nodes.forEach((node, index) => {
      partial[levelKeys[index]] = node.slug;
      labels[levelKeys[index]] = node.name;
    });
    applyParts(component, partial, labels);
    close();
  }

  if (panel === 'shop') {
    return (
      <nav aria-label="Shop" className="p-2">
        <LevelHead backLabel="Menu" onBack={() => setPanel('root')} />
        <Row label="Parts" hint="By component, device and model" drills onClick={() => setPanel('parts')} />
        <Row label="Services" hint="Repairs and what they cost" drills onClick={() => setPanel('services')} />
        <Row label="Phones" hint="Pre-owned, tested and graded" to="/pre-owned" active={pathname === '/pre-owned'} onNavigate={close} />
      </nav>
    );
  }

  if (panel === 'offers') {
    return (
      <nav aria-label="Offers" className="p-2">
        <LevelHead backLabel="Menu" onBack={() => setPanel('root')} />
        <Row label="Combo deals" hint="Parts priced as one unit" to="/offers" active={pathname === '/offers'} onNavigate={close} />
        <Row label="Stock clearance" hint="Marked down while stock lasts" to="/clearance" active={pathname === '/clearance'} onNavigate={close} />
        <Row
          label="Exclusive deals"
          hint={exclusive ? exclusive.title : 'None running right now'}
          to={exclusive ? `/deals/${exclusive.slug}` : '/deals'}
          active={pathname.startsWith('/deals')}
          onNavigate={close}
        />
      </nav>
    );
  }

  if (panel === 'services') {
    const categories = services.data?.categories ?? [];
    return (
      <nav aria-label="Services" className="p-2">
        <LevelHead backLabel="Shop" onBack={() => setPanel('shop')} allLabel="All services" onAll={() => go('/services')} />
        {services.isLoading ? null : categories.length === 0 ? (
          <Empty>No services listed yet.</Empty>
        ) : (
          categories.map((category) => (
            <Row
              key={category.slug}
              label={category.name}
              hint={`${formatCount(category.count)} ${category.count === 1 ? 'service' : 'services'}`}
              onClick={() => go(`/services?category=${category.slug}`)}
            />
          ))
        )}
      </nav>
    );
  }

  if (panel === 'parts') {
    // Level 1 is the component type; below it, the tree the server pruned to it.
    if (!component) {
      return (
        <nav aria-label="Parts" className="p-2">
          <LevelHead backLabel="Shop" onBack={() => setPanel('shop')} allLabel="Shop all parts" onAll={() => applyAndClose([])} />
          {componentTypes.length === 0 ? (
            <Empty>Loading parts…</Empty>
          ) : (
            componentTypes.map((type) => (
              <Row
                key={type.slug}
                label={type.name}
                hint={`${formatCount(type.count)} parts`}
                drills
                onClick={() => {
                  setComponent({ slug: type.slug, name: type.name });
                  setStack([]);
                }}
              />
            ))
          )}
        </nav>
      );
    }

    const tree = prunedStale ? [] : (pruned?.tree ?? []);
    const nodes = stack.length ? (stack[stack.length - 1].children ?? []) : tree;
    const here = stack.length ? stack[stack.length - 1].name : component.name;
    const back = stack.length > 1 ? stack[stack.length - 2].name : stack.length === 1 ? component.name : 'Parts';

    return (
      <nav aria-label={here} className="p-2">
        <LevelHead
          backLabel={back}
          onBack={() => (stack.length ? setStack((s) => s.slice(0, -1)) : setComponent(null))}
          allLabel={`Shop all ${here}`}
          onAll={() => applyAndClose(stack)}
        />
        {nodes.length === 0 && !stack.length && <Empty>Loading…</Empty>}
        {nodes.map((node) => {
          const hasChildren = (node.children?.length ?? 0) > 0;
          const next = [...stack, node];
          return (
            <Row
              key={node.slug}
              label={node.name}
              hint={`${formatCount(node.count)} parts`}
              drills={hasChildren}
              onClick={() => (hasChildren ? setStack(next) : applyAndClose(next))}
            />
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Site navigation" className="p-2">
      {PRIMARY.map((item) =>
        item.panel ? (
          <Row key={item.key} label={item.label} drills onClick={() => setPanel(item.panel)} />
        ) : (
          <Row key={item.key} label={item.label} to={item.to} active={pathname === item.to} onNavigate={close} />
        ),
      )}

      <div className="mx-3 my-2 border-t border-line" />

      <ul>
        {SECONDARY.map((link) => {
          const active = !link.neverActive && pathname === link.to;
          return (
            <li key={link.label}>
              <Link
                to={link.to}
                onClick={close}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  pressable,
                  'block rounded-md px-3 py-2 text-sm',
                  active ? 'font-semibold text-brand-700' : 'text-ink-500 hover:bg-surface-2 hover:text-ink-900',
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function AccountTab({ close }) {
  const { user, isApproved, isPanelAccount } = useAuth();
  const openAccount = useUiStore((s) => s.openAccount);
  const signOut = useSignOut();

  if (!user) {
    return (
      <div className="p-4">
        <p className="font-display text-lg font-bold text-ink-900">Sign in to your account</p>
        <p className="mt-1.5 text-md leading-relaxed text-ink-500">
          Your orders, invoices, credit and saved addresses are here once you sign in.
        </p>
        <div className="mt-4 grid gap-2">
          <Button
            onClick={() => {
              close();
              openAccount('signin');
            }}
          >
            Sign in
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              close();
              openAccount('signup');
            }}
          >
            Create an account
          </Button>
        </div>
      </div>
    );
  }

  const rowClass = ({ isActive }) =>
    cn(
      pressable,
      'flex items-center gap-3 rounded-md px-3 py-2.5 text-md font-medium',
      isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-surface-2 hover:text-ink-900',
    );

  return (
    <div className="p-2">
      <div className="px-3 pb-3 pt-2">
        <p className="truncate font-display text-md font-bold text-ink-900">{user.displayName}</p>
        <p className="mt-0.5 truncate text-xs text-ink-400">{user.email}</p>
        <span
          className={cn(
            'mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
            isPanelAccount ? 'bg-surface-3 text-ink-700' : isApproved ? 'bg-ok-50 text-ok' : 'bg-warn-50 text-warn',
          )}
        >
          <ShieldCheck className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          {isPanelAccount ? 'Staff account' : isApproved ? 'Wholesale account approved' : 'Under review'}
        </span>
      </div>

      {isPanelAccount ? (
        // Staff have no orders, invoices or credit of their own; the buyer
        // menu would be dead ends. The ERP is its own host.
        <a href={panelUrl('/admin')} onClick={close} className={rowClass({ isActive: false })}>
          <ArrowUpRight className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          Go to the ERP
        </a>
      ) : (
        ACCOUNT_NAV.map((item) =>
          item.children ? (
            <section key={item.key} className="mt-2">
              <p className="eyebrow px-3 pb-1 pt-2 text-ink-400">{item.label}</p>
              <ul>
                {item.children.map((child) => {
                  const Icon = accountIcon(child.icon);
                  return (
                    <li key={child.key}>
                      <NavLink to={child.to} onClick={close} className={rowClass}>
                        <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                        {child.label}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <NavLink key={item.key} to={item.to} end onClick={close} className={rowClass}>
              {(() => {
                const Icon = accountIcon(item.icon);
                return <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />;
              })()}
              {item.label}
            </NavLink>
          ),
        )
      )}

      {/* Confirms before it runs: `useSignOut` opens the shared dialog. */}
      <button
        type="button"
        onClick={() => {
          close();
          signOut();
        }}
        className={cn(pressable, 'mt-2 flex w-full items-center gap-3 border-t border-line px-3 pb-2.5 pt-3.5 text-md font-medium text-ink-500 hover:text-danger')}
      >
        <LogOut className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        Sign out
      </button>
    </div>
  );
}

export function MobileDrawer() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const close = useUiStore((s) => s.closeMobileNav);
  const info = useBusinessInfo();

  // The tab lives in the store so the bottom bar's Menu button can pick it.
  const tab = useUiStore((s) => s.mobileNavTab);
  const setTab = useUiStore((s) => s.setMobileNavTab);

  // A drawer reopened starts at the top of the menu, not three levels down a
  // drill-down somebody abandoned. Remounting the tab is the whole reset.
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (!open) setSession((n) => n + 1);
  }, [open]);

  return (
    <Drawer
      open={open}
      onClose={close}
      side="left"
      header={
        <div>
          {/* The same mark both headers draw. */}
          <BusinessMark size="sm" />
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
          { key: 'account', label: 'Account' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={cn(
              pressable,
              'relative py-3 font-display text-sm font-semibold',
              tab === item.key ? 'bg-brand/6 text-ink-900' : 'text-ink-400 hover:text-ink-700',
            )}
          >
            {item.label}
            {tab === item.key && (
              <span className="rule-brand-gradient absolute inset-x-0 bottom-0 h-0.5" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {tab === 'account' ? (
        <AccountTab close={close} />
      ) : (
        <MenuTab key={session} close={close} />
      )}
    </Drawer>
  );
}

export default MobileDrawer;
