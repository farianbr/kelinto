import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { ArrowRight, CreditCard, Plus } from 'lucide-react';

import cn from '@/lib/cn';
import { pressableSurface } from '@/lib/motion';
import { count as formatCount, money } from '@/lib/format';
import { toast } from '@/store/toastStore';
import {
  PlatformBadge,
  PlatformButton,
  PlatformEmpty,
  PlatformHeader,
  PlatformPageSkeleton,
  PlatformPanel,
} from '@/components/superadmin/PlatformUI';
import { PlatformActions, PlatformError, PlatformInput, PlatformModal, PlatformTextarea } from '@/components/superadmin/PlatformForm';
import { usePlans, useSuperAdminMutations } from '@/hooks/useSuperAdmin';
import { usePlatformDirectory } from '@/components/superadmin/platformData';

/**
 * The tiers a tenant subscribes to, laid out the way a customer compares them.
 *
 * **Cards, because plans are read across.** A price, how many businesses it
 * includes, and who is on it: three plans side by side answer "which tier
 * earns the most, which is empty" at a glance in a way three table rows do
 * not. The price is the card's largest figure because it is what the plan IS
 * to the customer.
 *
 * A plan sets feature defaults; it does not enforce anything. `requireFeature`
 * reads the resolved set (type, then plan, then per-business override).
 */

function NewPlanForm({ onDone, onCancel }) {
  const { createPlan } = useSuperAdminMutations();
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { name: '', description: '', price: '', includedSlots: 1 },
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        createPlan.mutate(
          {
            name: values.name,
            description: values.description,
            // Typed in dollars, sent in cents: the boundary every money field
            // in this app crosses in the client.
            priceCents: Math.round(Number(values.price || 0) * 100),
            includedSlots: Number(values.includedSlots || 0),
          },
          { onSuccess: (result) => onDone(result.plan, values.name) },
        ),
      )}
    >
      <PlatformError>{createPlan.error?.message}</PlatformError>
      <PlatformInput
        label="Plan name"
        required
        placeholder="Growth"
        {...register('name', { required: 'Give the plan a name.' })}
        error={formState.errors.name?.message}
      />
      <PlatformTextarea
        className="mt-4"
        label="Description"
        rows={2}
        placeholder="Up to three businesses, with marketing and reporting."
        {...register('description')}
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <PlatformInput label="Price a month" inputMode="decimal" prefix="$" placeholder="149.00" {...register('price')} />
        <PlatformInput label="Businesses included" type="number" min="0" required {...register('includedSlots')} />
      </div>
      <PlatformActions>
        <PlatformButton variant="ghost" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton variant="primary" type="submit" icon={Plus} loading={createPlan.isPending}>
          Create plan
        </PlatformButton>
      </PlatformActions>
    </form>
  );
}

export function SuperAdminPlansPage() {
  const navigate = useNavigate();
  const { data, isLoading } = usePlans();
  const { tenants } = usePlatformDirectory();
  const [creating, setCreating] = useState(false);

  if (isLoading) return <PlatformPageSkeleton />;
  const plans = data?.plans ?? [];

  const revenueOf = (plan) =>
    tenants.filter((tenant) => tenant.plan?.id === plan.id && tenant.status === 'active').length * (plan.priceCents ?? 0);

  return (
    <>
      <PlatformHeader
        crumbs={[{ label: 'Overview', to: '/superadmin' }, { label: 'Plans' }]}
        title="Plans"
        description="What a tenant pays, how many businesses it includes, and the features every business on it starts with."
        action={
          <PlatformButton variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New plan
          </PlatformButton>
        }
      />

      {!plans.length ? (
        <PlatformPanel>
          <PlatformEmpty
            icon={CreditCard}
            title="No plans yet"
            body="A plan sets what a tenant pays and how many businesses they may run."
            action={
              <PlatformButton variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New plan
              </PlatformButton>
            }
          />
        </PlatformPanel>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                to={`/superadmin/plans/${plan.id}`}
                className={cn(
                  pressableSurface,
                  'flex h-full flex-col rounded-xl border border-plat-line bg-plat-surface p-5 hover:border-plat-dim/60',
                  !plan.isActive && 'opacity-70',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-tight text-plat-text">{plan.name}</h2>
                  <PlatformBadge tone={plan.isActive ? 'ok' : 'neutral'}>{plan.isActive ? 'Offered' : 'Retired'}</PlatformBadge>
                </div>
                <p className="mt-4 text-plat-text">
                  <span className="tnum text-d-sm font-semibold">{money(plan.priceCents)}</span>
                  <span className="ml-1 text-sm text-plat-dim">a month</span>
                </p>
                <p className="mt-2 min-h-10 text-sm leading-normal text-plat-muted">{plan.description || 'No description.'}</p>
                <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-plat-line-soft pt-4 text-sm">
                  <div>
                    <dt className="text-xs text-plat-dim">Businesses</dt>
                    <dd className="tnum mt-0.5 font-medium text-plat-text">{formatCount(plan.includedSlots)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-plat-dim">Tenants</dt>
                    <dd className="tnum mt-0.5 font-medium text-plat-text">{formatCount(plan.tenantCount ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-plat-dim">Monthly</dt>
                    <dd className="tnum mt-0.5 font-medium text-plat-text">{money(revenueOf(plan))}</dd>
                  </div>
                </dl>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-plat-accent-soft">
                  Open plan
                  <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <PlatformModal open={creating} onClose={() => setCreating(false)} title="New plan" size="md" align="top">
        {creating && (
          <NewPlanForm
            onCancel={() => setCreating(false)}
            onDone={(plan, name) => {
              setCreating(false);
              toast.ok('Plan created', `${name} can now be assigned to a tenant.`);
              if (plan?.id) navigate(`/superadmin/plans/${plan.id}`);
            }}
          />
        )}
      </PlatformModal>
    </>
  );
}

export default SuperAdminPlansPage;
