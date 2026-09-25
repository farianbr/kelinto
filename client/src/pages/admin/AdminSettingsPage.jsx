import { Link, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import cn from '@/lib/cn';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES, SETTINGS_CATEGORIES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { pressable } from '@/lib/motion';
import { featureEnabled } from '@shared/schemas/features';
import { byTabOrder } from '@/components/admin/settings/SettingsTabs';
import { useAuth } from '@/hooks/useAuth';

/**
 * Settings - Summary and the seven category landings (§6.15, phase 11).
 *
 * **One screen, two readings.** `/admin/settings` is the map of everything;
 * `/admin/settings?cat=financial` is the same grid filtered to one category
 * with a tab row above it. They are the same component because they are the
 * same content at two zoom levels, and forking them would mean two places to
 * add a settings page to.
 *
 * The map is worth its own screen. With ~20 settings pages a flat sidebar list
 * is unusable, and this is what keeps every page two clicks from anywhere.
 *
 * Cards are built from `ADMIN_ROUTES` rather than a list kept here, so a new
 * settings page appears on this screen the moment it is routed - there is no
 * second register to forget to update.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings'], icon: adminIcon('LayoutGrid') };

/**
 * Every routed settings page, grouped by its category.
 *
 * A page carrying a `feature` key is dropped when this business does not have
 * that feature. Its route already answers 404, so leaving the card would offer
 * a tile that opens onto nothing - and it would also tell a business about a
 * capability it has not been given, which is the one thing a feature flag is
 * supposed to prevent.
 */
function pagesByCategory(features) {
  const grouped = new Map(SETTINGS_CATEGORIES.map((category) => [category.key, []]));

  for (const [path, meta] of Object.entries(ADMIN_ROUTES)) {
    /**
     * Two ways a page joins a category, matching the tab row's rule exactly -
     * see `components/admin/settings/SettingsTabs.jsx`.
     *
     * `parent` is for a page that lives here. `settingsTab` lends one that
     * lives elsewhere: Services is in the Sales nav because the counter uses
     * it daily, and it is a Financial setting all the same. Reading only
     * `parent` here is what left it in the tab row but off this grid, so the
     * map and the tabs disagreed about what Financial contains.
     */
    const key = meta.parent?.startsWith('settings:')
      ? meta.parent.slice('settings:'.length)
      : meta.settingsTab;
    if (!key) continue;
    if (meta.feature && features && !featureEnabled(features, meta.feature)) continue;
    grouped.get(key)?.push({ ...meta, path });
  }

  // The same order the tab row uses, so the map and the tabs cannot disagree
  // about what comes first. See `byTabOrder` in `settings/SettingsTabs.jsx`.
  for (const list of grouped.values()) list.sort(byTabOrder);

  return grouped;
}

/**
 * One page's card.
 *
 * A card for a screen that has not been built yet still links - the stub tells
 * a staff member which phase it lands in, which is more useful than a dead tile
 * that says nothing. It carries a quiet `Soon` chip so the map does not
 * over-promise.
 */
function PageCard({ page, built }) {
  /**
   * A card whose icon is missing still renders.
   *
   * `adminIcon` returns null for an unregistered name - deliberately, so one
   * bad key cannot take down a nav row. This card rendered it unguarded, so a
   * route added with an icon nobody had registered crashed the WHOLE settings
   * page rather than losing one glyph. The registry keeps its contract; this is
   * the consumer holding up its end.
   */
  const Icon = adminIcon(page.icon);

  return (
    <Link
      to={page.path}
      // Tells a page lent from another section (Services, Discount Codes) that
      // it was opened from Settings, so it shows the settings tab row. Opened
      // from its own nav it does not. See `SettingsTabs`.
      state={{ fromSettings: page.settingsTab ?? null }}
      className={cn(
        'group flex gap-3 rounded-lg border border-line bg-surface p-4 transition-[border-color,background]',
        'hover:border-ink-300 hover:bg-surface-2',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md transition-colors',
          built ? 'bg-brand-50 text-brand' : 'bg-surface-3 text-ink-400',
        )}
      >
        {Icon && <Icon className="size-4.5" strokeWidth={1.75} aria-hidden="true" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-display text-md font-semibold text-ink-900">{page.label}</span>
          {!built && (
            <span className="rounded-full bg-surface-3 px-1.5 py-px font-display text-2xs font-bold tracking-wide text-ink-400 uppercase">
              Soon
            </span>
          )}
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-ink-500">
          {page.description}
        </span>
      </span>
    </Link>
  );
}

function CategoryPanel({ category, pages, heading }) {
  return (
    <section aria-labelledby={`settings-${category.key}`}>
      <div className="mb-3">
        {heading === 'h2' ? (
          <h2 id={`settings-${category.key}`} className="font-display text-lg font-bold">
            {category.label}
          </h2>
        ) : (
          <h2 id={`settings-${category.key}`} className="sr-only">
            {category.label}
          </h2>
        )}
        {heading === 'h2' && (
          <p className="mt-0.5 text-sm text-ink-500">{category.description}</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pages.map((page) => (
          // A page from an earlier phase is built by definition - it shipped
          // with that phase. Phase 11 lands across several passes, so its
          // routes say so explicitly rather than being inferred from a number
          // that is the same for a real screen and a stub.
          <PageCard key={page.path} page={page} built={page.built || page.phase < 11} />
        ))}
      </div>
    </section>
  );
}

export function AdminSettingsPage() {
  const [params] = useSearchParams();
  const active = params.get('cat');
  const { features } = useAuth();
  const grouped = pagesByCategory(features);

  /**
   * A category with nothing left in it is not drawn.
   *
   * Every page in a category can be dropped by the filter above - Scheduling
   * holds exactly two, both gated on `scheduling.appointments` - and the panel
   * rendered its heading and description regardless. That left a business
   * reading "Scheduling & Booking · The weekly board and the appointment grid"
   * above an empty grid, which describes a capability nobody granted it in the
   * same breath as showing it has none. The tab row is filtered on the same
   * list so it cannot offer a landing that would be empty either.
   */
  const populated = SETTINGS_CATEGORIES.filter((entry) => (grouped.get(entry.key)?.length ?? 0) > 0);

  const category = populated.find((c) => c.key === active) ?? null;
  const shown = category ? [category] : populated;

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={category ? category.label : ADMIN_PAGE.title}
        description={category ? 'Settings for this area.' : ADMIN_PAGE.description}
      />

      {/* The tab row exists only on a category landing - on the summary every
          category is already a heading below, so a tab row would just be the
          page's own contents restated above it. */}
      {category && (
        <nav
          aria-label="Settings categories"
          className="mb-6 -mx-3 flex gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0"
        >
          <Link
            to="/admin/settings"
            className={cn(pressable, 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
          >
            <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Summary
          </Link>

          {populated.map((tab) => (
            <Link
              key={tab.key}
              to={`/admin/settings?cat=${tab.key}`}
              aria-current={tab.key === category.key ? 'page' : undefined}
              className={cn(
                pressable,
                'inline-flex h-8 shrink-0 items-center rounded-md px-3 font-display text-sm font-semibold',
                tab.key === category.key
                  ? 'bg-ink-900 text-white'
                  : 'text-ink-500 hover:bg-surface-2 hover:text-ink-700',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      )}

      <div className="space-y-8">
        {shown.map((entry) => (
          <CategoryPanel
            key={entry.key}
            category={entry}
            pages={grouped.get(entry.key) ?? []}
            // On a category landing the H1 already names the category, so
            // repeating it as an H2 directly beneath is noise.
            heading={category ? 'sr' : 'h2'}
          />
        ))}
      </div>
    </>
  );
}

export default AdminSettingsPage;
