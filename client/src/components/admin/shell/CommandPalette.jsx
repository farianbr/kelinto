import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CornerDownLeft, Search } from 'lucide-react';
import cn from '@/lib/cn';
import { ADMIN_NAV } from '@shared/schemas/admin';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from './adminIcons';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAdminSearch } from '@/hooks/useAdmin';
import { visibleNav } from '@/lib/permissions';
import { featureEnabled } from '@shared/schemas/features';
import { useAuth } from '@/hooks/useAuth';

/**
 * Ctrl+K / ⌘K jump-to (ERP rework §7.1).
 *
 * **Screens and records**, since phase 12. Screens are matched locally against
 * the nav tree - instant, and available with no network at all. Records come
 * from `GET /admin/search`, which is **permission-filtered server-side**: a
 * role that cannot open Purchase never sees a supplier here, because a search
 * hit leaks a record's existence and name before anybody clicks it.
 *
 * **One flat list, grouped visually.** Arrow keys move through everything in
 * order regardless of which heading a row sits under - a cursor that had to
 * skip headings, or reset between groups, is the kind of thing that makes a
 * palette feel wrong without anybody being able to say why.
 *
 * Records rank above screens when the query matches both: somebody typing an
 * invoice number wants that invoice, not the Invoices list.
 *
 * Recent picks persist in `localStorage`, so the second use of the palette is
 * faster than the first.
 */

const RECENTS_KEY = 'cellvix.admin.palette.recents';
const RECENTS_MAX = 5;

/**
 * Flatten the nav tree to searchable rows, each remembering its group for
 * context.
 *
 * **Built from the nav this session can actually see**, not from `ADMIN_NAV`
 * raw. A palette that offers a screen the role cannot reach sends somebody to a
 * 403; one that offers a switched-off feature tells them it exists, which is
 * the thing a 404 gate is withholding (§3.2 rule 2).
 */
function buildIndex(permissions, features) {
  const visible = visibleNav(ADMIN_NAV, permissions, features);
  const rows = [];

  for (const group of visible) {
    if (group.to) {
      rows.push({ to: group.to, label: group.label, group: null, icon: group.icon });
      continue;
    }
    for (const child of group.children ?? []) {
      rows.push({ to: child.to, label: child.label, group: group.label, icon: child.icon });
    }
  }

  // Which top-level sections survived the filters. A route belonging to a
  // section that did not is not offered - `ADMIN_ROUTES` also describes screens
  // that have a nav row, so without this the loop below would put a hidden
  // section straight back in and quietly undo the filter above it.
  const visibleSections = new Set(visible.map((group) => group.key));

  // Screens with a route but no nav row of their own - Approvals, My Profile
  // are reachable targets too, and someone will type their name.
  for (const [path, meta] of Object.entries(ADMIN_ROUTES)) {
    if (path.includes(':')) continue;
    if (rows.some((row) => row.to.split('?')[0] === path)) continue;
    if (meta.section && !visibleSections.has(meta.section)) continue;
    // A route carrying its own flag is filtered on it here, because the section
    // check above cannot do it: every settings screen belongs to `settings`,
    // which is visible to anyone who can open the panel at all. Without this
    // the Kiosk, Devices and Calendar screens were offered by name to a
    // business that does not have them - the one thing their 404 gate is
    // withholding, handed over by the search box instead.
    if (meta.feature && features && !featureEnabled(features, meta.feature)) continue;
    rows.push({ to: path, label: meta.title ?? meta.label, group: null, icon: meta.icon });
  }

  return rows;
}

function readRecents() {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    // A private window or blocked site data is not an error worth surfacing.
    return [];
  }
}

function writeRecents(list) {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch {
    /* ignore */
  }
}

/**
 * Substring first, then a *tight* subsequence so `puror` still finds
 * `Purchase Orders`.
 *
 * The density check is the important part: a plain subsequence match spreads
 * five letters across a whole sentence, which is how `roles` ends up matching
 * "Devices, brands, models & aliases". Requiring the matched letters to sit
 * inside a span of about twice the query length keeps a fuzzy match fuzzy
 * rather than meaningless.
 */
function score(label, query) {
  const haystack = label.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return 0;

  const direct = haystack.indexOf(needle);
  if (direct === 0) return 100;
  if (direct > 0) return 70 - direct;

  // Word-initial match: `pos` finds `Purchase Orders` via its initials.
  const initials = haystack
    .split(/[^a-z0-9]+/)
    .map((word) => word[0] ?? '')
    .join('');
  if (initials.startsWith(needle)) return 60;

  let index = 0;
  let start = -1;
  for (const char of needle) {
    index = haystack.indexOf(char, index);
    if (index === -1) return -1;
    if (start === -1) start = index;
    index += 1;
  }

  const span = index - start;
  if (span > needle.length * 2 + 2) return -1;
  return 30 - (span - needle.length);
}

export function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [recents, setRecents] = useState(readRecents);

  const { permissions, features } = useAuth();
  const index = useMemo(
    () => buildIndex(permissions, features),
    [permissions, features],
  );

  // Debounced so a typed invoice number is one request rather than fifteen.
  const debouncedQuery = useDebouncedValue(query, 200);
  const { data: records, isFetching } = useAdminSearch(open ? debouncedQuery : '');

  const results = useMemo(() => {
    if (!query.trim()) {
      const recentRows = recents
        .map((to) => index.find((row) => row.to === to))
        .filter(Boolean)
        .map((row) => ({ ...row, recent: true, kind: 'screen' }));

      // Recents first, then the rest of the panel in nav order.
      const seen = new Set(recentRows.map((row) => row.to));
      return [
        ...recentRows,
        ...index.filter((row) => !seen.has(row.to)).map((row) => ({ ...row, kind: 'screen' })),
      ].slice(0, 12);
    }

    // Records first: somebody typing an invoice number wants the invoice, not
    // the Invoices list. Each carries its group label so the flat list can be
    // rendered under headings without the cursor knowing about them.
    const recordRows = (records?.groups ?? []).flatMap((group) =>
      group.hits.map((hit) => ({
        kind: 'record',
        to: hit.to,
        label: hit.title,
        detail: hit.detail,
        badge: hit.badge,
        group: group.label,
        icon: group.icon,
      })),
    );

    const screenRows = index
      .map((row) => ({
        row,
        value: Math.max(score(row.label, query), score(row.group ?? '', query) - 20),
      }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((entry) => ({ ...entry.row, kind: 'screen' }));

    return [...recordRows, ...screenRows].slice(0, 14);
  }, [query, index, recents, records]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    // Autofocus after the dialog paints, or the first keystroke is dropped.
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  function go(row) {
    if (!row) return;

    // **Only screens are remembered.** A recent list of record URLs would fill
    // with one-off invoices nobody revisits, and would keep showing a row for
    // a record that has since been deleted - `readRecents` resolves against the
    // nav index, so a stale record path would simply vanish and leave the list
    // shorter than it looks.
    if (row.kind !== 'record') {
      const next = [row.to, ...recents.filter((to) => to !== row.to)].slice(0, RECENTS_MAX);
      setRecents(next);
      writeRecents(next);
    }

    onClose();
    navigate(row.to);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((value) => (value + 1) % Math.max(results.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((value) => (value - 1 + results.length) % Math.max(results.length, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[cursor]);
    } else if (event.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/45"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative w-full max-w-[540px] overflow-hidden rounded-lg bg-surface shadow-card"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          <Search className="size-4 shrink-0 text-ink-300" strokeWidth={2} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search screens, clients, orders, invoices…"
            /**
             * `focus:shadow-none`, not just `focus:outline-none`.
             *
             * The global `:focus-visible` rule in index.css draws its ring with
             * a **box-shadow**, not an outline, so `outline-none` removed
             * nothing and the brand ring was painting a rounded red rectangle
             * around a field that has no border of its own - it read as a stray
             * box floating inside the palette.
             *
             * Every other input in the app happens to hide it by accident, by
             * setting its own `focus:ring-2`. This field wants no ring at all:
             * it is the only focusable thing in the dialog, it is focused the
             * moment the palette opens, and the caret is already saying where
             * you are typing. Suppressing it here costs no discoverability and
             * leaves the global rule intact for everything else.
             */
            className="h-12 flex-1 bg-transparent text-md text-ink-900 placeholder:text-ink-300 focus:shadow-none focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-2xs text-ink-300">
            Esc
          </kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto scroll-slim py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-400">
              {isFetching ? 'Searching…' : `Nothing matches “${query}”.`}
            </p>
          ) : (
            results.map((row, position) => {
              const Icon = adminIcon(row.icon);
              const active = position === cursor;
              // A heading whenever the group changes, so the flat list reads as
              // sections without the cursor having to step over anything.
              const previous = results[position - 1];
              const heading =
                row.kind === 'record' && row.group !== previous?.group
                  ? row.group
                  : row.kind === 'screen' && previous?.kind === 'record'
                    ? 'Screens'
                    : null;

              return (
                <div key={`${row.kind}:${row.to}`}>
                  {heading && (
                    <p className="eyebrow px-3.5 pt-2 pb-1 text-ink-300">{heading}</p>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(position)}
                    onClick={() => go(row)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-md transition-colors',
                      active ? 'bg-surface-2 text-ink-900' : 'text-ink-700',
                    )}
                  >
                    {Icon && (
                      <Icon className="size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {row.kind === 'screen' && row.group && (
                        <span className="text-ink-300">{row.group} · </span>
                      )}
                      {row.label}
                      {row.detail && (
                        <span className="ml-1.5 text-ink-300">{row.detail}</span>
                      )}
                    </span>
                    {row.recent && !query && (
                      <span className="eyebrow shrink-0 text-ink-200">Recent</span>
                    )}
                    {active && (
                      <CornerDownLeft className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <p className="border-t border-line bg-surface-2 px-3.5 py-2 text-xs leading-snug text-ink-400">
          Searches screens, clients, orders, invoices, quotes, RMAs, inventory, suppliers, purchase
          orders and businesses - limited to what your role can open.
        </p>
      </div>
    </div>
  );
}

export default CommandPalette;
