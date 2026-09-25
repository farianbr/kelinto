import { Link } from 'react-router';
import { ArrowRight, CheckCircle2, Globe, LifeBuoy, ShieldAlert, UserX, Wallet } from 'lucide-react';

import cn from '@/lib/cn';
import { pressableSurface } from '@/lib/motion';
import { count as formatCount, date, money, relativeTime } from '@/lib/format';
import {
  PlatformBadge,
  PlatformHeader,
  PlatformPageSkeleton,
  PlatformPanel,
  PlatformStat,
} from '@/components/superadmin/PlatformUI';
import { addressOf, TENANT_STATUS, usePlatformPulse } from '@/components/superadmin/platformData';

/**
 * The console's front page: is the platform healthy, and what is waiting on us.
 *
 * **Opened for the queue.** An operator lands here to learn whether anybody is
 * waiting: an address request, an unread message, a colleague still inside a
 * customer's records. That list is the page's weight, placed first in reading
 * order on a phone and in the wide column on a desktop. The figures above it
 * are context, set as a quiet row, because a number nobody acts on should not
 * outrank the work.
 *
 * **Nothing here reads a tenant's books.** Revenue is the price list
 * multiplied out, labelled as such; the console never sees a tenant's own
 * sales, by design (SAAS_PLATFORM §4.5).
 */

function QueueItem({ icon: Icon, tone, title, detail, to, when }) {
  return (
    <li>
      <Link
        to={to}
        className={cn(pressableSurface, 'flex items-start gap-3 px-5 py-3.5 transition-colors duration-fast hover:bg-plat-text/3')}
      >
        <Icon
          className={cn('mt-0.5 size-4 shrink-0', tone === 'danger' ? 'text-plat-danger' : tone === 'accent' ? 'text-plat-accent-soft' : 'text-plat-warn')}
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-md font-medium text-plat-text">{title}</span>
          <span className="mt-0.5 block truncate text-sm text-plat-muted">{detail}</span>
        </span>
        {when && <span className="shrink-0 pt-0.5 text-xs text-plat-dim">{when}</span>}
        <ArrowRight className="mt-0.5 size-4 shrink-0 text-plat-dim" strokeWidth={2} aria-hidden="true" />
      </Link>
    </li>
  );
}

export function SuperAdminOverviewPage() {
  const pulse = usePlatformPulse();

  if (pulse.isLoading) return <PlatformPageSkeleton />;

  const activeTenants = pulse.tenants.filter((tenant) => tenant.status === 'active').length;
  const deleted = pulse.businesses.length - pulse.liveBusinesses.length;

  /**
   * The queue, most urgent first: a person inside a customer's records, then a
   * customer waiting on a reply, then a customer waiting on an address, then
   * accounts nobody can sign in to. DNS is last because the next move is the
   * customer's, not ours.
   */
  const queue = [
    ...pulse.liveGrants.map((grant) => ({
      key: `grant-${grant.id}`,
      icon: ShieldAlert,
      tone: 'danger',
      title: `${grant.superAdminName || grant.superAdminEmail} is inside ${grant.businessName}`,
      detail: grant.reason,
      to: '/superadmin/access',
      when: `until ${date(grant.expiresAt)}`,
    })),
    ...pulse.unreadThreads.map((thread) => ({
      key: `thread-${thread.id}`,
      icon: LifeBuoy,
      tone: 'accent',
      title: `${thread.tenantName} wrote ${thread.unread === 1 ? 'a message' : `${thread.unread} messages`}`,
      detail: thread.preview,
      to: `/superadmin/support/${thread.tenant}`,
      when: relativeTime(thread.lastMessageAt),
    })),
    ...pulse.pendingRequests.map((business) => ({
      key: `request-${business.id}`,
      icon: Globe,
      tone: 'warn',
      title: `${business.name} asked for ${addressOf(business.addressRequest.slug, pulse.storefrontDomain)}`,
      detail: business.tenant?.name ?? 'No tenant',
      to: `/superadmin/businesses/${business.id}/domains`,
      when: relativeTime(business.addressRequest.requestedAt),
    })),
    ...pulse.ownerless.map((tenant) => ({
      key: `owner-${tenant.id}`,
      icon: UserX,
      tone: 'warn',
      title: `${tenant.name} has no owner`,
      detail: 'Nobody can sign in to administer it.',
      to: `/superadmin/tenants/${tenant.id}/owners`,
    })),
    ...pulse.troubledTenants.map((tenant) => ({
      key: `status-${tenant.id}`,
      icon: Wallet,
      tone: tenant.status === 'cancelled' ? 'danger' : 'warn',
      title: `${tenant.name} is ${TENANT_STATUS[tenant.status]?.label.toLowerCase() ?? tenant.status}`,
      detail: TENANT_STATUS[tenant.status] ? 'Their ERP is restricted until this changes.' : '',
      to: `/superadmin/tenants/${tenant.id}/subscription`,
    })),
    ...pulse.waitingDomains.map((business) => ({
      key: `dns-${business.id}`,
      icon: Globe,
      tone: 'warn',
      title: `${business.name} is waiting for DNS`,
      detail: [business.domain, business.panelDomain].filter(Boolean).join(' · '),
      to: `/superadmin/businesses/${business.id}/domains`,
    })),
  ];

  const recent = [...pulse.tenants]
    .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0))
    .slice(0, 5);

  const planMix = pulse.plans
    .map((plan) => ({ ...plan, tenants: pulse.tenants.filter((tenant) => tenant.plan?.id === plan.id).length }))
    .filter((plan) => plan.tenants > 0 || plan.isActive);
  const noPlan = pulse.tenants.filter((tenant) => !tenant.plan).length;
  const mixTotal = Math.max(1, pulse.tenants.length);

  return (
    <>
      <PlatformHeader
        eyebrow="Kelinto"
        title="Overview"
        description={
          queue.length
            ? `${formatCount(queue.length)} thing${queue.length === 1 ? '' : 's'} waiting on the Kelinto team.`
            : 'Nothing is waiting on the Kelinto team.'
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <PlatformStat
          label="Tenants"
          value={formatCount(pulse.tenants.length)}
          detail={`${formatCount(activeTenants)} active`}
          to="/superadmin/tenants"
        />
        <PlatformStat
          label="Businesses"
          value={formatCount(pulse.liveBusinesses.length)}
          detail={deleted ? `${formatCount(deleted)} deleted, restorable` : 'All trading'}
          to="/superadmin/businesses"
        />
        <PlatformStat
          label="Slots in use"
          value={`${formatCount(pulse.slotsUsed)} / ${formatCount(pulse.slotsGranted)}`}
          detail="Across every tenant"
        />
        <PlatformStat
          label="Monthly recurring"
          value={money(pulse.mrrCents)}
          detail="List price of active plans"
          to="/superadmin/plans"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <PlatformPanel
          title="Needs you"
          description="Most urgent first. Each item opens where it is dealt with."
          flush
          className="self-start"
        >
          {queue.length ? (
            <ul className="divide-y divide-plat-line-soft border-t border-plat-line-soft">
              {queue.map(({ key, ...item }) => (
                <QueueItem key={key} {...item} />
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-3 border-t border-plat-line-soft px-5 py-8">
              <CheckCircle2 className="size-5 shrink-0 text-plat-ok" strokeWidth={2} aria-hidden="true" />
              <p className="text-md text-plat-muted">
                No requests, no unread messages, and nobody is inside a customer&apos;s records.
              </p>
            </div>
          )}
        </PlatformPanel>

        <div className="space-y-6">
          <PlatformPanel title="Plans" description="Where tenants sit today.">
            <ul className="space-y-3">
              {planMix.map((plan) => (
                <li key={plan.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <Link to={`/superadmin/plans/${plan.id}`} className="font-medium text-plat-text hover:underline">
                      {plan.name}
                    </Link>
                    <span className="tnum text-plat-muted">{formatCount(plan.tenants)}</span>
                  </div>
                  {/* A share of tenants, so the bar's length is data, not a design value. */}
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-plat-raised">
                    <div className="h-full rounded-full bg-plat-accent" style={{ width: `${(plan.tenants / mixTotal) * 100}%` }} />
                  </div>
                </li>
              ))}
              {noPlan > 0 && (
                <li className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-plat-muted">No plan</span>
                  <span className="tnum text-plat-muted">{formatCount(noPlan)}</span>
                </li>
              )}
            </ul>
          </PlatformPanel>

          <PlatformPanel title="Newest tenants" flush>
            <ul className="divide-y divide-plat-line-soft border-t border-plat-line-soft">
              {recent.map((tenant) => (
                <li key={tenant.id}>
                  <Link
                    to={`/superadmin/tenants/${tenant.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors duration-fast hover:bg-plat-text/3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-md font-medium text-plat-text">{tenant.name}</span>
                      <span className="block text-xs text-plat-dim">
                        {tenant.plan?.name ?? 'No plan'} · {date(tenant.createdAt)}
                      </span>
                    </span>
                    <PlatformBadge tone={TENANT_STATUS[tenant.status]?.tone}>
                      {TENANT_STATUS[tenant.status]?.label ?? tenant.status}
                    </PlatformBadge>
                  </Link>
                </li>
              ))}
            </ul>
          </PlatformPanel>
        </div>
      </div>
    </>
  );
}

export default SuperAdminOverviewPage;
