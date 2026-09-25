import { useState } from 'react';
import { Search, Store } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { count as formatCount } from '@/lib/format';
import {
  PlatformBadge,
  PlatformEmpty,
  PlatformHeader,
  PlatformPageSkeleton,
  PlatformPanel,
  PlatformTable,
} from '@/components/superadmin/PlatformUI';
import {
  addressOf,
  BUSINESS_STATUS,
  BUSINESS_TYPE,
  businessAttention,
  usePlatformDirectory,
} from '@/components/superadmin/platformData';

/**
 * Every business on the platform, whoever owns it.
 *
 * Tenants are how we bill; businesses are what we actually run. An operator
 * chasing "the shop at parts.cellshoppe.ca" knows the business, not its
 * account, so this is the list that answers by name, address or code without
 * first guessing which tenant to open.
 */

const FILTERS = [
  { value: 'live', label: 'Trading' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'all', label: 'All' },
];

export function SuperAdminBusinessesPage() {
  const { businesses, storefrontDomain, isLoading } = usePlatformDirectory();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('live');

  if (isLoading) return <PlatformPageSkeleton />;

  const needle = search.trim().toLowerCase();
  const rows = businesses
    .filter((business) => {
      if (filter === 'live' && business.deletedAt) return false;
      if (filter === 'deleted' && !business.deletedAt) return false;
      if (filter === 'attention' && !businessAttention(business).length) return false;
      if (!needle) return true;
      return [business.name, business.code, business.slug, business.domain, business.panelDomain, business.tenant?.name]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle));
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const columns = [
    {
      key: 'name',
      label: 'Business',
      render: (business) => (
        <span className="block min-w-0">
          <span className="block truncate">{business.name}</span>
          <span className="block font-mono text-xs font-normal text-plat-dim">{business.code}</span>
        </span>
      ),
    },
    {
      key: 'tenant',
      label: 'Tenant',
      render: (business) => <span className="text-plat-muted">{business.tenant?.name ?? 'None'}</span>,
    },
    {
      key: 'type',
      label: 'Type',
      hideBelow: 'md',
      render: (business) => (
        <PlatformBadge tone={BUSINESS_TYPE[business.businessType]?.tone}>
          {BUSINESS_TYPE[business.businessType]?.label ?? business.businessType}
        </PlatformBadge>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (business) =>
        business.deletedAt ? (
          <PlatformBadge tone="danger">Deleted</PlatformBadge>
        ) : (
          <PlatformBadge tone={BUSINESS_STATUS[business.status]?.tone}>
            {BUSINESS_STATUS[business.status]?.label ?? business.status}
          </PlatformBadge>
        ),
    },
    {
      key: 'address',
      label: 'Address',
      hideBelow: 'lg',
      render: (business) => {
        const attention = businessAttention(business);
        return (
          <span className="block min-w-0">
            <span className="block max-w-64 truncate font-mono text-xs text-plat-muted">
              {business.domain || addressOf(business.slug, storefrontDomain) || 'None'}
            </span>
            {attention.length > 0 && <span className="block text-xs text-plat-warn">{attention.join(', ')}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PlatformHeader
        crumbs={[{ label: 'Overview', to: '/superadmin' }, { label: 'Businesses' }]}
        title="Businesses"
        description="What each tenant actually runs: a website, an ERP and a database of its own."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative w-full min-w-0 sm:w-auto sm:max-w-80 sm:flex-1">
          <span className="sr-only">Search businesses</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-plat-dim" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, code, address or tenant"
            className="h-9 w-full rounded-lg border border-plat-line bg-plat-surface pl-9 pr-3 text-lg text-plat-text outline-none placeholder:text-plat-dim focus:border-plat-accent focus:ring-2 focus:ring-plat-accent/25 sm:text-sm"
          />
        </label>
        <div className="scroll-slim flex gap-1 overflow-x-auto" role="group" aria-label="Filter businesses">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                pressable,
                'h-9 shrink-0 rounded-lg px-3 text-sm font-medium',
                filter === option.value ? 'bg-plat-accent/15 text-plat-text' : 'text-plat-muted hover:bg-plat-text/5 hover:text-plat-text',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="tnum ml-auto text-sm text-plat-dim">
          {formatCount(rows.length)} of {formatCount(businesses.length)}
        </p>
      </div>

      <PlatformTable
        columns={columns}
        rows={rows}
        rowTo={(business) => `/superadmin/businesses/${business.id}`}
        empty={
          <PlatformPanel>
            <PlatformEmpty
              icon={Store}
              title="No business matches"
              body="Businesses are created from a tenant's page, which spends one of its slots."
            />
          </PlatformPanel>
        }
      />
    </>
  );
}

export default SuperAdminBusinessesPage;
