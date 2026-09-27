import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, BellOff, UserCheck } from 'lucide-react';
import cn from '@/lib/cn';
import useOnClickOutside from '@/hooks/useOnClickOutside';
import { relativeTime } from '@/lib/format';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ApproveClientForm from '@/components/admin/ApproveClientForm';
import {
  useNotifications,
  useNotificationActions,
  useAdminMutations,
} from '@/hooks/useAdmin';
import { adminIcon } from './adminIcons';
import { pressable } from '@/lib/motion';

/**
 * The notification bell and its dropdown (ERP rework §7.3, §6.15, phase 12c).
 *
 * `Clear All`, `N alerts`, then rows of icon + type + one-line detail +
 * relative time, tinted by severity and linking to the entity - the panel §6.15
 * specifies.
 *
 * **The list arrives already filtered and already merged.** The server decides
 * which areas this role may hear about and recomputes the standing conditions
 * on every read, so there is nothing here that filters, derives or sorts. That
 * is deliberate: a client that re-sorted would eventually disagree with the
 * badge it is sitting next to.
 *
 * **Opening marks read; it does not clear.** Those are different acts
 * "I have seen this" and "I am done with this" - and collapsing them would mean
 * a glance at the bell silently emptied a queue somebody was working through.
 *
 * **Two row types carry an action**, and both open a form rather than
 * committing anything. A pending account is answered *by approving it*, so the
 * row opens that form in place; the reorder queue is answered by raising a
 * purchase order, so it opens the create screen with the lines filled in.
 * Every other alert is cleared by work done elsewhere - paying an invoice,
 * receiving a shipment - so a button on those rows would have nothing to press.
 */

/** Which icon each type gets. Names resolve through the shared `adminIcon` map. */
const TYPE_ICON = {
  new_registration: 'UserPlus',
  supplier_application: 'Building2',
  pending_approval: 'UserCheck',
  new_order: 'Package',
  quote_accepted: 'FileSignature',
  new_rma: 'RotateCcw',
  invoice_overdue: 'FileText',
  low_stock: 'TrendingDown',
  out_of_stock: 'PackageX',
  // One row for the whole reorder queue, not one per empty shelf. The server
  // collapses them; see the note in `notificationService`.
  reorder_queue: 'PackageX',
  po_overdue: 'ClipboardList',
};

/**
 * Severity tints (§6.15: `danger` for out of stock, `warn` for low stock).
 *
 * Colour is never the only carrier - every row also states its condition in
 * words, because a tint alone fails both a colour-blind reader and a
 * screen-reader one (Instructions 3.1).
 */
const SEVERITY_CLASS = {
  danger: 'text-danger',
  warn: 'text-warn',
  success: 'text-success',
  info: 'text-info',
};

/**
 * Which rows `Clear All` can actually clear.
 *
 * A stored event has a real `ObjectId`; a standing condition has a synthetic
 * `condition:id` string. The server will not clear the second kind - it is
 * recomputed from the live records on the next read, and a staff member who
 * dismissed "out of stock" while the shelf is still empty has not solved
 * anything. Knowing the split here is what lets the panel *say* so, instead of
 * offering a button that appears to do nothing.
 */
const STORED_ID = /^[a-f\d]{24}$/i;

/**
 * One notification row.
 *
 * A container rather than one button, because a button inside a button is
 * invalid and a nested click target that has to `stopPropagation` to work is a
 * bug waiting to be reintroduced. Two siblings say what they each do.
 *
 * `onAct` is the row's own action - approving an account, drafting a purchase
 * order. It is passed only for rows the server marked actionable, so the button
 * exists exactly where there is something to press.
 */
function NotificationRow({ entry, onOpen, onAct, acting = false }) {
  const Icon = adminIcon(TYPE_ICON[entry.type]) ?? Bell;

  return (
    <div
      className={cn(
        pressable,
        'flex w-full items-start border-b border-line last:border-b-0 hover:bg-surface-2',
        // An unread row is tinted, not bolded alone: weight shifts reflow the
        // text and make the list twitch as rows are read.
        !entry.read && 'bg-surface-2/60',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
      >
        <Icon
          className={cn('mt-px size-4 shrink-0', SEVERITY_CLASS[entry.severity] ?? 'text-ink-400')}
          strokeWidth={2}
          aria-hidden="true"
        />

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-snug text-ink-900">
            {entry.title}
          </span>
          {entry.detail && (
            <span className="mt-0.5 block truncate text-xs text-ink-500">{entry.detail}</span>
          )}
        </span>

        {/**
         * A time, or the word "ongoing" - never both, and never a time this
         * row cannot support.
         *
         * A standing condition (an empty shelf, an overdue PO) has no moment
         * of onset in the records, so the server dates it to now purely to
         * sort it. Rendering that as a time ago printed "just now" against
         * every one of them, which was the single most misleading thing in
         * this panel: forty alerts all claiming to have arrived this second.
         */}
        {entry.standing ? (
          <span className="shrink-0 pt-px text-2xs text-ink-300">ongoing</span>
        ) : (
          <time
            dateTime={new Date(entry.createdAt).toISOString()}
            className="shrink-0 pt-px text-2xs text-ink-300"
          >
            {relativeTime(entry.createdAt)}
          </time>
        )}
      </button>

      {onAct && (
        <button
          type="button"
          // The panel stays open behind whatever this opens: an action is a
          // decision about one row, and closing the list underneath it loses
          // the staff member their place in the queue.
          onClick={onAct}
          disabled={acting}
          aria-label={`${entry.action.label} - ${entry.title}`}
          className={cn(pressable, 'my-2.5 mr-3 shrink-0 self-center rounded-sm border border-brand/40 bg-brand-50 px-2 py-1 text-xs font-medium text-brand hover:border-brand disabled:cursor-not-allowed disabled:opacity-45')}
        >
          {acting ? 'Working…' : entry.action.label}
        </button>
      )}
    </div>
  );
}

export function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const [approving, setApproving] = useState(null);
  // Clearing removes alerts for good, so it confirms twice (§3.0.1).
  const [confirmingClear, setConfirmingClear] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  useOnClickOutside(ref, () => setOpen(false));

  const { data, isLoading } = useNotifications();
  const { markRead, clearAll } = useNotificationActions();
  const { approveUser } = useAdminMutations();

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const unread = data?.unread ?? 0;

  const clearable = useMemo(
    () => entries.filter((entry) => STORED_ID.test(entry.id)).length,
    [entries],
  );
  const standing = entries.length - clearable;

  /**
   * Rows that can be *finished* from here are split out and put first.
   *
   * Mixed into the rest they were indistinguishable from things that merely
   * wanted reading. The server already sorts actionable rows to the top; this
   * makes the boundary visible, so a staff member can see at a glance whether
   * anything is waiting on them.
   *
   * Two kinds qualify now: an account waiting for approval, and the reorder
   * queue - both are alerts whose answer is a decision this panel can take,
   * rather than work done on another screen.
   */
  const [actionable, rest] = useMemo(() => {
    const waiting = [];
    const other = [];
    for (const entry of entries) {
      (entry.action ? waiting : other).push(entry);
    }
    return [waiting, other];
  }, [entries]);

  /**
   * What a row's action button does, by kind.
   *
   * Both open a form rather than committing anything. Approving a business
   * account carries terms - a credit limit, a tier - that a one-click approve
   * would be setting by default; a reorder carries quantities a rule inferred,
   * which is exactly what somebody should look at before a purchase order
   * exists. Neither writes until the form is saved.
   */
  function act(entry) {
    if (entry.action?.kind === 'approve_user') {
      setApproving({
        id: entry.action.userId,
        businessName: entry.action.businessName ?? entry.entity?.label,
        contactName: entry.action.contactName,
        email: entry.action.email,
        taxId: entry.action.taxId,
      });
      return;
    }

    if (entry.action?.kind === 'generate_reorder_draft') {
      // No product ids: the whole queue. The create screen fetches it itself,
      // so the lines describe the shelf when the form opens rather than
      // whenever the bell last polled.
      setOpen(false);
      navigate('/admin/purchase-orders/create?reorder=1');
    }
  }

  // Opening marks everything currently visible as read. Fired once per open
  // rather than on every render, and only when there is something to mark
  // otherwise every poll while the panel sits open would re-issue the write.
  useEffect(() => {
    if (!open || unread === 0) return;
    markRead.mutate(undefined);
    // `markRead` is a fresh object each render, so it stays out of the deps
    // including it would re-fire the mutation on its own success.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'
        }
        className={cn(pressable, 'relative flex size-9 items-center justify-center rounded-md text-ink-500 hover:bg-surface-2 hover:text-ink-900')}
      >
        <Bell className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        {unread > 0 && (
          // The count, not a dot: "3 things want you" and "something wants you"
          // are different messages, and the staff member decides whether to stop
          // what they are doing based on which one it is. Past 9 it becomes
          // `9+` rather than widening the badge over the icon.
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-2xs font-bold leading-[16px] text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* A scrim behind the panel.

              Sitting on the same near-white the page uses, the dropdown read
              as part of the layout rather than over it - the edge between
              them was one hairline. Dimming what is behind it separates the
              two without the panel having to shout, and gives a click target
              for dismissing it that is the whole rest of the screen. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-ink-900/20"
          />

        <div
          role="dialog"
          aria-label="Notifications"
          // Right-anchored under the bell, and capped to the viewport so it
          // cannot push the page sideways on a 320 screen (Instructions 3.1).
          //
          // A max width on a viewport-relative width is not enough on its own: the
          // anchor is the bell, which is not flush to the right edge - the
          // avatar sits beyond it - so a panel exactly as wide as the viewport
          // hangs off the *left* by however far the bell is inset, clipping the
          // count and the row icons. Fixed on small screens pins it to the
          // viewport itself, which is the only box that knows where the edges
          // are; from the sm breakpoint up it returns to the anchor.
          className="fixed inset-x-3 top-14 z-40 mt-1.5 overflow-hidden rounded-lg bg-surface shadow-pop ring-1 ring-ink-900/5 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-[min(420px,calc(100vw-1.5rem))]"
        >
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink-700">
                {entries.length} {entries.length === 1 ? 'alert' : 'alerts'}
              </p>
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                // Disabled on *clearable* rows, not on the total. A panel
                // showing nothing but standing conditions has a full list and
                // nothing to clear, and an enabled button there is one that can
                // only appear broken - the rule phase 9 settled with "Send to
                // 0", applied to the half of the list that can be acted on.
                disabled={clearable === 0 || clearAll.isPending}
                title={
                  clearable === 0 && standing > 0
                    ? 'These alerts stay until the underlying condition clears.'
                    : undefined
                }
                className={cn(pressable, 'text-xs font-medium text-ink-400 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-45')}
              >
                Clear All
              </button>
            </div>

            {standing > 0 && (
              // Said plainly rather than left to be inferred from a list that
              // did not shrink. `Clear All` dismisses events; a condition stops
              // being listed when it stops being true.
              <p className="mt-1 text-2xs leading-snug text-ink-400">
                {standing} {standing === 1 ? 'alert stays' : 'alerts stay'} until the underlying
                condition clears.
              </p>
            )}
          </div>

          <div className="max-h-[min(520px,68vh)] overflow-y-auto">
            {isLoading && (
              <p className="px-3 py-6 text-center text-sm text-ink-400">Loading…</p>
            )}

            {!isLoading && entries.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                <BellOff className="size-5 text-ink-300" strokeWidth={1.5} aria-hidden="true" />
                <p className="text-sm text-ink-400">Nothing needs your attention.</p>
              </div>
            )}

            {/* Actionable rows first, under their own heading. Everything here
                can be finished from this panel; everything below it cannot. */}
            {actionable.length > 0 && (
              <>
                <p className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-brand-50 px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-brand">
                  <UserCheck className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                  Waiting on you
                  <span className="tnum ml-auto rounded-full bg-brand px-1.5 text-2xs leading-[15px] text-white">
                    {actionable.length}
                  </span>
                </p>
                {actionable.map((entry) => (
                  <NotificationRow
                    key={entry.id}
                    entry={entry}
                    onOpen={() => {
                      setOpen(false);
                      if (entry.href) navigate(entry.href);
                    }}
                    onAct={() => act(entry)}
                  />
                ))}
              </>
            )}

            {rest.length > 0 && (
              <>
                {/* The heading only appears when there is something above it to
                    separate from - a lone "Updates" label over the whole list
                    labels nothing. */}
                {actionable.length > 0 && (
                  <p className="sticky top-0 z-10 border-b border-line bg-surface-2 px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-400">
                    Everything else
                  </p>
                )}
                {rest.map((entry) => (
                  <NotificationRow
                    key={entry.id}
                    entry={entry}
                    onOpen={() => {
                      setOpen(false);
                      if (entry.href) navigate(entry.href);
                    }}
                  />
                ))}
              </>
            )}
          </div>
        </div>
        </>
      )}

      <ConfirmDialog
        open={confirmingClear}
        onClose={() => setConfirmingClear(false)}
        onConfirm={() => clearAll.mutate(undefined, { onSuccess: () => setConfirmingClear(false) })}
        title={`Clear ${clearable} ${clearable === 1 ? 'alert' : 'alerts'}?`}
        body="They are removed from this list for good. Alerts about a condition that still holds stay until it clears."
        confirmLabel="Clear alerts"
        confirmPhrase="clear"
        confirmPhraseLabel="the word clear"
        loading={clearAll.isPending}
        error={clearAll.error?.message}
      />

      <Modal
        open={Boolean(approving)}
        onClose={() => setApproving(null)}
        title="Approve business account"
        size="md"
        align="top"
      >
        {approving && (
          <ApproveClientForm
            user={approving}
            isPending={approveUser.isPending}
            error={approveUser.error?.message}
            onCancel={() => setApproving(null)}
            onSubmit={(body) =>
              approveUser.mutate(
                { id: approving.id, ...body },
                {
                  // The mutation invalidates the whole `['admin']` subtree, so
                  // the bell refetches and the row leaves on its own - there is
                  // nothing to patch by hand here.
                  onSuccess: () => setApproving(null),
                },
              )
            }
          />
        )}
      </Modal>
    </div>
  );
}

export default NotificationMenu;
