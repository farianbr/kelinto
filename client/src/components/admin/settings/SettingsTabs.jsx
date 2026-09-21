import { Link, useLocation } from 'react-router';

import cn from '@/lib/cn';
import { ADMIN_ROUTES, SETTINGS_CATEGORIES, matchAdminRoute } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { featureEnabled } from '@shared/schemas/features';
import { useAuth } from '@/hooks/useAuth';
import { pressable } from '@/lib/motion';

/**
 * The settings category's own tab row, on every screen inside it.
 *
 * ## Why this exists
 *
 * The tab row lived only on `/admin/settings?cat=…`, so a staff member editing
 * a tax rate had no way to reach the payment methods beside it without going
 * back to the hub first. Settings is the one section where the sibling screens
 * are the navigation: twenty pages across seven categories, and the thing you
 * want next is almost always the one next to the thing you are on.
 *
 * So it renders here instead, above every settings page, and the category
 * landing keeps its own copy of the grid rather than the tabs.
 *
 * ## What counts as "a settings page"
 *
 * Not the URL. A tab's screen may live anywhere - Device & Models is
 * `/admin/device-models`, Services is `/admin/services` - because those are
 * real screens staff also reach from their own sections, and rebuilding them
 * under `/admin/settings/*` would mean two places to edit one list. What makes
 * a page part of a category is its `parent: 'settings:<category>'`, which is
 * the same field the hub's card grid reads.
 *
 * ## Which tabs a business sees
 *
 * The same filter the cards and the command palette apply: a route carrying a
 * `feature` is dropped for a business that does not have it. A tab that opens
 * onto a 404 is worse here than on the hub, because the row is on screen the
 * whole time rather than once.
 *
 * Renders nothing outside settings, and nothing for a category with one page -
 * a tab row of one is chrome that says only where you already are.
 */
/**
 * The settings category a route appears in, or null.
 *
 * Two ways in, and the second is why this is a function rather than a field
 * read:
 *
 * - `parent: 'settings:financial'` - the page *lives* in settings. Its
 *   breadcrumb runs Home › Settings › Financial › …, and it is on the hub's
 *   card grid.
 * - `settingsTab: 'financial'` - the page lives somewhere else and is *also*
 *   reachable from the row. Services is in the Sales nav because staff price
 *   labour daily; Discount Codes is Marketing → Offers because
 *   `pricingService` is the only place a discount is decided. Both belong in
 *   the Financial row too, and neither should have its breadcrumb or its nav
 *   home moved to get there.
 *
 * The second is a tab, not a card: the hub's grid still reads `parent`, so a
 * page is listed once on the map, under the section that owns it.
 */
function tabCategory(meta) {
  if (meta.parent?.startsWith('settings:')) return meta.parent.slice('settings:'.length);
  return meta.settingsTab ?? null;
}

/**
 * The order tabs appear in, within one category.
 *
 * **Not declaration order**, which is what this used to be. `ADMIN_ROUTES` is
 * grouped by section, so a settings page declared among the Marketing routes -
 * Discount Codes, Referrals - sorted ahead of Sale Settings for no reason a
 * reader could see, and moving a page between categories silently reshuffled a
 * row somewhere else. `tabOrder` on the route entry is the one place that
 * decides, and a page without one sorts to the end alphabetically rather than
 * wherever it happens to sit in the file.
 */
export function byTabOrder(a, b) {
  const rank = (tab) => (typeof tab.tabOrder === 'number' ? tab.tabOrder : Number.MAX_SAFE_INTEGER);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return (a.settingsTabLabel ?? a.label).localeCompare(b.settingsTabLabel ?? b.label);
}

export function SettingsTabs() {
  const { pathname } = useLocation();
  const { features } = useAuth();

  const current = matchAdminRoute(pathname);
  const categoryKey = current ? tabCategory(current) : null;

  // The hub draws its own tab row against the `?cat=` param, so it is left
  // alone: two rows of tabs on one screen is the same fact twice.
  if (!categoryKey) return null;

  const category = SETTINGS_CATEGORIES.find((entry) => entry.key === categoryKey);
  if (!category) return null;

  const tabs = Object.entries(ADMIN_ROUTES)
    .filter(([, meta]) => tabCategory(meta) === categoryKey)
    .filter(([, meta]) => !meta.feature || !features || featureEnabled(features, meta.feature))
    .map(([path, meta]) => ({ ...meta, path }))
    .sort(byTabOrder);

  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label={`${category.label} settings`}
      /**
       * Sticky, because the row is navigation rather than a heading.
       *
       * A settings form runs well past one screen - the tax table alone is
       * thirteen rows - and a tab row that scrolls away is one a staff member
       * has to scroll back up to use. `top-0` against the scrolling `<main>`,
       * and the negative margins let it span the container's gutter so the
       * background covers the full width when it lands.
       */
      className="sticky top-0 z-20 -mx-3 mb-5 border-b border-line bg-surface-2/95 px-3 backdrop-blur sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6"
    >
      {/*
        Wraps rather than scrolls.

        Eleven tabs do not fit one line at any width, and the scrolling version
        hid the last few behind an edge: a staff member could not see that
        Discount Codes existed without dragging the row. Wrapping costs one
        extra line on Financial and nothing on the six smaller categories, and
        every tab is visible and one click away at every width - which is the
        whole point of putting the row on every page.
      */}
      {/*
        The label is its own column, not the first item in the wrap.

        As a flex child it pushed only the FIRST row across, so the second row
        began at the container edge and the two rows started at different
        x-positions - which is what made the wrap read as ragged rather than as
        a block. Taking it out of the wrapping flow gives every row one left
        edge, and the label sits beside all of them instead of above-left of
        one.
      */}
      <div className="flex items-start gap-3 py-2">
        <span className="mt-1.5 hidden shrink-0 font-display text-2xs font-bold uppercase tracking-wide text-ink-400 sm:block">
          {category.label}
        </span>

        {/* `content-start` so a short second row hugs the first rather than
            being distributed down the container's height. */}
        <div className="flex min-w-0 flex-1 flex-wrap content-start gap-1.5">
          {tabs.map((tab) => {
            const Icon = adminIcon(tab.icon);
            const active = tab.path === current.path;

            return (
              <Link
                key={tab.path}
                to={tab.path}
                aria-current={active ? 'page' : undefined}
                /**
                 * Every tab carries a border, active or not.
                 *
                 * Borderless labels wrapped onto two lines read as loose words
                 * rather than as one control each - there was nothing to say
                 * where a tab began and the next ended, so the second row
                 * looked like stray text under the first. A hairline gives each
                 * tab a shape, and the rows become two rows of the same object.
                 * Bordered OR filled, never both: the active tab drops its
                 * hairline to a matching dark edge (Instructions §2).
                 */
                className={cn(
                  pressable,
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 font-display text-sm font-semibold transition-colors',
                  active
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : 'border-line bg-surface text-ink-500 hover:border-ink-300 hover:text-ink-900',
                )}
              >
                {Icon && <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />}
                {/* A page reachable from two places can need two names: the
                    Marketing nav calls it Offers, and an admin in Financial
                    settings is looking for Discount Codes. */}
                {tab.settingsTabLabel ?? tab.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export default SettingsTabs;
