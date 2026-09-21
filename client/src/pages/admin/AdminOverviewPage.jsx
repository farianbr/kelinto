import { useState } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Building2,
  Check,
  Clock,
  FileText,
  Mail,
  Package,
  Phone,
  Plus,
  Receipt,
  Tablet,
  TrendingUp,
  Trophy,
  Truck,
  Undo2,
  UserCheck,
  Wallet,
  Wrench,
} from 'lucide-react';
import cn from '@/lib/cn';
import {
  money,
  moneyCompact,
  moneyAxis,
  date,
  relativeTime,
  count as formatCount,
} from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { OrderStatusBadge, InvoiceStatusBadge } from '@/components/account/OrderStatusBadge';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import DateRangeBar, {
  DASHBOARD_PRESETS,
  useDateRange,
  rangeLabel,
} from '@/components/admin/DateRangeBar';
import { TrendChart, BarList } from '@/components/admin/charts/Charts';
import ApproveClientForm from '@/components/admin/ApproveClientForm';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { featureEnabled } from '@shared/schemas/features';
import { useAuth } from '@/hooks/useAuth';
import { businessUrl } from '@/store/businessStore';

import { useAdminStats, useAdminMutations, useAdminSettings } from '@/hooks/useAdmin';
import { pressable, pressableSurface } from '@/lib/motion';

/**
 * Header metadata read from the same table the breadcrumb uses, so a page
 * title can never drift from its crumb.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin'], icon: adminIcon('Home') };

/**
 * One row of "this needs doing", with the count and a link to the filtered list.
 *
 * A card renders **only when its count is non-zero** (ERP rework §6.1.3). An
 * empty board is a good day and should say so, not show four zeroes - four
 * zeroes teach a staff member to stop reading the section.
 */
function TodoCard({ icon: Icon, tone, title, body, to, onClick, cta }) {
  const tones = {
    warn: 'border-warn/30 bg-warn-50 text-warn',
    danger: 'border-danger/25 bg-danger-50 text-danger',
    info: 'border-info/25 bg-info-50 text-info',
  };

  // Most cards go somewhere; one of them opens the work in place. Both are the
  // same object to the staff member - a thing that needs doing, clicked - so they
  // render identically and differ only in the element underneath.
  const Shell = onClick ? 'button' : Link;
  const shellProps = onClick ? { type: 'button', onClick } : { to };

  return (
    <Shell
      {...shellProps}
      // A wide card, so the softened press - same reason as the order rows.
      className={cn(
        pressableSurface,
        'group flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-3.5 text-left hover:border-line-strong',
      )}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-md border ${tones[tone]}`}
      >
        <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-md font-semibold text-ink-900">{title}</span>
        <span className="block text-sm text-ink-500">{body}</span>
      </span>

      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-brand">
        {cta}
        <ArrowRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
          strokeWidth={2.25}
          aria-hidden="true"
        />
      </span>
    </Shell>
  );
}

/**
 * Where an audit row points.
 *
 * The feed is only useful if a line is a way *in* to the thing it describes
 * "Reversed a payment on INV-2026-10049" that cannot be clicked leaves the
 * staff member to go and find that invoice by hand, which is most of the work the
 * line just saved them.
 *
 * Driven by `entity`, which the audit row already carries, rather than by
 * parsing the description text: the description is prose written for a human
 * and would break the routing the first time somebody reworded it.
 *
 * An entity with no screen of its own (`settings`, `role`, `session`) returns
 * null and renders as a plain row rather than a link that goes nowhere.
 */
function activityHref(entity) {
  if (!entity?.kind) return null;
  const id = entity.id?.trim();

  switch (entity.kind) {
    case 'invoice':
      return id ? `/admin/invoices/${id}` : '/admin/invoices';
    case 'order':
      return id ? `/admin/orders/${id}` : '/admin/orders';
    case 'user':
      return id ? `/admin/clients/${id}` : '/admin/clients';
    case 'supplier':
      return id ? `/admin/suppliers/${id}` : '/admin/suppliers';
    case 'product':
      // The catalogue lives under `inventory`; there is no `/admin/products`.
      return id ? `/admin/inventory/${id}` : '/admin/inventory';
    case 'quote':
      return '/admin/quotes';
    case 'rma':
      return '/admin/rma';
    case 'expense':
      return '/admin/expenses';
    case 'purchaseOrder':
      return '/admin/purchase-orders';
    case 'offer':
      return '/admin/marketing/offers';
    case 'business':
      return '/admin/businesses';
    // campaign, staff, role, settings, referral, storeCredit, session,
    // taxonomy and invoiceStatusRule have no per-record screen to open.
    default:
      return null;
  }
}

/** The glyph that says what KIND of thing happened, without reading the line. */
function activityIcon(entity) {
  switch (entity?.kind) {
    case 'invoice':
      return Receipt;
    case 'order':
      return Package;
    case 'user':
    case 'staff':
      return Building2;
    case 'product':
      return Boxes;
    case 'supplier':
    case 'purchaseOrder':
      return Truck;
    case 'storeCredit':
    case 'referral':
      return Wallet;
    case 'rma':
      return Undo2;
    default:
      return Activity;
  }
}

/**
 * A recent order, read without leaving the dashboard.
 *
 * `stats` already returns the whole serialised order - lines, totals, address,
 * status - so the preview needs no second request and opens instantly. It is
 * deliberately **read-only**: changing a status is the order screen's job, and
 * the footer link goes there rather than growing a second place that edits an
 * order.
 */
function OrderPreview({ order, onClose }) {
  if (!order) return null;

  const lines = order.items ?? [];

  return (
    <Modal
      open={Boolean(order)}
      onClose={onClose}
      title={order.orderNumber}
      description={`${order.displayName ?? order.businessName} · ${date(order.createdAt)}`}
      size="md"
      align="top"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={order.status} size="sm" />
          {order.payment?.status && (
            <Badge tone={order.payment.status === 'paid' ? 'ok' : 'warn'} size="sm">
              {order.payment.status === 'paid' ? 'Paid' : titleCase(order.payment.status)}
            </Badge>
          )}
          {order.poNumber && (
            <span className="text-xs text-ink-400">PO {order.poNumber}</span>
          )}
        </div>

        {lines.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line">
            {lines.map((item, index) => (
              <li
                key={item.sku ?? item.product ?? index}
                className="flex items-center gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{item.name}</p>
                  {item.sku && <p className="font-mono text-2xs text-ink-300">{item.sku}</p>}
                </div>

                <p className="tnum shrink-0 text-xs text-ink-500">×{formatCount(item.qty)}</p>
                {/* `lineTotal` is the server's own figure, not qty × unitPrice
                    recomputed here - the client never does money arithmetic. */}
                <p className="tnum w-20 shrink-0 text-right text-sm font-semibold text-ink-900">
                  {money(item.lineTotal)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {/* Totals repeat the server's stored figures - nothing is recomputed
            here, so the preview can never disagree with the order. */}
        <dl className="space-y-1.5 text-sm">
          <Row label="Subtotal" value={money(order.subtotal)} />
          {order.discount > 0 && (
            <Row label="Discount" value={`−${money(order.discount)}`} tone="ok" />
          )}
          {order.storeCreditApplied > 0 && (
            <Row label="Store credit" value={`−${money(order.storeCreditApplied)}`} tone="ok" />
          )}
          <Row label="Shipping" value={money(order.shipping)} />
          <Row label="Tax" value={money(order.tax)} />
          <div className="flex items-baseline justify-between border-t border-line pt-1.5">
            <dt className="font-display text-md font-bold text-ink-900">Total</dt>
            <dd className="tnum font-display text-lg font-bold text-ink-900">
              {money(order.total)}
            </dd>
          </div>
        </dl>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Link to={`/admin/orders/${order.orderNumber}`}>
            <Button icon={ArrowUpRight}>Open order</Button>
          </Link>
        </div>
      </div>
    </Modal>
  );
}

/** One totals line. Kept local: nothing outside this preview needs it. */
function Row({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd className={cn('tnum font-medium', tone === 'ok' ? 'text-ok' : 'text-ink-900')}>
        {value}
      </dd>
    </div>
  );
}

/** Up to two initials for the avatar. `-` for a name that is somehow empty. */
function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '-';
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('');
}

/**
 * The approvals queue, as a dialog.
 *
 * **Why a dialog and not a section.** A pending account is a decision, and a
 * decision is a thing you sit down to - the staff member opens it, works the list,
 * and closes it. As a panel it sat permanently on a screen that is otherwise
 * for reading, taking the most vertical space of anything on the page while
 * usually holding two or three rows, and on a quiet day it vanished entirely
 * and left a hole in the layout. The card in "things to do today" already
 * announces the work; this is where the work happens.
 *
 * **It is a queue, so it is ordered and it states its age.** Oldest first, and
 * every row says how long it has been waiting, because the failure mode here is
 * not a wrong decision - it is an account nobody looked at. A row past a week
 * carries a warn badge for the same reason.
 *
 * The row is deliberately not a form. Approving sets a credit limit and terms,
 * which is `ApproveClientForm`'s job and the same form the notification bell
 * opens; this hands off to it rather than growing a second, thinner approval
 * path that forgets the terms.
 */
function ApprovalsQueueModal({ open, onClose, accounts, onApprove }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Approvals queue"
      description={
        accounts.length === 1
          ? 'One business is waiting. It cannot see pricing or place an order until you approve it.'
          : `${accounts.length} businesses are waiting. They cannot see pricing or place an order until approved.`
      }
      size="lg"
      align="top"
      bodyClassName="p-0"
      footer={
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/admin/approvals"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
            onClick={onClose}
          >
            Open the full queue
            <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          </Link>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {accounts.length === 0 ? (
        <PanelEmpty
          icon={UserCheck}
          title="Nothing waiting"
          body="Every business that has registered has been reviewed."
        />
      ) : (
        <ul className="divide-y divide-line">
          {accounts.map((account) => {
            // Days waiting, floored: "waiting 8 days" is the fact that makes
            // somebody act, and it is the one thing a name-only row omits.
            const waitingDays = Math.floor(
              (Date.now() - new Date(account.createdAt).getTime()) / 86_400_000,
            );
            const stale = waitingDays >= 7;
            const name = account.displayName ?? account.businessName ?? account.email;

            return (
              <li key={account.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-50 font-display text-sm font-bold text-brand-700"
                  aria-hidden="true"
                >
                  {initials(name)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/admin/clients/${account.id}`}
                      onClick={onClose}
                      className="truncate font-display text-md font-bold text-ink-900 hover:text-brand"
                    >
                      {name}
                    </Link>
                    {stale && (
                      <Badge tone="warn" size="sm">
                        {waitingDays}d waiting
                      </Badge>
                    )}
                  </div>

                  {/* The company, then how to reach them. The name above is the
                      person, so this is the half the title does not carry. */}
                  {account.businessName && account.businessName !== name && (
                    <p className="truncate text-xs text-ink-500">{account.businessName}</p>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Mail className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                      <span className="truncate">{account.email}</span>
                    </span>
                    {account.phone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                        {account.phone}
                      </span>
                    )}
                    <span className={cn('inline-flex items-center gap-1.5', stale && 'text-warn')}>
                      <Clock className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                      {waitingDays === 0
                        ? 'Registered today'
                        : `Waiting ${waitingDays} ${waitingDays === 1 ? 'day' : 'days'}`}
                      {account.businessType && ` · ${account.businessType}`}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Link to={`/admin/clients/${account.id}`} onClick={onClose}>
                    <Button size="xs" variant="outline">
                      View
                    </Button>
                  </Link>
                  <Button size="xs" icon={Check} onClick={() => onApprove(account)}>
                    Approve
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

/** `awaiting_payment` reads as `Awaiting payment` on a badge. */
function titleCase(value) {
  const spaced = String(value).replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function AdminOverviewPage() {
  const { user, features } = useAuth();

  /**
   * Whether this business sells goods at all.
   *
   * The to-do cards above are count-gated and so look after themselves - a
   * service business has no orders, so "Fulfil orders" never fires. The panels
   * below are not: "Recent orders" would sit there permanently empty, pointing
   * at a route that now answers 404 for this business, which reads as a broken
   * screen rather than as a section this business does not have.
   */
  const hasOrders = !features || featureEnabled(features, 'sales.orders');

  /**
   * The check-in tablet, if this business has one.
   *
   * The kiosk lives at `/kiosk`, outside the panel, so there is nowhere else
   * in the admin a staff member could find it - a tablet being set up on a
   * counter is opened from the machine it will run on, and until this link
   * existed that meant knowing a URL nobody had been told.
   *
   * Shown only when the business has the feature AND the kiosk is actually
   * live: a button that opens a lock screen refusing every PIN is worse than
   * no button, because it reads as a broken tablet rather than as setup that
   * has not been finished. Settings is where that gets finished, and the link
   * points there instead while it is unfinished.
   */
  const hasKiosk = features ? featureEnabled(features, 'sales.kiosk') : false;
  const { data: settings } = useAdminSettings();
  const kioskLive = Boolean(settings?.kiosk?.isEnabled) && Boolean(settings?.kiosk?.hasPin);
  // The range lives in the URL, so the whole dashboard is linkable (§6.1.2).
  const range = useDateRange('this-month');
  // Every figure below states the period it covers. A filtered dashboard that
  // looks identical to an unfiltered one invites the numbers to be read as
  // all-time, which is the one thing they are not.
  const period = rangeLabel(range, DASHBOARD_PRESETS);
  const { data, isLoading } = useAdminStats(range);

  const [previewing, setPreviewing] = useState(null);
  const [approving, setApproving] = useState(null);
  const [queueOpen, setQueueOpen] = useState(false);
  // The same mutation the approvals queue and the notification bell use
  // approving from here is the identical act, so it must not be a second path.
  const { approveUser } = useAdminMutations();

  // The weekday is worth keeping in a greeting; the date itself is the same
  // `DD-MMM-YY` every other date in the panel uses.
  const now = new Date();
  const today = `${now.toLocaleDateString('en-CA', { weekday: 'long' })}, ${date(now)}`;

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-72" />
        <Skeleton className="h-24" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const {
    users,
    orders,
    invoiced,
    collected,
    receivables,
    inventory,
    trend,
    topClients,
    recentOrders,
    recentInvoices,
    recentActivity,
    pendingQueue,
    lowStockItems,
  } = data;

  const todos = [
    users.pending > 0 && {
      key: 'approve',
      icon: UserCheck,
      tone: 'warn',
      title: 'Approve accounts',
      body: `${formatCount(users.pending)} ${users.pending === 1 ? 'business is' : 'businesses are'} waiting for approval`,
      // Opens the queue in place rather than leaving the dashboard: approving
      // is a short decision, and a round trip to another screen and back for
      // each of three accounts is the slow way to make it.
      onClick: () => setQueueOpen(true),
      cta: 'Review',
    },
    orders.awaitingFulfilment > 0 && {
      key: 'fulfil',
      icon: Package,
      tone: 'info',
      title: 'Fulfil orders',
      body: `${formatCount(orders.awaitingFulfilment)} placed and not yet shipped`,
      // `unfulfilled`, not `placed`: the body counts placed AND processing.
      to: '/admin/orders?status=unfulfilled',
      cta: 'Open',
    },
    inventory.lowStock + inventory.outOfStock > 0 && {
      key: 'restock',
      icon: Boxes,
      tone: inventory.outOfStock > 0 ? 'danger' : 'warn',
      title: 'Restock inventory',
      body:
        inventory.outOfStock > 0
          ? `${formatCount(inventory.outOfStock)} out of stock · ${formatCount(inventory.lowStock)} running low`
          : `${formatCount(inventory.lowStock)} at or below the reorder point`,
      // Out of stock first when there is any, because that is the half the
      // card leads with and the more urgent one - a zero-stock part is a sale
      // being refused right now. It also has to be this way round: `stock=low`
      // is `> 0`, so a card announcing "53 out of stock" linked to the one
      // filter that excludes all 53.
      to:
        inventory.outOfStock > 0
          ? '/admin/inventory?stock=out'
          : '/admin/inventory?stock=low',
      cta: 'Review',
    },
    receivables.overdue > 0 && {
      key: 'chase',
      icon: Wallet,
      tone: 'danger',
      title: 'Chase receivables',
      body: `${money(receivables.overdue)} overdue across ${formatCount(receivables.overdueCount)} ${receivables.overdueCount === 1 ? 'invoice' : 'invoices'}`,
      to: '/admin/invoices?status=overdue',
      cta: 'Open',
    },
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={`${today} · Welcome back, ${user?.contactName ?? 'there'}.`}
        // The two things a staff member starts from this screen. Both are the
        // real entry points rather than dashboard-only copies: the ticket link
        // is the same route the tickets screen uses, and `?new=1` is the
        // established convention for opening a create modal on arrival
        // (`useCreateParam`), so the invoice form is the one form.
        //
        // Invoice leads and takes the solid button: billing is the more
        // frequent act, and one primary is the whole point of a primary.
        action={
          <>
            {/* `sm`, not the default `md`: at h-11 the pair sat as tall as
                the page title and read as the loudest thing on the screen,
                which a secondary shortcut should not be. */}
            <Link to="/admin/invoices?new=1">
              <Button size="sm" icon={Plus}>
                New invoice
              </Button>
            </Link>
            <Link to="/admin/tickets/new">
              <Button size="sm" variant="outline" icon={Wrench}>
                New ticket
              </Button>
            </Link>
            {/* The third shortcut is not a form: it opens the customer-facing
                tablet, which lives outside this panel and has no other door
                into it. A new tab rather than a navigation - the kiosk fills
                the viewport and deliberately offers no way back. */}
            {hasKiosk && kioskLive && (
              <a href={businessUrl('/kiosk')} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline" icon={Tablet}>
                  Open kiosk
                </Button>
              </a>
            )}
            {hasKiosk && !kioskLive && (
              <Link to="/admin/settings/kiosk">
                <Button size="sm" variant="outline" icon={Tablet}>
                  Set up kiosk
                </Button>
              </Link>
            )}
          </>
        }
      />

      <DateRangeBar presets={DASHBOARD_PRESETS} defaultPreset="this-month" />

      {/* ---- things to do today ------------------------------------------- */}
      {/* The column count follows the card count so the row is never ragged.
          Three cards in a two-column grid strand the third at half width with a
          gap beside it, which reads as a card that failed to load rather than
          as a deliberate layout. */}
      {todos.length > 0 ? (
        <section
          aria-label="Things to do today"
          className={cn(
            'grid gap-3',
            todos.length === 1 && 'lg:grid-cols-1',
            todos.length === 2 && 'lg:grid-cols-2',
            todos.length === 3 && 'lg:grid-cols-3',
            todos.length >= 4 && 'lg:grid-cols-2',
          )}
        >
          {todos.map(({ key, ...card }) => (
            <TodoCard key={key} {...card} />
          ))}
        </section>
      ) : (
        <p className="rounded-lg border border-ok/25 bg-ok-50 px-4 py-3 text-sm text-ok">
          Nothing needs attention: every account is reviewed, every order is moving, stock is
          healthy and no invoice is overdue.
        </p>
      )}

      {/* ---- the headline figures ------------------------------------------
          Collected and Invoiced are named separately and never collapsed into
          one word called "revenue" (§9.1). Outstanding and Inventory are
          positions as of today rather than flows through the range, and their
          hints say so.

          Every tile carries `to`, and each one lands on the list **filtered to
          the figure it just showed** rather than the section's front page - a
          tile reading "3 overdue" that opens all invoices makes the staff member
          re-find the three they clicked for. */}
      <KpiRow
        tiles={[
          {
            key: 'collected',
            label: 'Collected',
            value: money(collected.total),
            // A reversal is stored as a negative payment row, so a period whose
            // refunds outweigh its receipts collects a negative amount. That is
            // real and correct, but it must not render as an ordinary figure
            // money leaving is exactly the case the value colour exists for.
            meta: period,
            hint:
              collected.total < 0
                ? 'Reversals exceeded payments'
                : 'Payments received',
            tone: collected.total < 0 ? 'danger' : 'ok',
            icon: Wallet,
            delta: collected.deltaPercent,
            goodWhen: 'up',
            to: '/admin/invoices?status=paid',
          },
          {
            key: 'invoiced',
            label: 'Invoiced',
            value: money(invoiced.total),
            meta: period,
            hint: `${formatCount(invoiced.count)} ${invoiced.count === 1 ? 'invoice' : 'invoices'} issued`,
            tone: 'brand',
            icon: Receipt,
            to: '/admin/invoices',
          },
          {
            key: 'outstanding',
            // "Due Amount" rather than "Outstanding": it is what the staff member
            // says out loud, and it reads as money owed without the accounting
            // register.
            label: 'Due Amount',
            value: money(receivables.outstanding),
            // The COUNT, not the overdue figure. Overdue already has a card of
            // its own in "Chase receivables" above, and stating it twice made
            // the more urgent number look like a footnote to the calmer one.
            // How many invoices make up the balance is the thing this tile
            // could say and nothing else does.
            //
            // Receivables are a position as of now rather than a flow through
            // the range, so the hint says so - a tile in a dated row otherwise
            // reads as belonging to that date.
            hint:
              receivables.count > 0
                ? `${formatCount(receivables.count)} ${receivables.count === 1 ? 'invoice' : 'invoices'} unpaid · as of today`
                : 'Nothing unpaid · as of today',
            tone: receivables.overdue > 0 ? 'danger' : 'info',
            icon: Wallet,
            to: '/admin/invoices?status=unpaid',
          },
          {
            key: 'orders',
            label: 'Open orders',
            value: formatCount(orders.open),
            hint: `${formatCount(orders.awaitingFulfilment)} awaiting fulfilment`,
            tone: 'info',
            icon: Package,
            // `open`, not `placed`: the value counts four statuses, so linking
            // to one of them showed a list that contradicted the number.
            to: '/admin/orders?status=open',
          },
          {
            key: 'clients',
            // "Customers" everywhere the staff member reads it - the sidebar
            // already says so, and the route keeping `clients` is an internal
            // detail that should not surface as a second word for one thing.
            label: 'Customers',
            value: formatCount(users.total),
            hint: `${formatCount(users.approved)} approved · ${formatCount(users.pending)} pending`,
            tone: 'info',
            icon: Building2,
            to: '/admin/clients',
          },
          {
            key: 'inventory',
            label: 'Inventory',
            // Also a position rather than a flow, like Outstanding above.
            value: moneyCompact(inventory.value),
            hint: `Value of ${formatCount(inventory.total)} SKUs · as of today`,
            tone: 'info',
            icon: Boxes,
            to: '/admin/inventory',
          },
        ]}
      />

      {/* ---- trend and top clients ---------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          icon={TrendingUp}
          title="Order value"
          meta={period}
          description={`By ${data.range?.bucket === 'week' ? 'week' : 'day'}, cancelled orders excluded`}
        >
          <TrendChart
            points={trend}
            caption="Order value over the selected period"
            seriesLabel="Order value"
            // The tooltip shows the exact figure; the axis and the peak/low
            // line round, because a tick column is read as a scale rather than
            // as a set of values.
            formatValue={money}
            formatTick={moneyAxis}
          />
        </Panel>

        <Panel
          icon={Trophy}
          title="Top customers"
          meta={period}
          description="By invoiced value"
        >
          {topClients.length === 0 ? (
            <PanelEmpty
              icon={Building2}
              title="Nothing invoiced"
              body={`No invoices were issued in ${period.toLowerCase()}.`}
            />
          ) : (
            <BarList
              items={topClients.map((client) => ({
                // The person, not the company - a sole trader has no
                // business name and would render as a blank bar label.
                label: client.displayName ?? client.businessName,
                value: client.total,
                hint: `${formatCount(client.invoices)} ${client.invoices === 1 ? 'invoice' : 'invoices'}`,
                // "Who is my biggest account" is a question the staff member asks
                // in order to go and look at that account.
                to: `/admin/clients/${client.id}`,
              }))}
              caption="Top customers by invoiced value"
              formatValue={money}
              rank
              // Share of the top-five total, not of all invoicing - the panel
              // says "Top clients", so that is the whole this reads against.
              showShare
            />
          )}
        </Panel>
      </div>

      {/* ---- recent orders and low stock ---------------------------------- */}
      <div className={cn('grid gap-4', hasOrders && 'lg:grid-cols-2')}>
        {hasOrders && (
        <Panel
          icon={Package}
          title="Recent orders"
          action={
            <Link
              to="/admin/orders"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
            >
              All orders
              <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            </Link>
          }
          flush={recentOrders.length > 0}
        >
          {recentOrders.length === 0 ? (
            <PanelEmpty icon={Package} title="No orders yet" />
          ) : (
            /* A row opens the preview rather than navigating: glancing at what
               is in an order is the common act, and bouncing to a full screen
               and back for each of six orders is the slow way to do it. The
               preview's footer navigates for the times it is warranted. */
            <ul className="divide-y divide-line">
              {recentOrders.map((order) => (
                <li key={order.orderNumber}>
                  <button
                    type="button"
                    onClick={() => setPreviewing(order)}
                    // `pressableSurface`, not `pressable`: a full-width row
                    // scaled by 3% visibly lurches and drags its neighbours'
                    // alignment with it. 0.5% reads as a press without the row
                    // appearing to jump out of the list.
                    className={cn(
                      pressableSurface,
                      'group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2 sm:px-5',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-nowrap font-mono text-sm font-medium text-ink-900">
                        {order.orderNumber}
                      </p>
                      <p className="truncate text-xs text-ink-500">
                        {order.displayName ?? order.businessName}
                      </p>
                    </div>

                    <p className="hidden text-xs text-ink-400 sm:block">
                      {date(order.createdAt)}
                    </p>
                    <OrderStatusBadge status={order.status} size="sm" />

                    <p className="tnum w-20 shrink-0 text-right font-display text-sm font-bold">
                      {money(order.total)}
                    </p>

                    <ArrowUpRight
                      // `group-hover` is gated behind a pointer query
                      // globally (styles/index.css), so no extra guard here.
                      className="size-3.5 shrink-0 text-ink-300 opacity-0 transition-opacity duration-fast ease-entrance group-hover:opacity-100"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        )}

        {/* Inventory is not gated: a repair shop holds parts, counts them and
            runs out of them exactly as a wholesaler does. What differs is
            whether those parts are sold as goods or fitted to a job. */}
        <Panel
          icon={AlertTriangle}
          title="Low stock"
          description={`${formatCount(inventory.lowStock)} low · ${formatCount(inventory.outOfStock)} out · ${money(inventory.value)} on hand`}
          action={
            <Link
              to={
                inventory.outOfStock > 0
                  ? '/admin/inventory?stock=out'
                  : '/admin/inventory?stock=low'
              }
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
            >
              Review stock
              <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            </Link>
          }
          flush={lowStockItems.length > 0}
        >
          {lowStockItems.length === 0 ? (
            <PanelEmpty
              icon={AlertTriangle}
              title="Stock is healthy"
              body="Nothing is at or below the reorder point."
            />
          ) : (
            <ul className="divide-y divide-line">
              {lowStockItems.map((product) => (
                <li key={product.id}>
                  {/* Clickable like every other feed row: the answer to "this
                      is low" is to open the product and reorder it. */}
                  <Link
                    to={`/admin/inventory/${product.id}`}
                    className={cn(
                      pressableSurface,
                      'group flex w-full items-center gap-3 px-4 py-2.5 hover:bg-surface-2 sm:px-5',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {product.name}
                      </p>
                      <p className="font-mono text-2xs text-ink-300">{product.sku}</p>
                    </div>

                    <p
                      className={`tnum w-20 shrink-0 text-right text-sm font-semibold ${
                        product.stock === 0 ? 'text-danger' : 'text-warn'
                      }`}
                    >
                      {product.stock === 0 ? 'Out of stock' : `${formatCount(product.stock)} left`}
                    </p>

                    <ArrowUpRight
                      className="size-3.5 shrink-0 text-ink-300 opacity-0 transition-opacity duration-fast ease-entrance group-hover:opacity-100"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ---- recent invoices and activity ---------------------------------

          Both are **feeds**, and both are read the same way: newest first, one
          line each, every line a way into the record it names. A feed whose
          rows cannot be clicked is a list of things to go and find manually.

          They are deliberately unranged, unlike the tiles above. "Recent"
          answers "what has been happening", and a date filter would empty the
          panel on any range with no activity in it - a blank feed reads as a
          broken panel, not as an accurate report of a quiet fortnight. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          icon={Receipt}
          title="Recent invoices"
          action={
            <Link
              to="/admin/invoices"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
            >
              All invoices
              <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            </Link>
          }
          flush={recentInvoices.length > 0}
        >
          {recentInvoices.length === 0 ? (
            <PanelEmpty
              icon={Receipt}
              title="Nothing invoiced yet"
              body="Invoices raised against an account will appear here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentInvoices.map((invoice) => (
                <li key={invoice.number}>
                  <Link
                    to={`/admin/invoices/${invoice.number}`}
                    className={cn(
                      pressableSurface,
                      'group flex w-full items-center gap-3 px-4 py-2.5 hover:bg-surface-2 sm:px-5',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-nowrap font-mono text-sm font-medium text-ink-900">
                        {invoice.number}
                      </p>
                      <p className="truncate text-xs text-ink-500">{invoice.displayName}</p>
                    </div>

                    <p className="hidden text-xs text-ink-400 sm:block">
                      {date(invoice.issuedAt)}
                    </p>
                    <InvoiceStatusBadge status={invoice.status} size="sm" />

                    <p className="tnum w-20 shrink-0 text-right font-display text-sm font-bold">
                      {money(invoice.amount)}
                    </p>

                    <ArrowUpRight
                      className="size-3.5 shrink-0 text-ink-300 opacity-0 transition-opacity duration-fast ease-entrance group-hover:opacity-100"
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          icon={Activity}
          title="Recent activity"
          description="What staff changed, newest first"
          flush={recentActivity.length > 0}
        >
          {recentActivity.length === 0 ? (
            <PanelEmpty
              icon={Activity}
              title="Nothing logged yet"
              body="Edits to orders, invoices and accounts are recorded here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentActivity.map((row) => {
                const href = activityHref(row.entity);
                const Icon = activityIcon(row.entity);

                // The row's inner markup is identical either way; only the
                // wrapper differs. An entity with no screen must not render as
                // a link that goes nowhere.
                const body = (
                  <>
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-500">
                      <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-900">
                        {row.description || row.action}
                      </span>
                      <span className="block truncate text-xs text-ink-400">
                        {row.actorName || 'System'} · {relativeTime(row.at)}
                      </span>
                    </span>

                    {href && (
                      <ArrowUpRight
                        className="mt-0.5 size-3.5 shrink-0 text-ink-300 opacity-0 transition-opacity duration-fast ease-entrance group-hover:opacity-100"
                        strokeWidth={2.25}
                        aria-hidden="true"
                      />
                    )}
                  </>
                );

                return (
                  <li key={row.id}>
                    {href ? (
                      <Link
                        to={href}
                        className={cn(
                          pressableSurface,
                          'group flex w-full items-start gap-2.5 px-4 py-2.5 hover:bg-surface-2 sm:px-5',
                        )}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex w-full items-start gap-2.5 px-4 py-2.5 sm:px-5">
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <OrderPreview order={previewing} onClose={() => setPreviewing(null)} />

      <ApprovalsQueueModal
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        accounts={pendingQueue}
        onApprove={(account) => {
          // The queue steps aside for the form rather than stacking two
          // dialogs: the staff member is answering one question at a time, and a
          // dialog over a dialog is where a modal stops feeling designed.
          setQueueOpen(false);
          setApproving(account);
        }}
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
                // The mutation invalidates the whole `['admin']` subtree, so the
                // dashboard refetches and the card leaves on its own.
                { onSuccess: () => setApproving(null) },
              )
            }
          />
        )}
      </Modal>
    </div>
  );
}

export default AdminOverviewPage;
