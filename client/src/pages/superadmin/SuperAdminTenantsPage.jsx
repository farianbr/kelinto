import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Building2, Plus, Search } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { count as formatCount, date } from '@/lib/format';
import { toast } from '@/store/toastStore';
import {
  PlatformBadge,
  PlatformButton,
  PlatformEmpty,
  PlatformHeader,
  PlatformPageSkeleton,
  PlatformPanel,
  PlatformTable,
} from '@/components/superadmin/PlatformUI';
import { PlatformModal } from '@/components/superadmin/PlatformForm';
import { TenantForm } from '@/components/superadmin/ConsoleForms';
import { TENANT_STATUS, usePlatformDirectory } from '@/components/superadmin/platformData';
import { usePlans, useSuperAdminMutations } from '@/hooks/useSuperAdmin';

/**
 * Every tenant, as a list you can find one in.
 *
 * **A table, because tenants are compared.** Which accounts are past due, who
 * is out of slots, who has nobody able to sign in: each is a column read down,
 * which the old stack of panels made impossible past three tenants. The row
 * opens the tenant's own page, where everything that used to hang off the
 * panel header now lives.
 */

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'attention', label: 'Needs attention' },
];

export function SuperAdminTenantsPage() {
  const navigate = useNavigate();
  const { tenants, unassigned, isLoading } = usePlatformDirectory();
  const { data: planData } = usePlans();
  const { createTenant } = useSuperAdminMutations();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  if (isLoading) return <PlatformPageSkeleton />;

  const needle = search.trim().toLowerCase();
  const attention = (tenant) =>
    tenant.status !== 'active' || !tenant.admins?.length || (tenant.slotsFree === 0 && tenant.slots > 0);
  const rows = tenants.filter((tenant) => {
    if (filter === 'active' && tenant.status !== 'active') return false;
    if (filter === 'attention' && !attention(tenant)) return false;
    if (!needle) return true;
    return [tenant.name, tenant.contactName, tenant.contactEmail, ...tenant.businesses.map((b) => b.name)]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(needle));
  });

  const columns = [
    {
      key: 'name',
      label: 'Tenant',
      render: (tenant) => (
        <span className="block min-w-0">
          <span className="block truncate">{tenant.name}</span>
          <span className="block truncate text-xs font-normal text-plat-dim">
            {tenant.contactEmail || tenant.contactName || 'No contact on file'}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (tenant) => (
        <PlatformBadge tone={TENANT_STATUS[tenant.status]?.tone}>
          {TENANT_STATUS[tenant.status]?.label ?? tenant.status}
        </PlatformBadge>
      ),
    },
    { key: 'plan', label: 'Plan', render: (tenant) => <span className="text-plat-muted">{tenant.plan?.name ?? 'No plan'}</span> },
    {
      key: 'businesses',
      label: 'Businesses',
      align: 'right',
      render: (tenant) => (
        <span className="tnum text-plat-muted">
          {formatCount(tenant.businesses.filter((b) => !b.deletedAt).length)}
        </span>
      ),
    },
    {
      key: 'slots',
      label: 'Slots',
      align: 'right',
      render: (tenant) => (
        <span className={cn('tnum', tenant.slotsFree === 0 ? 'text-plat-warn' : 'text-plat-muted')}>
          {formatCount(tenant.slotsUsed)} / {formatCount(tenant.slots)}
        </span>
      ),
    },
    {
      key: 'owner',
      label: 'Owner',
      hideBelow: 'lg',
      render: (tenant) =>
        tenant.admins?.length ? (
          <span className="block max-w-48 truncate text-plat-muted">{tenant.admins[0].email}</span>
        ) : (
          <span className="text-plat-warn">None</span>
        ),
    },
    {
      key: 'created',
      label: 'Since',
      hideBelow: 'lg',
      render: (tenant) => <span className="text-plat-dim">{date(tenant.createdAt)}</span>,
    },
  ];

  return (
    <>
      <PlatformHeader
        crumbs={[{ label: 'Overview', to: '/superadmin' }, { label: 'Tenants' }]}
        title="Tenants"
        description="An account that owns one or more businesses. Slots decide how many; the plan decides what they start with."
        action={
          <PlatformButton variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New tenant
          </PlatformButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative w-full min-w-0 sm:w-auto sm:max-w-80 sm:flex-1">
          <span className="sr-only">Search tenants</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-plat-dim" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, contact or business"
            className="h-9 w-full rounded-lg border border-plat-line bg-plat-surface pl-9 pr-3 text-lg text-plat-text outline-none placeholder:text-plat-dim focus:border-plat-accent focus:ring-2 focus:ring-plat-accent/25 sm:text-sm"
          />
        </label>
        <div className="flex gap-1" role="group" aria-label="Filter tenants">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                pressable,
                'h-9 rounded-lg px-3 text-sm font-medium',
                filter === option.value
                  ? 'bg-plat-accent/15 text-plat-text'
                  : 'text-plat-muted hover:bg-plat-text/5 hover:text-plat-text',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="tnum ml-auto text-sm text-plat-dim">
          {formatCount(rows.length)} of {formatCount(tenants.length)}
        </p>
      </div>

      <PlatformTable
        columns={columns}
        rows={rows}
        rowTo={(tenant) => `/superadmin/tenants/${tenant.id}`}
        empty={
          <PlatformPanel>
            <PlatformEmpty
              icon={Building2}
              title={tenants.length ? 'No tenant matches' : 'No tenants yet'}
              body={
                tenants.length
                  ? 'Try another name, or clear the filter.'
                  : 'A tenant is an account that owns one or more businesses. Create one to get started.'
              }
              action={
                !tenants.length && (
                  <PlatformButton variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                    New tenant
                  </PlatformButton>
                )
              }
            />
          </PlatformPanel>
        }
      />

      {/* A business owned by nobody is a real state somebody has to resolve;
          hiding it would make the slot arithmetic disagree with the database. */}
      {unassigned.length > 0 && (
        <PlatformPanel
          className="mt-6"
          title="Businesses with no tenant"
          description="They predate tenants and count against nobody's slots."
          flush
        >
          <ul className="divide-y divide-plat-line-soft border-t border-plat-line-soft">
            {unassigned.map((business) => (
              <li key={business.id}>
                <Link
                  to={`/superadmin/businesses/${business.id}`}
                  className="flex items-center gap-3 px-5 py-3 text-md text-plat-text hover:bg-plat-text/3"
                >
                  <span className="min-w-0 flex-1 truncate">{business.name}</span>
                  <span className="font-mono text-xs text-plat-dim">{business.code}</span>
                </Link>
              </li>
            ))}
          </ul>
        </PlatformPanel>
      )}

      <PlatformModal open={creating} onClose={() => setCreating(false)} title="New tenant" size="md" align="top">
        <TenantForm
          plans={planData?.plans ?? []}
          isPending={createTenant.isPending}
          error={createTenant.error?.message}
          onCancel={() => setCreating(false)}
          onSubmit={(values) =>
            createTenant.mutate(values, {
              onSuccess: (result) => {
                setCreating(false);
                toast.ok('Tenant created', `${values.name} is on Kelinto. Add a business next.`);
                if (result?.tenant?.id) navigate(`/superadmin/tenants/${result.tenant.id}`);
              },
            })
          }
        />
      </PlatformModal>
    </>
  );
}

export default SuperAdminTenantsPage;
