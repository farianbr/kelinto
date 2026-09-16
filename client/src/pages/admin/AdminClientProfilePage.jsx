import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Eye,
  FileSignature,
  FileText,
  Globe,
  Check,
  Copy,
  Gift,
  History,
  Link2,
  Mail,
  MessageCircle,
  Package,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RotateCcw,
  Undo2,
  UserRound,
  Wallet,
  WalletCards,
  Wrench,
  XCircle,
} from 'lucide-react';
import cn from '@/lib/cn';
import { apiUrl } from '@/lib/api';
import { toast } from '@/store/toastStore';
import { money, date, dateTime, relativeTime, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ApproveClientForm from '@/components/admin/ApproveClientForm';
import { RejectForm } from '@/pages/admin/AdminApprovalsPage';
import Skeleton from '@/components/ui/Skeleton';
import SelectMenu from '@/components/ui/SelectMenu';
import { OrderStatusBadge, InvoiceStatusBadge } from '@/components/account/OrderStatusBadge';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import {
  CreditForm,
  CreditRepaymentForm,
  StoreCreditPanel,
  STATUS_TONES,
} from '@/components/admin/ClientDetail';
import {
  ConsentPanel,
  TierPanel,
  NotesPanel,
  ConversationsPanel,
  ReferralPanel,
} from '@/components/admin/CustomerCrm';
import { MEMBERSHIP_TIERS } from '@shared/schemas/admin';
import { featureEnabled } from '@shared/schemas/features';
import { useAuth } from '@/hooks/useAuth';
import CustomerPortalLink from '@/components/admin/CustomerPortalLink';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import TabRow from '@/components/ui/TabRow';
import { pressable } from '@/lib/motion';
import {
  useAdminUser,
  useAdminUserActivity,
  useAdminUserPayments,
  useEmailCustomerPortalLink,
  useAdminMutations,
  useMarketingMessages,
  useAdminSettings,
  useAdminTickets,
  useAdminQuotes,
  useAdminWebQuotes,
  useAdminRmas,
} from '@/hooks/useAdmin';


/**
 * The tab lives in the URL so a colleague can be sent straight to the credit
 * ledger rather than "open the client, then click Credit" (§4, one canonical
 * URL per screen).
 */
/**
 * **A tab is a feature, and the same registry decides both.**
 *
 * A repair shop's customer has no Orders and no Returns; a wholesaler's has no
 * Tickets. Hard-coding one list and hiding rows by business type would put a
 * second, parallel answer to "which sections exist" beside the one in
 * `shared/schemas/features.js`, and the two would disagree the first time a
 * super admin flipped a switch. So every divergent tab names its feature key
 * and `visibleTabs` asks the registry - which means a `both` business gets the
 * union for free, and an override is honoured here exactly as it is in the nav.
 *
 * A tab with no `feature` is unconditional: every business has a customer, a
 * conversation with them, and a history of both.
 */
const TABS = [
  // Overview is a **summary of every other tab**, not a tab of its own content:
  // each panel on it shows the first few rows and links to the tab that owns
  // them. A staff member opening a customer wants the shape of the relationship
  // before they want any one part of it.
  { key: 'overview', label: 'Overview', icon: UserRound },
  /**
   * Tickets, with **Conversations folded into it**.
   *
   * Conversations was its own tab, which put the record of a repair and the
   * record of talking about that repair on opposite sides of the tab strip.
   * A contact log is almost always *about* a job, so it now sits under the
   * tickets it belongs to and the strip loses a top-level entry that was only
   * ever read after a ticket anyway.
   */
  { key: 'tickets', label: 'Tickets', icon: Wrench, feature: 'sales.tickets' },
  { key: 'orders', label: 'Orders', icon: Package, feature: 'sales.orders' },
  { key: 'invoices', label: 'Invoices', icon: Receipt },
  /**
   * The line of credit - what the business lends this customer.
   *
   * Follows Orders rather than standing alone: terms are what a wholesale buyer
   * is given against goods on account, and a repair shop that takes payment at
   * the counter has nothing to lend against. **Store credit is the other
   * instrument and is not gated with it** - a refund puts money on a repair
   * customer's account exactly as it does a wholesaler's, so it moves to
   * Payments below, where a service business can still see it.
   */
  { key: 'credit', label: 'Credit', icon: WalletCards, feature: 'sales.orders' },
  { key: 'quotes', label: 'Quotes', icon: FileSignature, feature: 'sales.quotes' },
  // Enquiries this account sent through the website's contact form. Only ever
  // populated for a customer who was signed in when they submitted.
  { key: 'web-quotes', label: 'Web Quotes', icon: Globe, feature: 'sales.webquotes' },
  { key: 'rmas', label: 'Returns', icon: RotateCcw, feature: 'sales.rma' },
  /**
   * What has actually been collected, across every invoice.
   *
   * A product business reads this off Credit, where the terms and the ledger
   * sit together. A service business has no line of credit, so without this it
   * had nowhere at all to answer "has this customer paid us" - the invoices
   * list says what is owed, not what arrived. Unconditional for that reason:
   * every business takes money, and every business is asked that question.
   */
  { key: 'payments', label: 'Payments', icon: Wallet },
  /**
   * Notes, and the terms of the relationship, **as tabs**.
   *
   * Both are summarised on Overview for every business, and for a service
   * business that summary is the whole of it: a repair counter's relationship
   * with a walk-in is one screen's worth of facts, and a tab strip that spends
   * two of its entries on a note field and a referral code pushes the tickets
   * and the invoices - the reason anybody opened the customer - further away.
   *
   * Gated on `sales.orders` because that is the flag that actually means
   * "this business sells goods on an account", which is the relationship these
   * two describe. They are not about orders, and the key is doing duty as a
   * product marker rather than naming what it gates; that is a seam worth
   * remembering if a service business ever asks for them back, because the
   * honest fix then is a key of their own rather than a second meaning here.
   */
  { key: 'notes', label: 'Notes', icon: FileText, feature: 'sales.orders' },
  { key: 'membership', label: 'Referral & Membership', icon: Gift, feature: 'sales.orders' },
  { key: 'activity', label: 'Activity', icon: History },
];

/**
 * The tabs this business actually has.
 *
 * `features` is null until `/auth/me` resolves and for any account that is not
 * staff. **Null means show everything**, matching `visibleNav`: defaulting to
 * "off" would blank the strip on every first paint and read as a bug rather
 * than as a setting.
 */
function visibleTabs(features) {
  if (!features) return TABS;
  return TABS.filter((item) => !item.feature || featureEnabled(features, item.feature));
}

/**
 * The warranty bonus a tier carries, in days.
 *
 * Read per tier rather than for the current one, so the membership select can
 * label every option with what choosing it would do - "Silver · 90d warranty"
 * answers the question the select is being asked.
 */
function tierBonusFor(settings, tier) {
  return settings?.financial?.warrantyBonusByTier?.[tier] ?? 0;
}

/** Icon and tone per activity kind, so a ledger of forty rows is scannable. */
const ACTIVITY_STYLE = {
  order: { icon: Package, tone: 'text-info' },
  'order-status': { icon: ArrowRight, tone: 'text-ink-400' },
  invoice: { icon: Receipt, tone: 'text-brand' },
  payment: { icon: Wallet, tone: 'text-ok' },
  void: { icon: Undo2, tone: 'text-warn' },
  credit: { icon: WalletCards, tone: 'text-ok' },
};

/** Tier badge tones. Mirrors `CustomerCrm`'s `TierPanel` and the customers list. */
const TIER_TONE = { standard: 'neutral', silver: 'info', gold: 'warn', platinum: 'brand' };

/**
 * The header tiles are deliberately uniform.
 *
 * Colouring each one by meaning made the row shout: eight washes, eight chips
 * and eight hairlines is a lot of signal for a set of figures somebody scans
 * once. The plain treatment the counts already used - white card, grey chip,
 * one ink colour - is what the whole row uses now, and colour is left to the
 * one place it still earns its keep: a figure that is actually a problem.
 */
const TILE_ALERT = 'text-danger';

/** Ticket status tones, matching `AdminTicketsPage` so a status reads the same on both. */
const TICKET_TONES = {
  diagnosis: 'info',
  accepted: 'info',
  waiting_for_parts: 'warn',
  ready_to_repair: 'info',
  processing: 'warn',
  retention_policy: 'neutral',
  ready_to_pickup: 'ok',
  completed: 'ok',
  cancelled: 'danger',
};

/**
 * Explicit widths on every column.
 *
 * Left to itself the browser sizes columns by content, so a long fault
 * description swallowed the row and the money column landed in a different
 * place on every table. Fixed proportions keep the figures in a straight line
 * down the page, which is the only thing that makes a column of numbers
 * comparable at a glance.
 */
/**
 * The Payments table.
 *
 * A reversed row is struck through and tinted rather than removed: the payment
 * happened, the customer may hold a receipt for it, and the negative row that
 * undoes it is listed separately. Hiding either half is how somebody concludes
 * they were charged twice.
 */
const PAYMENT_COLUMNS = [
  {
    key: 'at',
    header: 'Date',
    priority: 1,
    width: '20%',
    sortValue: (payment) => new Date(payment.at).getTime(),
    render: (payment) => (
      <span className="tnum whitespace-nowrap text-sm text-ink-500">{date(payment.at)}</span>
    ),
  },
  {
    key: 'invoice',
    header: 'Invoice',
    priority: 2,
    width: '22%',
    render: (payment) => (
      <span className="whitespace-nowrap font-mono text-sm font-semibold text-ink-900">
        {payment.invoice}
      </span>
    ),
  },
  {
    key: 'method',
    header: 'Method',
    priority: 4,
    width: '22%',
    render: (payment) => (
      <span className="block truncate text-sm text-ink-500">
        {payment.method ?? '–'}
        {payment.reference && (
          <span className="block truncate text-xs text-ink-400">{payment.reference}</span>
        )}
      </span>
    ),
  },
  {
    key: 'status',
    header: '',
    priority: 3,
    width: '16%',
    render: (payment) =>
      payment.reversedAt ? (
        <Badge tone="warn" size="sm">
          Reversed
        </Badge>
      ) : null,
  },
  {
    key: 'amount',
    header: 'Amount',
    priority: 1,
    width: '20%',
    align: 'right',
    sortValue: (payment) => payment.amount,
    render: (payment) => (
      <span
        className={cn(
          'tnum whitespace-nowrap text-sm font-semibold',
          payment.reversedAt ? 'text-ink-400 line-through' : 'text-ink-900',
        )}
      >
        {money(payment.amount)}
      </span>
    ),
  },
];

const TICKET_COLUMNS = [
  {
    key: 'ticketNumber',
    header: 'Ticket',
    priority: 1,
    width: '18%',
    render: (ticket) => (
      <span className="whitespace-nowrap font-mono text-sm font-semibold text-ink-900">
        {ticket.ticketNumber}
      </span>
    ),
  },
  {
    key: 'device',
    header: 'Device',
    priority: 2,
    width: '30%',
    sortValue: (ticket) => `${ticket.device.brand ?? ''} ${ticket.device.model ?? ''}`,
    render: (ticket) => (
      <>
        <span className="block truncate text-sm text-ink-900">
          {[ticket.device.brand, ticket.device.model].filter(Boolean).join(' ') || '-'}
        </span>
        <span className="block truncate text-xs text-ink-400">{ticket.issue}</span>
      </>
    ),
  },
  {
    key: 'createdAt',
    header: 'Booked in',
    priority: 3,
    width: '16%',
    sortValue: (ticket) => new Date(ticket.createdAt).getTime(),
    render: (ticket) => (
      <span className="tnum whitespace-nowrap text-sm text-ink-500">
        {date(ticket.createdAt)}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    priority: 1,
    width: '20%',
    render: (ticket) => (
      <Badge tone={TICKET_TONES[ticket.status] ?? 'neutral'} size="sm">
        {ticket.status.replace(/_/g, ' ')}
      </Badge>
    ),
  },
  {
    key: 'estimateCents',
    header: 'Estimate',
    priority: 2,
    width: '16%',
    align: 'right',
    className: 'tnum',
    sortValue: (ticket) => ticket.estimateCents ?? 0,
    render: (ticket) =>
      ticket.estimateCents > 0 ? (
        <span className="text-sm font-semibold text-ink-900">{money(ticket.estimateCents)}</span>
      ) : (
        <span className="text-xs text-ink-300">-</span>
      ),
  },
];

/** Orders. Same fixed-width discipline as the tickets table above. */
const ORDER_COLUMNS = [
  {
    key: 'orderNumber',
    header: 'Order #',
    priority: 1,
    width: '20%',
    render: (order) => (
      <span className="whitespace-nowrap font-mono text-sm font-semibold text-brand">
        {order.orderNumber}
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Date',
    priority: 2,
    width: '20%',
    sortValue: (order) => new Date(order.createdAt).getTime(),
    render: (order) => (
      <span className="tnum whitespace-nowrap text-sm text-ink-500">
        {date(order.createdAt)}
      </span>
    ),
  },
  {
    key: 'items',
    header: 'Items',
    priority: 3,
    // Centred, not right-aligned. A right-aligned count sits hard against the
    // left-aligned Status beside it, so the two read as one crowded pair while
    // a gap opens on the other side. A count is not a money column and gains
    // nothing from a decimal edge to line up on.
    width: '20%',
    align: 'center',
    className: 'tnum',
    sortValue: (order) => order.items.length,
    render: (order) => (
      <span className="text-sm text-ink-700">{formatCount(order.items.length)}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    priority: 1,
    width: '20%',
    render: (order) => <OrderStatusBadge status={order.status} size="sm" />,
  },
  {
    key: 'total',
    header: 'Total',
    priority: 1,
    width: '20%',
    align: 'right',
    className: 'tnum',
    sortValue: (order) => order.total,
    render: (order) => (
      <span className="text-sm font-semibold text-ink-900">{money(order.total)}</span>
    ),
  },
];

/**
 * Invoices, in the reference's column order: number, dates, money, status.
 *
 * **No subtotal or tax columns**, which the reference has and this does not.
 * The profile's invoice payload carries the total and what is paid against it,
 * not the line detail those two would be summed from - printing a "subtotal"
 * derived from a guessed tax rate would be a figure nobody could reconcile
 * against the invoice it claims to describe. The invoice's own screen, one
 * click away, shows the real breakdown.
 */
const INVOICE_COLUMNS = [
  {
    key: 'number',
    header: 'Invoice #',
    priority: 1,
    width: '18%',
    render: (invoice) => (
      <span className="whitespace-nowrap font-mono text-sm font-semibold text-brand">
        {invoice.number}
      </span>
    ),
  },
  {
    key: 'issuedAt',
    header: 'Date',
    priority: 2,
    width: '16%',
    sortValue: (invoice) => (invoice.issuedAt ? new Date(invoice.issuedAt).getTime() : 0),
    render: (invoice) => (
      <span className="tnum whitespace-nowrap text-sm text-ink-500">
        {invoice.issuedAt ? date(invoice.issuedAt) : '-'}
      </span>
    ),
  },
  {
    key: 'dueDate',
    header: 'Due',
    priority: 3,
    width: '16%',
    sortValue: (invoice) => (invoice.dueDate ? new Date(invoice.dueDate).getTime() : 0),
    render: (invoice) => (
      <span className="tnum whitespace-nowrap text-sm text-ink-500">
        {invoice.dueDate ? date(invoice.dueDate) : '-'}
      </span>
    ),
  },
  {
    /**
     * Paid, not "balance".
     *
     * A balance column reads "Settled" on every row of a healthy account,
     * which is a column of the same word - it says nothing and still costs the
     * width. What is actually useful beside a total is how much of it has
     * arrived, and the outstanding remainder is the one case worth colouring.
     */
    key: 'amountPaid',
    header: 'Paid',
    priority: 2,
    width: '18%',
    align: 'right',
    className: 'tnum',
    sortValue: (invoice) => invoice.amountPaid,
    render: (invoice) =>
      invoice.balance > 0 ? (
        <>
          <span className="text-sm font-semibold text-ink-900">
            {money(invoice.amountPaid)}
          </span>
          <span className="block whitespace-nowrap text-2xs text-danger">
            {money(invoice.balance)} owed
          </span>
        </>
      ) : (
        <span className="text-sm text-ink-700">{money(invoice.amountPaid)}</span>
      ),
  },
  {
    key: 'amount',
    header: 'Total',
    priority: 1,
    width: '16%',
    align: 'right',
    className: 'tnum',
    sortValue: (invoice) => invoice.amount,
    render: (invoice) => (
      <span className="text-sm font-semibold text-ink-900">{money(invoice.amount)}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    priority: 1,
    width: '16%',
    render: (invoice) => <InvoiceStatusBadge status={invoice.status} size="sm" />,
  },
];

/** Quote status tones, matching `AdminQuotesPage` so one status reads the same on both. */
const QUOTE_TONES = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'ok',
  expired: 'warn',
  converted: 'brand',
  rejected: 'danger',
};

/** Quotes on the customer profile. Even fifths, like the orders table. */
/** Status tones and labels, matching `/admin/rma` so one record reads the
 *  same from the queue and from the account. */
const RMA_STATUS_TONES = {
  requested: 'neutral',
  approved: 'info',
  in_transit: 'info',
  received: 'warn',
  inspecting: 'warn',
  resolved: 'ok',
  rejected: 'danger',
};

const RMA_COLUMNS = [
  {
    key: 'rmaNumber',
    header: 'Return',
    priority: 1,
    render: (rma) => (
      <span className="block whitespace-nowrap font-mono text-sm font-medium text-ink-900">
        {rma.rmaNumber}
      </span>
    ),
  },
  {
    key: 'orderNumber',
    header: 'Order',
    priority: 2,
    render: (rma) => (
      <span className="whitespace-nowrap font-mono text-xs text-ink-500">
        {rma.orderNumber ?? '-'}
      </span>
    ),
  },
  {
    key: 'qty',
    header: 'Items',
    priority: 3,
    align: 'right',
    className: 'tnum',
    render: (rma) => formatCount(rma.qty),
  },
  {
    key: 'status',
    header: 'Status',
    priority: 1,
    render: (rma) => (
      <Badge tone={RMA_STATUS_TONES[rma.status]} size="sm">
        {String(rma.status).replace('_', ' ')}
      </Badge>
    ),
  },
  {
    key: 'createdAt',
    header: 'Raised',
    priority: 2,
    sortValue: (rma) => rma.createdAt,
    render: (rma) => date(rma.createdAt),
  },
];

const QUOTE_COLUMNS = [
  {
    key: 'quoteNumber',
    header: 'Quote #',
    priority: 1,
    width: '20%',
    render: (quote) => (
      <span className="whitespace-nowrap font-mono text-sm font-semibold text-brand">
        {quote.quoteNumber}
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Date',
    priority: 2,
    width: '20%',
    sortValue: (quote) => new Date(quote.createdAt).getTime(),
    render: (quote) => (
      <span className="tnum whitespace-nowrap text-sm text-ink-500">
        {date(quote.createdAt)}
      </span>
    ),
  },
  {
    key: 'itemCount',
    header: 'Items',
    priority: 3,
    width: '20%',
    align: 'center',
    className: 'tnum',
    sortValue: (quote) => quote.itemCount ?? 0,
    render: (quote) => (
      <span className="text-sm text-ink-700">{formatCount(quote.itemCount ?? 0)}</span>
    ),
  },
  {
    key: 'validUntil',
    header: 'Expires',
    priority: 2,
    width: '20%',
    sortValue: (quote) => (quote.validUntil ? new Date(quote.validUntil).getTime() : 0),
    render: (quote) => (
      <span
        className={cn(
          'tnum whitespace-nowrap text-sm',
          quote.expired ? 'font-medium text-warn' : 'text-ink-500',
        )}
      >
        {quote.validUntil ? date(quote.validUntil) : '-'}
      </span>
    ),
  },
  {
    key: 'total',
    header: 'Total',
    priority: 1,
    width: '20%',
    align: 'right',
    className: 'tnum',
    sortValue: (quote) => quote.total,
    render: (quote) => (
      <>
        <span className="block text-sm font-semibold text-ink-900">{money(quote.total)}</span>
        <Badge tone={QUOTE_TONES[quote.status] ?? 'neutral'} size="sm">
          {quote.status}
        </Badge>
      </>
    ),
  },
];

/** Website enquiries on the customer profile. Even fifths, like the others. */
const WEB_QUOTE_TONES = { new: 'brand', read: 'info', closed: 'neutral' };

const WEB_QUOTE_COLUMNS = [
  {
    key: 'createdAt',
    header: 'Received',
    priority: 1,
    width: '20%',
    sortValue: (row) => new Date(row.createdAt).getTime(),
    render: (row) => (
      <span className="tnum whitespace-nowrap text-sm text-ink-500">
        {date(row.createdAt)}
      </span>
    ),
  },
  {
    key: 'topic',
    header: 'Topic',
    priority: 2,
    width: '20%',
    render: (row) => (
      <Badge tone="neutral" size="sm">
        {row.topic}
      </Badge>
    ),
  },
  {
    key: 'message',
    header: 'Enquiry',
    priority: 2,
    width: '40%',
    render: (row) => (
      <span className="block truncate text-sm text-ink-700">{row.message}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    priority: 1,
    width: '20%',
    render: (row) => (
      <Badge tone={WEB_QUOTE_TONES[row.status] ?? 'neutral'} size="sm">
        {row.status}
      </Badge>
    ),
  },
];

/** Rows per page on the profile's own tables. */
const ROWS_PER_PAGE = 10;

/**
 * A tab whose records arrive with a later phase.
 *
 * Named rather than hidden: a staff member who cannot find the Quotes tab assumes
 * the client has none. This says the screen is not built, which is a different
 * claim from "there is nothing here" (§6b, rule 4 - nothing fakes success).
 */
function PendingTab({ icon: Icon, title, phase }) {
  return (
    <Panel>
      <PanelEmpty
        icon={Icon}
        title={title}
        body={`This record type ships in phase ${phase}. Nothing is hidden here - there is nothing to show yet.`}
      />
    </Panel>
  );
}

export function AdminClientProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { features } = useAuth();

  const tabs = useMemo(() => visibleTabs(features), [features]);

  /**
   * A `?tab=` naming a section this business does not have falls back to
   * Overview rather than rendering nothing.
   *
   * This is a real path, not a defensive flourish: the switcher changes business
   * without leaving the page, and a bookmark to `?tab=orders` sent between
   * colleagues at two businesses is the obvious way to arrive here. Both would
   * otherwise leave the strip with nothing selected above an empty panel.
   */
  const requested = searchParams.get('tab') ?? 'overview';
  const tab = tabs.some((item) => item.key === requested) ? requested : 'overview';

  /**
   * The two facts Overview changes shape around.
   *
   * Read off the same resolved tab list rather than re-asking the registry, so
   * a panel can never appear for a section whose tab is hidden - one answer,
   * used twice.
   */
  const hasTickets = tabs.some((item) => item.key === 'tickets');
  const hasOrders = tabs.some((item) => item.key === 'orders');

  /**
   * Is this tab confirmed to exist for this business?
   *
   * **Rendering and fetching want different answers while `features` is null**,
   * and conflating them is what made `/admin/rma` 404 on a service business.
   *
   * `visibleTabs` treats null as "show everything", matching `visibleNav`:
   * `features` is absent until `/auth/me` resolves, and defaulting to "off"
   * would blank the tab strip on every first paint and look exactly like a
   * permissions bug. That is right for a strip, which corrects itself a moment
   * later with nothing lost.
   *
   * It is wrong for a request. A `?tab=rmas` URL opened against a business
   * without Returns passed the strip's check on that first render and fired
   * `GET /admin/rma`, which the new feature gate answers 404 - a console error
   * for a section the staff member was never going to be shown.
   *
   * So a fetch waits for the real answer. A tab with no feature key never
   * waits: every business has invoices, notes and an activity log.
   */
  const confirmed = (key) => {
    const entry = TABS.find((item) => item.key === key);
    if (!entry?.feature) return true;
    return Boolean(features) && featureEnabled(features, entry.feature);
  };

  const { data, isLoading } = useAdminUser(id);
  // The activity feed is a second query and only runs on its own tab - it
  // merges four collections and there is no reason to pay for it on Overview.
  const { data: activityData, isLoading: activityLoading } = useAdminUserActivity(
    id,
    tab === 'activity',
  );

  /**
   * Contact history, from the same `MessageLog` the Marketing screens write.
   *
   * Fetched on Overview as well as its own tab, because Overview summarises it
   * but only a handful of rows there, since the roll-up shows three.
   */
  /**
   * Overview only, and the full fifty.
   *
   * It was fetched on the Tickets tab too, back when a second copy of the
   * conversation panel sat there. And it asked for **five** rows on Overview,
   * because Overview showed a three-row summary - it now shows the real panel,
   * so five would silently truncate the history to the last handful with no
   * indication anything was missing.
   */
  const { data: messageData, isLoading: messagesLoading } = useMarketingMessages(
    tab === 'overview' ? { user: id, limit: 50 } : undefined,
  );

  /**
   * This account's repair tickets, for the Tickets tab.
   *
   * Filtered server-side by `user`, which only tickets raised against an
   * account carry - a walk-in repair has no account and belongs on nobody's
   * profile. Fetched on its own tab only; the header's count comes from
   * `totals` and does not need the rows.
   */
  /** This account's quotes. Fetched on its own tab; the header count is in `totals`. */
  const { data: quoteData, isLoading: quotesLoading } = useAdminQuotes(
    tab === 'quotes' && confirmed('quotes') ? { user: id, status: 'all' } : undefined,
  );

  /** This account's returns. Fetched on its own tab only, like the rest. */
  const { data: rmaData, isLoading: rmasLoading } = useAdminRmas(
    tab === 'rmas' && confirmed('rmas') ? { user: id, status: 'all' } : undefined,
  );

  /** This account's website enquiries. Fetched on its own tab only. */
  const { data: webQuoteData, isLoading: webQuotesLoading } = useAdminWebQuotes(
    tab === 'web-quotes' && confirmed('web-quotes') ? { user: id, status: 'all' } : undefined,
  );

  /**
   * Fetched on Overview as well as its own tab.
   *
   * Overview leads with tickets for a service business - they are what a
   * staff member opened the customer to check - so the rows have to be there before
   * the tab is. A short page on Overview, the full 50 on the tab, so summarising
   * does not pay for a list nobody is reading yet.
   */
  /** Payments, on their own tab only - nothing else on the screen shows one. */
  const { data: paymentData, isLoading: paymentsLoading } = useAdminUserPayments(
    id,
    tab === 'payments',
  );

  const wantsTickets = confirmed('tickets') && (tab === 'tickets' || tab === 'overview');
  const { data: ticketData, isLoading: ticketsLoading } = useAdminTickets(
    wantsTickets ? { user: id, status: 'all', limit: tab === 'overview' ? 5 : 50 } : undefined,
  );

  const {
    setContactConsent,
    setTier,
    addInternalNote,
    deleteInternalNote,
    sendMessage,
    approveUser,
    rejectUser,
  } = useAdminMutations();

  // What the server said actually happened to a message. Held here rather than
  // in the panel so it survives the panel's own re-render after a send.
  const [notice, setNotice] = useState(null);
  const [approving, setApproving] = useState(false);
  const [sendingPortal, setSendingPortal] = useState(false);
  /**
   * Whether the referral link was just copied.
   *
   * **Above the loading return**, with every other hook. It was declared beside
   * the link it belongs to, which reads better and is wrong: that code sits
   * after `if (isLoading || !data)`, so the hook was skipped on the loading
   * render and called on the loaded one - "rendered more hooks than during the
   * previous render", and a blank screen.
   */
  const [copiedReferral, setCopiedReferral] = useState(false);
  const emailPortalLink = useEmailCustomerPortalLink(id);
  const [rejecting, setRejecting] = useState(false);

  // The tier's warranty bonus is a setting, not a property of the account, so
  // the panel reads it from there rather than the profile inventing a number.
  const { data: settingsData } = useAdminSettings();

  // Publishes the business name to the shell's breadcrumb, so the trail reads
  // `⌂ > Sales > Clients > Northline Wireless` rather than `… > Client` (§4b.6).
  // Called before the loading return, because a hook cannot be conditional.
  useSetRecordLabel(data?.user?.displayName);

  /**
   * Paging for the three tabs the hand-rolled orders/invoices paging never
   * covered.
   *
   * **Above the loading return, for the same reason `useSetRecordLabel` is.**
   * These sat below it, which meant the first render - while `data` was still
   * loading - ran three fewer hooks than the render after it, and React threw
   * `Rendered more hooks than during the previous render` the moment the fetch
   * resolved. The page crashed on every visit.
   *
   * They read `?.` off possibly-absent data and default to an empty array,
   * which is exactly what makes them safe to call before the guard: with no
   * data yet they page an empty list, and nothing below this point runs until
   * the guard has passed anyway.
   */
  /**
   * The five tickets Overview shows, **open ones first**.
   *
   * Newest-first alone is wrong here. A customer with a job booked in last
   * month and three collected since would lead with the three that are done,
   * which is the opposite of what the panel is for - the open job is the one
   * somebody is about to be asked about. Within each group the order stays
   * newest-first, so the sort adds a rule rather than replacing one.
   *
   * **Above the loading return**, with the paging hooks and for the same
   * reason: a hook below it is skipped on the loading render and called on the
   * loaded one, which changes the order of hooks between renders. React counts
   * hooks by position, so that is a real fault and not a lint preference - it
   * reported it as "a change in the order of Hooks called by
   * AdminClientProfilePage".
   */
  const overviewTickets = useMemo(() => {
    const rows = ticketData?.tickets ?? [];
    const closed = (ticket) => ticket.status === 'completed' || ticket.status === 'cancelled';
    return [...rows]
      .sort((a, b) => {
        if (closed(a) !== closed(b)) return closed(a) ? 1 : -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .slice(0, 5);
  }, [ticketData]);

  const paymentPage = useTablePage(paymentData?.payments ?? []);
  const ticketPage = useTablePage(ticketData?.tickets ?? []);
  const quotePage = useTablePage(quoteData?.quotes ?? []);
  const webQuotePage = useTablePage(webQuoteData?.webQuotes ?? []);
  const rmaPage = useTablePage(rmaData?.rmas ?? []);

  function setTab(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-80" />
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const { user, orders, invoices, notes = [] } = data;
  const messages = messageData?.messages ?? [];

  /**
   * Log a call, or send a message, against this account.
   *
   * Defined once and passed to both the Conversations tab and the Overview
   * roll-up: two copies would eventually disagree about which route a channel
   * posts to, and the `notice` handling is the part that must not drift - the
   * server says whether anything actually transmitted, and that is rendered
   * verbatim rather than turned into a confirmation (§6b rule 4).
   */
  function logInteraction({ channel, direction, body }, done) {
    // `calls` is the route's plural; every other channel - `note` included -
    // matches its own name.
    const route = channel === 'call' ? 'calls' : channel;

    sendMessage.mutate(
      { channel: route, userId: id, direction, body, text: body },
      {
        onSuccess: (payload) => {
          setNotice(payload?.notice ?? null);
          done();
        },
      },
    );
  }

  /**
   * The monogram. Two letters from the display name, one from a single word.
   *
   * Built from `displayName` rather than `businessName` (§0): a private
   * customer has no company, and initials taken from an empty string would
   * render an empty circle on exactly the accounts this panel now serves.
   */
  const initials =
    (user.displayName ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '-';

  /**
   * Header figures come from `totals`, not from the lists.
   *
   * `orders` and `invoices` are the ten most recent - enough for the roll-up
   * panels, wrong for a tile that says "total". Summing them understated every
   * account past its tenth invoice, which is precisely the set of accounts
   * somebody opens this screen to check. The server counts the whole set.
   */
  const totals = data.totals ?? {};
  const invoiced = totals.invoiced ?? 0;
  const collected = totals.collected ?? 0;
  const outstanding = totals.outstanding ?? 0;
  const activeTickets = totals.activeTickets ?? 0;
  const openQuotes = totals.openQuotes ?? 0;

  /**
   * When anything last happened on this account.
   *
   * Taken from the newest order or invoice already on screen rather than a
   * sixth query: both lists are sorted newest-first, so the answer is the first
   * row of each. `lastLoginAt` is deliberately not in the running - signing in
   * is not activity on the account, it is somebody looking at it.
   */
  const lastActivityAt = [orders[0]?.createdAt, invoices[0]?.issuedAt]
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];

  /**
   * Paging for the Orders and Invoices tables.
   *
   * In the URL beside `tab`, so a page is part of the address like every other
   * bit of screen state here - and clamped on read, because a filter or a
   * fresh load can strand the URL on a page that no longer exists.
   */
  const ordersPage = Math.max(1, Number(searchParams.get('ordersPage') ?? 1));
  const invoicesPage = Math.max(1, Number(searchParams.get('invoicesPage') ?? 1));

  const orderPages = Math.max(1, Math.ceil(orders.length / ROWS_PER_PAGE));
  const invoicePages = Math.max(1, Math.ceil(invoices.length / ROWS_PER_PAGE));

  const currentOrdersPage = Math.min(ordersPage, orderPages);
  const currentInvoicesPage = Math.min(invoicesPage, invoicePages);

  const pagedOrders = orders.slice(
    (currentOrdersPage - 1) * ROWS_PER_PAGE,
    currentOrdersPage * ROWS_PER_PAGE,
  );
  const pagedInvoices = invoices.slice(
    (currentInvoicesPage - 1) * ROWS_PER_PAGE,
    currentInvoicesPage * ROWS_PER_PAGE,
  );

  function setRowPage(key, next) {
    const params = new URLSearchParams(searchParams);
    if (next <= 1) params.delete(key);
    else params.set(key, String(next));
    setSearchParams(params, { replace: true });
  }

  /** Query string that pre-fills the ticket form's free-text customer. */
  const ticketSeed = new URLSearchParams({
    client: id,
    name: user.displayName ?? '',
    phone: user.phone ?? '',
    email: user.email ?? '',
  }).toString();

  /**
   * The header strip's figures.
   *
   * Built as data rather than markup so the strip stays one loop - eight
   * hand-written cells is eight places to get a divider or a type size wrong.
   * `emphasis` is only set where the number carries a warning; everything else
   * is deliberately the same weight, because a panel where four figures shout
   * has no emphasis at all.
   */
  const STATS = [
    {
      key: 'revenue',
      label: 'Total revenue',
      icon: Receipt,
      value: money(invoiced),
      hint: `${formatCount(totals.invoiceCount ?? 0)} invoiced · ${formatCount(totals.orderCount ?? 0)} orders`,
    },
    {
      key: 'collected',
      label: 'Collected',
      icon: Wallet,
      value: money(collected),
      hint: outstanding > 0 ? `${money(outstanding)} still unpaid` : 'Paid in full',
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      icon: FileText,
      // Red only when money is actually late. An always-red Outstanding tile
      // is a warning light that is never off, which is a warning light nobody
      // looks at.
      alert: outstanding > 0,
      value: money(outstanding),
      hint: 'Unpaid on issued invoices',
    },
    {
      // The line of credit: what Cellvix lends. Kept apart from store credit,
      // as the Instructions require - they are two different instruments.
      key: 'credit-line',
      label: 'Line of credit',
      icon: Wallet,
      value: money(user.balance),
      hint: `of ${money(user.creditLimit)} · ${user.terms.replace('net', 'Net ')}`,
    },
    {
      // Store credit: what the business already holds.
      key: 'store-credit',
      label: 'Store credit',
      icon: WalletCards,
      value: money(user.storeCredit ?? 0),
      hint: 'Spends at checkout',
    },
    {
      key: 'tickets',
      label: 'Active tickets',
      icon: Wrench,
      value: formatCount(activeTickets),
      hint: activeTickets > 0 ? 'Open repair jobs' : 'No open jobs',
    },
    {
      key: 'quotes',
      label: 'Open quotes',
      icon: FileSignature,
      value: formatCount(openQuotes),
      hint: openQuotes > 0 ? 'Awaiting a decision' : 'Nothing outstanding',
    },
    {
      // The one non-numeric cell: "when did we last hear from them" is how a
      // dormant account is spotted, and a date answers it where a count cannot.
      key: 'last-activity',
      label: 'Last activity',
      icon: CalendarDays,
      value: lastActivityAt ? relativeTime(lastActivityAt) : '-',
      hint: lastActivityAt ? date(lastActivityAt) : 'Nothing recorded yet',
    },
  ];

  /** Counts shown on the tabs. Absent or zero renders no badge at all. */
  const TAB_COUNTS = {
    tickets: activeTickets,
    orders: totals.orderCount ?? 0,
    invoices: totals.invoiceCount ?? 0,
    quotes: openQuotes,
    'web-quotes': totals.webQuotes ?? 0,
    // Open returns, matching the other counts on the strip - the tab had no
    // entry at all, so an account with four returns in progress showed nothing.
    rmas: totals.openRmas ?? 0,
    notes: notes.length,
  };

  const tierBonus = settingsData?.financial?.warrantyBonusByTier?.[user.tier] ?? 0;

  /**
   * The referral link, and whether it was just copied.
   *
   * Only exists once a code does - a code is minted on approval, so a pending
   * account has nothing to share and the row is left out rather than showing a
   * link that resolves to nothing.
   */
  const referralLink = user.referralCode
    ? `${window.location.origin}/?ref=${encodeURIComponent(user.referralCode)}`
    : null;

  async function copyReferral() {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopiedReferral(true);
      // Back to the idle label, so the tick reads as "that copy worked" rather
      // than as a permanent state of the button.
      window.setTimeout(() => setCopiedReferral(false), 1600);
    } catch {
      // Clipboard access can be refused outright (an insecure origin, a
      // locked-down browser). The link is on screen and selectable, so say so
      // rather than failing at something the staff member cannot act on.
      toast.error('Could not copy. Select the link and copy it by hand.');
    }
  }

  return (
    <>
      {/**
       * The profile's own header, not `PageHeader`.
       *
       * Every other admin screen opens with an icon, a title and a description,
       * because every other screen is *about a kind of record*. This one is
       * about **a person**, and the things a staff member does from it are
       * transactional - raise a ticket, invoice them, send a statement. So it
       * gets a monogram rather than the Customers glyph (which was the same
       * mark on every account), the contact details as a scannable row rather
       * than one run-on sentence, and the actions laid out as a row of equals.
       */}
      {/**
       * The approval decision, on the record it is about.
       *
       * A pending account was answerable only from the Approvals queue or the
       * notification bell - so a staff member who arrived here from a search, or
       * from the customers list, could read everything about the business and
       * still had to go and find the same form somewhere else. The banner is
       * the whole state of the account said in one line, with both answers
       * beside it.
       *
       * It leads the page rather than sitting among the tabs because until it
       * is answered nothing else on this screen can happen: a pending account
       * cannot see a price, order, or be invoiced.
       */}
      {user.status === 'pending' && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/35 bg-warn-50 px-4 py-3">
          <Clock className="size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm leading-snug text-ink-900">
            <span className="font-semibold">This account is waiting for approval.</span>{' '}
            <span className="text-ink-600">
              It can sign in and browse, but sees no wholesale pricing and cannot order until it is
              approved.
            </span>
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={XCircle} onClick={() => setRejecting(true)}>
              Reject
            </Button>
            <Button size="sm" icon={CheckCircle2} onClick={() => setApproving(true)}>
              Approve
            </Button>
          </div>
        </div>
      )}

      {/* One card: identity, figures and tabs are the same object, and three
          separate slabs made the top of this screen read as three unrelated
          widgets. The brand rule along the top is the only ornament - it says
          "this is a record" the way the reference does. */}
      <div className="mb-5 overflow-hidden rounded-lg border border-line bg-surface">
        <span className="block h-1 bg-brand-gradient" aria-hidden="true" />

        <header className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            {/* Initials, from the name the account is actually known by
                (§0's `displayName`). A monogram tells two accounts apart in a
                way a shared icon cannot. */}
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-gradient-orb font-display text-xl font-bold text-white"
              aria-hidden="true"
            >
              {initials}
            </span>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl leading-tight sm:text-2xl">{user.displayName}</h1>
                <Badge tone={STATUS_TONES[user.status]} size="sm">
                  {user.status}
                </Badge>
                {user.tier && user.tier !== 'standard' && (
                  <Badge tone="brand" size="sm">
                    {user.tier}
                  </Badge>
                )}
              </div>

              {/* One line per fact, each behind its own icon: a staff member
                  reading a phone number off the screen should not have to find
                  it inside a sentence of separators. Email and phone are
                  actionable - this is a screen somebody uses while picking up
                  the handset. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
                {user.businessName && user.businessName !== user.displayName && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="size-3.5 shrink-0 text-brand" strokeWidth={2.25} aria-hidden="true" />
                    {user.businessName}
                  </span>
                )}
                <a
                  href={`mailto:${user.email}`}
                  className={cn(pressable, 'inline-flex items-center gap-1.5 hover:text-ink-900')}
                >
                  <Mail className="size-3.5 shrink-0 text-brand" strokeWidth={2.25} aria-hidden="true" />
                  {user.email}
                </a>
                {user.phone && (
                  <a
                    href={`tel:${user.phone.replace(/[^\d+]/g, '')}`}
                    className={cn(pressable, 'inline-flex items-center gap-1.5 hover:text-ink-900')}
                  >
                    <Phone className="size-3.5 shrink-0 text-brand" strokeWidth={2.25} aria-hidden="true" />
                    {user.phone}
                  </a>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5 shrink-0 text-brand" strokeWidth={2.25} aria-hidden="true" />
                  Since {date(user.createdAt)}
                </span>
              </div>
            </div>
          </div>

          {/* The transactional actions, in the order somebody reaches for
              them. Each opens the page that already owns that record type,
              seeded with this account - never a second form of its own, which
              is how two create paths end up disagreeing (§7.2). */}
          <div className="flex flex-wrap items-center gap-2">
            {/* A ticket stores its customer as free text, so the name, phone
                and email travel with the link rather than an id the tickets
                page would have to look up. `client` links it back to the
                account so this profile can count its own open jobs. */}
            <Link to={`/admin/tickets?new=1&${ticketSeed}`}>
              <Button size="sm" icon={Wrench}>
                New ticket
              </Button>
            </Link>
            <Link to={`/admin/invoices?new=1&client=${id}`}>
              <Button size="sm" variant="outline" icon={Receipt}>
                Invoice
              </Button>
            </Link>
            <Link to={`/admin/quotes?new=1&client=${id}`}>
              <Button size="sm" variant="outline" icon={FileSignature}>
                Quote
              </Button>
            </Link>
            {/* The printable account statement: every invoice and payment on
                this account with a closing balance. It opens the rendered
                document in a new tab, where the browser's print dialog is what
                saves it as a PDF - the same route the invoice document takes,
                so there is one way to produce paper from this system. */}
            <Button
              size="sm"
              variant="outline"
              icon={FileText}
              onClick={() =>
                window.open(apiUrl(`/admin/users/${id}/statement`), '_blank', 'noopener')
              }
            >
              Statement
            </Button>
            {/* Mails the customer their own read-only page. Confirms first: it
                is one click, it reaches a third party, and what it sends is a
                working key to this account's record (§3.0.1). */}
            <Button
              size="sm"
              variant="outline"
              icon={Link2}
              loading={emailPortalLink.isPending}
              disabled={!user.email}
              title={user.email ? undefined : 'This customer has no email address on file.'}
              onClick={() => setSendingPortal(true)}
            >
              Portal Link
            </Button>
            <Link to={`/admin/clients/${id}/edit`}>
              <Button size="sm" variant="outline" icon={Pencil}>
                Edit
              </Button>
            </Link>
            </div>
          </div>
        </header>


        {/**
         * Eight figures, one uniform treatment.
         *
         * They were briefly coloured by meaning - a wash, a chip and a
         * hairline per tile keyed to what the number was. Eight of those in a
         * row is a lot of signal for a set of figures somebody scans once, and
         * the colour ended up competing with the numbers rather than ranking
         * them. Every tile is the plain card the counts already used; the only
         * colour left is on a figure that is genuinely a problem.
         */}
        <dl className="grid grid-cols-2 gap-2.5 border-t border-line bg-surface-2 p-3 sm:grid-cols-4">
          {STATS.map((stat) => (
            <div
              key={stat.key}
              className={cn(
                'rounded-lg border border-line bg-surface px-3.5 py-3',
                'transition-shadow duration-fast hover:shadow-card',
              )}
            >
              <dt className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-ink-400">
                  <stat.icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="truncate text-2xs font-semibold uppercase tracking-wider text-ink-500">
                  {stat.label}
                </span>
              </dt>

              <dd>
                <span
                  className={cn(
                    'tnum mt-2.5 block font-display text-xl font-bold leading-none',
                    // The one exception to the uniform treatment: a figure that
                    // is genuinely a problem. Everything else is ink.
                    stat.alert ? TILE_ALERT : 'text-ink-900',
                  )}
                >
                  {stat.value}
                </span>
                <span className="mt-1.5 block text-2xs leading-tight text-ink-400">
                  {stat.hint}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/**
       * Tabs are their own section now.
       *
       * Inside the identity card they read as part of the record's header,
       * which is the wrong claim: the strip does not describe the customer, it
       * switches what is shown *below* it. Sitting on its own, directly above
       * the panel it controls, the relationship is the one it actually has.
       */}
      <TabRow
        tabs={tabs.map((item) => ({
          ...item,
          // A count only when there is something to count: a row of grey
          // zeroes teaches a staff member to stop reading them.
          count: TAB_COUNTS[item.key] > 0 ? TAB_COUNTS[item.key] : undefined,
        }))}
        value={tab}
        onChange={setTab}
        label="Customer sections"
        panel
        className="mb-4"
      />


      {tab === 'overview' && (
        /**
         * **A narrow column of facts, and a wide column of records.**
         *
         * Every panel used to take half the width, which sized them by position
         * rather than by content: "Customer details" is a list of short labelled
         * values that wraps badly past about 40 characters, while Invoices and
         * Tickets are tables whose columns had to be cramped or dropped to fit
         * the same box. One of them was being given twice the room it needed and
         * the other half of what it wanted.
         *
         * Three columns, one for the facts and two for the records. Below `lg`
         * it is a single stack, details first - on a phone the identity of the
         * customer is what you want at the top, not a table.
         */
        <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          {/* The one place the business name is shown. Everywhere else - the
              header, the breadcrumb, the customers list, every reference to
              this account - uses `displayName`, which is the person (§0). The
              company is a detail *about* them, and it belongs in the detail
              panel rather than standing in as their name. */}
          <Panel
            title="Customer details"
            action={
              <Link
                to={`/admin/clients/${id}/edit`}
                className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
              >
                <Pencil className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                Edit
              </Link>
            }
          >
            <dl className="space-y-2.5 text-sm">
              {[
                ['Name', user.displayName],
                ['Business', user.businessName || '-'],
                ['Email', user.email],
                ['Phone', user.phone || '-'],
                ['Tax ID', user.taxId || '-'],
                ['Registered', date(user.createdAt)],
                ['Last signed in', user.lastLoginAt ? date(user.lastLoginAt) : 'Never'],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <dt className="w-32 shrink-0 text-ink-400">{label}</dt>
                  <dd className="min-w-0 flex-1 break-words text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          {/* ---- the roll-up ------------------------------------------------
              Each summary shows the first few rows and hands off to the tab
              that owns them. Deliberately read-only: a form on Overview and the
              same form on its own tab is two places to write the same record,
              and they drift. Overview answers "what is going on with this
              account"; the tabs are where something is done about it. */}
          {/**
           * **Referral and portal, in one card.**
           *
           * This was "Membership & consent", a read-only summary whose only
           * action was a "Referral & Membership" button pointing at a tab that
           * no longer exists for a service business - a dead control on the
           * default screen of every customer.
           *
           * Rather than re-point it, the summary became the thing it was
           * summarising. Everything here is one line of state or one control,
           * so there was never enough to justify a second screen behind a
           * button: the tier is a select, the code and link are copyable, and
           * the two figures underneath are what somebody opens a referral to
           * check. Consent moved out entirely - it belongs with the
           * conversation log, not under a referral code.
           */}
          <Panel title="Referral & portal" icon={Gift}>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="eyebrow text-ink-400">Membership</dt>
                <dd className="min-w-0">
                  {/* The tier is set here rather than read here. It was a
                      badge, which meant changing it was a trip to another
                      screen to operate one select. */}
                  <SelectMenu
                    srLabel="Membership tier"
                    value={user.tier}
                    onChange={(next) => setTier.mutate({ id, tier: next })}
                    options={MEMBERSHIP_TIERS.map((item) => ({
                      value: item.value,
                      label:
                        tierBonusFor(settingsData, item.value) > 0
                          ? `${item.label} · ${tierBonusFor(settingsData, item.value)}d warranty`
                          : item.label,
                    }))}
                    align="right"
                    className="w-[190px]"
                  />
                </dd>
              </div>

              <div className="flex items-center justify-between gap-3">
                <dt className="eyebrow shrink-0 text-ink-400">Referral code</dt>
                <dd className="min-w-0">
                  {user.referralCode ? (
                    <code className="font-mono text-sm font-semibold text-ink-900">
                      {user.referralCode}
                    </code>
                  ) : (
                    <span className="text-ink-400">Not issued</span>
                  )}
                </dd>
              </div>

              {referralLink && (
                <div className="flex items-start justify-between gap-3">
                  <dt className="eyebrow shrink-0 pt-1.5 text-ink-400">Referral link</dt>
                  <dd className="flex min-w-0 flex-col items-end gap-1">
                    {/* Truncated and selectable rather than wrapped: the link is
                        long, it is copied rather than read, and three wrapped
                        lines of it would be the tallest thing in the card. */}
                    <span className="w-full max-w-[190px] truncate rounded-md bg-surface-2 px-2 py-1.5 text-right font-mono text-xs text-ink-700">
                      {referralLink}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={copiedReferral ? Check : Copy}
                      onClick={copyReferral}
                    >
                      {copiedReferral ? 'Copied' : 'Copy'}
                    </Button>
                  </dd>
                </div>
              )}

              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
                <dt className="text-ink-500">Store credit</dt>
                <dd className="tnum font-semibold text-ok">{money(user.storeCredit ?? 0)}</dd>
              </div>

              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Referred</dt>
                <dd className="tnum font-medium text-ink-900">
                  {formatCount(totals.referredCount ?? 0)}{' '}
                  {(totals.referredCount ?? 0) === 1 ? 'customer' : 'customers'}
                </dd>
              </div>
            </dl>

            <p className="mt-3 border-t border-line pt-3 text-xs leading-snug text-ink-400">
              Earns {settingsData?.financial?.referralPercent ?? 5}% of every payment their
              referred customers make, added here as store credit.
            </p>
          </Panel>


          <CustomerPortalLink id={id} />

          {/**
           * **The notes panel itself, not a summary of it.**
           *
           * This was three truncated notes behind an "All notes" button
           * pointing at a tab a service business does not have - a dead control,
           * and the second one on this screen. The panel it was summarising is
           * one textarea and a list, which is small enough that summarising it
           * only ever added a click.
           *
           * The write lives in `CustomerCrm` and is mounted once, so this is the
           * same form the Notes tab shows rather than a second one that could
           * drift from it.
           */}
          <NotesPanel
            notes={notes}
            isPending={addInternalNote.isPending}
            onAdd={(body, done) => addInternalNote.mutate({ id, body }, { onSuccess: done })}
            onDelete={(noteId) => deleteInternalNote.mutate({ id, noteId })}
          />
        </div>

        {/* ---- the wide column: the records themselves ------------------
            Invoices and Tickets are tables. They get two thirds of the width
            because their columns are what the staff member came to read, and the
            conversation sits under them because talking to the customer is
            what happens after reading both. */}
        <div className="space-y-4 lg:col-span-2">

          {/* Invoices get their own panel on Overview rather than only a line
              in "Recent activity". It is the section a staff member opens a
              customer to look at - what has been billed and what is still
              owed - and the roll-up buries it among order rows. */}
          <Panel
            flush
            title="Invoices"
            action={
              <div className="flex items-center gap-2">
                <Link to={`/admin/invoices?new=1&client=${id}`}>
                  <Button size="xs" icon={Plus}>
                    New
                  </Button>
                </Link>
                <button
                  type="button"
                  onClick={() => setTab('invoices')}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
                >
                  View all
                  <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                </button>
              </div>
            }
          >
            {/**
              * The same DataTable the Invoices tab uses, with the same columns.
              *
              * This was a hand-rolled list of five <Link> rows, which meant one
              * customer's invoices were presented two different ways on two
              * halves of the same screen - different alignment, different
              * status treatment, no sortable headers, and the totals not
              * column-aligned with the tab a click away.
              *
              * `compact` and no pagination: it is a summary, and "View all"
              * above is the way to the rest.
              */}
            <DataTable
              columns={INVOICE_COLUMNS}
              rows={invoices.slice(0, 5)}
              rowKey={(invoice) => invoice.number}
              onRowClick={(invoice) => navigate(`/admin/invoices/${invoice.number}`)}
              empty={
                <PanelEmpty
                  icon={Receipt}
                  title="No invoices yet"
                  body="Nothing has been billed to this account."
                />
              }
            />
          </Panel>

          {/**
           * **Tickets take the lead slot for a service business.**
           *
           * "Recent activity" below is a merge of orders and invoices, which
           * for a repair shop is a panel about goods it does not sell sitting
           * where the open jobs should be. The question somebody opens a repair
           * customer to answer is "what are we doing for them right now", and
           * this is that question - so it replaces the roll-up rather than
           * joining it, and a business with both keeps the pair.
           */}
          {hasTickets && (
            <Panel
              flush
              title="Tickets"
              action={
                <div className="flex items-center gap-2">
                  <Link to={`/admin/tickets?new=1&${ticketSeed}`}>
                    <Button size="xs" icon={Plus}>
                      New
                    </Button>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setTab('tickets')}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
                  >
                    View all
                    <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  </button>
                </div>
              }
            >
              {/* The Tickets tab's own table and columns, so a ticket reads
                  the same in both places. */}
              <DataTable
                columns={TICKET_COLUMNS}
                rows={overviewTickets}
                rowKey={(ticket) => ticket.id}
                onRowClick={(ticket) => navigate(`/admin/tickets/${ticket.id}`)}
                empty={
                  <PanelEmpty
                    icon={Wrench}
                    title="No tickets yet"
                    body="No repair has been raised against this account."
                  />
                }
              />
            </Panel>
          )}

          {/* The orders-and-invoices roll-up. A business that sells no goods
              has no orders to merge, and the invoices panel above already
              covers the other half - so it would render as half a panel. */}
          {hasOrders && (
          <Panel
            title="Recent activity"
            description="The last few things to happen on this account. Click any row to open it."
            action={
              <button
                type="button"
                onClick={() => setTab('activity')}
                className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
              >
                Full history
                <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              </button>
            }
          >
            {orders.length === 0 && invoices.length === 0 ? (
              <PanelEmpty icon={Building2} title="Nothing yet" body="No orders or invoices." />
            ) : (
              // Each row is a link to the record it names. The row already
              // said "Order 1043"; it just could not be opened, which made the
              // panel a list of things to go and find somewhere else.
              <ul className="-mx-2 space-y-0.5">
                {orders.slice(0, 3).map((order) => (
                  <li key={order.orderNumber}>
                    <Link
                      to={`/admin/orders/${order.orderNumber}`}
                      className={cn(pressable, 'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2')}
                    >
                      <Package className="size-3.5 shrink-0 text-info" strokeWidth={2.25} aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ink-700 group-hover:text-brand">
                        <span className="truncate">Order {order.orderNumber}</span>
                        <Eye
                          className="size-3.5 shrink-0 text-ink-300 opacity-0 transition-opacity group-hover:opacity-100"
                          strokeWidth={2.25}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="tnum shrink-0 text-ink-400">{date(order.createdAt)}</span>
                    </Link>
                  </li>
                ))}
                {invoices.slice(0, 3).map((invoice) => (
                  <li key={invoice.number}>
                    <Link
                      to={`/admin/invoices/${invoice.number}`}
                      className={cn(pressable, 'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2')}
                    >
                      <Receipt className="size-3.5 shrink-0 text-brand" strokeWidth={2.25} aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ink-700 group-hover:text-brand">
                        <span className="truncate">Invoice {invoice.number}</span>
                        <Eye
                          className="size-3.5 shrink-0 text-ink-300 opacity-0 transition-opacity group-hover:opacity-100"
                          strokeWidth={2.25}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="tnum shrink-0 text-ink-400">{money(invoice.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          )}

          {/**
           * **The conversation itself, not a summary of it, and it writes.**
           *
           * This was three truncated rows behind a "View all" pointing at a tab
           * that no longer exists - the strip lost `conversations` when it
           * folded into Tickets, and the button had been dead ever since. The
           * fix is not to re-point it: talking to the customer is the thing
           * somebody does while looking at their profile, and sending them two
           * clicks away to do it was why the summary never earned its space.
           *
           * It is also the one panel on Overview that is deliberately not
           * read-only. The rule the roll-up follows - a form here and the same
           * form on its own tab is two places to write one record, and they
           * drift - is satisfied because this IS that form, mounted once rather
           * than reimplemented twice. It used to be mounted on the Tickets tab
           * as well, which put two message boxes for one `MessageLog` on the
           * same screen.
           *
           * In the wide column: a message box in a third of the width wraps
           * every sentence twice.
           */}
          <ConversationsPanel
            messages={messages}
            isLoading={messagesLoading}
            isPending={sendMessage.isPending}
            error={sendMessage.error?.message}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            onLog={logInteraction}
          />
        </div>
        </div>
      )}

      {/* Tickets.
          The conversation log used to sit underneath them here as well as on
          Overview, which meant two message boxes writing to one `MessageLog` on
          the same screen - a colleague could type into either and only one of
          them was the one being read. It lives on Overview now, where somebody
          is already standing when they pick up the phone. */}
      {tab === 'tickets' && (
        <div className="space-y-4">
          <Panel
            flush
            title="Repair tickets"
            description="Jobs raised against this account. A walk-in with no account is not listed here."
            action={
              <Link to={`/admin/tickets?new=1&${ticketSeed}`}>
                <Button size="xs" icon={Plus}>
                  New ticket
                </Button>
              </Link>
            }
          >
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <CountLine
                total={(ticketData?.tickets ?? []).length}
                shown={ticketPage.pageRows.length}
                from={ticketPage.from}
                noun={(ticketData?.tickets ?? []).length === 1 ? 'ticket' : 'tickets'}
              />
            </div>

            <DataTable
              columns={TICKET_COLUMNS}
              rows={ticketPage.pageRows}
              rowKey={(ticket) => ticket.id}
              loading={ticketsLoading}
              onRowClick={(ticket) => navigate(`/admin/tickets/${ticket.id}`)}
              defaultSort={{ key: 'createdAt', direction: 'desc' }}
              empty={
                <PanelEmpty
                  icon={Wrench}
                  title="No tickets"
                  body="No repair has been booked in against this account."
                />
              }
            />

              <Pagination
                page={ticketPage.page}
                pages={ticketPage.totalPages}
                onChange={ticketPage.setPage}
                hideWhenSingle
                className="border-t border-line px-3 py-3 sm:px-4"
              />
          </Panel>
        </div>
      )}

      {tab === 'notes' && (
        <NotesPanel
          notes={notes}
          isPending={addInternalNote.isPending}
          onAdd={(body, done) => addInternalNote.mutate({ id, body }, { onSuccess: done })}
          onDelete={(noteId) => deleteInternalNote.mutate({ id, noteId })}
        />
      )}

      {tab === 'membership' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <ReferralPanel user={user} percent={settingsData?.financial?.referralPercent ?? 5} />
            <TierPanel
              tier={user.tier}
              warrantyBonus={settingsData?.financial?.warrantyBonusByTier?.[user.tier] ?? 0}
              isPending={setTier.isPending}
              onChange={(next) => setTier.mutate({ id, tier: next })}
            />
          </div>

          <ConsentPanel
            consent={user.consent}
            preferredContact={user.preferredContact}
            isPending={setContactConsent.isPending}
            onSave={(channels) => setContactConsent.mutate({ id, ...channels })}
          />
        </div>
      )}

      {tab === 'orders' && (
        <Panel
          flush
          title="Orders"
          description="Click a row to open the order."
        >
          <div className="border-b border-line px-3 py-2 sm:px-4">
            <CountLine
              total={orders.length}
              shown={pagedOrders.length}
              from={(currentOrdersPage - 1) * ROWS_PER_PAGE + 1}
              noun={orders.length === 1 ? 'order' : 'orders'}
            />
          </div>

          <DataTable
            columns={ORDER_COLUMNS}
            rows={pagedOrders}
            rowKey={(order) => order.orderNumber}
            defaultSort={{ key: 'createdAt', direction: 'desc' }}
            // One canonical URL per record (invariant 15): the row opens the
            // order's own screen rather than a drawer showing the same thing
            // at a different address.
            onRowClick={(order) => navigate(`/admin/orders/${order.orderNumber}`)}
            empty={<PanelEmpty icon={Package} title="No orders" body="This account has not ordered yet." />}
          />

          {orders.length > 0 && (
            <div className="border-t border-line p-3">
              <Pagination
                page={currentOrdersPage}
                pages={orderPages}
                onChange={(next) => setRowPage('ordersPage', next)}
              />
            </div>
          )}
        </Panel>
      )}

      {tab === 'invoices' && (
        <Panel
          flush
          title="All invoices"
          description="Click a row to open the invoice."
          action={
            <Link to={`/admin/invoices?new=1&client=${id}`}>
              <Button size="xs" icon={Plus}>
                New invoice
              </Button>
            </Link>
          }
        >
          <div className="border-b border-line px-3 py-2 sm:px-4">
            <CountLine
              total={invoices.length}
              shown={pagedInvoices.length}
              from={(currentInvoicesPage - 1) * ROWS_PER_PAGE + 1}
              noun={invoices.length === 1 ? 'invoice' : 'invoices'}
            />
          </div>

          <DataTable
            columns={INVOICE_COLUMNS}
            rows={pagedInvoices}
            rowKey={(invoice) => invoice.number}
            defaultSort={{ key: 'issuedAt', direction: 'desc' }}
            onRowClick={(invoice) => navigate(`/admin/invoices/${invoice.number}`)}
            empty={<PanelEmpty icon={FileText} title="No invoices" body="Nothing has been invoiced yet." />}
          />

          {invoices.length > 0 && (
            <div className="border-t border-line p-3">
              <Pagination
                page={currentInvoicesPage}
                pages={invoicePages}
                onChange={(next) => setRowPage('invoicesPage', next)}
              />
            </div>
          )}
        </Panel>
      )}

      {tab === 'credit' && (
        // Two instruments, kept visually apart (Instructions): the line of
        // credit is what Cellvix lends, store credit is what the business holds.
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <CreditForm id={id} user={user} />
            {/* Recording a payment sits under the terms it pays against, not
                beside store credit: they are the two halves of the same
                instrument. */}
            <CreditRepaymentForm id={id} user={user} />
          </div>
          <StoreCreditPanel id={id} balance={user.storeCredit} />
        </div>
      )}

      {/**
       * **Payments, and store credit beside them.**
       *
       * A product business reads both off the Credit tab, where the line of
       * credit, its ledger and its repayments sit together. A service business
       * has no line of credit - there is nothing to lend against when payment
       * is taken at the counter - so without this tab it had nowhere to answer
       * either "has this customer paid us" or "how much of their money are we
       * holding". Store credit is the instrument that survives the split: a
       * refund puts money on a repair customer's account exactly as it does a
       * wholesaler's.
       */}
      {tab === 'payments' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Panel
              flush
              title="Payments received"
              description="Every payment against this account, newest first. A reversed payment stays listed."
              action={
                paymentData ? (
                  <Badge tone="neutral" size="sm">
                    {money(paymentData.total)} collected
                  </Badge>
                ) : undefined
              }
            >
              <DataTable
                columns={PAYMENT_COLUMNS}
                rows={paymentPage.pageRows}
                rowKey={(payment, index) => `${payment.invoice}-${payment.at}-${index}`}
                loading={paymentsLoading}
                onRowClick={(payment) => navigate(`/admin/invoices/${payment.invoice}`)}
                defaultSort={{ key: 'at', direction: 'desc' }}
                empty={
                  <PanelEmpty
                    icon={Wallet}
                    title="No payments yet"
                    body="Nothing has been collected against this account."
                  />
                }
              />
              <Pagination
                page={paymentPage.page}
                pages={paymentPage.totalPages}
                onChange={paymentPage.setPage}
                hideWhenSingle
                className="border-t border-line px-3 py-3 sm:px-4"
              />
            </Panel>
          </div>

          <StoreCreditPanel id={id} balance={user.storeCredit} />
        </div>
      )}

      {tab === 'quotes' && (
        <Panel
          flush
          title="All quotes"
          description="Click a row to open the quote. An accepted quote converts to an order and its invoice."
          action={
            <Link to={`/admin/quotes?new=1&client=${id}`}>
              <Button size="xs" icon={Plus}>
                New quote
              </Button>
            </Link>
          }
        >
          <div className="border-b border-line px-3 py-2 sm:px-4">
            <CountLine
              total={(quoteData?.quotes ?? []).length}
              shown={quotePage.pageRows.length}
              from={quotePage.from}
              noun={(quoteData?.quotes ?? []).length === 1 ? 'quote' : 'quotes'}
            />
          </div>

          <DataTable
            columns={QUOTE_COLUMNS}
            rows={quotePage.pageRows}
            rowKey={(quote) => quote.id}
            loading={quotesLoading}
            defaultSort={{ key: 'createdAt', direction: 'desc' }}
            onRowClick={(quote) => navigate(`/admin/quotes/${quote.id}`)}
            empty={
              <PanelEmpty
                icon={FileSignature}
                title="No quotes"
                body="Nothing has been quoted to this account yet."
              />
            }
          />

            <Pagination
              page={quotePage.page}
              pages={quotePage.totalPages}
              onChange={quotePage.setPage}
              hideWhenSingle
              className="border-t border-line px-3 py-3 sm:px-4"
            />
        </Panel>
      )}
      {tab === 'web-quotes' && (
        <Panel
          flush
          title="Website enquiries"
          description="Messages this account sent through the site's contact form. A guest enquiry is not linked to an account and lives on the Web Quote list."
          action={
            <Link
              to="/admin/web-quotes"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700"
            >
              All enquiries
              <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            </Link>
          }
        >
          <div className="border-b border-line px-3 py-2 sm:px-4">
            <CountLine
              total={(webQuoteData?.webQuotes ?? []).length}
              shown={webQuotePage.pageRows.length}
              from={webQuotePage.from}
              noun={(webQuoteData?.webQuotes ?? []).length === 1 ? 'enquiry' : 'enquiries'}
            />
          </div>

          <DataTable
            columns={WEB_QUOTE_COLUMNS}
            rows={webQuotePage.pageRows}
            rowKey={(row) => row.id}
            loading={webQuotesLoading}
            defaultSort={{ key: 'createdAt', direction: 'desc' }}
            onRowClick={() => navigate('/admin/web-quotes')}
            empty={
              <PanelEmpty
                icon={Globe}
                title="No enquiries"
                body="This account has not sent anything through the website contact form."
              />
            }
          />

            <Pagination
              page={webQuotePage.page}
              pages={webQuotePage.totalPages}
              onChange={webQuotePage.setPage}
              hideWhenSingle
              className="border-t border-line px-3 py-3 sm:px-4"
            />
        </Panel>
      )}

      {/* The returns this account has raised.
      
          This tab rendered a "arrives in phase 7" placeholder long after phase
          7 shipped - the list screen, the workflow and the data were all live,
          so a staff member looking at a customer with five returns was told the
          feature did not exist. The tab now shows them, using the same columns
          and the same status tones as `/admin/rma`, because it is the same
          record seen from the account rather than from the queue. */}
      {tab === 'rmas' && (
        <Panel
          flush
          title="Returns"
          description="Items this account has sent back, newest first. Click a row to open it."
        >
          <div className="border-b border-line px-3 py-2 sm:px-4">
            <CountLine
              total={(rmaData?.rmas ?? []).length}
              shown={rmaPage.pageRows.length}
              from={rmaPage.from}
              noun={(rmaData?.rmas ?? []).length === 1 ? 'return' : 'returns'}
            />
          </div>

          <DataTable
            columns={RMA_COLUMNS}
            rows={rmaPage.pageRows}
            rowKey={(rma) => rma.id}
            loading={rmasLoading}
            defaultSort={{ key: 'createdAt', direction: 'desc' }}
            onRowClick={(rma) => navigate(`/admin/rma/${rma.id}`)}
            empty={
              <PanelEmpty
                icon={RotateCcw}
                title="No returns"
                body="Nothing has been sent back by this account."
              />
            }
          />

          <Pagination
            page={rmaPage.page}
            pages={rmaPage.totalPages}
            onChange={rmaPage.setPage}
            hideWhenSingle
            className="border-t border-line px-3 py-3 sm:px-4"
          />
        </Panel>
      )}

      {tab === 'activity' && (
        <Panel
          title="Activity"
          description="Orders, invoices, payments and credit movements, newest first"
          flush
        >
          {activityLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12" />
              ))}
            </div>
          ) : (activityData?.activity ?? []).length === 0 ? (
            <PanelEmpty icon={Building2} title="Nothing recorded" body="No activity on this account." />
          ) : (
            <ul className="divide-y divide-line">
              {activityData.activity.map((event, index) => {
                const style = ACTIVITY_STYLE[event.kind] ?? ACTIVITY_STYLE['order-status'];
                const Icon = style.icon;

                return (
                  <li
                    key={`${event.kind}-${event.at}-${index}`}
                    className="flex items-start gap-3 px-4 py-2.5"
                  >
                    <Icon
                      className={cn('mt-0.5 size-3.5 shrink-0', style.tone)}
                      strokeWidth={2.25}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink-900">{event.title}</span>
                      {event.detail && (
                        <span className="block text-xs text-ink-400">{event.detail}</span>
                      )}
                    </span>
                    {event.amount != null && (
                      <span className="tnum shrink-0 text-sm font-medium text-ink-700">
                        {money(Math.abs(event.amount))}
                      </span>
                    )}
                    <span className="tnum hidden shrink-0 text-xs text-ink-400 sm:block">
                      {dateTime(event.at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
      {/* Approving sets credit terms and an account rep in one payload - the
          decision to do business with somebody and the decision how much credit
          to extend them are one decision, so they are one form. */}
      <Modal
        open={approving}
        onClose={() => setApproving(false)}
        title={`Approve ${user.displayName}`}
        size="lg"
      >
        {approving && (
          <ApproveClientForm
            user={user}
            isPending={approveUser.isPending}
            error={approveUser.error?.message}
            onCancel={() => setApproving(false)}
            onSubmit={(values) =>
              approveUser.mutate(
                { id, ...values },
                {
                  onSuccess: () => {
                    setApproving(false);
                    toast.ok('Account approved', `${user.displayName} can now see pricing and order.`);
                  },
                },
              )
            }
          />
        )}
      </Modal>

      {/* The same `RejectForm` the Approvals queue uses. A reason is required
          because it goes into the notification email - a rejection with no
          explanation is a customer who calls to ask why. */}
      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={`Reject ${user.displayName}`}
      >
        {rejecting && (
          <RejectForm
            user={user}
            isPending={rejectUser.isPending}
            onCancel={() => setRejecting(false)}
            onSubmit={(reason) =>
              rejectUser.mutate(
                { id, reason },
                {
                  onSuccess: () => {
                    setRejecting(false);
                    toast.ok('Account rejected', 'They have been told why.');
                  },
                },
              )
            }
          />
        )}
      </Modal>

      {/**
       * Sending the portal link.
       *
       * A confirm rather than a straight send: one click puts a working key to
       * this customer's record into an inbox, which is outward-facing and not
       * undoable once it has gone (§3.0.1). No `confirmPhrase` - the recipient
       * is the person the record is about, so the blast radius of a misclick is
       * the customer reading their own page early.
       *
       * The address is named in the body, because sending to a stale one is the
       * actual failure mode here and it is the one thing a staff member can check
       * before the mail leaves.
       */}
      <ConfirmDialog
        open={sendingPortal}
        onClose={() => setSendingPortal(false)}
        onConfirm={() => {
          setSendingPortal(false);
          emailPortalLink.mutate(undefined, {
            onSuccess: (result) =>
              result.sent
                ? toast.ok('Portal link sent', `${result.to} has it.`)
                : // The mailer's own answer, not a confirmation of it: a
                  // `.example` address fails on purpose in development, and
                  // nothing here reports a send that did not happen.
                  toast.error(
                    `Could not send to ${result.to}${result.error ? ` - ${result.error}` : '.'}`,
                  ),
            onError: (error) => toast.error(error.message),
          });
        }}
        title={
          user.email
            ? `Email the portal link to ${user.email}?`
            : 'No email address on file'
        }
        body={user.email ? undefined : 'Add one to this customer before sending a link.'}
        confirmLabel="Send link"
        tone="info"
      />
    </>
  );
}

export default AdminClientProfilePage;
