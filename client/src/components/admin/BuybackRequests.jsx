import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Inbox, Search } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { date, money } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import DataTable from '@/components/admin/DataTable';
import { useBuybackRequests } from '@/hooks/usePreowned';

/**
 * Inventory › Kiosk buybacks: phones customers sold us at the kiosk, waiting
 * for a price (2026-10-02; was Purchase › Pre-owned › Requests).
 *
 * Almost always opened because a phone has just been handed over and needs a
 * price, so it starts on the ones waiting. Accepting one adds it to stock on
 * its product in the Phones type, like any delivery, which is why it lives
 * beside the stock it becomes rather than on a page of its own.
 */
const REQUEST_FILTERS = [
  { key: 'pending', label: 'Waiting' },
  { key: 'accepted', label: 'Bought' },
  { key: 'declined', label: 'Declined' },
  { key: 'all', label: 'All' },
];


const REQUEST_TONES = { pending: 'warn', accepted: 'ok', declined: 'neutral' };
const REQUEST_LABELS = { pending: 'Waiting', accepted: 'Bought', declined: 'Declined' };

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

export function BuybackRequests() {
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
          to={`/admin/inventory/buybacks/${row.id}`}
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
    <Panel title="Kiosk buybacks" description="Phones customers have sold us at the kiosk." icon={Inbox} flush>
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


export default BuybackRequests;
