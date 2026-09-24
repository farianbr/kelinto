import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Layers, Store } from 'lucide-react';
import cn from '@/lib/cn';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import { pressable } from '@/lib/motion';
import { useAuth } from '@/hooks/useAuth';
import { useAdminBusinesses } from '@/hooks/useAdmin';
import { getBusiness, setBusiness, subscribeBusiness } from '@/store/businessStore';
import { panelBusiness } from '@/lib/surface';

/**
 * Which shop the panel is looking at (§6.14).
 *
 * **An admin sees everything by default and narrows to one shop from here.** A
 * staff member does not see this control at all: their business is fixed by
 * `User.business` and enforced server-side, so offering them a switcher would be
 * offering a choice the API will refuse.
 *
 * Switching **drops every cached admin query and refetches them**. Each was
 * fetched for the previous business, so serving them under a new business's name
 * even for a beat - is the most misleading thing this control could do. See
 * `choose()` for why both steps are needed.
 *
 * `useSyncExternalStore` rather than local state, because `lib/api.js` reads the
 * same value synchronously on every request and the two must not disagree.
 */
export function BusinessSwitcher() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const selected = useSyncExternalStore(subscribeBusiness, getBusiness, getBusiness);

  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOnClickOutside(ref, () => setOpen(false));

  // Escape closes it, which is what a keyboard user reaches for first.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const { data } = useAdminBusinesses(isAdmin ? { status: 'all' } : undefined);
  const businesses = data?.businesses ?? [];

  // Staff are pinned. One business in the business is not a choice either - a
  // switcher offering a single option is a control that cannot do anything.
  // Nor is a business's own panel domain: the server holds every request on it
  // to that business, so a switch there would change the label and nothing else.
  if (!isAdmin || businesses.length < 2 || panelBusiness) return null;

  const active = businesses.find((business) => business.id === selected);

  /**
   * Land in a real business when nothing is chosen.
   *
   * With "All businesses" gone, `null` is no longer a view - it is an
   * unanswered question, and an admin arriving with an empty
   * `sessionStorage` would otherwise see a switcher labelled after nothing.
   * The default business is the right landing place for the same reason it is
   * everywhere else: it is where an unattributed record lands.
   *
   * Set during render rather than in an effect because `lib/api.js` reads this
   * store synchronously on the very next request; an effect would let one
   * round of unscoped queries go out first.
   */
  if (!active) {
    const fallback = businesses.find((business) => business.isDefault) ?? businesses[0];
    if (fallback && fallback.id !== selected) {
      setBusiness(fallback.id, { colorToken: fallback.colorToken, name: fallback.name });
    }
  }

  function choose(id) {
    // The token rides along with the id so the next reload paints in this
    // business's colour from the first frame - see `store/businessStore.js`.
    const picked = businesses.find((business) => business.id === id);
    setBusiness(id, { colorToken: picked?.colorToken, name: picked?.name });
    setOpen(false);

    /**
     * Refetch every admin query against the new business.
     *
     * The business is injected in `lib/api.js` rather than being part of any
     * query key, so React Query sees identical keys across a switch and would
     * otherwise sit still - leaving one shop's orders on screen under the
     * other shop's name.
     *
     * `refetchType: 'all'` is the load-bearing part: the default only refetches
     * ACTIVE queries, and `removeQueries` first was worse still - it unmounted
     * the data so there was nothing left for a refetch to find, and exactly one
     * request went out.
     */
    queryClient.invalidateQueries({ queryKey: ['admin'], refetchType: 'all' });

    /**
     * And the session, because the **feature set** rides on it.
     *
     * A business carries a type, and the type decides which nav sections exist
     * (SAAS_PLATFORM §1.1). That answer arrives from `/auth/me` under
     * `['auth', 'me']`, not under `['admin']` - so without this the records
     * would switch and the sidebar would not, leaving a service business
     * showing Orders and Returns until the next reload.
     */
    queryClient.invalidateQueries({ queryKey: ['auth', 'me'], refetchType: 'all' });
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Business: ${active?.name ?? 'All businesses'}`}
        className={cn(
          pressable,
          'flex h-9 max-w-[200px] items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium',
          active
            ? 'border-brand/30 bg-brand-50 text-brand-700'
            : 'border-line bg-surface text-ink-700 hover:border-line-strong hover:text-ink-900',
        )}
      >
        {active ? (
          <Store className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        ) : (
          <Layers className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">{active?.name ?? 'All businesses'}</span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-fast ease-entrance',
            open && 'rotate-180',
          )}
          strokeWidth={2.25}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Business"
          className="absolute right-0 top-full z-50 mt-1.5 w-[260px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-card"
        >
          {/*
            **There is no "All businesses" any more** (SAAS_PLATFORM §4.1).

            An admin always works inside exactly one business. Under
            database-per-business a request resolves to one database, so a view
            spanning all of them cannot be a query - it would have to be N
            queries merged in the client, and a P&L summing two unrelated
            businesses is a number nobody asked for.

            The option was removed rather than disabled: a control that is
            visibly there and refuses to work invites somebody to ask why.
          */}
          {businesses.map((business) => (
            <Option
              key={business.id}
              icon={Store}
              label={business.name}
              // The code, because two shops in one city are told apart by it
              // long before they are told apart by name.
              hint={business.code}
              selected={selected === business.id}
              onSelect={() => choose(business.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Option({ icon: Icon, label, hint, selected, onSelect }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        pressable,
        'flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2',
        selected && 'bg-surface-2',
      )}
    >
      <Icon className="size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-900">{label}</span>
        {hint && <span className="block truncate text-xs text-ink-400">{hint}</span>}
      </span>
      {selected && (
        <Check className="size-4 shrink-0 text-brand" strokeWidth={2.5} aria-hidden="true" />
      )}
    </button>
  );
}

export default BusinessSwitcher;
