import { Link } from 'react-router';
import { ArrowRight, Globe } from 'lucide-react';

import { relativeTime } from '@/lib/format';
import {
  PlatformBadge,
  PlatformEmpty,
  PlatformHeader,
  PlatformPageSkeleton,
  PlatformPanel,
  PlatformTable,
} from '@/components/superadmin/PlatformUI';
import { addressOf, domainState, usePlatformDirectory } from '@/components/superadmin/platformData';

/**
 * Every address the platform answers on for a business, in one list.
 *
 * Read-only on purpose. Changing an address happens on the business's own
 * Domains tab, behind the two-step confirmation; this page is where an
 * operator sees the whole estate at once: which domains are live, which are
 * still waiting on somebody's DNS, and which tenants are waiting on us.
 */

function DomainCell({ host, liveAt }) {
  const state = domainState(host, liveAt);
  if (state === 'none') return <span className="text-plat-dim">None</span>;
  return (
    <span className="block min-w-0">
      <span className="block max-w-64 truncate font-mono text-xs text-plat-text">{host}</span>
      {state === 'live' ? (
        <span className="text-xs text-plat-ok">Live</span>
      ) : (
        <span className="text-xs text-plat-warn">Waiting for DNS</span>
      )}
    </span>
  );
}

export function SuperAdminDomainsPage() {
  const { businesses, storefrontDomain, isLoading } = usePlatformDirectory();
  if (isLoading) return <PlatformPageSkeleton />;

  const live = businesses.filter((business) => !business.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
  const requests = live.filter((business) => business.addressRequest?.status === 'pending');

  const columns = [
    {
      key: 'name',
      label: 'Business',
      render: (business) => (
        <span className="block min-w-0">
          <span className="block truncate">{business.name}</span>
          <span className="block text-xs font-normal text-plat-dim">{business.tenant?.name ?? 'No tenant'}</span>
        </span>
      ),
    },
    {
      key: 'address',
      label: 'Web address',
      render: (business) =>
        business.slug ? (
          <span className="font-mono text-xs text-plat-muted">{addressOf(business.slug, storefrontDomain)}</span>
        ) : (
          <span className="text-xs text-plat-warn">None</span>
        ),
    },
    {
      key: 'domain',
      label: 'Website domain',
      render: (business) => <DomainCell host={business.domain} liveAt={business.domainLiveAt} />,
    },
    {
      key: 'panel',
      label: 'ERP domain',
      render: (business) => <DomainCell host={business.panelDomain} liveAt={business.panelDomainLiveAt} />,
    },
  ];

  return (
    <>
      <PlatformHeader
        crumbs={[{ label: 'Overview', to: '/superadmin' }, { label: 'Domains' }]}
        title="Domains"
        description={
          storefrontDomain
            ? `Every business gets an address on ${storefrontDomain}, and may add domains of its own. Changes are made on each business's Domains tab.`
            : 'Kelinto’s own domain is not configured on the server, so businesses have no subdomain yet.'
        }
      />

      {requests.length > 0 && (
        <PlatformPanel
          className="mb-6"
          title="Waiting on you"
          description="Addresses tenants asked for. Approving puts one live immediately."
          flush
        >
          <ul className="divide-y divide-plat-line-soft border-t border-plat-line-soft">
            {requests.map((business) => (
              <li key={business.id}>
                <Link
                  to={`/superadmin/businesses/${business.id}/domains`}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors duration-fast hover:bg-plat-text/3"
                >
                  <Globe className="size-4 shrink-0 text-plat-warn" strokeWidth={2} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-md text-plat-text">
                      {addressOf(business.addressRequest.slug, storefrontDomain)}
                    </span>
                    <span className="block text-xs text-plat-dim">
                      {business.name} · {relativeTime(business.addressRequest.requestedAt)}
                    </span>
                  </span>
                  <PlatformBadge tone="warn">Review</PlatformBadge>
                  <ArrowRight className="size-4 shrink-0 text-plat-dim" strokeWidth={2} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </PlatformPanel>
      )}

      <PlatformTable
        columns={columns}
        rows={live}
        rowTo={(business) => `/superadmin/businesses/${business.id}/domains`}
        empty={
          <PlatformPanel>
            <PlatformEmpty icon={Globe} title="No businesses yet" body="Addresses appear once a tenant has a business." />
          </PlatformPanel>
        }
      />
    </>
  );
}

export default SuperAdminDomainsPage;
