import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Boxes,
  CalendarDays,
  ClipboardList,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Truck,
  Wallet,
} from 'lucide-react';
import { money, date, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import TabRow from '@/components/ui/TabRow';
import { CONSENT_CHANNELS } from '@/components/ui/ConsentChannels';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { BarList } from '@/components/admin/charts/Charts';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import { useAdminSupplier, useAdminMutations } from '@/hooks/useAdmin';
import Skeleton from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { toast } from '@/store/toastStore';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * One supplier - contact details, consent, linked products, PO history and the
 * spend chart that feeds the Supplier Prices report (ERP rework §6.7).
 *
 * **Tabbed**, matched to CellShoppe. Everything used to stack into one long
 * two-column page, which works while a supplier has one purchase order and
 * stops working at fifty: the contact details a staff member opened the page for
 * end up below a table that has grown without limit. Three views - who they
 * are, what we ordered, what they supply - and the tab carries its own count so
 * the empty ones answer themselves without being opened.
 *
 * The breadcrumb names the supplier rather than the type (§4b.6), which the
 * page publishes through `useRecordLabel` - the shell renders one `Breadcrumbs`
 * for every screen, so a detail page is a sibling of its trail, not a parent.
 */

const PO_STATUS_TONES = {
  draft: 'neutral',
  sent: 'info',
  partial: 'warn',
  received: 'ok',
  cancelled: 'danger',
};

const TERMS_LABELS = {
  prepaid: 'Prepaid',
  net15: 'Net 15',
  net30: 'Net 30',
  net60: 'Net 60',
};

/** `2026-03` → `Mar 26`, for the spend chart's axis. */
function monthLabel(key) {
  const [year, month] = String(key).split('-');
  const formatted = new Date(Number(year), Number(month) - 1, 1);
  return formatted.toLocaleDateString('en-CA', { month: 'short', year: '2-digit' });
}

/** Two letters from the business name - the header's avatar. */
function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * One labelled fact, as a definition row.
 *
 * A dash rather than an omitted row when the value is missing: a details panel
 * that silently drops its empty fields makes "we never recorded a website" look
 * identical to "this supplier has no website field at all", and a staff member
 * cannot tell which of them to go and fix.
 */
function DetailRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="eyebrow shrink-0 text-ink-400">{label}</dt>
      <dd className="min-w-0 wrap-break-word text-right text-sm text-ink-900">
        {children ?? <span className="text-ink-300">-</span>}
      </dd>
    </div>
  );
}

/** One header fact - an icon and a value, or nothing at all. */
function HeaderFact({ icon: Icon, children }) {
  if (!children) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-500">
      <Icon className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
      {children}
    </span>
  );
}

export function AdminSupplierProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useAdminSupplier(id);
  const [tab, setTab] = useState('overview');

  const supplier = data?.supplier;
  const orders = data?.orders ?? [];
  const products = data?.products ?? [];
  const spend = data?.spend ?? [];

  // One hook per tab. Only one table is on screen at a time, so they can
  // share the  parameter without fighting over it.
  const orderPage = useTablePage(orders);
  const productPage = useTablePage(products);

  // The breadcrumb names the supplier rather than the type. It clears on
  // unmount, so a stale name cannot survive onto the next screen.
  useSetRecordLabel(supplier?.name);

  const { inviteSupplierPortal } = useAdminMutations();

  /**
   * Issue portal credentials and say honestly whether the email left.
   *
   * The same handler the Suppliers list carries, and it must stay the same
   * shape: the password is reset **either way**, so a mail failure is not a
   * no-op to report and forget - the supplier's old password has stopped
   * working, and the message has to say that rather than only that something
   * went wrong.
   */
  // Mail to a third party from one click: confirmed twice (Instructions §3.0.1).
  const [confirmingInvite, setConfirmingInvite] = useState(false);

  function sendPortalInvite() {
    inviteSupplierPortal.mutate(supplier.id, {
      onSuccess: (result) => {
        setConfirmingInvite(false);
        if (result.delivered) {
          toast.ok('Portal link sent', `${supplier.name} can set a password from the email. The link lasts 7 days.`);
        } else {
          // Nothing about their access changed: the email only carries a link,
          // and an existing password keeps working until that link is used.
          toast.error('The email did not send', `Nothing changed for ${supplier.name}. Check the mail settings and send it again.`);
        }
      },
      onError: (mutationError) => {
        setConfirmingInvite(false);
        toast.error('Nothing was sent', mutationError.message);
      },
    });
  }

  if (error) {
    return (
      <>
        <PageHeader icon={Truck} title="Supplier" />
        <Panel>
          <PanelEmpty
            icon={Truck}
            title="Supplier not found"
            body={error.message}
            action={
              <Link
                to="/admin/suppliers"
                className={cn(pressable, 'inline-flex h-9 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
              >
                Back to suppliers
              </Link>
            }
          />
        </Panel>
      </>
    );
  }

  if (isLoading || !supplier) {
    return (
      <>
        <PageHeader icon={Truck} title="Supplier" />
        <div className="space-y-3">
          <Skeleton className="h-24" rounded="lg" />
          <Skeleton className="h-64" rounded="lg" />
        </div>
      </>
    );
  }

  const address = supplier.address ?? {};
  const addressLine = [address.line1, address.line2, address.city, address.region, address.postal, address.country]
    .filter(Boolean)
    .join(', ');

  const openOrders = orders.filter(
    (order) => !['received', 'cancelled'].includes(order.status),
  ).length;

  const termsLabel = TERMS_LABELS[supplier.paymentTerms] ?? supplier.paymentTerms;

  const orderColumns = [
    {
      key: 'poNumber',
      header: 'PO #',
      priority: 1,
      // Plain text, not a link: the row itself opens the order. A link inside a
      // clickable row is two targets for one destination, and the one that is
      // only a few characters wide is the one people miss.
      render: (order) => (
        <span className="whitespace-nowrap font-mono text-sm font-medium text-ink-900">
          {order.poNumber}
        </span>
      ),
    },
    {
      key: 'orderDate',
      header: 'Date',
      priority: 2,
      render: (order) => <span className="text-sm text-ink-500">{date(order.orderDate)}</span>,
    },
    {
      key: 'expectedDate',
      header: 'Expected',
      priority: 3,
      render: (order) =>
        order.expectedDate ? (
          <span className={`text-sm ${order.overdue ? 'font-medium text-danger' : 'text-ink-500'}`}>
            {date(order.expectedDate)}
          </span>
        ) : (
          <span className="text-xs text-ink-300">-</span>
        ),
    },
    {
      key: 'itemCount',
      header: 'Lines',
      priority: 3,
      align: 'right',
      className: 'tnum',
      render: (order) => formatCount(order.itemCount),
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      render: (order) => (
        <Badge tone={PO_STATUS_TONES[order.status]} size="sm">
          {order.status}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      priority: 1,
      align: 'right',
      className: 'tnum',
      render: (order) => (
        <>
          <span className="text-sm font-medium text-ink-900">{money(order.total)}</span>
          <span className="block text-2xs text-ink-400">
            {order.payment.status === 'paid' ? 'paid' : 'unpaid'}
          </span>
        </>
      ),
    },
  ];

  const productColumns = [
    { key: 'name', header: 'Product', priority: 1, className: 'max-w-[220px] truncate' },
    {
      key: 'sku',
      header: 'SKU',
      priority: 2,
      render: (product) => <span className="font-mono text-xs text-ink-500">{product.sku}</span>,
    },
    {
      key: 'stock',
      header: 'On hand',
      priority: 1,
      align: 'right',
      className: 'tnum',
      render: (product) => (
        <>
          <span className="text-sm text-ink-900">{formatCount(product.stock)}</span>
          {product.minStock > 0 && (
            <span className="block text-2xs text-ink-400">min {product.minStock}</span>
          )}
        </>
      ),
    },
    {
      key: 'cost',
      header: 'Cost',
      priority: 2,
      align: 'right',
      className: 'tnum',
      render: (product) =>
        product.cost > 0 ? money(product.cost) : <span className="text-xs text-ink-300">-</span>,
    },
    {
      key: 'price',
      header: 'Sell',
      priority: 3,
      align: 'right',
      className: 'tnum',
      render: (product) => money(product.price),
    },
  ];

  /**
   * Row menus, so both tables carry the `Actions` column every other list
   * screen has. Without one a `DataTable` renders as an inert grid: no trailing
   * column, no row hover, nothing saying the row goes anywhere - which is why
   * these two read as a different component from the Customers table.
   */
  const orderMenu = [
    {
      key: 'open',
      label: 'Open purchase order',
      icon: ExternalLink,
      onSelect: (order) => navigate(`/admin/purchase-orders/${order.id}`),
    },
  ];

  const productMenu = [
    {
      key: 'open',
      label: 'Open inventory item',
      icon: ExternalLink,
      onSelect: (product) => navigate(`/admin/inventory/${product.id}`),
    },
    {
      key: 'reorder',
      label: 'Reorder from this supplier',
      icon: Plus,
      onSelect: () =>
        navigate(`/admin/purchase-orders/create?supplier=${supplier.id}`),
    },
  ];

  const tabs = [
    { key: 'overview', label: 'Overview', icon: Truck },
    { key: 'orders', label: 'Purchase orders', icon: ClipboardList, count: orders.length },
    { key: 'products', label: 'Items supplied', icon: Boxes, count: products.length },
  ];

  return (
    <>
      <PageHeader
        icon={() => (
          <span className="font-display text-md font-bold leading-none">
            {initials(supplier.name)}
          </span>
        )}
        title={supplier.name}
        badge={
          <Badge tone={supplier.isActive ? 'ok' : 'neutral'} size="sm">
            {supplier.isActive ? 'active' : 'inactive'}
          </Badge>
        }
        action={
          <>
            {/* Straight into a new order against this supplier - the thing a
                staff member most often came to this page to do. */}
            <Link
              to={`/admin/purchase-orders/create?supplier=${supplier.id}`}
              className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md bg-brand-gradient px-5 font-display text-md font-semibold text-white')}
            >
              <Plus className="size-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              New PO
            </Link>
            {/* The supplier list owns the edit form, so this hands off to it
                rather than the profile carrying a second copy of that modal. */}
            <Link
              to={`/admin/suppliers?edit=${supplier.id}`}
              className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
            >
              <Pencil className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              Edit
            </Link>
            <Link
              to="/admin/suppliers"
              className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
            >
              All suppliers
            </Link>
          </>
        }
      />

      {/* The facts a staff member reads before deciding anything, on one line
          under the name rather than buried in a panel below the fold. */}
      <div className="-mt-2 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <HeaderFact icon={Mail}>
          {supplier.email && (
            <a href={`mailto:${supplier.email}`} className="hover:text-brand hover:underline">
              {supplier.email}
            </a>
          )}
        </HeaderFact>
        <HeaderFact icon={Phone}>
          {supplier.phone && (
            <a
              href={`tel:${supplier.phone.replace(/[^\d+]/g, '')}`}
              className="hover:text-brand hover:underline"
            >
              {supplier.phone}
            </a>
          )}
        </HeaderFact>
        <HeaderFact icon={MapPin}>{address.country || null}</HeaderFact>
        <HeaderFact icon={Wallet}>Terms {termsLabel}</HeaderFact>
      </div>

      <KpiRow
        tiles={[
          {
            key: 'orders',
            label: 'Purchase orders',
            value: formatCount(supplier.ordersCount),
            hint: `${formatCount(openOrders)} still open`,
            tone: 'info',
            icon: ClipboardList,
          },
          {
            key: 'spent',
            label: 'Total spent',
            value: money(supplier.totalSpent),
            hint: 'Across every sent and received order',
            tone: 'brand',
            icon: Wallet,
          },
          {
            key: 'last',
            label: 'Last order',
            value: supplier.lastOrderAt ? date(supplier.lastOrderAt) : '-',
            hint: supplier.lastOrderAt ? 'Most recent order placed' : 'Never ordered from',
            tone: 'neutral',
            icon: CalendarDays,
          },
          {
            key: 'products',
            label: 'Items supplied',
            value: formatCount(products.length),
            hint: 'Reorder defaults to this supplier',
            tone: 'neutral',
            icon: Boxes,
          },
        ]}
      />

      <TabRow
        tabs={tabs}
        value={tab}
        onChange={setTab}
        label="Supplier sections"
        panel
        className="mb-3"
      />

      {tab === 'overview' && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_1fr]">
          <Panel title="Supplier details">
            <dl>
              <DetailRow label="Contact">{supplier.contactName}</DetailRow>
              <DetailRow label="Email">
                {supplier.email && (
                  <a href={`mailto:${supplier.email}`} className="hover:text-brand">
                    {supplier.email}
                  </a>
                )}
              </DetailRow>
              <DetailRow label="Phone">
                {supplier.phone && (
                  <a
                    href={`tel:${supplier.phone.replace(/[^\d+]/g, '')}`}
                    className="hover:text-brand"
                  >
                    {supplier.phone}
                  </a>
                )}
              </DetailRow>
              <DetailRow label="Website">
                {supplier.website && (
                  <a
                    href={supplier.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 break-all hover:text-brand"
                  >
                    {supplier.website}
                    <ExternalLink className="size-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                  </a>
                )}
              </DetailRow>
              <DetailRow label="Address">{addressLine || null}</DetailRow>
              <DetailRow label="Code">
                {supplier.code && <span className="font-mono">{supplier.code}</span>}
              </DetailRow>
              <DetailRow label="Terms">{termsLabel}</DetailRow>
              <DetailRow label="Status">{supplier.isActive ? 'Active' : 'Inactive'}</DetailRow>
            </dl>
          </Panel>

          <div className="space-y-3">
            <Panel
              title="Communication & access"
              description="What this supplier agreed to be contacted on."
            >
              <p className="eyebrow mb-2 text-ink-400">Consent</p>
              <ConsentSummary consent={supplier.contactConsent} />
              {supplier.contactConsent?.at ? (
                <p className="mt-2.5 text-sm text-ink-400">
                  Recorded {date(supplier.contactConsent.at)}.
                </p>
              ) : (
                // Never asked is not the same fact as declined, and the panel
                // has to be able to say which - see `Supplier.contactConsent`.
                <p className="mt-2.5 text-sm text-ink-400">
                  Not recorded yet. Set it from Edit.
                </p>
              )}

              {/**
               * Portal access (§6.8a).
               *
               * **Here, not only in the list's row menu.** The button existed
               * solely as a `···` entry on `/admin/suppliers`, which is the
               * wrong place to look: you open a supplier's profile to act on
               * that supplier, and this page - the one about them - could not
               * say whether they could even sign in, let alone invite them.
               *
               * The state is stated before the button, because "has this
               * supplier got access?" is a question the screen has to be able
               * to answer on its own. A supplier who has never been invited
               * cannot answer a request for quote, and nothing anywhere said so.
               */}
              <div className="mt-4 border-t border-line pt-3">
                <p className="eyebrow mb-2 text-ink-400">Supplier portal</p>

                {!supplier.email ? (
                  <p className="text-sm text-ink-400">
                    No email address on file, so there is nowhere to send a portal link. Add one
                    from Edit.
                  </p>
                ) : !supplier.isActive ? (
                  // Deactivating is how the purchasing team ends a relationship,
                  // and it closes the portal door too - `invitePortal` refuses an
                  // inactive supplier, so offering the button here would only ever
                  // produce an error.
                  <p className="text-sm text-ink-400">
                    Inactive suppliers cannot sign in. Reactivate them to send a portal link.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-ink-600">
                      {supplier.portalInviteAt ? (
                        <>
                          Portal link sent {date(supplier.portalInviteAt)}.
                          {supplier.portalLastLoginAt
                            ? ` Last signed in ${date(supplier.portalLastLoginAt)}.`
                            : ' Not signed in yet.'}
                        </>
                      ) : (
                        'No portal access yet: they cannot answer a request for quote.'
                      )}
                    </p>

                    <Button
                      variant="outline"
                      icon={Mail}
                      className="mt-2.5"
                      loading={inviteSupplierPortal.isPending}
                      onClick={() => setConfirmingInvite(true)}
                    >
                      {supplier.portalInviteAt ? 'Resend portal link' : 'Send portal link'}
                    </Button>

                    {/* Said before the click: what the email carries, and that
                        nothing they already have stops working. */}
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
                      Emails a link to set a password for this business&apos;s supplier portal. An existing
                      password keeps working until the link is used.
                    </p>

                    <ConfirmDialog
                      open={confirmingInvite}
                      onClose={() => setConfirmingInvite(false)}
                      onConfirm={sendPortalInvite}
                      tone="warn"
                      title={`Email the portal link to ${supplier.email}?`}
                      body={`${supplier.name} gets a link to set a password for your supplier portal, valid for 7 days. Any earlier link stops working.`}
                      confirmLabel="Send link"
                      confirmPhrase={supplier.email}
                      loading={inviteSupplierPortal.isPending}
                    />
                  </>
                )}
              </div>
            </Panel>

            <Panel title="Notes">
              {supplier.notes ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">
                  {supplier.notes}
                </p>
              ) : (
                <p className="py-6 text-center text-sm text-ink-400">No notes recorded.</p>
              )}
            </Panel>

            <Panel
              title="Spend by month"
              description="Sent and received orders only - a draft is a plan, not money."
            >
              <BarList
                items={spend.map((row) => ({
                  label: monthLabel(row.label),
                  value: row.total,
                  hint: `${formatCount(row.count)} order${row.count === 1 ? '' : 's'}`,
                }))}
                caption="Spend by month"
                formatValue={money}
              />
            </Panel>
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <Panel title="Purchase orders" flush>
          {/* The count line is what carries the density toggle, so a table
              without one is a table a staff member cannot set the density of
              which is how every detail page ended up stuck at whatever the
              last list screen left the preference on. */}
          <div className="border-b border-line px-3 py-2 sm:px-4">
            <CountLine
              total={orders.length}
              shown={orderPage.pageRows.length}
              from={orderPage.from}
              noun={orders.length === 1 ? 'purchase order' : 'purchase orders'}
            />
          </div>

          <DataTable
            columns={orderColumns}
            rows={orderPage.pageRows}
            rowKey={(order) => order.id}
            rowMenu={orderMenu}
            onRowClick={(order) => navigate(`/admin/purchase-orders/${order.id}`)}
            defaultSort={{ key: 'orderDate', direction: 'desc' }}
            empty={
              <PanelEmpty
                icon={ClipboardList}
                title="No purchase orders"
                body="Nothing has been ordered from this supplier yet."
              />
            }
          />

          <Pagination
            page={orderPage.page}
            pages={orderPage.totalPages}
            onChange={orderPage.setPage}
            hideWhenSingle
            className="border-t border-line px-3 py-3 sm:px-4"
          />
        </Panel>
      )}

      {tab === 'products' && (
        <Panel
          title="Items supplied"
          description="Parts whose reorder defaults to this supplier."
          flush
        >
          <div className="border-b border-line px-3 py-2 sm:px-4">
            <CountLine
              total={products.length}
              shown={productPage.pageRows.length}
              from={productPage.from}
              noun={products.length === 1 ? 'item' : 'items'}
            />
          </div>

          <DataTable
            columns={productColumns}
            rows={productPage.pageRows}
            rowKey={(product) => product.id}
            rowMenu={productMenu}
            onRowClick={(product) => navigate(`/admin/inventory/${product.id}`)}
            defaultSort={{ key: 'name', direction: 'asc' }}
            empty={
              <PanelEmpty
                icon={Boxes}
                title="No inventory items linked to this supplier"
                body="Set a default supplier on a product from the Inventory screen."
              />
            }
          />

          <Pagination
            page={productPage.page}
            pages={productPage.totalPages}
            onChange={productPage.setPage}
            hideWhenSingle
            className="border-t border-line px-3 py-3 sm:px-4"
          />
        </Panel>
      )}
    </>
  );
}

/**
 * The four channels, each showing its answer.
 *
 * Read-only, so this is not `ConsentChannels` - that component is a control and
 * its chips invite a click. It reads from the same `CONSENT_CHANNELS` list, so
 * a channel added later appears on both without either being edited.
 *
 * A channel that was never asked shows an em dash rather than a cross: "we did
 * not ask" and "they said no" are different facts, and only one of them is a
 * reason to go and ask.
 */
function ConsentSummary({ consent }) {
  const recorded = Boolean(consent?.at);

  return (
    <div className="flex flex-wrap gap-2">
      {CONSENT_CHANNELS.map(({ key, label, icon: Icon }) => {
        const on = Boolean(consent?.[key]);
        return (
          <span
            key={key}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium',
              on
                ? 'border-ok/30 bg-ok-50 text-ok'
                : 'border-line bg-surface text-ink-400',
            )}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {label}
            <span aria-hidden="true">{!recorded ? '-' : on ? '✓' : '✕'}</span>
            <span className="sr-only">
              {!recorded ? 'not recorded' : on ? 'consented' : 'declined'}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default AdminSupplierProfilePage;
