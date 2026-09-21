import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import cn from '@/lib/cn';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/permissions';
import { featureEnabled } from '@shared/schemas/features';
import { adminIcon } from './adminIcons';
import { pressable } from '@/lib/motion';

/**
 * The `+ Create` dropdown, shortcut `C` (ERP rework §7.2).
 *
 * **Grouped, not flat** - the screenshot settles it: money coming in on one
 * side, money going out on the other, which is how the staff member already thinks
 * about which record they are about to make.
 *
 * **Entries the role cannot create are hidden** (§7.2, wired in phase 12b).
 * Each carries the area and level its screen actually requires - creating is a
 * `full` action everywhere, so `view` is not enough to see the entry. The
 * underlying route still checks: a hidden menu item is a courtesy, never a
 * permission (§7.6).
 *
 * A group whose every entry is hidden disappears with its heading, rather than
 * leaving a label above nothing.
 *
 * **Every entry opens a form, not a list.** `+ Create > Quote` used to land on
 * the quotes list and leave the staff member to find the button they had just
 * pressed the equivalent of - which is the menu asking them to do the thing
 * twice. It cannot open a modal on a page that has not mounted, so it navigates
 * with `?new=1` and the page reads that through `useCreateParam`, which strips
 * the flag on arrival so the URL stops describing a modal the moment it closes.
 */

/**
 * `area` is the permission this entry needs; `feature` is the capability the
 * business has to have for it to exist at all. The two are filtered
 * independently below, because an admin bypasses the first and nobody bypasses
 * the second (SAAS_PLATFORM §4.4).
 */
const GROUPS = [
  {
    key: 'income',
    label: 'Income',
    items: [
      { key: 'client', label: 'Client', to: '/admin/clients', icon: 'Users', area: 'clients', feature: 'sales.clients' },
      { key: 'order', label: 'Order', to: '/admin/orders', icon: 'Package', area: 'sales', feature: 'sales.orders' },
      // `servicePage` is where this entry goes on a business that sells labour.
      // A repair invoice and a repair estimate are raised on their own screens,
      // because each carries devices, services, parts and travel - more than a
      // dialog holds without scrolling past what it is asking about. Naming the
      // destination here rather than letting the list redirect is what keeps the
      // wholesale modal from mounting for a frame on the way past.
      { key: 'invoice', label: 'Invoice', to: '/admin/invoices', servicePage: '/admin/invoices/create', icon: 'FileText', area: 'sales', feature: 'sales.invoices' },
      { key: 'quote', label: 'Quote', to: '/admin/quotes', servicePage: '/admin/quotes/create', icon: 'FileSignature', area: 'sales', feature: 'sales.quotes' },
      { key: 'rma', label: 'RMA', to: '/admin/rma', icon: 'RotateCcw', area: 'sales', feature: 'sales.rma' },
      // A ticket only exists on a service business, so its own screen is not
      // conditional - there is no modal behind this one to fall back to.
      { key: 'ticket', label: 'Ticket', to: '/admin/tickets/new', page: true, icon: 'ClipboardList', area: 'sales', feature: 'sales.tickets' },
    ],
  },
  {
    key: 'expense',
    label: 'Expense',
    items: [
      { key: 'supplier', label: 'Supplier', to: '/admin/suppliers', icon: 'Truck', area: 'purchase', feature: 'purchase.suppliers' },
      // `page: true` - a purchase order is raised on its own screen, not in a
      // modal over the list. Without it this navigated to the list with a
      // `?new=1` nothing reads, so the menu item silently did nothing.
      { key: 'po', label: 'Purchase Order', to: '/admin/purchase-orders/create', page: true, icon: 'ClipboardList', area: 'purchase', feature: 'purchase.orders' },
      { key: 'expense', label: 'Expense', to: '/admin/expenses', icon: 'Receipt', area: 'purchase', feature: 'purchase.expenses' },
      { key: 'product', label: 'Product', to: '/admin/inventory', icon: 'Boxes', area: 'purchase', feature: 'purchase.inventory' },
    ],
  },
];

export function CreateMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { permissions, features, isAdmin } = useAuth();
  useOnClickOutside(ref, () => setOpen(false));

  // `sales.services` is on exactly when the business sells labour - the same
  // test the quotes and invoices lists branch on. It decides which destination
  // an entry carrying both takes.
  const isService = Boolean(features?.['sales.services']);

  /**
   * What this session may actually create.
   *
   * **Two filters, and only one of them an admin bypasses.** A permission is
   * what this account may do, and an admin bypasses the map entirely (§7.6). A
   * feature is what the business has at all - nobody bypasses that, because an
   * admin creating a record in a section the business does not run would hit
   * the same 404 as anyone else (§4.4).
   */
  const visibleGroups = useMemo(() => {
    const hasFeature = (item) => !item.feature || featureEnabled(features, item.feature);

    return GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => hasFeature(item) && (isAdmin || can(permissions, item.area, 'full')),
      ),
    })).filter((group) => group.items.length > 0);
  }, [permissions, features, isAdmin]);

  // A role that can create nothing gets no button at all - a `+ Create` that
  // opens an empty panel is worse than its absence.
  const hasAnything = visibleGroups.length > 0;

  // `C` opens the menu, unless the user is typing - a shortcut that fires
  // inside a search box eats the letter.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') return setOpen(false);
      if (event.key !== 'c' && event.key !== 'C') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      const typing =
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (typing) return;

      event.preventDefault();
      setOpen((value) => !value);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Placed after the hooks, never before them: bailing earlier would change the
  // hook order between renders as permissions resolve.
  if (!hasAnything) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Create (C)"
        className="hidden h-9 items-center gap-1.5 rounded-md bg-brand-gradient px-3 text-sm font-semibold text-white transition-[filter] hover:brightness-110 sm:inline-flex"
      >
        <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
        Create
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-[230px] overflow-hidden rounded-md bg-surface py-1.5 shadow-card"
        >
          {visibleGroups.map((group, index) => (
            <div key={group.key} className={cn(index > 0 && 'mt-1 border-t border-line pt-1')}>
              <p className="eyebrow px-3 py-1.5 text-ink-300">{group.label}</p>

              {group.items.map((item) => {
                const Icon = adminIcon(item.icon);

                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      // Most record types open a modal over their list, so the
                      // menu navigates and leaves `?new=1` for `useCreateParam`
                      // to consume. A type with its own create screen is
                      // navigated to directly - appending the sentinel there
                      // would put a flag in the URL that nothing reads.
                      //
                      // The menu already knows which business it is in, so a
                      // service business is sent straight to the full page. It
                      // used to navigate to the list with `?new=1` and let the
                      // list redirect, which meant the wholesale modal was
                      // mounted and then navigated out from under - the "it
                      // still opens the modal" this replaces. Deciding here
                      // means no modal is ever constructed.
                      const page = (isService && item.servicePage) || (item.page ? item.to : null);
                      navigate(page ?? `${item.to}?new=1`);
                    }}
                    className={cn(pressable, 'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-ink-700 hover:bg-surface-2 hover:text-ink-900')}
                  >
                    {Icon && (
                      <Icon className="size-3.5 shrink-0 text-ink-400" strokeWidth={2.25} aria-hidden="true" />
                    )}
                    <span className="flex-1">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CreateMenu;
