import { useState } from 'react';
import { Link } from 'react-router';
import { ShieldAlert, ShieldCheck, X } from 'lucide-react';

import { dateTime } from '@/lib/format';
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
import { PlatformConfirm } from '@/components/superadmin/PlatformForm';
import { useImpersonations, useSuperAdminMutations } from '@/hooks/useSuperAdmin';

/**
 * Every time somebody from the platform stepped into a customer's records.
 *
 * **Read by us, about us.** Every other console page answers a question about
 * a tenant; this one answers one about the platform's own conduct. An operator
 * who forgot to leave, or entered with a reason nobody would accept, is
 * visible here without anybody going looking. The tenant reads the same
 * facts in their own activity log, and their copy cannot be edited from here.
 */

export function SuperAdminAccessPage() {
  const { data, isLoading } = useImpersonations();
  const { revokeImpersonation } = useSuperAdminMutations();
  const [revoking, setRevoking] = useState(null);

  if (isLoading) return <PlatformPageSkeleton />;

  const grants = data?.grants ?? [];
  const live = grants.filter((grant) => grant.live);
  const past = grants.filter((grant) => !grant.live);

  const columns = [
    {
      key: 'who',
      label: 'Operator',
      render: (grant) => <span className="text-plat-text">{grant.superAdminName || grant.superAdminEmail}</span>,
    },
    {
      key: 'business',
      label: 'Business',
      render: (grant) =>
        grant.business ? (
          <Link to={`/superadmin/businesses/${grant.business}/access`} className="relative z-10 text-plat-muted hover:underline">
            {grant.businessName}
          </Link>
        ) : (
          <span className="text-plat-muted">{grant.businessName}</span>
        ),
    },
    {
      key: 'reason',
      label: 'Reason',
      render: (grant) => <span className="block max-w-md text-plat-muted">{grant.reason}</span>,
    },
    {
      key: 'when',
      label: 'When',
      hideBelow: 'lg',
      render: (grant) => (
        <span className="block text-xs text-plat-dim">
          {dateTime(grant.startedAt)}
          <span className="block">
            {grant.endedReason === 'revoked' ? 'revoked ' : 'left '}
            {dateTime(grant.endedAt ?? grant.expiresAt)}
          </span>
        </span>
      ),
    },
  ];

  return (
    <>
      <PlatformHeader
        crumbs={[{ label: 'Overview', to: '/superadmin' }, { label: 'Access log' }]}
        title="Access log"
        description="Who from Kelinto stepped into a business, why, and when they left. Each session is also written into that business's own activity log."
      />

      <PlatformPanel
        className="mb-6"
        title="Inside a business now"
        description={live.length ? 'These sessions can read and change a tenant’s records right now.' : 'Nobody is inside a tenant’s business.'}
        flush
      >
        {live.length ? (
          <ul className="divide-y divide-plat-line-soft border-t border-plat-line-soft">
            {live.map((grant) => (
              <li key={grant.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-plat-danger" strokeWidth={2} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-md font-medium text-plat-text">
                    {grant.superAdminName || grant.superAdminEmail}
                    <span className="font-normal text-plat-dim">in</span>
                    {grant.businessName}
                    <PlatformBadge tone="danger">inside now</PlatformBadge>
                  </span>
                  <span className="mt-0.5 block text-sm text-plat-muted">{grant.reason}</span>
                  <span className="mt-0.5 block text-xs text-plat-dim">
                    Since {dateTime(grant.startedAt)}, ends {dateTime(grant.expiresAt)}
                    {grant.ip ? ` · ${grant.ip}` : ''}
                  </span>
                </span>
                <PlatformButton variant="danger" size="sm" icon={X} onClick={() => setRevoking(grant)}>
                  Revoke
                </PlatformButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-plat-line-soft px-5 py-4 text-sm text-plat-muted">Nothing open. Access also ends by itself when a session runs out.</p>
        )}
      </PlatformPanel>

      <h2 className="mb-3 text-lg font-semibold tracking-tight text-plat-text">Earlier sessions</h2>
      <PlatformTable
        columns={columns}
        rows={past}
        empty={
          <PlatformPanel>
            <PlatformEmpty icon={ShieldCheck} title="No support sessions yet" body="Stepping into a business records it here and in that business's activity log." />
          </PlatformPanel>
        }
      />

      <PlatformConfirm
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        tone="danger"
        title={`End ${revoking?.superAdminName || revoking?.superAdminEmail || 'this'} session in ${revoking?.businessName ?? ''}?`}
        confirmLabel="Revoke access"
        isPending={revokeImpersonation.isPending}
        error={revokeImpersonation.error?.message}
        onConfirm={() =>
          revokeImpersonation.mutate(
            { id: revoking.id },
            {
              onSuccess: () => {
                toast.ok('Access revoked', `${revoking.businessName} is closed to that session.`);
                setRevoking(null);
              },
            },
          )
        }
      >
        <p>Their next click inside {revoking?.businessName} is refused. Anything they had already saved stays saved.</p>
      </PlatformConfirm>
    </>
  );
}

export default SuperAdminAccessPage;
