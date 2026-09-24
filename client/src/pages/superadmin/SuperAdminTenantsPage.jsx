import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  AlertCircle,
  Building2,
  Check,
  Globe,
  Layers,
  LogIn,
  Lock,
  Plus,
  MessageSquare,
  RotateCcw,
  Settings2,
  Trash2,
  UserPlus,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { money, count as formatCount, dateTime } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';
import {
  PlatformBadge,
  PlatformButton,
  PlatformEmpty,
  PlatformHeader,
  PlatformPanel,
} from '@/components/superadmin/PlatformUI';
import {
  PlatformActions,
  PlatformError,
  PlatformInput,
  PlatformModal,
  PlatformNotice,
  PlatformSelect,
} from '@/components/superadmin/PlatformForm';
import SupportThread from '@/components/support/SupportThread';
import {
  businessSlugProblem,
  customDomainProblem,
  normaliseDomain,
  suggestSlug,
} from '@shared/hosts';
import { toast } from '@/store/toastStore';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';
import {
  useTenants,
  usePlans,
  useBusinessFeatures,
  useSupportThread,
  useSuperAdminMutations,
} from '@/hooks/useSuperAdmin';

/**
 * Tenants, the businesses they own, and what each business may do.
 *
 * **The three things a super admin actually does** (§4.5): create a tenant,
 * grant it slots, and toggle features per business. Everything else the console
 * could show - revenue, usage, a tenant's own records - is deliberately absent:
 * an operator who can read every tenant's books is a breach waiting for one
 * stolen laptop, and the server returns none of it.
 */

const TYPE_TONES = { product: 'accent', service: 'warn', both: 'ok' };
const STATUS_TONES = { active: 'ok', past_due: 'warn', suspended: 'warn', cancelled: 'danger' };

/**
 * What each status actually does, said in the console rather than only in the
 * middleware that enforces it.
 *
 * An operator suspending a tenant is taking their panel read-only; one
 * cancelling is closing the account. Those are different acts with different
 * consequences, and a bare dropdown of four words says nothing about either.
 */
const TENANT_STATUSES = [
  { value: 'active', label: 'Active - everything works' },
  { value: 'past_due', label: 'Past due - can read, cannot create' },
  { value: 'suspended', label: 'Suspended - read-only' },
  { value: 'cancelled', label: 'Cancelled - no access' },
];

const STATUS_LABELS = {
  active: 'active',
  past_due: 'past due',
  suspended: 'suspended',
  cancelled: 'cancelled',
};

const BUSINESS_TYPES = [
  { value: 'product', label: 'Product - sells goods' },
  { value: 'service', label: 'Service - sells work' },
  { value: 'both', label: 'Both - goods and work' },
];

/**
 * The feature grid for one business.
 *
 * **`source` is what makes this honest.** A key that is on because the business
 * type says so reads differently from one somebody switched on, and a grid
 * showing only the effective value would make an override indistinguishable
 * from a default - so an operator could not tell what they had changed.
 *
 * A locked key renders as locked rather than being hidden: "this cannot be
 * switched off" is information, and omitting it would leave somebody hunting
 * for a row that is not there.
 */
function FeatureGrid({ businessId, onClose }) {
  const { data, isLoading } = useBusinessFeatures(businessId);
  const { setFeature } = useSuperAdminMutations();
  const [error, setError] = useState(null);

  if (isLoading) return <Skeleton className="h-64" rounded="lg" />;
  if (!data) return null;

  const byArea = data.features.reduce((acc, feature) => {
    (acc[feature.area] ??= []).push(feature);
    return acc;
  }, {});

  function toggle(feature) {
    setError(null);
    setFeature.mutate(
      {
        id: businessId,
        key: feature.key,
        // Switching a key that is already an override back to its default is a
        // third state, reachable from the Reset control rather than the toggle.
        enabled: !feature.enabled,
      },
      { onError: (err) => setError(err.message) },
    );
  }

  function reset(feature) {
    setError(null);
    setFeature.mutate(
      { id: businessId, key: feature.key, enabled: null },
      { onError: (err) => setError(err.message) },
    );
  }

  /**
   * The two storefront keys, read and written as one decision.
   *
   * `storefront.public` and `storefront.checkout` are separate flags because the
   * registry describes capabilities, but nobody configures a business that has a
   * public catalogue and no way to buy from it - that combination is a mistake,
   * not a mode. Surfacing them as one control is what stops it being reachable
   * by accident; the underlying keys stay separate and still appear below.
   */
  const publicKey = data.features.find((row) => row.key === 'storefront.public');
  const checkoutKey = data.features.find((row) => row.key === 'storefront.checkout');
  const hasWebsite = Boolean(publicKey?.enabled);

  function setStorefront(on) {
    setError(null);
    for (const feature of [publicKey, checkoutKey]) {
      if (!feature || feature.locked) continue;
      setFeature.mutate(
        { id: businessId, key: feature.key, enabled: on },
        { onError: (err) => setError(err.message) },
      );
    }
  }

  return (
    <>
      <p className="mb-3 text-sm text-plat-muted">
        {data.business.name} is a{' '}
        <strong className="font-semibold text-plat-text">{data.business.businessType}</strong>{' '}
        business
        {data.business.plan ? ` on the ${data.business.plan.name} plan` : ''}. The type sets the
        starting point; anything switched here overrides it.
      </p>

      {/* The one decision an operator actually makes about a business, lifted
          out of the grid because it is the first question - does this shop have
          a public website, or is it the back office only? */}
      {publicKey && (
        <div className="mb-4 rounded-md border border-plat-line-soft p-3">
          <p className="eyebrow mb-1.5 text-plat-dim">Storefront</p>
          <div className="flex flex-wrap gap-2">
            <PlatformButton
              size="sm"
              variant={hasWebsite ? 'primary' : 'ghost'}
              onClick={() => setStorefront(true)}
              disabled={setFeature.isPending}
            >
              Website + ERP
            </PlatformButton>
            <PlatformButton
              size="sm"
              variant={hasWebsite ? 'ghost' : 'primary'}
              onClick={() => setStorefront(false)}
              disabled={setFeature.isPending}
            >
              ERP only
            </PlatformButton>
          </div>
          <p className="mt-1.5 text-xs text-plat-dim">
            {hasWebsite
              ? 'Customers can browse the catalogue and place their own orders.'
              : 'No public site. Staff work in the panel and raise orders themselves.'}
          </p>
        </div>
      )}

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-plat-danger/10 px-3 py-2.5 text-sm text-plat-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="space-y-4">
        {Object.entries(byArea).map(([area, features]) => (
          <section key={area}>
            <h3 className="eyebrow mb-1.5 text-plat-dim">{area}</h3>
            <ul className="divide-y divide-plat-line-soft rounded-md border border-plat-line-soft">
              {features.map((feature) => (
                <li key={feature.key} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-plat-text">
                      {feature.label}
                      {feature.locked && (
                        <PlatformBadge tone="neutral" size="sm" icon={Lock}>
                          always on
                        </PlatformBadge>
                      )}
                      {feature.source === 'override' && (
                        <PlatformBadge tone="brand" size="sm">
                          overridden
                        </PlatformBadge>
                      )}
                    </p>
                    <p className="text-xs text-plat-dim">{feature.description}</p>
                  </div>

                  {feature.source === 'override' && (
                    <button
                      type="button"
                      onClick={() => reset(feature)}
                      className={cn(
                        pressable,
                        'shrink-0 self-center text-xs font-medium text-plat-dim hover:text-plat-text',
                      )}
                    >
                      Reset
                    </button>
                  )}

                  {/* A switch, not a checkbox: this is a setting that takes
                      effect immediately, not one field of a form somebody is
                      about to submit. */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={feature.enabled}
                    aria-label={`${feature.label} for ${data.business.name}`}
                    disabled={feature.locked || setFeature.isPending}
                    onClick={() => toggle(feature)}
                    className={cn(
                      pressable,
                      'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-snap',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      feature.enabled ? 'bg-plat-ok' : 'bg-plat-line',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 size-4 rounded-full bg-white transition-[left] duration-snap',
                        feature.enabled ? 'left-[18px]' : 'left-0.5',
                      )}
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <PlatformButton variant="ghost" onClick={onClose}>
          Done
        </PlatformButton>
      </div>
    </>
  );
}

/** Create a tenant, or add a business to one. Both spend nothing until saved. */
function TenantForm({ onSubmit, onCancel, isPending, error, plans }) {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { name: '', contactName: '', contactEmail: '', slots: 1, plan: '' },
  });
  const [plan, setPlan] = useState('');

  return (
    <form onSubmit={handleSubmit((values) => onSubmit({ ...values, plan }))}>
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-plat-danger/10 px-3 py-2.5 text-sm text-plat-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <PlatformInput
        label="Tenant name"
        required
        placeholder="Northline Group"
        {...register('name', { required: 'Give the tenant a name.' })}
        error={formState.errors.name?.message}
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <PlatformInput label="Contact name" placeholder="Dana Whitfield" {...register('contactName')} />
        <PlatformInput
          label="Contact email"
          type="email"
          placeholder="dana@northline.ca"
          {...register('contactEmail')}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <PlatformInput
          label="Business slots"
          type="number"
          min="0"
          required
          hint="How many businesses this tenant may run."
          {...register('slots')}
        />
        <div>
          <PlatformSelect
            label="Plan"
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
            options={[
              { value: '', label: 'No plan' },
              ...plans.map((row) => ({ value: row.id, label: row.name })),
            ]}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <PlatformButton variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton type="submit" icon={Plus} loading={isPending}>
          Create tenant
        </PlatformButton>
      </div>
    </form>
  );
}

/**
 * The address a slug becomes, as a customer would type it.
 *
 * `storefrontDomain` comes from the server's wildcard origin. Without one there
 * is no domain to promise, so the slug is shown alone rather than beside a
 * domain this installation does not actually answer on.
 */
function addressOf(slug, storefrontDomain) {
  if (!slug) return '';
  return storefrontDomain ? `${slug}.${storefrontDomain}` : slug;
}

/**
 * The web-address field, shared by create and by the address editor so both
 * say the same thing about the same input.
 */
function SlugInput({ value, onChange, storefrontDomain, error, showError }) {
  const problem = businessSlugProblem(value);
  return (
    <PlatformInput
      label="Web address"
      required
      value={value}
      onChange={(event) => onChange(event.target.value.toLowerCase().trim())}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      error={error || (showError ? problem : null)}
      hint={
        !value || problem
          ? 'Lowercase letters, digits and hyphens.'
          : storefrontDomain
            ? `Customers reach the storefront at ${addressOf(value, storefrontDomain)}.`
            : // No wildcard domain on this server, so there is no full address to
              // promise - say what the label is for instead of printing half of one.
              'Becomes the storefront subdomain once the platform domain is set on the server.'
      }
    />
  );
}

function BusinessForm({ tenant, storefrontDomain, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, formState, watch } = useForm({ defaultValues: { name: '' } });
  const [businessType, setBusinessType] = useState('product');

  /**
   * Follows the name until somebody edits it, then stops.
   *
   * Most businesses want the address their name suggests, so filling it saves a
   * step; but once somebody has typed their own, carrying on overwriting it as
   * they correct a typo in the name would throw their choice away.
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
      onSubmit={(event) => {
        setSubmitted(true);
        return submit(event);
      }}
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-plat-danger/10 px-3 py-2.5 text-sm text-plat-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <p className="mb-3 text-sm text-plat-muted">
        {tenant.name} has {formatCount(tenant.slotsFree)} slot
        {tenant.slotsFree === 1 ? '' : 's'} left. Creating a business spends one.
      </p>

      <PlatformInput
        label="Business name"
        required
        placeholder="Northline Repairs"
        {...register('name', { required: 'Give the business a name.' })}
        error={formState.errors.name?.message}
      />

      <div className="mt-3">
        <SlugInput
          value={slug}
          onChange={setTypedSlug}
          storefrontDomain={storefrontDomain}
          // Only once it matters: an empty name derives an empty slug, and
          // shouting about it before anybody has typed is noise.
          showError={submitted || typedSlug !== null}
        />
      </div>

      <div className="mt-3">
        <PlatformSelect
          label="Business type"
          value={businessType}
          onChange={(event) => setBusinessType(event.target.value)}
          options={BUSINESS_TYPES}
        />
        {/* The type is what decides which sections the panel renders, so it is
            worth saying rather than leaving to be discovered. */}
        <p className="mt-1.5 text-xs text-plat-dim">
          A product business gets Orders and Returns; a service business gets Tickets and Quotes.
          Either can be changed afterwards, one feature at a time.
        </p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <PlatformButton variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton type="submit" icon={Plus} loading={isPending}>
          Create business
        </PlatformButton>
      </div>
    </form>
  );
}

/**
 * Where a business answers: its web address, and up to two domains it owns -
 * one its customers use (the storefront) and one its staff use (the panel).
 *
 * Opened from the address itself on the business row. The form is the
 * confirmation (§3.0.1) - somebody opened it and typed - but it states the one
 * consequence nobody can see from the fields: a changed address stops the old
 * one working, and whatever was printed or shared with it goes dead too.
 */
function AddressForm({
  business,
  storefrontDomain,
  platformDomains,
  onSubmit,
  onCancel,
  isPending,
  error,
}) {
  const [slug, setSlug] = useState(business.slug ?? suggestSlug(business.name));
  const [domain, setDomain] = useState(business.domain ?? '');
  const [panelDomain, setPanelDomain] = useState(business.panelDomain ?? '');
  const [submitted, setSubmitted] = useState(false);

  const slugProblem = businessSlugProblem(slug);
  const domainProblem = customDomainProblem(domain, platformDomains);
  const panelProblem =
    customDomainProblem(panelDomain, platformDomains) ??
    (panelDomain && normaliseDomain(panelDomain) === normaliseDomain(domain)
      ? 'One address cannot be the storefront and the panel.'
      : null);
  const moving = Boolean(business.slug) && slug !== business.slug;
  const unchanged =
    slug === (business.slug ?? '') &&
    normaliseDomain(domain) === (business.domain ?? '') &&
    normaliseDomain(panelDomain) === (business.panelDomain ?? '');
  // The one step only the business can take, named exactly: the record in
  // THEIR DNS. Everything on our side (certificate, origin) follows by itself.
  const newDomains = [domain, panelDomain]
    .map(normaliseDomain)
    .filter((value) => value && value !== business.domain && value !== business.panelDomain);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (slugProblem || domainProblem || panelProblem) return;
        onSubmit({ slug, domain: normaliseDomain(domain), panelDomain: normaliseDomain(panelDomain) });
      }}
    >
      <PlatformError>{error}</PlatformError>

      <SlugInput
        value={slug}
        onChange={setSlug}
        storefrontDomain={storefrontDomain}
        showError
      />

      {moving && (
        <div className="mt-3">
          <PlatformNotice icon={AlertCircle}>
            {addressOf(business.slug, storefrontDomain)} stops working as soon as this is saved.
            Links already shared and anything printed with it, receipts included, will not reach
            the storefront.
          </PlatformNotice>
        </div>
      )}

      <div className="mt-3">
        <PlatformInput
          label="Storefront domain"
          placeholder="shop.example.com"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={submitted || domain ? domainProblem : null}
          hint="Optional. Where this business's customers shop, on a domain it owns."
        />
      </div>

      <div className="mt-3">
        <PlatformInput
          label="Panel domain"
          placeholder="app.example.com"
          value={panelDomain}
          onChange={(event) => setPanelDomain(event.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={submitted || panelDomain ? panelProblem : null}
          hint="Optional. Where its staff sign in to the ERP. Only this business's accounts can sign in there."
        />
      </div>

      {newDomains.length > 0 && storefrontDomain && (
        <div className="mt-3">
          <PlatformNotice icon={Globe}>
            The business adds a CNAME record for {newDomains.join(' and ')} pointing to{' '}
            {storefrontDomain}. The certificate is issued on the first visit after that; nothing
            changes on the server.
          </PlatformNotice>
        </div>
      )}

      <PlatformActions>
        <PlatformButton variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton type="submit" loading={isPending} disabled={unchanged}>
          Save address
        </PlatformButton>
      </PlatformActions>
    </form>
  );
}

/**
 * Web addresses tenants have asked for, waiting on an operator.
 *
 * At the top of the page because it is the one thing here somebody else is
 * waiting on - a business that asked for its storefront address cannot take a
 * customer until it is answered. Absent entirely when nothing is waiting,
 * rather than an empty panel saying so.
 *
 * Approve is confirmed, because it goes live the moment it is pressed and
 * changes which catalogue a public address opens. Reject asks for the reason,
 * which is shown to the tenant - the form is the confirmation.
 */
function AddressRequests({ requests, storefrontDomain }) {
  const { approveAddressRequest, rejectAddressRequest } = useSuperAdminMutations();
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');

  if (!requests.length) return null;

  return (
    <PlatformPanel
      title="Address requests"
      description="Storefront addresses tenants have asked for. Approving puts it live immediately."
      className="mb-3"
    >
      <ul className="space-y-2">
        {requests.map(({ business, tenantName }) => (
          <li
            key={business.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-plat-line-soft bg-plat-raised px-4 py-3"
          >
            {/* Full width on a phone, so the address is not squeezed into a
                column beside the two buttons - the same rule as the rows below. */}
            <span className="w-full min-w-0 sm:w-auto sm:flex-1">
              <span className="block font-mono text-sm text-plat-text break-all">
                {addressOf(business.addressRequest.slug, storefrontDomain)}
              </span>
              <span className="block text-xs text-plat-dim">
                {business.name} · {tenantName}
                {business.slug && ` · replaces ${addressOf(business.slug, storefrontDomain)}`}
              </span>
              <span className="block text-xs text-plat-dim">
                {[business.addressRequest.requestedBy, dateTime(business.addressRequest.requestedAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <div className="flex gap-2">
              <PlatformButton variant="ghost" size="sm" onClick={() => setRejecting(business)}>
                Reject
              </PlatformButton>
              <PlatformButton size="sm" icon={Check} onClick={() => setApproving(business)}>
                Approve
              </PlatformButton>
            </div>
          </li>
        ))}
      </ul>

      <PlatformModal
        open={Boolean(approving)}
        onClose={() => setApproving(null)}
        title={`Approve ${addressOf(approving?.addressRequest?.slug ?? '', storefrontDomain)}?`}
        size="md"
        align="top"
      >
        {approving && (
          <>
            <PlatformError>{approveAddressRequest.error?.message}</PlatformError>
            <p className="text-sm text-plat-muted">
              {addressOf(approving.addressRequest.slug, storefrontDomain)} starts opening{' '}
              {approving.name}&apos;s storefront as soon as this is approved.
              {approving.slug &&
                ` ${addressOf(approving.slug, storefrontDomain)} stops working at the same moment.`}
            </p>
            <PlatformActions>
              <PlatformButton variant="ghost" onClick={() => setApproving(null)}>
                Cancel
              </PlatformButton>
              <PlatformButton
                variant="primary"
                icon={Check}
                loading={approveAddressRequest.isPending}
                onClick={() =>
                  approveAddressRequest.mutate(
                    { id: approving.id },
                    {
                      onSuccess: (result) => {
                        toast.ok(
                          'Address approved',
                          result.liveUrl
                            ? `${approving.name} is live at ${result.liveUrl.replace(/^https?:\/\//, '')}.`
                            : `${approving.name} has its address.`,
                        );
                        setApproving(null);
                      },
                    },
                  )
                }
              >
                Approve and go live
              </PlatformButton>
            </PlatformActions>
          </>
        )}
      </PlatformModal>

      <PlatformModal
        open={Boolean(rejecting)}
        onClose={() => {
          setRejecting(null);
          setNote('');
        }}
        title={`Reject ${addressOf(rejecting?.addressRequest?.slug ?? '', storefrontDomain)}`}
        size="md"
        align="top"
      >
        {rejecting && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              rejectAddressRequest.mutate(
                { id: rejecting.id, note },
                {
                  onSuccess: () => {
                    toast.ok('Request rejected', `${rejecting.name} can see why.`);
                    setRejecting(null);
                    setNote('');
                  },
                },
              );
            }}
          >
            <PlatformError>{rejectAddressRequest.error?.message}</PlatformError>
            <PlatformInput
              label="Reason"
              required
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              hint={`Shown to ${rejecting.name}, so they can ask for something else.`}
            />
            <PlatformActions>
              <PlatformButton
                variant="ghost"
                type="button"
                onClick={() => {
                  setRejecting(null);
                  setNote('');
                }}
              >
                Cancel
              </PlatformButton>
              <PlatformButton
                variant="danger"
                type="submit"
                disabled={!note.trim()}
                loading={rejectAddressRequest.isPending}
              >
                Reject request
              </PlatformButton>
            </PlatformActions>
          </form>
        )}
      </PlatformModal>
    </PlatformPanel>
  );
}

/**
 * A tenant's conversation, opened from their row.
 *
 * The same component the Support screen uses - this is the entry point for a
 * tenant who has never written, since a thread only appears on that screen once
 * it exists.
 */
function TenantThread({ tenantId, tenantName }) {
  const { data, isLoading } = useSupportThread(tenantId);
  const { replyToThread } = useSuperAdminMutations();
  const [error, setError] = useState(null);

  if (isLoading) return <Skeleton className="h-64" rounded="lg" />;

  return (
    <div className="flex h-[55vh] flex-col">
      <SupportThread
        thread={data?.thread}
        side="platform"
        surface="platform"
        isSending={replyToThread.isPending}
        error={error}
        placeholder={`Message ${tenantName}…`}
        emptyBody="No messages yet. What you send here appears in their own panel."
        onSend={(body, { onSuccess }) => {
          setError(null);
          replyToThread.mutate(
            { id: tenantId, body },
            { onSuccess, onError: (err) => setError(err.message) },
          );
        }}
      />
    </div>
  );
}

/**
 * Create the tenant's own administrator (§6 phase 16).
 *
 * **There is no password field and that is the point.** The owner receives an
 * invitation and chooses their own secret, so no credential for a customer's
 * account ever passes through an operator's hands - or sits in their sent mail.
 * The form says so rather than leaving the absence to be wondered about.
 */
function OwnerForm({ tenant, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { contactName: '', email: '', phone: '' },
  });

  // Only asked when the answer is ambiguous - the server refuses to guess
  // between several, and there is nothing to choose when there is one.
  const needsBusiness = tenant.businesses.length > 1;
  const [business, setBusiness] = useState(tenant.businesses[0]?.id ?? '');

  return (
    <form onSubmit={handleSubmit((values) => onSubmit({ ...values, business }))} noValidate>
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-plat-danger/10 px-3 py-2.5 text-sm text-plat-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <p className="mb-3 text-sm text-plat-muted">
        They receive an email inviting them to set their own password. No password is created
        here and none is sent.
      </p>

      <PlatformInput
        label="Name"
        required
        placeholder="Dana Whitfield"
        {...register('contactName', { required: 'Give the owner a name.' })}
        error={formState.errors.contactName?.message}
      />

      <div className="mt-3">
        <PlatformInput
          label="Email"
          type="email"
          required
          placeholder="dana@northline.ca"
          {...register('email', { required: 'An invitation needs an address.' })}
          error={formState.errors.email?.message}
        />
      </div>

      <div className="mt-3">
        <PlatformInput label="Phone" placeholder="Optional" {...register('phone')} />
      </div>

      {needsBusiness && (
        <div className="mt-3">
          <PlatformSelect
            label="Administers"
            value={business}
            onChange={(event) => setBusiness(event.target.value)}
            options={tenant.businesses.map((row) => ({ value: row.id, label: row.name }))}
          />
          <p className="mt-1.5 text-xs text-plat-dim">
            An owner administers one business. Add another owner for each of the others.
          </p>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <PlatformButton variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton type="submit" icon={Plus} loading={isPending}>
          Create and invite
        </PlatformButton>
      </div>
    </form>
  );
}

/**
 * Change what a tenant's subscription still permits (§6 phase 19).
 *
 * **Each option states its consequence**, because the four words on their own
 * do not distinguish "they cannot create new records" from "they cannot get in
 * at all" - and the operator picking between them is deciding whether somebody
 * can run their business tomorrow morning.
 */
function StatusForm({ tenant, onSubmit, onCancel, isPending, error }) {
  const [status, setStatus] = useState(tenant.status);

  const consequence = {
    active: 'Everything works normally.',
    past_due:
      'They keep full read access - a locked-out customer cannot chase the payment that settles the bill - but nothing new can be created.',
    suspended: 'The panel opens read-only. Nothing can be changed.',
    cancelled: 'The account is closed. Only billing remains reachable.',
  }[status];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        /**
         * Only the fields the schema owns, not the whole row.
         *
         * The tenant object from `listTenants` carries derived shapes - `plan`
         * as `{ id, name }`, `businesses`, `slotsUsed` - and `tenantSchema`
         * expects `plan` to be a string id. Spreading the row would fail
         * validation on a field this form never touches.
         */
        onSubmit({ name: tenant.name, status });
      }}
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-plat-danger/10 px-3 py-2.5 text-sm text-plat-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <PlatformSelect
        label="Subscription status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        options={TENANT_STATUSES}
      />

      <p className="mt-2 rounded-md bg-plat-raised px-3 py-2.5 text-sm text-plat-muted">
        {consequence}
      </p>

      {/* A tenant's businesses all move together - the status is a property of
          the account, not of one shop - so the count is worth showing before
          the change rather than discovering afterwards. */}
      {tenant.businesses.length > 1 && status !== 'active' && (
        <p className="mt-2 text-xs text-plat-dim">
          This affects all {formatCount(tenant.businesses.length)} of this tenant's businesses.
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <PlatformButton variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton
          type="submit"
          icon={Check}
          loading={isPending}
          disabled={status === tenant.status}
        >
          Save status
        </PlatformButton>
      </div>
    </form>
  );
}

/**
 * Stepping into a business (§4.5, invariant 9).
 *
 * **The reason field is the point of this form**, not a formality. It is
 * written into the tenant's own activity log where their owner reads it, so the
 * screen says so plainly before the operator types - somebody who knows the
 * sentence will be read by the customer writes a different sentence.
 *
 * The form deliberately offers no "remember me" and no long durations: a grant
 * is an errand, and the console should not make a standing key easy to mint.
 */
function EnterForm({ business, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { reason: '', minutes: 60 },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-plat-danger/10 px-3 py-2.5 text-sm text-plat-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <p className="mb-3 flex items-start gap-2 rounded-md bg-plat-warn/10 px-3 py-2.5 text-sm text-plat-text">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-plat-warn" strokeWidth={2} aria-hidden="true" />
        <span>
          You are about to work inside <strong>{business.name}</strong> with full access to their
          records. Entering and leaving are both written into their activity log, and everything
          you do there is recorded as platform support.
        </span>
      </p>

      <PlatformInput
        label="Why are you stepping in?"
        required
        placeholder="Investigating the invoice total they reported on ticket 4182"
        {...register('reason', {
          required: 'Say why - the business owner sees this.',
          minLength: { value: 4, message: 'Say a little more than that.' },
        })}
        error={formState.errors.reason?.message}
      />

      <div className="mt-3">
        <PlatformInput
          label="Minutes"
          type="number"
          min={5}
          max={240}
          {...register('minutes', { valueAsNumber: true })}
          error={formState.errors.minutes?.message}
        />
        {/* A grant expires on a clock rather than on a sign-out, so the length
            is a decision the operator makes deliberately each time. */}
        <p className="mt-1.5 text-xs text-plat-dim">
          Access ends automatically when this runs out. Four hours is the most the platform allows.
        </p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <PlatformButton variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton type="submit" icon={LogIn} loading={isPending}>
          Step in
        </PlatformButton>
      </div>
    </form>
  );
}

/**
 * Grant or revoke slots.
 *
 * States the floor rather than only enforcing it: the server refuses fewer
 * slots than the tenant already uses, and an operator should learn that before
 * the click rather than from an error afterwards.
 */
function SlotsForm({ tenant, onSubmit, onCancel, isPending, error }) {
  const [slots, setSlots] = useState(String(tenant.slots));
  const value = Number(slots);
  const tooFew = Number.isFinite(value) && value < tenant.slotsUsed;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooFew) onSubmit(value);
      }}
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-plat-danger/10 px-3 py-2.5 text-sm text-plat-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <PlatformInput
        label="Business slots"
        type="number"
        min={tenant.slotsUsed}
        required
        value={slots}
        onChange={(event) => setSlots(event.target.value)}
        hint={`${tenant.name} runs ${formatCount(tenant.slotsUsed)} business${tenant.slotsUsed === 1 ? '' : 'es'} today.`}
        error={tooFew ? `Cannot go below ${tenant.slotsUsed} - that is what is already running.` : undefined}
      />

      <div className="mt-4 flex justify-end gap-2">
        <PlatformButton variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </PlatformButton>
        <PlatformButton type="submit" icon={Check} loading={isPending} disabled={tooFew}>
          Update slots
        </PlatformButton>
      </div>
    </form>
  );
}

export function SuperAdminTenantsPage() {
  const { data, isLoading } = useTenants();
  const { data: planData } = usePlans();
  const {
    createTenant,
    createBusiness,
    setSlots,
    enterBusiness,
    updateTenant,
    createOwner,
    deleteBusiness,
    restoreBusiness,
    setBusinessAddress,
  } = useSuperAdminMutations();
  const [addressFor, setAddressFor] = useState(null);

  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState(null);
  const [featuresFor, setFeaturesFor] = useState(null);
  const [enterFor, setEnterFor] = useState(null);
  const [statusFor, setStatusFor] = useState(null);
  const [ownerFor, setOwnerFor] = useState(null);
  const [messageFor, setMessageFor] = useState(null);
  const [deleteFor, setDeleteFor] = useState(null);
  // A modal rather than `window.prompt`: the panel already ruled that out once
  // for the rejection reason, on the grounds that it was the one control on the
  // page that did not look like the rest of the app.
  const [slotsFor, setSlotsFor] = useState(null);
  const [error, setError] = useState(null);

  const tenants = data?.tenants ?? [];
  const unassigned = data?.unassigned ?? [];
  const storefrontDomain = data?.storefrontDomain ?? null;
  const platformDomains = data?.platformDomains ?? [];
  const plans = planData?.plans ?? [];

  if (isLoading) {
    return (
      <>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-4 h-40 w-full" />
      </>
    );
  }

  return (
    <>
      <PlatformHeader
        title="Tenants"
        description="Who runs on the platform, what they may run, and what each business can do."
        action={
          <PlatformButton variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New tenant
          </PlatformButton>
        }
      />

      <AddressRequests
        storefrontDomain={storefrontDomain}
        requests={[
          ...tenants.flatMap((tenant) =>
            tenant.businesses.map((business) => ({ business, tenantName: tenant.name })),
          ),
          ...unassigned.map((business) => ({ business, tenantName: 'No tenant' })),
        ].filter(({ business }) => business.addressRequest?.status === 'pending' && !business.deletedAt)}
      />

      {!tenants.length ? (
        <PlatformPanel>
          <PlatformEmpty
            icon={Layers}
            title="No tenants yet"
            body="A tenant is an account that owns one or more businesses. Create one to get started."
            action={
              <PlatformButton variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                New tenant
              </PlatformButton>
            }
          />
        </PlatformPanel>
      ) : (
        <div className="space-y-3">
          {tenants.map((tenant) => (
            <PlatformPanel
              key={tenant.id}
              title={tenant.name}
              description={
                [
                  tenant.plan?.name ?? 'No plan',
                  `${formatCount(tenant.slotsUsed)} of ${formatCount(tenant.slots)} slots used`,
                  /**
                   * The owner, read off the **tenant**.
                   *
                   * Owners live in the control plane scoped to the tenant, so
                   * one login reaches every business the account owns. The
                   * console previously read them per-business and therefore
                   * showed "No owner - nobody can sign in" against a tenant
                   * whose owner was signed in at that moment.
                   */
                  tenant.admins?.length
                    ? tenant.admins.map((admin) => admin.email).join(', ')
                    : 'No owner - nobody can sign in',
                ]
                  .filter(Boolean)
                  .join(' · ')
              }
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {/* The badge is the control. A status that can be read but
                      only changed from somewhere else is a status somebody
                      edits in the wrong place - and this one decides whether
                      the tenant can trade tomorrow. */}
                  <button
                    type="button"
                    onClick={() => setStatusFor(tenant)}
                    aria-label={`Change subscription status for ${tenant.name}`}
                    className={cn(pressable, 'rounded-full')}
                  >
                    <PlatformBadge tone={STATUS_TONES[tenant.status] ?? 'neutral'}>
                      {STATUS_LABELS[tenant.status] ?? tenant.status}
                    </PlatformBadge>
                  </button>
                  <PlatformButton
                    variant="ghost"
                    size="sm"
                    icon={SlidersHorizontal}
                    onClick={() => setSlotsFor(tenant)}
                  >
                    Slots
                  </PlatformButton>
                  {/* The way to start a conversation with a tenant who has never
                      written - the Support screen only lists threads that
                      already exist. */}
                  <PlatformButton
                    variant="ghost"
                    size="sm"
                    icon={MessageSquare}
                    onClick={() => setMessageFor(tenant)}
                  >
                    Message
                  </PlatformButton>

                  {/* Only offered once there is a business to administer - an
                      owner is scoped to one, and the server refuses otherwise. */}
                  {tenant.businesses.length > 0 && (
                    <PlatformButton
                      variant="ghost"
                      size="sm"
                      icon={UserPlus}
                      onClick={() => setOwnerFor(tenant)}
                    >
                      Add owner
                    </PlatformButton>
                  )}
                  <PlatformButton
                    size="sm"
                    icon={Plus}
                    disabled={tenant.slotsFree <= 0}
                    onClick={() => setAddingTo(tenant)}
                  >
                    Add business
                  </PlatformButton>
                </div>
              }
            >
              {!tenant.businesses.length ? (
                <p className="text-sm text-plat-muted">
                  No businesses yet. This tenant has {formatCount(tenant.slotsFree)} slot
                  {tenant.slotsFree === 1 ? '' : 's'} to spend.
                </p>
              ) : (
                <ul className="space-y-2">
                  {tenant.businesses.map((business) => (
                    <li
                      key={business.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-plat-line-soft bg-plat-raised px-4 py-3"
                    >
                      {/* Identity takes the whole first line on a phone and
                          shares it on anything wider. Sharing it at 360px left
                          the name three letters wide beside the type badge and
                          the Features button - the one thing on the row you
                          need to read to know which business it is. */}
                      <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1">
                        <Building2
                          className="size-4 shrink-0 text-plat-dim"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-plat-text">
                            {business.name}
                          </span>
                          {/* The address is the control, the way the tenant's
                              status badge is: where a business answers is read
                              here, so it is changed here. A business with none
                              cannot be reached on any host, which is worth the
                              warning colour rather than a quiet dash. */}
                          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
                            <span className="font-mono text-plat-dim">{business.code}</span>
                            <span className="text-plat-dim" aria-hidden="true">
                              ·
                            </span>
                            <button
                              type="button"
                              onClick={() => setAddressFor(business)}
                              disabled={Boolean(business.deletedAt)}
                              aria-label={`Change web address for ${business.name}`}
                              className={cn(
                                pressable,
                                'rounded font-mono underline decoration-dotted underline-offset-2',
                                'disabled:no-underline disabled:active:scale-100',
                                business.slug ? 'text-plat-muted' : 'text-plat-warn',
                              )}
                            >
                              {business.slug
                                ? business.domain || addressOf(business.slug, storefrontDomain)
                                : 'No web address'}
                            </button>
                            {business.panelDomain && (
                              <>
                                <span className="text-plat-dim" aria-hidden="true">
                                  ·
                                </span>
                                <span className="font-mono text-plat-muted">
                                  {business.panelDomain} (panel)
                                </span>
                              </>
                            )}
                          </span>

                          {/* A deleted business still holds its slot until the
                              window closes, which is the fact an operator needs
                              when the slot arithmetic looks wrong.

                              There is deliberately no owner line here any more:
                              an owner belongs to the tenant, not to one of its
                              businesses, and it is shown on the tenant header
                              above. */}
                          {business.deletedAt && (
                            <span className="mt-0.5 block text-xs text-plat-danger">
                              {business.restorable
                                ? `Deleted - restorable until ${dateTime(business.purgeAfter)}, slot still held`
                                : 'Deleted - past its retention window'}
                            </span>
                          )}
                        </span>
                      </div>

                      <PlatformBadge tone={TYPE_TONES[business.businessType] ?? 'neutral'}>
                        {business.businessType}
                      </PlatformBadge>

                      <PlatformButton
                        variant="ghost"
                        size="sm"
                        icon={Settings2}
                        onClick={() => setFeaturesFor(business)}
                      >
                        Features
                      </PlatformButton>

                      {/* Reading a tenant's records requires stepping in, and
                          stepping in is logged into their own activity log
                          (§4.5). The console itself shows no customer, invoice
                          or order - this button is the only way to see one, and
                          it leaves a trail the owner reads. */}
                      {!business.deletedAt && (
                        <PlatformButton
                          variant="ghost"
                          size="sm"
                          icon={LogIn}
                          onClick={() => setEnterFor(business)}
                        >
                          Step in
                        </PlatformButton>
                      )}

                      {/* Deletion is soft and reversible while the window is
                          open, so restore sits where delete was rather than
                          somewhere a operator has to go looking for it. */}
                      {business.deletedAt ? (
                        business.restorable && (
                          <PlatformButton
                            variant="ghost"
                            size="sm"
                            icon={RotateCcw}
                            loading={restoreBusiness.isPending}
                            onClick={() =>
                              restoreBusiness.mutate(
                                { id: business.id },
                                { onError: (err) => toast.error('Could not restore', err.message) },
                              )
                            }
                          >
                            Restore
                          </PlatformButton>
                        )
                      ) : (
                        <PlatformButton
                          variant="ghost"
                          size="sm"
                          icon={Trash2}
                          disabled={business.isDefault}
                          onClick={() => setDeleteFor(business)}
                        >
                          Delete
                        </PlatformButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </PlatformPanel>
          ))}
        </div>
      )}

      {/* A business owned by nobody is a real state somebody has to resolve, and
          hiding it would make the slot arithmetic disagree with the database. */}
      {unassigned.length > 0 && (
        <PlatformPanel
          icon={AlertCircle}
          title="Not assigned to a tenant"
          description="These businesses predate tenants. Assign them so their slots are counted."
          className="mt-3"
        >
          <ul className="space-y-2">
            {unassigned.map((business) => (
              <li
                key={business.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-warn/30 bg-plat-warn/10 px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 text-sm font-medium text-plat-text">
                  {business.name}
                </span>
                <PlatformBadge tone={TYPE_TONES[business.businessType] ?? 'neutral'} size="sm">
                  {business.businessType}
                </PlatformBadge>
              </li>
            ))}
          </ul>
        </PlatformPanel>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-plat-danger/10 px-3 py-2.5 text-sm text-plat-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <PlatformModal open={creating} onClose={() => setCreating(false)} title="New tenant" size="md" align="top">
        <TenantForm
          plans={plans}
          isPending={createTenant.isPending}
          error={createTenant.error?.message}
          onCancel={() => setCreating(false)}
          onSubmit={(values) =>
            createTenant.mutate(values, {
              onSuccess: () => {
                setCreating(false);
                toast.ok('Tenant created', `${values.name} is on the platform.`);
              },
            })
          }
        />
      </PlatformModal>

      <PlatformModal
        open={Boolean(addingTo)}
        onClose={() => setAddingTo(null)}
        title={`Add a business to ${addingTo?.name ?? ''}`}
        size="md"
        align="top"
      >
        {addingTo && (
          <BusinessForm
            tenant={addingTo}
            storefrontDomain={storefrontDomain}
            isPending={createBusiness.isPending}
            error={createBusiness.error?.message}
            onCancel={() => setAddingTo(null)}
            onSubmit={(values) =>
              createBusiness.mutate(
                { id: addingTo.id, ...values },
                {
                  onSuccess: () => {
                    setAddingTo(null);
                    toast.ok('Business created', `${values.name} is ready to configure.`);
                  },
                },
              )
            }
          />
        )}
      </PlatformModal>

      <PlatformModal
        open={Boolean(addressFor)}
        onClose={() => setAddressFor(null)}
        title={`Web address - ${addressFor?.name ?? ''}`}
        size="md"
        align="top"
      >
        {addressFor && (
          <AddressForm
            business={addressFor}
            storefrontDomain={storefrontDomain}
            platformDomains={platformDomains}
            isPending={setBusinessAddress.isPending}
            error={setBusinessAddress.error?.message}
            onCancel={() => setAddressFor(null)}
            onSubmit={(values) =>
              setBusinessAddress.mutate(
                { id: addressFor.id, ...values },
                {
                  onSuccess: (result) => {
                    setAddressFor(null);
                    const { slug, domain, panelDomain } = result.business;
                    const where = [addressOf(slug, storefrontDomain), domain, panelDomain && `${panelDomain} (panel)`]
                      .filter(Boolean)
                      .join(' · ');
                    toast.ok('Address saved', `${addressFor.name} answers at ${where}.`);
                  },
                },
              )
            }
          />
        )}
      </PlatformModal>

      <PlatformModal
        open={Boolean(slotsFor)}
        onClose={() => setSlotsFor(null)}
        title={`Business slots - ${slotsFor?.name ?? ''}`}
        size="sm"
        align="top"
      >
        {slotsFor && (
          <SlotsForm
            tenant={slotsFor}
            isPending={setSlots.isPending}
            error={setSlots.error?.message}
            onCancel={() => setSlotsFor(null)}
            onSubmit={(slots) =>
              setSlots.mutate(
                { id: slotsFor.id, slots },
                {
                  onSuccess: () => {
                    setSlotsFor(null);
                    toast.ok('Slots updated', `${slotsFor.name} now has ${slots}.`);
                  },
                },
              )
            }
          />
        )}
      </PlatformModal>

      <PlatformModal
        open={Boolean(featuresFor)}
        onClose={() => setFeaturesFor(null)}
        title={`Features - ${featuresFor?.name ?? ''}`}
        size="lg"
        align="top"
      >
        {featuresFor && (
          <FeatureGrid businessId={featuresFor.id} onClose={() => setFeaturesFor(null)} />
        )}
      </PlatformModal>

      <PlatformModal
        open={Boolean(deleteFor)}
        onClose={() => setDeleteFor(null)}
        title={`Delete ${deleteFor?.name ?? ''}?`}
        size="md"
        align="top"
      >
        {deleteFor && (
          <>
            {/* Says what deletion actually does, because "delete" on its own
                implies something this does not do - the records stay, and the
                slot does not come back today. */}
            <p className="text-sm text-plat-muted">
              The business stops trading and disappears from the tenant's switcher. Its records
              are kept and it can be restored for 30 days.
            </p>
            <p className="mt-2 text-sm text-plat-muted">
              The slot stays spent for those 30 days - it is not returned immediately, so
              delete-and-recreate cannot be used to run an extra business.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <PlatformButton variant="ghost" onClick={() => setDeleteFor(null)}>
                Cancel
              </PlatformButton>
              <PlatformButton
                variant="danger"
                icon={Trash2}
                loading={deleteBusiness.isPending}
                onClick={() =>
                  deleteBusiness.mutate(
                    { id: deleteFor.id },
                    {
                      onSuccess: () => {
                        toast.ok('Business deleted', `${deleteFor.name} can be restored for 30 days.`);
                        setDeleteFor(null);
                      },
                      onError: (err) => toast.error('Could not delete', err.message),
                    },
                  )
                }
              >
                Delete
              </PlatformButton>
            </div>
          </>
        )}
      </PlatformModal>

      <PlatformModal
        open={Boolean(messageFor)}
        onClose={() => setMessageFor(null)}
        title={`Message ${messageFor?.name ?? ''}`}
        size="lg"
        align="top"
      >
        {messageFor && (
          <TenantThread tenantId={messageFor.id} tenantName={messageFor.name} />
        )}
      </PlatformModal>

      <PlatformModal
        open={Boolean(ownerFor)}
        onClose={() => setOwnerFor(null)}
        title={`Owner for ${ownerFor?.name ?? ''}`}
        size="md"
        align="top"
      >
        {ownerFor && (
          <OwnerForm
            tenant={ownerFor}
            isPending={createOwner.isPending}
            error={error}
            onCancel={() => setOwnerFor(null)}
            onSubmit={(values) => {
              setError(null);
              createOwner.mutate(
                { id: ownerFor.id, ...values },
                {
                  onSuccess: (result) => {
                    // The account exists whether or not the mail went out, and
                    // saying which is what tells the operator to resend rather
                    // than to create a second one.
                    if (result.invited) {
                      toast.ok('Owner invited', `${result.owner.email} can now set a password.`);
                    } else {
                      toast.info(
                        'Owner created, invitation not sent',
                        `${result.owner.email} exists - resend the invitation rather than creating another.`,
                      );
                    }
                    setOwnerFor(null);
                  },
                  onError: (err) => setError(err.message),
                },
              );
            }}
          />
        )}
      </PlatformModal>

      <PlatformModal
        open={Boolean(statusFor)}
        onClose={() => setStatusFor(null)}
        title={`Status - ${statusFor?.name ?? ''}`}
        size="md"
        align="top"
      >
        {statusFor && (
          <StatusForm
            tenant={statusFor}
            isPending={updateTenant.isPending}
            error={error}
            onCancel={() => setStatusFor(null)}
            onSubmit={(values) => {
              setError(null);
              updateTenant.mutate(
                { id: statusFor.id, ...values },
                {
                  onSuccess: () => {
                    toast.ok(
                      'Status updated',
                      `${statusFor.name} is now ${STATUS_LABELS[values.status]}.`,
                    );
                    setStatusFor(null);
                  },
                  onError: (err) => setError(err.message),
                },
              );
            }}
          />
        )}
      </PlatformModal>

      <PlatformModal
        open={Boolean(enterFor)}
        onClose={() => setEnterFor(null)}
        title={`Step into ${enterFor?.name ?? ''}`}
        size="md"
        align="top"
      >
        {enterFor && (
          <EnterForm
            business={enterFor}
            isPending={enterBusiness.isPending}
            error={error}
            onCancel={() => setEnterFor(null)}
            onSubmit={(values) => {
              setError(null);
              enterBusiness.mutate(
                { id: enterFor.id, ...values },
                {
                  /**
                   * A full page load rather than a route change.
                   *
                   * The panel is a different application on a different session,
                   * and everything React Query holds was fetched as the console.
                   * Navigating within the SPA would carry that cache across the
                   * boundary; reloading is the one way to be certain the panel
                   * starts as the support session and nothing else.
                   */
                  // With the console and the panel on different hosts, the
                  // session cannot be set from here - the server hands back a
                  // single-use link the panel host claims instead.
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

export default SuperAdminTenantsPage;
