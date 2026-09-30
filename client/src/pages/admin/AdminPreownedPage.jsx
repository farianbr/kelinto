import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowUpRight, Globe, Inbox, Pencil, PackageX, Search, Smartphone } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { date, money } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import TabRow from '@/components/ui/TabRow';
import PageHeader from '@/components/admin/PageHeader';
import DataTable from '@/components/admin/DataTable';
import PreownedStockForm from '@/components/admin/PreownedStockForm';
import Modal from '@/components/ui/Modal';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useBuybackRequests, usePreownedMutations, usePreownedStock } from '@/hooks/usePreowned';

/**
 * Inventory › Pre-owned: phones bought from customers, and the stock they became.
 *
 * ## What the screen is opened for
 *
 * Almost always: **a phone has just been handed over at the kiosk and needs a
 * price.** So it opens on Requests, filtered to the ones waiting, and the
 * sidebar badge counts them. Stock is the second tab, for listing a phone on
 * the website once it has photos, and for finding one by IMEI.
 *
 * Two tabs on one screen rather than two screens, because a request and a unit
 * are one phone at two moments, and the person pricing it is the person who
 * lists it.
 */

const PAGE_ICON = adminIcon('Smartphone');

const REQUEST_FILTERS = [
  { key: 'pending', label: 'Waiting' },
  { key: 'accepted', label: 'Bought' },
  { key: 'declined', label: 'Declined' },
  { key: 'all', label: 'All' },
];

const STOCK_FILTERS = [
  { key: 'available', label: 'In stock' },
  { key: 'listed', label: 'On the website' },
  { key: 'sold', label: 'Sold' },
  { key: 'withdrawn', label: 'Withdrawn' },
];

const REQUEST_TONES = { pending: 'warn', accepted: 'ok', declined: 'neutral' };
const REQUEST_LABELS = { pending: 'Waiting', accepted: 'Bought', declined: 'Declined' };
const STOCK_TONES = { in_stock: 'neutral', listed: 'ok', sold: 'info', withdrawn: 'neutral' };
const STOCK_LABELS = {
  in_stock: 'In stock',
  listed: 'On the website',
  sold: 'Sold',
  withdrawn: 'Withdrawn',
};

function FilterPills({ filters, value, onChange, counts }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {filters.map((filter) => {
        const active = value === filter.key;
        const count =
          filter.key === 'all'
            ? Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0)
            : filter.key === 'available'
              ? (counts?.in_stock ?? 0) + (counts?.listed ?? 0)
              : (counts?.[filter.key] ?? 0);
        return (
          <button
            key={filter.key}
            type="button"
            onClick={() => onChange(filter.key)}
            aria-pressed={active}
            className={cn(
              pressable,
              'rounded-md px-2.5 py-1.5 text-sm font-medium',
              active ? 'bg-surface-2 text-ink-900' : 'text-ink-500 hover:bg-surface-2 hover:text-ink-900',
            )}
          >
            {filter.label}
            <span className="tnum ml-1.5 text-xs text-ink-400">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function RequestsTab() {
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const { data, isLoading } = useBuybackRequests({ status, q });
  const rows = data?.buybacks ?? [];

  const columns = [
    {
      key: 'number',
      header: 'Request',
      width: '14%',
      render: (row) => (
        <Link
          to={`/admin/preowned/requests/${row.id}`}
          className={cn(pressable, 'group inline-flex items-center gap-1 font-mono text-sm font-semibold text-ink-900 hover:text-brand')}
        >
          {row.number}
          <ArrowUpRight className="size-3.5 text-ink-300 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2.25} aria-hidden="true" />
        </Link>
      ),
    },
    {
      key: 'device',
      header: 'Phone',
      width: '30%',
      sortValue: (row) => row.device.title,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{row.device.title}</p>
          <p className="tnum truncate font-mono text-xs text-ink-400">IMEI {row.device.imei}</p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Seller',
      width: '22%',
      priority: 2,
      sortValue: (row) => row.customer.name,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-700">{row.customer.name}</p>
          {row.customer.phone && <p className="tnum truncate text-xs text-ink-400">{row.customer.phone}</p>}
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Handed in',
      width: '14%',
      priority: 3,
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => <span className="text-sm text-ink-600">{date(row.createdAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '12%',
      render: (row) => (
        <Badge tone={REQUEST_TONES[row.status]} size="sm">
          {REQUEST_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: 'paid',
      header: 'Paid',
      width: '8%',
      align: 'right',
      priority: 2,
      sortValue: (row) => row.review.purchasePriceCents ?? -1,
      render: (row) =>
        row.review.purchasePriceCents != null ? (
          <span className="tnum text-sm text-ink-900">{money(row.review.purchasePriceCents)}</span>
        ) : (
          <span className="text-ink-300">–</span>
        ),
    },
  ];

  return (
    <Panel title="Requests" description="Phones customers have sold us at the kiosk." icon={Inbox} flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search number, seller, model or IMEI"
          icon={Search}
          className="w-full sm:w-80"
          aria-label="Search requests"
        />
        <FilterPills filters={REQUEST_FILTERS} value={status} onChange={setStatus} counts={data?.counts} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        defaultSort={{ key: 'createdAt', direction: 'desc' }}
        empty={
          <PanelEmpty
            icon={Inbox}
            title={status === 'pending' ? 'Nothing waiting to be priced' : 'No requests here'}
            body={
              q
                ? 'Nothing matches that search.'
                : 'A phone a customer sells at the kiosk appears here, ready to be priced.'
            }
          />
        }
      />
    </Panel>
  );
}

function StockTab() {
  const [status, setStatus] = useState('available');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const { data, isLoading } = usePreownedStock({ status, q });
  const { updateStock } = usePreownedMutations();
  const rows = data?.devices ?? [];

  const columns = [
    {
      key: 'stockNumber',
      header: 'Stock no.',
      width: '12%',
      render: (row) => <span className="font-mono text-sm font-semibold text-ink-900">{row.stockNumber}</span>,
    },
    {
      key: 'title',
      header: 'Phone',
      width: '32%',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          {row.photos[0] ? (
            <img src={row.photos[0]} alt="" width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded-md border border-line object-cover" />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2">
              <Smartphone className="size-4 text-ink-300" strokeWidth={1.75} aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-900">{row.title}</p>
            <p className="tnum truncate font-mono text-xs text-ink-400">
              {row.gradeLabel} · IMEI {row.imei ?? '–'}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'costCents',
      header: 'Paid',
      width: '10%',
      align: 'right',
      priority: 2,
      render: (row) => <span className="tnum text-sm text-ink-600">{money(row.costCents)}</span>,
    },
    {
      key: 'priceCents',
      header: 'Price',
      width: '10%',
      align: 'right',
      render: (row) => <span className="tnum text-sm font-semibold text-ink-900">{money(row.priceCents)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '14%',
      render: (row) => (
        <Badge tone={STOCK_TONES[row.status]} size="sm">
          {STOCK_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: 'source',
      header: 'Bought on',
      width: '14%',
      priority: 3,
      sortValue: (row) => row.buybackNumber ?? '',
      render: (row) =>
        row.buybackId ? (
          <Link to={`/admin/preowned/requests/${row.buybackId}`} className="font-mono text-xs text-brand hover:underline">
            {row.buybackNumber}
          </Link>
        ) : (
          <span className="text-ink-300">–</span>
        ),
    },
  ];

  const setStatusOf = (row, next) =>
    updateStock.mutateAsync({ id: row.id, status: next });

  const rowMenu = [
    {
      key: 'edit',
      label: 'Edit price, grade and photos',
      icon: Pencil,
      hidden: (row) => row.status === 'sold',
      onSelect: setEditing,
    },
    {
      key: 'list',
      label: 'Put on the website',
      icon: Globe,
      hidden: (row) => row.status !== 'in_stock' && row.status !== 'withdrawn',
      confirm: (row) => ({
        title: `Put ${row.stockNumber} on the website?`,
        body: `${row.title} goes on sale at ${money(row.priceCents)} on the pre-owned page. Approved customers see the price and can buy it.`,
        confirmLabel: 'Put on sale',
        tone: 'warn',
      }),
      onSelect: (row) => setStatusOf(row, 'listed'),
    },
    {
      key: 'unlist',
      label: 'Take off the website',
      icon: Globe,
      hidden: (row) => row.status !== 'listed',
      confirm: (row) => ({
        title: `Take ${row.stockNumber} off the website?`,
        body: `${row.title} stays in stock but can no longer be bought online. A cart already holding it will say it is gone.`,
        confirmLabel: 'Take off sale',
        tone: 'warn',
      }),
      onSelect: (row) => setStatusOf(row, 'in_stock'),
    },
    {
      key: 'withdraw',
      label: 'Withdraw from stock',
      icon: PackageX,
      tone: 'danger',
      hidden: (row) => row.status === 'sold' || row.status === 'withdrawn',
      confirm: (row) => ({
        title: `Withdraw ${row.stockNumber} from stock?`,
        body: `${row.title} is taken out of stock and off the website, for a phone sent for parts or returned. It stays on record and can be put back on sale later.`,
        confirmLabel: 'Withdraw',
      }),
      onSelect: (row) => setStatusOf(row, 'withdrawn'),
    },
  ];

  return (
    <Panel title="Stock" description="Each phone is one unit, with its own IMEI and price." icon={Smartphone} flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search stock no., model or IMEI"
          icon={Search}
          className="w-full sm:w-80"
          aria-label="Search stock"
        />
        <FilterPills filters={STOCK_FILTERS} value={status} onChange={setStatus} counts={data?.counts} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowMenu={rowMenu}
        loading={isLoading}
        defaultSort={{ key: 'stockNumber', direction: 'desc' }}
        empty={
          <PanelEmpty
            icon={Smartphone}
            title="No phones here"
            body={q ? 'Nothing matches that search.' : 'A request you price and buy becomes a phone in stock here.'}
          />
        }
      />

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.stockNumber} · ${editing.title}` : ''}
        size="md"
        align="top"
      >
        {editing && (
          <PreownedStockForm
            device={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => setEditing(null)}
          />
        )}
      </Modal>
    </Panel>
  );
}

export function AdminPreownedPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'stock' ? 'stock' : 'requests';

  return (
    <div className="space-y-4">
      <PageHeader
        icon={PAGE_ICON}
        title="Pre-owned"
        description="Phones customers sold us at the kiosk: price them, then sell them on the website."
      />

      <TabRow
        panel
        value={tab}
        onChange={(next) => setParams(next === 'stock' ? { tab: 'stock' } : {}, { replace: true })}
        tabs={[
          { key: 'requests', label: 'Requests', icon: Inbox },
          { key: 'stock', label: 'Stock', icon: Smartphone },
        ]}
      />

      {tab === 'requests' ? <RequestsTab /> : <StockTab />}
    </div>
  );
}

export default AdminPreownedPage;
