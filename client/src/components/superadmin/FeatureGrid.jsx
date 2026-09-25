import { useState } from 'react';
import { Lock, RotateCcw, Search } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { toast } from '@/store/toastStore';
import { PlatformBadge, PlatformButton, PlatformPanel, PlatformSkeleton } from '@/components/superadmin/PlatformUI';
import { PlatformConfirm, PlatformError, PlatformSwitch } from '@/components/superadmin/PlatformForm';
import { useBusinessFeatures, useSuperAdminMutations } from '@/hooks/useSuperAdmin';
import { BUSINESS_TYPE } from '@/components/superadmin/platformData';

/**
 * One business's features, changed as a batch.
 *
 * **Switches stage; Apply writes.** The grid used to save on every click,
 * which made it the one place in the console where a write fired without a
 * confirmation (§3.0.1), and a slip of the trackpad switched a section off for
 * a live business. Now each switch marks a pending change, a bar says how many
 * are waiting, and Apply lists them in a confirmation before anything is sent.
 *
 * **`source` is what makes the grid honest.** A key that is on because the
 * business type says so reads differently from one somebody switched on, so an
 * operator can always tell what they changed from what they inherited.
 */

const SOURCE_LABEL = {
  override: 'set here',
  plan: 'from plan',
  type: 'from type',
  default: 'default',
};

export function FeatureGrid({ businessId, businessName, disabled }) {
  const { data, isLoading } = useBusinessFeatures(businessId);
  const { setFeature } = useSuperAdminMutations();
  // key -> true | false | null (null returns the key to its inherited value)
  const [pending, setPending] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  if (isLoading) return <PlatformSkeleton className="h-96 w-full rounded-xl" />;
  if (!data) return null;

  const features = data.features;
  const changeKeys = Object.keys(pending);
  const byKey = new Map(features.map((feature) => [feature.key, feature]));

  function stage(feature, value) {
    setPending((current) => {
      const next = { ...current };
      // Staging a key back to what it already is clears the change rather than
      // leaving a no-op in the list: a reset only means something on an
      // override, and a switch only means something if it moves the value.
      const noOp = value === null ? feature.source !== 'override' : value === feature.enabled;
      if (noOp) delete next[feature.key];
      else next[feature.key] = value;
      return next;
    });
  }

  const effective = (feature) =>
    feature.key in pending ? (pending[feature.key] === null ? feature.enabled : pending[feature.key]) : feature.enabled;

  /**
   * The storefront as one decision. `storefront.public` and
   * `storefront.checkout` are separate capabilities, but a public catalogue
   * nobody can buy from is a mistake rather than a mode, so they move together.
   */
  const publicKey = byKey.get('storefront.public');
  const checkoutKey = byKey.get('storefront.checkout');
  const hasWebsite = publicKey ? effective(publicKey) : false;

  function setStorefront(on) {
    for (const feature of [publicKey, checkoutKey]) {
      if (feature && !feature.locked) stage(feature, on);
    }
  }

  async function apply() {
    setError(null);
    setApplying(true);
    try {
      for (const key of changeKeys) {
        await setFeature.mutateAsync({ id: businessId, key, enabled: pending[key] });
      }
      toast.ok('Features updated', `${changeKeys.length} change${changeKeys.length === 1 ? '' : 's'} applied to ${businessName}.`);
      setPending({});
      setConfirming(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? features.filter((feature) => `${feature.label} ${feature.description} ${feature.area}`.toLowerCase().includes(needle))
    : features;
  const byArea = visible.reduce((acc, feature) => {
    (acc[feature.area] ??= []).push(feature);
    return acc;
  }, {});

  const describe = (key) => {
    const value = pending[key];
    if (value === null) return 'Back to inherited';
    return value ? 'On' : 'Off';
  };

  return (
    <>
      {publicKey && (
        <PlatformPanel
          title="Website"
          description="Whether this business has a public website, or works in the ERP only."
          className="mb-4"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { on: true, label: 'Website and ERP', body: 'Customers browse the catalogue and place their own orders.' },
              { on: false, label: 'ERP only', body: 'No public site. Staff raise orders themselves.' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                disabled={disabled}
                onClick={() => setStorefront(option.on)}
                aria-pressed={hasWebsite === option.on}
                className={cn(
                  pressable,
                  'rounded-lg border px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60',
                  hasWebsite === option.on
                    ? 'border-plat-accent bg-plat-accent/10'
                    : 'border-plat-line bg-plat-raised hover:border-plat-dim',
                )}
              >
                <span className="block text-md font-medium text-plat-text">{option.label}</span>
                <span className="mt-0.5 block text-xs text-plat-muted">{option.body}</span>
              </button>
            ))}
          </div>
        </PlatformPanel>
      )}

      <PlatformPanel
        title="Features"
        description={`Its type (${(BUSINESS_TYPE[data.business.businessType]?.label ?? data.business.businessType).toLowerCase()})${data.business.plan ? ` and the ${data.business.plan.name} plan` : ''} set the starting point. Anything set here overrides ${data.business.plan ? 'both' : 'it'}.`}
        action={
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">Filter features</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-plat-dim" aria-hidden="true" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter features"
              className="h-9 w-full rounded-lg border border-plat-line bg-plat-raised pl-9 pr-3 text-lg text-plat-text outline-none placeholder:text-plat-dim focus:border-plat-accent focus:ring-2 focus:ring-plat-accent/25 sm:text-sm"
            />
          </label>
        }
      >
        <div className="space-y-5">
          {Object.entries(byArea).map(([area, rows]) => (
            <section key={area}>
              <h3 className="eyebrow mb-2 text-plat-dim">{area}</h3>
              <ul className="divide-y divide-plat-line-soft rounded-lg border border-plat-line-soft">
                {rows.map((feature) => {
                  const staged = feature.key in pending;
                  return (
                    <li
                      key={feature.key}
                      className={cn('flex items-start gap-3 px-3 py-3', staged && 'bg-plat-accent/5')}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5 text-md font-medium text-plat-text">
                          {feature.label}
                          {feature.locked ? (
                            <PlatformBadge icon={Lock}>always on</PlatformBadge>
                          ) : staged ? (
                            <PlatformBadge tone="accent">{describe(feature.key).toLowerCase()}, not applied</PlatformBadge>
                          ) : (
                            <span className="text-xs font-normal text-plat-dim">
                              {SOURCE_LABEL[feature.source] ?? feature.source}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs leading-normal text-plat-muted">{feature.description}</p>
                      </div>

                      {feature.source === 'override' && !staged && !disabled && (
                        <button
                          type="button"
                          onClick={() => stage(feature, null)}
                          className={cn(pressable, 'inline-flex shrink-0 items-center gap-1 self-center text-xs font-medium text-plat-muted hover:text-plat-text')}
                        >
                          <RotateCcw className="size-3.5" strokeWidth={2} aria-hidden="true" />
                          Reset
                        </button>
                      )}

                      <span className="mt-0.5">
                        <PlatformSwitch
                          checked={effective(feature)}
                          disabled={feature.locked || disabled}
                          label={`${feature.label} for ${businessName}`}
                          onChange={(value) => stage(feature, value)}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {!visible.length && <p className="py-6 text-center text-sm text-plat-muted">No feature matches “{filter}”.</p>}
        </div>
      </PlatformPanel>

      {/* The pending bar: fixed to the foot of the viewport while there is
          something to apply, so the count follows the operator down a long
          grid instead of waiting at the top where they started. */}
      {changeKeys.length > 0 && (
        <div className="sticky bottom-4 z-30 mt-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-plat-line bg-plat-raised px-4 py-3 shadow-flyout">
            <p className="min-w-0 flex-1 text-md text-plat-text">
              <span className="tnum font-semibold">{changeKeys.length}</span> change{changeKeys.length === 1 ? '' : 's'} not
              applied yet
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
        title={`Apply ${changeKeys.length} feature change${changeKeys.length === 1 ? '' : 's'} to ${businessName}?`}
        confirmLabel="Apply changes"
      >
        <p>
          They take effect on the next request. A section switched off disappears from {businessName}&apos;s ERP
          and its pages answer as if they do not exist; nothing inside it is deleted.
        </p>
        <ul className="divide-y divide-plat-line-soft rounded-lg border border-plat-line-soft">
          {changeKeys.map((key) => (
            <li key={key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-plat-text">{byKey.get(key)?.label ?? key}</span>
              <span className={cn('font-medium', pending[key] === false ? 'text-plat-danger' : 'text-plat-ok')}>
                {describe(key)}
              </span>
            </li>
          ))}
        </ul>
      </PlatformConfirm>

      {error && !confirming && <PlatformError>{error}</PlatformError>}
    </>
  );
}

export default FeatureGrid;
