import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { count as formatCount, money } from '@/lib/format';
import { toast } from '@/store/toastStore';
import {
  MetaDot,
  PlatformBadge,
  PlatformButton,
  PlatformHeader,
  PlatformNotFound,
  PlatformPageSkeleton,
  PlatformPanel,
} from '@/components/superadmin/PlatformUI';
import { PlatformConfirm, PlatformError, PlatformInput, PlatformTextarea } from '@/components/superadmin/PlatformForm';
import { TENANT_STATUS, usePlatformDirectory } from '@/components/superadmin/platformData';
import { usePlans, useSuperAdminMutations } from '@/hooks/useSuperAdmin';

/**
 * One plan: its terms, the defaults it hands every business, and who is on it.
 *
 * **Every change here reaches every subscriber at once.** `resolveFeatures`
 * reads a plan's defaults on each request, so a default switched off hides a
 * section for every business on the tier with no migration and no delay. The
 * subscriber count is therefore in the header, and the defaults stage and
 * confirm the way a business's own features do.
 *
 * **Always sends the whole plan.** `planSchema` defaults `priceCents` to 0, so
 * an update carrying only `isActive` would quietly make the plan free.
 */

function PlanDetails({ plan }) {
  const { updatePlan } = useSuperAdminMutations();
  const { register, handleSubmit, formState, reset } = useForm({
    defaultValues: {
      name: plan.name,
      description: plan.description ?? '',
      price: (plan.priceCents / 100).toFixed(2),
      includedSlots: plan.includedSlots,
    },
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        updatePlan.mutate(
          {
            id: plan.id,
            name: values.name,
            description: values.description,
            priceCents: Math.round(Number(values.price || 0) * 100),
            includedSlots: Number(values.includedSlots || 0),
            isActive: plan.isActive,
          },
          {
            onSuccess: () => {
              toast.ok('Plan saved', `${values.name} updated.`);
              reset(values);
            },
          },
        ),
      )}
    >
      <PlatformPanel
        title="Terms"
        description={
          plan.tenantCount
            ? `A new price applies to all ${formatCount(plan.tenantCount)} tenant${plan.tenantCount === 1 ? '' : 's'} on this plan.`
            : 'No tenant is on this plan yet.'
        }
        footer={
          <PlatformButton variant="primary" type="submit" disabled={!formState.isDirty} loading={updatePlan.isPending}>
            Save terms
          </PlatformButton>
        }
      >
        <PlatformError>{updatePlan.error?.message}</PlatformError>
        <PlatformInput label="Name" required {...register('name', { required: 'Give the plan a name.' })} error={formState.errors.name?.message} />
        <PlatformTextarea className="mt-4" label="Description" rows={2} {...register('description')} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <PlatformInput label="Price a month" inputMode="decimal" prefix="$" {...register('price')} />
          <PlatformInput label="Businesses included" type="number" min="0" {...register('includedSlots')} />
        </div>
      </PlatformPanel>
    </form>
  );
}

const CHOICES = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
  { value: 'type', label: 'By type' },
];

function PlanDefaults({ plan, features }) {
  const { setPlanFeature } = useSuperAdminMutations();
  const [pending, setPending] = useState({}); // key -> true | false | null
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  const defaults = plan.featureDefaults ?? {};
  const current = (key) => (Object.prototype.hasOwnProperty.call(defaults, key) ? (defaults[key] ? 'on' : 'off') : 'type');
  const shown = (key) => (key in pending ? (pending[key] === null ? 'type' : pending[key] ? 'on' : 'off') : current(key));

  function choose(key, choice) {
    setPending((state) => {
      const next = { ...state };
      if (choice === current(key)) delete next[key];
      else next[key] = choice === 'type' ? null : choice === 'on';
      return next;
    });
  }

  const keys = Object.keys(pending);
  const labelOf = (key) => features.find((feature) => feature.key === key)?.label ?? key;
  const editable = features.filter((feature) => !feature.locked);
  const byArea = editable.reduce((acc, feature) => {
    (acc[feature.area] ??= []).push(feature);
    return acc;
  }, {});

  async function apply() {
    setError(null);
    setApplying(true);
    try {
      for (const key of keys) {
        await setPlanFeature.mutateAsync({ id: plan.id, key, enabled: pending[key] });
      }
      toast.ok('Defaults updated', `${keys.length} change${keys.length === 1 ? '' : 's'} on ${plan.name}.`);
      setPending({});
      setConfirming(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <PlatformPanel
        title="Feature defaults"
        description="What a business on this plan starts with. By type falls back to the business type; a business's own setting beats both."
      >
        <div className="space-y-5">
          {Object.entries(byArea).map(([area, rows]) => (
            <section key={area}>
              <h3 className="eyebrow mb-2 text-plat-dim">{area}</h3>
              <ul className="divide-y divide-plat-line-soft rounded-lg border border-plat-line-soft">
                {rows.map((feature) => (
                  <li
                    key={feature.key}
                    className={cn('flex flex-wrap items-center gap-3 px-3 py-2.5', feature.key in pending && 'bg-plat-accent/5')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-md font-medium text-plat-text">{feature.label}</span>
                      <span className="block text-xs text-plat-muted">{feature.description}</span>
                    </span>
                    <span className="flex shrink-0 rounded-lg border border-plat-line-soft bg-plat-raised p-0.5" role="group" aria-label={feature.label}>
                      {CHOICES.map((choice) => (
                        <button
                          key={choice.value}
                          type="button"
                          aria-pressed={shown(feature.key) === choice.value}
                          onClick={() => choose(feature.key, choice.value)}
                          className={cn(
                            pressable,
                            'rounded-md px-2.5 py-1 text-xs font-medium',
                            shown(feature.key) === choice.value ? 'bg-plat-accent text-white' : 'text-plat-muted hover:text-plat-text',
                          )}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </PlatformPanel>

      {keys.length > 0 && (
        <div className="sticky bottom-4 z-30 mt-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-plat-line bg-plat-raised px-4 py-3 shadow-flyout">
            <p className="min-w-0 flex-1 text-md text-plat-text">
              <span className="tnum font-semibold">{keys.length}</span> default{keys.length === 1 ? '' : 's'} not applied yet
            </p>
            <PlatformButton variant="ghost" onClick={() => setPending({})}>
              Discard
            </PlatformButton>
            <PlatformButton variant="primary" onClick={() => setConfirming(true)}>
              Review and apply
            </PlatformButton>
          </div>
        </div>
      )}

      <PlatformConfirm
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={apply}
        isPending={applying}
        error={error}
        tone={plan.tenantCount ? 'danger' : 'default'}
        confirmPhrase={plan.tenantCount ? plan.name : undefined}
        title={`Change ${keys.length} default${keys.length === 1 ? '' : 's'} on ${plan.name}?`}
        confirmLabel="Apply defaults"
      >
        <p>
          {plan.tenantCount
            ? `Every business belonging to the ${formatCount(plan.tenantCount)} tenant${plan.tenantCount === 1 ? '' : 's'} on this plan picks this up on its next request, unless it has its own setting.`
            : 'No tenant is on this plan, so nothing changes for anybody today.'}
        </p>
        <ul className="divide-y divide-plat-line-soft rounded-lg border border-plat-line-soft">
          {keys.map((key) => (
            <li key={key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-plat-text">{labelOf(key)}</span>
              <span className={cn('font-medium', pending[key] === false ? 'text-plat-danger' : 'text-plat-ok')}>
                {pending[key] === null ? 'By type' : pending[key] ? 'On' : 'Off'}
              </span>
            </li>
          ))}
        </ul>
      </PlatformConfirm>
    </>
  );
}

export function SuperAdminPlanPage() {
  const { planId } = useParams();
  const { data, isLoading } = usePlans();
  const { tenants } = usePlatformDirectory();
  const { updatePlan } = useSuperAdminMutations();
  const [toggling, setToggling] = useState(false);

  if (isLoading) return <PlatformPageSkeleton />;

  const plan = (data?.plans ?? []).find((row) => row.id === planId);
  const crumbs = [{ label: 'Plans', to: '/superadmin/plans' }, { label: plan?.name ?? 'Not found' }];
  if (!plan) return <PlatformNotFound crumbs={crumbs} what="Plan" back={{ to: '/superadmin/plans', label: 'All plans' }} />;

  const subscribers = tenants.filter((tenant) => tenant.plan?.id === plan.id);

  return (
    <>
      <PlatformHeader
        crumbs={crumbs}
        title={plan.name}
        badges={<PlatformBadge tone={plan.isActive ? 'ok' : 'neutral'}>{plan.isActive ? 'Offered' : 'Retired'}</PlatformBadge>}
        meta={
          <>
            <span className="tnum">{money(plan.priceCents)} a month</span>
            <MetaDot />
            <span className="tnum">{formatCount(plan.includedSlots)} businesses included</span>
            <MetaDot />
            <span className="tnum">
              {formatCount(plan.tenantCount ?? 0)} tenant{plan.tenantCount === 1 ? '' : 's'}
            </span>
          </>
        }
        action={
          <PlatformButton variant="secondary" onClick={() => setToggling(true)}>
            {plan.isActive ? 'Retire plan' : 'Offer again'}
          </PlatformButton>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <PlanDetails key={`${plan.id}-${plan.priceCents}-${plan.name}`} plan={plan} />
          <PlanDefaults plan={plan} features={data?.features ?? []} />
        </div>

        <PlatformPanel title="On this plan" flush className="self-start">
          {subscribers.length ? (
            <ul className="divide-y divide-plat-line-soft border-t border-plat-line-soft">
              {subscribers.map((tenant) => (
                <li key={tenant.id}>
                  <Link to={`/superadmin/tenants/${tenant.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-plat-text/3">
                    <span className="min-w-0 flex-1 truncate text-md text-plat-text">{tenant.name}</span>
                    <PlatformBadge tone={TENANT_STATUS[tenant.status]?.tone}>{TENANT_STATUS[tenant.status]?.label}</PlatformBadge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-plat-line-soft px-5 py-4 text-sm text-plat-muted">Nobody yet. Assign it from a tenant&apos;s Subscription tab.</p>
          )}
        </PlatformPanel>
      </div>

      <PlatformConfirm
        open={toggling}
        onClose={() => setToggling(false)}
        title={plan.isActive ? `Retire ${plan.name}?` : `Offer ${plan.name} again?`}
        confirmLabel={plan.isActive ? 'Retire plan' : 'Offer plan'}
        isPending={updatePlan.isPending}
        error={updatePlan.error?.message}
        onConfirm={() =>
          updatePlan.mutate(
            {
              id: plan.id,
              name: plan.name,
              description: plan.description ?? '',
              priceCents: plan.priceCents,
              includedSlots: plan.includedSlots,
              isActive: !plan.isActive,
            },
            {
              onSuccess: () => {
                toast.ok(plan.isActive ? 'Plan retired' : 'Plan offered', plan.name);
                setToggling(false);
              },
            },
          )
        }
      >
        <p>
          {plan.isActive
            ? `It stops being offered to new tenants. The ${formatCount(plan.tenantCount ?? 0)} already on it keep it, at the same price, until moved.`
            : 'It can be chosen for tenants again.'}
        </p>
      </PlatformConfirm>
    </>
  );
}

export default SuperAdminPlanPage;
