import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ExternalLink, Globe, LogIn, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';

import { date, dateTime } from '@/lib/format';
import { toast } from '@/store/toastStore';
import {
  MetaDot,
  PlatformBadge,
  PlatformButton,
  PlatformEmpty,
  PlatformFacts,
  PlatformHeader,
  PlatformNotFound,
  PlatformPageSkeleton,
  PlatformPanel,
  PlatformTabs,
} from '@/components/superadmin/PlatformUI';
import { PlatformChoice, PlatformConfirm, PlatformModal, PlatformNotice } from '@/components/superadmin/PlatformForm';
import { EnterForm } from '@/components/superadmin/ConsoleForms';
import FeatureGrid from '@/components/superadmin/FeatureGrid';
import BusinessDomains from '@/components/superadmin/BusinessDomains';
import {
  addressOf,
  BUSINESS_STATUS,
  BUSINESS_STATUS_OPTIONS,
  BUSINESS_TYPE,
  domainState,
  usePlatformDirectory,
} from '@/components/superadmin/platformData';
import { useImpersonations, useSuperAdminMutations } from '@/hooks/useSuperAdmin';

/**
 * One business: where it answers, what it may do, and who has been inside it.
 *
 * **Four tabs, four different kinds of act.** Overview holds its state (open,
 * closed, deleted); Features what its panel shows; Domains where the public
 * reaches it; Access the one door into its records. They are separate pages
 * because they are separate risks: a domain change breaks printed receipts, a
 * feature change hides a section, a support session is read by the owner.
 */

function httpsOf(host) {
  return host ? `https://${host}` : null;
}

function OverviewSection({ business, storefrontDomain }) {
  const { setBusinessStatus, deleteBusiness, restoreBusiness } = useSuperAdminMutations();
  const [status, setStatus] = useState(business.status);
  const [confirm, setConfirm] = useState(null); // 'status' | 'delete' | 'restore'

  const storefront = business.domain && business.domainLiveAt ? business.domain : addressOf(business.slug, storefrontDomain);
  const nextLabel = BUSINESS_STATUS[status]?.label ?? status;

  return (
    <div className="space-y-6">
      <PlatformPanel title="At a glance">
        <PlatformFacts
          items={[
            { label: 'Code', value: business.code, mono: true },
            { label: 'Type', value: BUSINESS_TYPE[business.businessType]?.label ?? business.businessType },
            {
              label: 'Tenant',
              value: business.tenant ? (
                <Link to={`/superadmin/tenants/${business.tenant.id}`} className="hover:underline">
                  {business.tenant.name}
                </Link>
              ) : null,
            },
            { label: 'Created', value: date(business.createdAt) },
            {
              label: 'Website',
              value: storefront ? (
                <a href={httpsOf(storefront)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-sm hover:underline">
                  {storefront}
                  <ExternalLink className="size-3.5 text-plat-dim" aria-hidden="true" />
                </a>
              ) : null,
            },
            {
              label: 'Own ERP domain',
              value: business.panelDomain ? (
                <span className="font-mono text-sm">
                  {business.panelDomain}
                  {domainState(business.panelDomain, business.panelDomainLiveAt) === 'waiting' && (
                    <span className="ml-2 font-sans text-xs text-plat-warn">waiting for DNS</span>
                  )}
                </span>
              ) : null,
            },
          ]}
        />
        {business.isDefault && (
          <p className="mt-5 border-t border-plat-line-soft pt-4 text-sm text-plat-muted">
            <strong className="font-semibold text-plat-text">The default business.</strong> It answers any host that names
            no business, so it cannot be deleted or closed while it holds this role.
          </p>
        )}
      </PlatformPanel>

      {!business.deletedAt && (
        <PlatformPanel
          title="Status"
          description="Whether the business is trading. Nothing here deletes a record."
          footer={
            <PlatformButton
              variant="primary"
              disabled={status === business.status || (business.isDefault && status !== 'active')}
              onClick={() => setConfirm('status')}
            >
              Change status
            </PlatformButton>
          }
        >
          <PlatformChoice name="business-status" value={status} onChange={setStatus} options={BUSINESS_STATUS_OPTIONS} />
          {business.isDefault && status !== 'active' && (
            <p className="mt-3 text-sm text-plat-warn">The default business has to stay open.</p>
          )}
        </PlatformPanel>
      )}

      <PlatformPanel
        title={business.deletedAt ? 'Deleted' : 'Delete business'}
        description={
          business.deletedAt
            ? business.restorable
              ? `Restorable until ${dateTime(business.purgeAfter)}. Its slot is still held until then.`
              : 'Past its 30-day window. It can no longer be restored.'
            : 'Stops trading and leaves the tenant’s switcher. Records are kept for 30 days and it can be restored until then.'
        }
        footer={
          business.deletedAt ? (
            business.restorable && (
              <PlatformButton variant="secondary" icon={RotateCcw} onClick={() => setConfirm('restore')}>
                Restore business
              </PlatformButton>
            )
          ) : (
            <PlatformButton
              variant="danger"
              icon={Trash2}
              disabled={business.isDefault}
              title={business.isDefault ? 'Make another business the default first.' : undefined}
              onClick={() => setConfirm('delete')}
            >
              Delete business
            </PlatformButton>
          )
        }
      />

      <PlatformConfirm
        open={confirm === 'status'}
        onClose={() => setConfirm(null)}
        tone={status === 'inactive' ? 'danger' : 'default'}
        title={`Set ${business.name} to ${nextLabel.toLowerCase()}?`}
        confirmLabel="Change status"
        confirmPhrase={status === 'inactive' ? business.slug || business.code : undefined}
        changes={[{ label: 'Status', from: BUSINESS_STATUS[business.status]?.label, to: nextLabel }]}
        isPending={setBusinessStatus.isPending}
        error={setBusinessStatus.error?.message}
        onConfirm={() =>
          setBusinessStatus.mutate(
            { id: business.id, status },
            {
              onSuccess: () => {
                toast.ok('Status changed', `${business.name} is now ${nextLabel.toLowerCase()}.`);
                setConfirm(null);
              },
            },
          )
        }
      >
        <p>{BUSINESS_STATUS_OPTIONS.find((option) => option.value === status)?.description}</p>
      </PlatformConfirm>

      <PlatformConfirm
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        tone="danger"
        title={`Delete ${business.name}?`}
        confirmLabel="Delete business"
        confirmPhrase={business.slug || business.code}
        isPending={deleteBusiness.isPending}
        error={deleteBusiness.error?.message}
        onConfirm={() =>
          deleteBusiness.mutate(
            { id: business.id },
            {
              onSuccess: () => {
                toast.ok('Business deleted', `${business.name} can be restored for 30 days.`);
                setConfirm(null);
              },
            },
          )
        }
      >
        <p>
          The website and ERP stop answering and the business leaves {business.tenant?.name ?? 'its tenant'}&apos;s
          switcher. Its records are kept and it can be restored for 30 days.
        </p>
        <p>
          The slot stays spent for those 30 days, so deleting and recreating cannot be used to run an extra business.
        </p>
      </PlatformConfirm>

      <PlatformConfirm
        open={confirm === 'restore'}
        onClose={() => setConfirm(null)}
        title={`Restore ${business.name}?`}
        confirmLabel="Restore business"
        isPending={restoreBusiness.isPending}
        error={restoreBusiness.error?.message}
        onConfirm={() =>
          restoreBusiness.mutate(
            { id: business.id },
            {
              onSuccess: () => {
                toast.ok('Business restored', `${business.name} is trading again.`);
                setConfirm(null);
              },
            },
          )
        }
      >
        <p>Its website and ERP answer again at the addresses it had, with every record as it was left.</p>
      </PlatformConfirm>
    </div>
  );
}

function AccessSection({ business }) {
  const { data } = useImpersonations();
  const { enterBusiness } = useSuperAdminMutations();
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState(null);
  const grants = (data?.grants ?? []).filter((grant) => grant.business === business.id);

  return (
    <>
      <PlatformPanel
        title="Support access"
        description="The only way Kelinto reads this business's records. Every session is written into its own activity log."
        action={
          !business.deletedAt && (
            <PlatformButton variant="primary" size="sm" icon={LogIn} onClick={() => setEntering(true)}>
              Step in
            </PlatformButton>
          )
        }
        flush
      >
        {!grants.length ? (
          <div className="border-t border-plat-line-soft">
            <PlatformEmpty icon={ShieldAlert} title="Nobody from Kelinto has been inside" body="Sessions appear here and in the business's own activity log." />
          </div>
        ) : (
          <ul className="divide-y divide-plat-line-soft border-t border-plat-line-soft">
            {grants.map((grant) => (
              <li key={grant.id} className="px-5 py-3">
                <p className="flex flex-wrap items-center gap-2 text-md font-medium text-plat-text">
                  {grant.superAdminName || grant.superAdminEmail}
                  {grant.live && <PlatformBadge tone="danger">inside now</PlatformBadge>}
                  {grant.endedReason === 'revoked' && <PlatformBadge tone="warn">revoked</PlatformBadge>}
                </p>
                <p className="mt-0.5 text-sm text-plat-muted">{grant.reason}</p>
                <p className="mt-0.5 text-xs text-plat-dim">
                  {dateTime(grant.startedAt)}
                  {grant.endedAt ? `, left ${dateTime(grant.endedAt)}` : `, until ${dateTime(grant.expiresAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PlatformPanel>

      <PlatformModal open={entering} onClose={() => setEntering(false)} title={`Step into ${business.name}`} size="md" align="top">
        {entering && (
          <EnterForm
            business={business}
            isPending={enterBusiness.isPending}
            error={error}
            onCancel={() => setEntering(false)}
            onSubmit={(values) => {
              setError(null);
              enterBusiness.mutate(
                { id: business.id, ...values },
                {
                  // A full page load rather than a route change: the panel is a
                  // different application on a different session, and the
                  // server hands back a single-use link the panel host claims.
                  onSuccess: (result) => window.location.assign(result.handoffUrl ?? '/admin'),
                  onError: (err) => setError(err.message),
                },
              );
            }}
          />
        )}
      </PlatformModal>
    </>
  );
}

export function SuperAdminBusinessPage({ section = 'overview' }) {
  const { businessId } = useParams();
  const { businessById, storefrontDomain, platformDomains, isLoading } = usePlatformDirectory();

  if (isLoading) return <PlatformPageSkeleton />;

  const business = businessById.get(businessId);
  const crumbs = [
    { label: 'Businesses', to: '/superadmin/businesses' },
    ...(business?.tenant ? [{ label: business.tenant.name, to: `/superadmin/tenants/${business.tenant.id}` }] : []),
    { label: business?.name ?? 'Not found' },
  ];
  if (!business) {
    return <PlatformNotFound crumbs={crumbs} what="Business" back={{ to: '/superadmin/businesses', label: 'All businesses' }} />;
  }

  const base = `/superadmin/businesses/${business.id}`;
  const domainWork =
    (business.addressRequest?.status === 'pending' ? 1 : 0) +
    (domainState(business.domain, business.domainLiveAt) === 'waiting' ? 1 : 0) +
    (domainState(business.panelDomain, business.panelDomainLiveAt) === 'waiting' ? 1 : 0);

  return (
    <>
      <PlatformHeader
        crumbs={crumbs}
        title={business.name}
        badges={
          <>
            {business.deletedAt ? (
              <PlatformBadge tone="danger">Deleted</PlatformBadge>
            ) : (
              <PlatformBadge tone={BUSINESS_STATUS[business.status]?.tone}>
                {BUSINESS_STATUS[business.status]?.label ?? business.status}
              </PlatformBadge>
            )}
            <PlatformBadge tone={BUSINESS_TYPE[business.businessType]?.tone}>
              {BUSINESS_TYPE[business.businessType]?.label}
            </PlatformBadge>
            {business.isDefault && <PlatformBadge tone="accent">Default</PlatformBadge>}
          </>
        }
        meta={
          <>
            <span className="font-mono">{business.code}</span>
            <MetaDot />
            <span className="font-mono">{business.domain || addressOf(business.slug, storefrontDomain) || 'No web address'}</span>
          </>
        }
        action={
          // A shortcut to the Domains tab, so not offered while on it.
          !business.deletedAt &&
          section !== 'domains' && (
            <PlatformButton variant="secondary" icon={Globe} to={`${base}/domains`}>
              Domains
            </PlatformButton>
          )
        }
      />

      <PlatformTabs
        items={[
          { label: 'Overview', to: base, end: true },
          { label: 'Features', to: `${base}/features` },
          { label: 'Domains', to: `${base}/domains`, count: domainWork },
          { label: 'Access', to: `${base}/access` },
        ]}
      />

      {section === 'overview' && <OverviewSection key={business.status} business={business} storefrontDomain={storefrontDomain} />}
      {section === 'features' && (
        <>
          {business.deletedAt && <PlatformNotice>Restore the business before changing what it can do.</PlatformNotice>}
          <FeatureGrid businessId={business.id} businessName={business.name} disabled={Boolean(business.deletedAt)} />
        </>
      )}
      {section === 'domains' && (
        <BusinessDomains business={business} storefrontDomain={storefrontDomain} platformDomains={platformDomains} />
      )}
      {section === 'access' && <AccessSection business={business} />}
    </>
  );
}

export default SuperAdminBusinessPage;
