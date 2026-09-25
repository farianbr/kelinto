import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { LogIn, Plus, ShieldAlert } from 'lucide-react';

import { count as formatCount } from '@/lib/format';
import { businessSlugProblem, suggestSlug } from '@shared/hosts';
import { PlatformButton } from '@/components/superadmin/PlatformUI';
import {
  PlatformActions,
  PlatformChoice,
  PlatformError,
  PlatformInput,
  PlatformNotice,
  PlatformSelect,
  PlatformTextarea,
} from '@/components/superadmin/PlatformForm';
import { addressOf, BUSINESS_TYPE_OPTIONS } from '@/components/superadmin/platformData';

/**
 * The console's record forms, shared by whichever page opens them.
 *
 * Each form is its own confirmation (§3.0.1): somebody opened it and typed.
 * What a form owes the operator instead is the consequence it cannot show in
 * a field - a slot spent, an invitation mailed, a log entry the customer reads.
 */

/** Create a tenant. Spends nothing until saved. */
export function TenantForm({ plans, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { name: '', contactName: '', contactEmail: '', phone: '', slots: 1, plan: '' },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <PlatformError>{error}</PlatformError>

      <PlatformInput
        label="Tenant name"
        required
        placeholder="Northline Group"
        hint="The account, not a business. It can own several businesses."
        {...register('name', { required: 'Give the tenant a name.' })}
        error={formState.errors.name?.message}
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <PlatformInput label="Contact name" placeholder="Dana Whitfield" {...register('contactName')} />
        <PlatformInput label="Contact email" type="email" placeholder="dana@northline.ca" {...register('contactEmail')} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <PlatformInput label="Phone" placeholder="Optional" {...register('phone')} />
        <PlatformInput
          label="Business slots"
          type="number"
          min="0"
          required
          hint="How many it may run."
          {...register('slots')}
        />
        <PlatformSelect
          label="Plan"
          options={[{ value: '', label: 'No plan' }, ...plans.map((row) => ({ value: row.id, label: row.name }))]}
          {...register('plan')}
        />
      </div>

      <PlatformActions>
        <PlatformButton variant="ghost" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton variant="primary" type="submit" icon={Plus} loading={isPending}>
          Create tenant
        </PlatformButton>
      </PlatformActions>
    </form>
  );
}

/**
 * A tenant's own details: who we deal with, and notes only we read.
 * Status, plan and slots are separate acts on the subscription page.
 */
export function TenantDetailsForm({ tenant, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: {
      name: tenant.name,
      contactName: tenant.contactName ?? '',
      contactEmail: tenant.contactEmail ?? '',
      phone: tenant.phone ?? '',
      notes: tenant.notes ?? '',
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <PlatformError>{error}</PlatformError>
      <PlatformInput
        label="Tenant name"
        required
        {...register('name', { required: 'Give the tenant a name.' })}
        error={formState.errors.name?.message}
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <PlatformInput label="Contact name" {...register('contactName')} />
        <PlatformInput label="Contact email" type="email" {...register('contactEmail')} />
      </div>
      <PlatformInput className="mt-4" label="Phone" {...register('phone')} />
      <PlatformTextarea
        className="mt-4"
        label="Internal notes"
        rows={4}
        maxLength={2000}
        hint="Seen only in this console. The tenant never reads it."
        {...register('notes')}
      />
      <PlatformActions>
        <PlatformButton variant="ghost" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton variant="primary" type="submit" loading={isPending}>
          Save details
        </PlatformButton>
      </PlatformActions>
    </form>
  );
}

/** The web-address field, so create and the domains page say the same thing. */
export function SlugInput({ value, onChange, storefrontDomain, showError, disabled }) {
  const problem = businessSlugProblem(value);
  return (
    <PlatformInput
      label="Web address"
      required
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value.toLowerCase().trim())}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      suffix={storefrontDomain ? `.${storefrontDomain}` : undefined}
      error={showError ? problem : null}
      hint={
        !value || problem
          ? 'Lowercase letters, digits and hyphens.'
          : storefrontDomain
            ? `Customers reach the website at ${addressOf(value, storefrontDomain)}.`
            : 'Becomes the website subdomain once Kelinto’s own domain is set on the server.'
      }
    />
  );
}

/** Add a business to a tenant. Spends one of its slots. */
export function BusinessForm({ tenant, storefrontDomain, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, formState, watch } = useForm({ defaultValues: { name: '' } });
  const [businessType, setBusinessType] = useState('both');
  /**
   * Follows the name until somebody edits it, then stops: once they have typed
   * their own, carrying on overwriting it as they fix a typo in the name would
   * throw their choice away.
   */
  const [typedSlug, setTypedSlug] = useState(null);
  const slug = typedSlug ?? suggestSlug(watch('name'));
  const [submitted, setSubmitted] = useState(false);

  const submit = handleSubmit((values) => {
    if (businessSlugProblem(slug)) return;
    onSubmit({ ...values, businessType, slug });
  });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        setSubmitted(true);
        return submit(event);
      }}
    >
      <PlatformError>{error}</PlatformError>

      <PlatformNotice>
        {tenant.name} has {formatCount(tenant.slotsFree)} slot{tenant.slotsFree === 1 ? '' : 's'} left. Creating a
        business spends one, and it stays spent for 30 days if the business is later deleted.
      </PlatformNotice>

      <PlatformInput
        label="Business name"
        required
        placeholder="Northline Repairs"
        {...register('name', { required: 'Give the business a name.' })}
        error={formState.errors.name?.message}
      />

      <div className="mt-4">
        <SlugInput
          value={slug}
          onChange={setTypedSlug}
          storefrontDomain={storefrontDomain}
          showError={submitted || typedSlug !== null}
        />
      </div>

      <div className="mt-5">
        <PlatformChoice
          legend="What it sells"
          name="businessType"
          value={businessType}
          onChange={setBusinessType}
          options={BUSINESS_TYPE_OPTIONS}
        />
        <p className="mt-2 text-xs text-plat-dim">
          Sets which apps its ERP starts with. Any feature can be switched afterwards.
        </p>
      </div>

      <PlatformActions>
        <PlatformButton variant="ghost" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton variant="primary" type="submit" icon={Plus} loading={isPending}>
          Create business
        </PlatformButton>
      </PlatformActions>
    </form>
  );
}

/**
 * Create the tenant's own administrator.
 *
 * **There is no password field, and that is the point.** The owner receives an
 * invitation and chooses their own secret, so no credential for a customer's
 * account ever passes through an operator's hands.
 */
export function OwnerForm({ tenant, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { contactName: '', email: '', phone: '' },
  });
  const live = tenant.businesses.filter((business) => !business.deletedAt);
  const [business, setBusiness] = useState(live[0]?.id ?? '');

  return (
    <form onSubmit={handleSubmit((values) => onSubmit({ ...values, business }))} noValidate>
      <PlatformError>{error}</PlatformError>

      <PlatformNotice tone="accent">
        Saving sends them an email to set their own password. No password is created here and none is sent.
      </PlatformNotice>

      <PlatformInput
        label="Name"
        required
        placeholder="Dana Whitfield"
        {...register('contactName', { required: 'Give the owner a name.' })}
        error={formState.errors.contactName?.message}
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <PlatformInput
          label="Email"
          type="email"
          required
          placeholder="dana@northline.ca"
          {...register('email', { required: 'An invitation needs an address.' })}
          error={formState.errors.email?.message}
        />
        <PlatformInput label="Phone" placeholder="Optional" {...register('phone')} />
      </div>

      {live.length > 1 && (
        <PlatformSelect
          className="mt-4"
          label="Administers"
          value={business}
          onChange={(event) => setBusiness(event.target.value)}
          options={live.map((row) => ({ value: row.id, label: row.name }))}
          hint="The tenant runs several businesses, so the server needs to be told which one this owner is for."
        />
      )}

      <PlatformActions>
        <PlatformButton variant="ghost" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton variant="primary" type="submit" icon={Plus} loading={isPending}>
          Create and send invitation
        </PlatformButton>
      </PlatformActions>
    </form>
  );
}

/**
 * Grant or take back slots. States the floor rather than only enforcing it:
 * the server refuses fewer slots than are in use, and the operator should know
 * before pressing rather than from an error afterwards.
 */
export function SlotsForm({ tenant, onSubmit, onCancel, isPending, error }) {
  const [slots, setSlots] = useState(String(tenant.slots));
  const value = Number(slots);
  const tooFew = Number.isFinite(value) && value < tenant.slotsUsed;
  const unchanged = value === tenant.slots;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooFew && !unchanged) onSubmit(value);
      }}
    >
      <PlatformError>{error}</PlatformError>
      <PlatformInput
        label="Business slots"
        type="number"
        min={tenant.slotsUsed}
        required
        value={slots}
        onChange={(event) => setSlots(event.target.value)}
        hint={`${tenant.name} holds ${formatCount(tenant.slotsUsed)} today, deleted businesses inside their 30 days included.`}
        error={tooFew ? `Cannot go below ${tenant.slotsUsed}: that many are in use.` : undefined}
      />
      <PlatformActions>
        <PlatformButton variant="ghost" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton variant="primary" type="submit" loading={isPending} disabled={tooFew || unchanged}>
          Set to {Number.isFinite(value) ? formatCount(value) : '…'}
        </PlatformButton>
      </PlatformActions>
    </form>
  );
}

/**
 * Stepping into a business (§4.5, invariant 9).
 *
 * **The reason is the point of this form**, not a formality. It is written into
 * the tenant's own activity log where their owner reads it, so the form says
 * so before the operator types: somebody who knows the sentence will be read
 * by the customer writes a different sentence.
 */
export function EnterForm({ business, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, formState } = useForm({ defaultValues: { reason: '', minutes: 60 } });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <PlatformError>{error}</PlatformError>

      <PlatformNotice icon={ShieldAlert}>
        You will work inside <strong className="font-semibold">{business.name}</strong> with full access to their
        records. Entering and leaving are both written into their activity log, where the owner reads your reason.
      </PlatformNotice>

      <PlatformTextarea
        label="Why are you stepping in?"
        required
        rows={2}
        placeholder="Investigating the invoice total they reported on ticket 4182"
        {...register('reason', {
          required: 'Say why. The business owner sees this.',
          minLength: { value: 4, message: 'Say a little more than that.' },
        })}
        error={formState.errors.reason?.message}
      />

      <PlatformInput
        className="mt-4 sm:max-w-48"
        label="Minutes"
        type="number"
        min={5}
        max={240}
        hint="Access ends by itself. Four hours at most."
        {...register('minutes', { valueAsNumber: true })}
        error={formState.errors.minutes?.message}
      />

      <PlatformActions>
        <PlatformButton variant="ghost" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton variant="primary" type="submit" icon={LogIn} loading={isPending}>
          Step in
        </PlatformButton>
      </PlatformActions>
    </form>
  );
}
