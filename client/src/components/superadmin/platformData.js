import { useMemo } from 'react';
import { useImpersonations, usePlans, useSupportThreads, useTenants } from '@/hooks/useSuperAdmin';

/**
 * What the console knows, read the same way on every page.
 *
 * The server answers `/superadmin/tenants` with tenants holding their
 * businesses, plus a list owned by nobody. Every page used to walk that shape
 * itself; now that a business, a tenant and a domain each have a page of their
 * own, one lookup answers "which record does this URL name" for all of them,
 * and the counts on the overview and the badges in the rail cannot disagree.
 */

export const TENANT_STATUS = {
  active: { label: 'Active', tone: 'ok' },
  past_due: { label: 'Past due', tone: 'warn' },
  suspended: { label: 'Suspended', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

/**
 * What each subscription status does, said where it is chosen rather than
 * only in the middleware that enforces it.
 */
export const TENANT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active', description: 'Everything works normally.' },
  {
    value: 'past_due',
    label: 'Past due',
    description:
      'Full read access, so they can still chase the payment that settles the bill. Nothing new can be created.',
  },
  { value: 'suspended', label: 'Suspended', description: 'The ERP opens read-only. Nothing can be changed.' },
  { value: 'cancelled', label: 'Cancelled', description: 'The account is closed. Only billing stays reachable.' },
];

export const BUSINESS_TYPE = {
  product: { label: 'Product', tone: 'accent', description: 'Sells goods: orders, returns, a catalogue.' },
  service: { label: 'Service', tone: 'warn', description: 'Sells work: tickets, quotes, a service list.' },
  both: { label: 'Product and service', tone: 'ok', description: 'Goods and work, one customer list.' },
};

export const BUSINESS_TYPE_OPTIONS = Object.entries(BUSINESS_TYPE).map(([value, row]) => ({
  value,
  label: row.label,
  description: row.description,
}));

export const BUSINESS_STATUS = {
  active: { label: 'Open', tone: 'ok' },
  inactive: { label: 'Closed', tone: 'neutral' },
  maintenance: { label: 'Maintenance', tone: 'warn' },
};

export const BUSINESS_STATUS_OPTIONS = [
  { value: 'active', label: 'Open', description: 'The website and ERP work normally.' },
  {
    value: 'maintenance',
    label: 'Maintenance',
    description: 'Temporarily unavailable while something is being fixed. Staff keep access.',
  },
  { value: 'inactive', label: 'Closed', description: 'Not trading. Records stay, nothing is deleted.' },
];

/**
 * The address a slug becomes, as a customer would type it. Without a platform
 * domain on the server there is no domain to promise, so the slug stands alone.
 */
export function addressOf(slug, storefrontDomain) {
  if (!slug) return '';
  return storefrontDomain ? `${slug}.${storefrontDomain}` : slug;
}

/**
 * Where a custom domain stands. `live` means a real HTTPS request has arrived
 * on it (`hostDirectory.markHostLive`), so DNS and the certificate both work.
 */
export function domainState(domain, liveAt) {
  if (!domain) return 'none';
  return liveAt ? 'live' : 'waiting';
}

/** What a business still needs from an operator, as short reasons. */
export function businessAttention(business) {
  if (business.deletedAt) return [];
  const reasons = [];
  if (business.addressRequest?.status === 'pending') reasons.push('address request');
  if (domainState(business.domain, business.domainLiveAt) === 'waiting') reasons.push('website DNS');
  if (domainState(business.panelDomain, business.panelDomainLiveAt) === 'waiting') reasons.push('ERP DNS');
  if (!business.slug) reasons.push('no web address');
  return reasons;
}

/**
 * The directory: every tenant and business, indexed, with the platform's
 * domain settings beside them.
 */
export function usePlatformDirectory() {
  const query = useTenants();
  const { data } = query;

  const directory = useMemo(() => {
    const tenants = data?.tenants ?? [];
    const unassigned = data?.unassigned ?? [];
    const businesses = [
      ...tenants.flatMap((tenant) => tenant.businesses.map((business) => ({ ...business, tenant }))),
      ...unassigned.map((business) => ({ ...business, tenant: null })),
    ];
    return {
      tenants,
      unassigned,
      businesses,
      tenantById: new Map(tenants.map((tenant) => [tenant.id, tenant])),
      businessById: new Map(businesses.map((business) => [business.id, business])),
      storefrontDomain: data?.storefrontDomain ?? null,
      platformDomains: data?.platformDomains ?? [],
    };
  }, [data]);

  return { ...directory, isLoading: query.isLoading, isError: query.isError };
}

/**
 * The figures behind the overview and the rail's badges, from one place.
 *
 * Monthly recurring revenue is what the plans say active tenants pay: a
 * price list multiplied out, not money received. The overview labels it so.
 */
export function usePlatformPulse() {
  const directory = usePlatformDirectory();
  const { data: planData } = usePlans();
  const { data: threadData } = useSupportThreads();
  const { data: grantData } = useImpersonations({ live: true });

  return useMemo(() => {
    const plans = planData?.plans ?? [];
    const priceOf = new Map(plans.map((plan) => [plan.id, plan.priceCents ?? 0]));
    const liveBusinesses = directory.businesses.filter((business) => !business.deletedAt);
    const paying = directory.tenants.filter((tenant) => tenant.status === 'active' && tenant.plan);
    const threads = threadData?.threads ?? [];
    const grants = (grantData?.grants ?? []).filter((grant) => grant.live);

    return {
      ...directory,
      plans,
      threads,
      liveGrants: grants,
      liveBusinesses,
      mrrCents: paying.reduce((sum, tenant) => sum + (priceOf.get(tenant.plan.id) ?? 0), 0),
      slotsGranted: directory.tenants.reduce((sum, tenant) => sum + (tenant.slots ?? 0), 0),
      slotsUsed: directory.tenants.reduce((sum, tenant) => sum + (tenant.slotsUsed ?? 0), 0),
      pendingRequests: liveBusinesses.filter((business) => business.addressRequest?.status === 'pending'),
      waitingDomains: liveBusinesses.filter(
        (business) =>
          domainState(business.domain, business.domainLiveAt) === 'waiting' ||
          domainState(business.panelDomain, business.panelDomainLiveAt) === 'waiting',
      ),
      unreadThreads: threads.filter((thread) => thread.unread > 0),
      ownerless: directory.tenants.filter((tenant) => !tenant.admins?.length && tenant.businesses.length),
      troubledTenants: directory.tenants.filter((tenant) => tenant.status !== 'active'),
    };
  }, [directory, planData, threadData, grantData]);
}
