import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowRight, Mail, MessageSquare, Plus, Send, Store, UserPlus } from 'lucide-react';

import cn from '@/lib/cn';
import { count as formatCount, date, dateTime, money, relativeTime } from '@/lib/format';
import { toast } from '@/store/toastStore';
import SupportThread from '@/components/support/SupportThread';
import {
  MetaDot,
  PlatformBadge,
  PlatformButton,
  PlatformEmpty,
  PlatformFacts,
  PlatformHeader,
  PlatformNotFound,
  PlatformPageSkeleton,
  PlatformSkeleton,
  PlatformPanel,
  PlatformRow,
  PlatformTabs,
} from '@/components/superadmin/PlatformUI';
import {
  PlatformChoice,
  PlatformConfirm,
  PlatformModal,
  PlatformNotice,
  PlatformSelect,
} from '@/components/superadmin/PlatformForm';
import { BusinessForm, OwnerForm, SlotsForm, TenantDetailsForm } from '@/components/superadmin/ConsoleForms';
import {
  addressOf,
  BUSINESS_STATUS,
  BUSINESS_TYPE,
  businessAttention,
  TENANT_STATUS,
  TENANT_STATUS_OPTIONS,
  usePlatformDirectory,
} from '@/components/superadmin/platformData';
import { usePlans, useSupportThread, useSupportThreads, useSuperAdminMutations } from '@/hooks/useSuperAdmin';

/**
 * One tenant: the account, what it owns, who can sign in, and what it pays.
 *
 * **Each section is a route** (`/tenants/:id/owners`, `/subscription`...), so
 * a link to "Northline's owners" goes straight there and the back button
 * works. The old console hung five modals off one panel header; the header
 * now says who the tenant is, and the tabs say what can be done about them.
 */

function BusinessesSection({ tenant, storefrontDomain }) {
  const navigate = useNavigate();
  const { createBusiness } = useSuperAdminMutations();
  const [adding, setAdding] = useState(false);
  const noSlot = tenant.slotsFree <= 0;

  return (
    <>
      <PlatformPanel
        title="Businesses"
        description={`${formatCount(tenant.slotsUsed)} of ${formatCount(tenant.slots)} slots in use.`}
        action={
          <PlatformButton
            variant="primary"
            size="sm"
            icon={Plus}
            disabled={noSlot}
            title={noSlot ? 'No free slot. Grant one on the Subscription tab first.' : undefined}
            onClick={() => setAdding(true)}
          >
            Add business
          </PlatformButton>
        }
      >
        {noSlot && (
          <PlatformNotice>
            Every slot is in use. Grant another on the Subscription tab before adding a business.
          </PlatformNotice>
        )}
        {!tenant.businesses.length ? (
          <PlatformEmpty icon={Store} title="No businesses yet" body={`${tenant.name} can run ${formatCount(tenant.slots)}.`} />
        ) : (
          <ul className="space-y-2">
            {tenant.businesses.map((business) => {
              const attention = businessAttention(business);
              return (
                <li key={business.id}>
                  <PlatformRow to={`/superadmin/businesses/${business.id}`}>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-md font-medium text-plat-text">{business.name}</span>
                        {business.isDefault && <PlatformBadge tone="accent">default</PlatformBadge>}
                        {business.deletedAt && <PlatformBadge tone="danger">deleted</PlatformBadge>}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-xs text-plat-dim">
                        {business.code} · {business.domain || addressOf(business.slug, storefrontDomain) || 'no web address'}
                      </span>
                      {attention.length > 0 && (
                        <span className="mt-1 block text-xs text-plat-warn">Waiting on: {attention.join(', ')}</span>
                      )}
                    </span>
                    <PlatformBadge tone={BUSINESS_TYPE[business.businessType]?.tone}>
                      {BUSINESS_TYPE[business.businessType]?.label ?? business.businessType}
                    </PlatformBadge>
                    {!business.deletedAt && (
                      <PlatformBadge tone={BUSINESS_STATUS[business.status]?.tone}>
                        {BUSINESS_STATUS[business.status]?.label ?? business.status}
                      </PlatformBadge>
                    )}
                    <ArrowRight className="size-4 shrink-0 text-plat-dim" strokeWidth={2} aria-hidden="true" />
                  </PlatformRow>
                </li>
              );
            })}
          </ul>
        )}
      </PlatformPanel>

      <PlatformModal open={adding} onClose={() => setAdding(false)} title={`Add a business to ${tenant.name}`} size="md" align="top">
        {adding && (
          <BusinessForm
            tenant={tenant}
            storefrontDomain={storefrontDomain}
            isPending={createBusiness.isPending}
            error={createBusiness.error?.message}
            onCancel={() => setAdding(false)}
            onSubmit={(values) =>
              createBusiness.mutate(
                { id: tenant.id, ...values },
                {
                  onSuccess: (result) => {
                    setAdding(false);
                    toast.ok('Business created', `${values.name} is ready to configure.`);
                    if (result?.business?.id) navigate(`/superadmin/businesses/${result.business.id}`);
                  },
                },
              )
            }
          />
        )}
      </PlatformModal>
    </>
  );
}

function OwnersSection({ tenant }) {
  const { createOwner, resendOwnerInvite } = useSuperAdminMutations();
  const [adding, setAdding] = useState(false);
  const [resendFor, setResendFor] = useState(null);
  const [error, setError] = useState(null);
  const canAdd = tenant.businesses.some((business) => !business.deletedAt);

  return (
    <>
      <PlatformPanel
        title="Owners"
        description="The tenant's own administrators. One sign-in reaches every business the tenant owns."
        action={
          <PlatformButton
            variant="primary"
            size="sm"
            icon={UserPlus}
            disabled={!canAdd}
            title={canAdd ? undefined : 'Add a business first: an owner is created inside one.'}
            onClick={() => setAdding(true)}
          >
            Add owner
          </PlatformButton>
        }
      >
        {!tenant.admins?.length ? (
          <PlatformEmpty
            icon={UserPlus}
            title="Nobody can sign in"
            body={canAdd ? 'Add an owner and they are emailed an invitation to set a password.' : 'Add a business first, then its owner.'}
          />
        ) : (
          <ul className="space-y-2">
            {tenant.admins.map((admin) => (
              <li key={admin.id}>
                <PlatformRow>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-plat-surface text-xs font-semibold text-plat-muted">
                    {(admin.contactName || admin.email).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-md font-medium text-plat-text">{admin.contactName || admin.email}</span>
                    <span className="block truncate text-xs text-plat-dim">{admin.email}</span>
                  </span>
                  {/* Whether they have ever got in: an invitation never opened
                      looks exactly like a working account until somebody asks. */}
                  <span className="text-right text-xs">
                    {admin.lastLoginAt ? (
                      <span className="text-plat-muted">Signed in {relativeTime(admin.lastLoginAt)}</span>
                    ) : (
                      <span className="text-plat-warn">Never signed in</span>
                    )}
                  </span>
                  {!admin.lastLoginAt && (
                    <PlatformButton variant="ghost" size="sm" icon={Send} onClick={() => setResendFor(admin)}>
                      Resend invitation
                    </PlatformButton>
                  )}
                </PlatformRow>
              </li>
            ))}
          </ul>
        )}
      </PlatformPanel>

      <PlatformModal open={adding} onClose={() => setAdding(false)} title={`New owner for ${tenant.name}`} size="md" align="top">
        {adding && (
          <OwnerForm
            tenant={tenant}
            isPending={createOwner.isPending}
            error={error}
            onCancel={() => setAdding(false)}
            onSubmit={(values) => {
              setError(null);
              createOwner.mutate(
                { id: tenant.id, ...values },
                {
                  onSuccess: (result) => {
                    // The account exists whether or not the mail went out, and
                    // saying which tells the operator to resend rather than
                    // create a second one.
                    if (result.invited) toast.ok('Owner invited', `${result.owner.email} can now set a password.`);
                    else toast.info('Owner created, invitation not sent', `Resend it to ${result.owner.email} from this list.`);
                    setAdding(false);
                  },
                  onError: (err) => setError(err.message),
                },
              );
            }}
          />
        )}
      </PlatformModal>

      {/* Mail to a third party, from one click: confirmed twice (§3.0.1). */}
      <PlatformConfirm
        open={Boolean(resendFor)}
        onClose={() => setResendFor(null)}
        title={`Resend the invitation to ${resendFor?.email ?? ''}?`}
        confirmLabel="Send invitation"
        confirmPhrase={resendFor?.email}
        isPending={resendOwnerInvite.isPending}
        error={resendOwnerInvite.error?.message}
        onConfirm={() =>
          resendOwnerInvite.mutate(
            { id: resendFor.id },
            {
              onSuccess: () => {
                toast.ok('Invitation sent', `${resendFor.email} has a new link to set a password.`);
                setResendFor(null);
              },
            },
          )
        }
      >
        <p>
          {resendFor?.contactName || 'They'} will get a new email with a link to set a password. Any earlier link
          stops working.
        </p>
      </PlatformConfirm>
    </>
  );
}

function SubscriptionSection({ tenant }) {
  const { data: planData } = usePlans();
  const { updateTenant, setSlots } = useSuperAdminMutations();
  const plans = planData?.plans ?? [];
  const [status, setStatus] = useState(tenant.status);
  const [plan, setPlan] = useState(tenant.plan?.id ?? '');
  const [confirm, setConfirm] = useState(null); // 'status' | 'plan'
  const [slotsOpen, setSlotsOpen] = useState(false);

  const planName = (id) => plans.find((row) => row.id === id)?.name ?? 'No plan';
  const restrictive = status === 'suspended' || status === 'cancelled';
  const liveCount = tenant.businesses.filter((business) => !business.deletedAt).length;

  const save = (body, done) =>
    updateTenant.mutate(
      { id: tenant.id, name: tenant.name, ...body },
      {
        onSuccess: () => {
          done();
          setConfirm(null);
        },
      },
    );

  return (
    <div className="space-y-6">
      <PlatformPanel
        title="Status"
        description="What the tenant's ERP still allows. Applies to every business they own at once."
        footer={
          <PlatformButton variant="primary" disabled={status === tenant.status} onClick={() => setConfirm('status')}>
            Change status
          </PlatformButton>
        }
      >
        <PlatformChoice name="status" value={status} onChange={setStatus} options={TENANT_STATUS_OPTIONS} />
      </PlatformPanel>

      <div className="grid gap-6 md:grid-cols-2">
        <PlatformPanel
          title="Plan"
          description="Sets the feature defaults every business here starts from."
          footer={
            <PlatformButton variant="primary" disabled={plan === (tenant.plan?.id ?? '')} onClick={() => setConfirm('plan')}>
              Change plan
            </PlatformButton>
          }
        >
          <PlatformSelect
            label="Plan"
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
            options={[
              { value: '', label: 'No plan' },
              ...plans.map((row) => ({
                value: row.id,
                label: `${row.name} · ${money(row.priceCents)} a month${row.isActive ? '' : ' (retired)'}`,
              })),
            ]}
          />
        </PlatformPanel>

        <PlatformPanel
          title="Business slots"
          description="How many businesses this tenant may run."
          footer={
            <PlatformButton variant="secondary" onClick={() => setSlotsOpen(true)}>
              Change slots
            </PlatformButton>
          }
        >
          <p className="tnum text-3xl font-semibold tracking-tight text-plat-text">
            {formatCount(tenant.slotsUsed)} <span className="text-plat-dim">/ {formatCount(tenant.slots)}</span>
          </p>
          <p className="mt-1 text-sm text-plat-muted">
            {tenant.slotsFree ? `${formatCount(tenant.slotsFree)} free` : 'All in use'}
          </p>
        </PlatformPanel>
      </div>

      <PlatformConfirm
        open={confirm === 'status'}
        onClose={() => setConfirm(null)}
        tone={restrictive ? 'danger' : 'default'}
        title={`Set ${tenant.name} to ${TENANT_STATUS[status]?.label.toLowerCase()}?`}
        confirmLabel="Change status"
        // Locking a customer out of their own records is confirmed twice.
        confirmPhrase={restrictive ? tenant.name : undefined}
        isPending={updateTenant.isPending}
        error={updateTenant.error?.message}
        changes={[{ label: 'Status', from: TENANT_STATUS[tenant.status]?.label, to: TENANT_STATUS[status]?.label }]}
        onConfirm={() =>
          save({ status }, () => toast.ok('Status changed', `${tenant.name} is now ${TENANT_STATUS[status]?.label.toLowerCase()}.`))
        }
      >
        <p>{TENANT_STATUS_OPTIONS.find((option) => option.value === status)?.description}</p>
        {liveCount > 1 && <p>This reaches all {formatCount(liveCount)} of their businesses immediately.</p>}
      </PlatformConfirm>

      <PlatformConfirm
        open={confirm === 'plan'}
        onClose={() => setConfirm(null)}
        title={`Move ${tenant.name} to ${planName(plan)}?`}
        confirmLabel="Change plan"
        isPending={updateTenant.isPending}
        error={updateTenant.error?.message}
        changes={[{ label: 'Plan', from: tenant.plan?.name ?? 'No plan', to: planName(plan) }]}
        onConfirm={() => save({ plan }, () => toast.ok('Plan changed', `${tenant.name} is on ${planName(plan)}.`))}
      >
        <p>
          Features that come from the plan change for every business they own on the next request. Anything set on a
          business directly stays as it is.
        </p>
      </PlatformConfirm>

      <PlatformModal open={slotsOpen} onClose={() => setSlotsOpen(false)} title={`Business slots for ${tenant.name}`} size="sm" align="top">
        {slotsOpen && (
          <SlotsForm
            tenant={tenant}
            isPending={setSlots.isPending}
            error={setSlots.error?.message}
            onCancel={() => setSlotsOpen(false)}
            onSubmit={(slots) =>
              setSlots.mutate(
                { id: tenant.id, slots },
                {
                  onSuccess: () => {
                    setSlotsOpen(false);
                    toast.ok('Slots updated', `${tenant.name} may now run ${formatCount(slots)}.`);
                  },
                },
              )
            }
          />
        )}
      </PlatformModal>
    </div>
  );
}

function MessagesSection({ tenant }) {
  const { data, isLoading } = useSupportThread(tenant.id);
  const { replyToThread } = useSuperAdminMutations();
  const [error, setError] = useState(null);

  return (
    <PlatformPanel title="Conversation" description="What you send appears in their own ERP, under Support.">
      {isLoading ? (
        <PlatformSkeleton className="h-96 rounded-xl" />
      ) : (
        <div className="flex h-[60vh] min-h-96 flex-col">
          <SupportThread
            thread={data?.thread}
            side="platform"
            surface="platform"
            isSending={replyToThread.isPending}
            error={error}
            placeholder={`Message ${tenant.name}…`}
            emptyBody="No messages yet. What you send here appears in their own ERP."
            onSend={(body, { onSuccess }) => {
              setError(null);
              replyToThread.mutate({ id: tenant.id, body }, { onSuccess, onError: (err) => setError(err.message) });
            }}
          />
        </div>
      )}
    </PlatformPanel>
  );
}

function DetailsSection({ tenant }) {
  const { updateTenant } = useSuperAdminMutations();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <PlatformPanel title="Edit details">
        <TenantDetailsForm
          tenant={tenant}
          isPending={updateTenant.isPending}
          error={updateTenant.error?.message}
          onCancel={() => setEditing(false)}
          onSubmit={(values) =>
            updateTenant.mutate(
              { id: tenant.id, ...values },
              {
                onSuccess: () => {
                  setEditing(false);
                  toast.ok('Details saved', `${values.name} is up to date.`);
                },
              },
            )
          }
        />
      </PlatformPanel>
    );
  }

  return (
    <PlatformPanel
      title="Details"
      footer={
        <PlatformButton variant="secondary" onClick={() => setEditing(true)}>
          Edit details
        </PlatformButton>
      }
    >
      <PlatformFacts
        items={[
          { label: 'Tenant name', value: tenant.name },
          { label: 'Handle', value: tenant.slug, mono: true },
          { label: 'Contact', value: tenant.contactName },
          {
            label: 'Contact email',
            value: tenant.contactEmail && (
              <a href={`mailto:${tenant.contactEmail}`} className="inline-flex items-center gap-1.5 hover:underline">
                <Mail className="size-3.5 text-plat-dim" aria-hidden="true" />
                {tenant.contactEmail}
              </a>
            ),
          },
          { label: 'Phone', value: tenant.phone },
          { label: 'On Kelinto since', value: dateTime(tenant.createdAt) },
        ]}
      />
      <div className="mt-5 border-t border-plat-line-soft pt-4">
        <p className="text-xs text-plat-dim">Internal notes</p>
        <p className={cn('mt-1 whitespace-pre-line text-md', tenant.notes ? 'text-plat-text' : 'text-plat-dim')}>
          {tenant.notes || 'None. Notes are seen only in this console.'}
        </p>
      </div>
    </PlatformPanel>
  );
}

export function SuperAdminTenantPage({ section = 'businesses' }) {
  const { tenantId } = useParams();
  const { tenantById, storefrontDomain, isLoading } = usePlatformDirectory();
  // The unread count comes from the thread LIST: fetching the thread itself
  // marks it read, so reading it here would clear the badge it feeds.
  const { data: threadData } = useSupportThreads();

  if (isLoading) return <PlatformPageSkeleton />;

  const tenant = tenantById.get(tenantId);
  const crumbs = [
    { label: 'Tenants', to: '/superadmin/tenants' },
    { label: tenant?.name ?? 'Not found' },
  ];
  if (!tenant) {
    return <PlatformNotFound crumbs={crumbs} what="Tenant" back={{ to: '/superadmin/tenants', label: 'All tenants' }} />;
  }

  const base = `/superadmin/tenants/${tenant.id}`;
  const unread = (threadData?.threads ?? []).find((row) => row.tenant === tenant.id)?.unread ?? 0;

  return (
    <>
      <PlatformHeader
        crumbs={crumbs}
        title={tenant.name}
        badges={
          <PlatformBadge tone={TENANT_STATUS[tenant.status]?.tone}>
            {TENANT_STATUS[tenant.status]?.label ?? tenant.status}
          </PlatformBadge>
        }
        meta={
          <>
            <span>{tenant.plan?.name ?? 'No plan'}</span>
            <MetaDot />
            <span className="tnum">
              {formatCount(tenant.slotsUsed)} of {formatCount(tenant.slots)} slots
            </span>
            <MetaDot />
            <span>Since {date(tenant.createdAt)}</span>
          </>
        }
        action={
          <PlatformButton variant="secondary" icon={MessageSquare} to={`${base}/messages`}>
            Message
          </PlatformButton>
        }
      />

      <PlatformTabs
        items={[
          { label: 'Businesses', to: base, end: true },
          { label: 'Owners', to: `${base}/owners`, count: tenant.admins?.length ? 0 : 1 },
          { label: 'Subscription', to: `${base}/subscription` },
          { label: 'Messages', to: `${base}/messages`, count: unread },
          { label: 'Details', to: `${base}/details` },
        ]}
      />

      {section === 'businesses' && <BusinessesSection tenant={tenant} storefrontDomain={storefrontDomain} />}
      {section === 'owners' && <OwnersSection tenant={tenant} />}
      {section === 'subscription' && <SubscriptionSection key={`${tenant.status}-${tenant.plan?.id}`} tenant={tenant} />}
      {section === 'messages' && <MessagesSection tenant={tenant} />}
      {section === 'details' && <DetailsSection tenant={tenant} />}
    </>
  );
}

export default SuperAdminTenantPage;
