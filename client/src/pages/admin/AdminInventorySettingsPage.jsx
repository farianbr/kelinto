import { useEffect, useState } from 'react';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeftRight } from 'lucide-react';

import { inventorySettingsSchema } from '@shared/schemas/admin';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/admin/PageHeader';
import { SettingsFormActions } from '@/components/admin/settings/SettingsForm';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { money } from '@/lib/format';
import { useAdminSettings, useAdminMutations } from '@/hooks/useAdmin';

/**
 * Inventory Settings (§6.15, category 2) - the defaults that pre-fill the New
 * Product form.
 *
 * **Pre-fill only.** Nothing here reprices anything already in the catalogue,
 * and a per-product value always wins. That is the first thing a staff member will
 * wonder when they change a number on this screen, so it is said on the screen
 * rather than left to be discovered.
 *
 * **Markup and margin are two views of one number**, related by
 * `markup = margin ÷ (100 − margin) × 100`. Both are stored because a supplier
 * quotes in whichever one they think in. The conversion is printed live, and a
 * button converts one into the other - without that, two fields that are
 * supposed to describe the same markup will quietly drift apart, and the form
 * would be storing a contradiction.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/inventory'], icon: adminIcon('Boxes') };

/** The worked example under the fields. A number is easier to check than a formula. */
const EXAMPLE_COST = 10_00;

const marginToMarkup = (margin) => (margin >= 100 ? null : (margin / (100 - margin)) * 100);
const markupToMargin = (markup) => (markup / (100 + markup)) * 100;
const round1 = (value) => Math.round(value * 10) / 10;

/** The form's shape, gathered from the two branches of the document it spans. */
const formValues = (settings) => ({
  defaultMarkupPercent: settings.inventory?.defaultMarkupPercent ?? 40,
  defaultMarginPercent: settings.inventory?.defaultMarginPercent ?? 28.5,
  lowStockThreshold: settings.operations?.lowStockThreshold ?? 50,
});

export function AdminInventorySettingsPage() {
  const { data, isLoading } = useAdminSettings();
  const { saveInventorySettings } = useAdminMutations();
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useAdminForm({
    resolver: zodResolver(inventorySettingsSchema),
    defaultValues: {
      defaultMarkupPercent: 40,
      defaultMarginPercent: 28.5,
      lowStockThreshold: 50,
    },
  });

  /**
   * The form's values come from two places on the settings document.
   *
   * The two pricing defaults live under `inventory`; the reorder-point fallback
   * lives under `operations`, where it has always lived and where the inventory
   * report reads it. The screen groups them because they are both things an
   * owner sets about stock - the storage shape is not the screen's problem, but
   * it does mean the form cannot just `reset(data.inventory)`.
   */
  useEffect(() => {
    if (!data?.inventory || isDirty) return;
    reset(formValues(data));
  }, [data, isDirty, reset]);

  const markup = Number(watch('defaultMarkupPercent'));
  const margin = Number(watch('defaultMarginPercent'));

  const impliedMarkup = Number.isFinite(margin) ? marginToMarkup(margin) : null;
  const impliedMargin = Number.isFinite(markup) ? markupToMargin(markup) : null;

  // Compared with a tolerance, not for equality. The seeded pair - 40% markup,
  // 28.5% margin - is the same markup rounded to one decimal in each direction
  // (28.5% implies 39.86%), and flagging that as a contradiction would put a
  // permanent warning on a form nobody has touched. Half a point apart is a
  // rounded pair; further apart is a slip worth naming.
  const agree =
    impliedMarkup === null ||
    !Number.isFinite(markup) ||
    Math.abs(impliedMarkup - markup) <= 0.5;

  const sellAtMarkup = Number.isFinite(markup) ? Math.round(EXAMPLE_COST * (1 + markup / 100)) : null;

  async function onSubmit(values) {
    setSaved(false);
    try {
      const next = await saveInventorySettings.mutateAsync(values);
      reset(formValues(next));
      setSaved(true);
    } catch (err) {
      setError('root', { message: err.message });
    }
  }

  if (isLoading) return <p className="text-sm text-ink-500">Loading settings…</p>;

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-form space-y-4">
        <Panel
          title="Default pricing"
          description="Pre-fills a new product. A price set on the product itself always wins."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              type="number"
              min="0"
              max="1000"
              step="0.1"
              label="Default markup"
              suffix="%"
              hint="Added to cost."
              error={errors.defaultMarkupPercent?.message}
              {...register('defaultMarkupPercent')}
            />
            <Input
              type="number"
              min="0"
              max="99.9"
              step="0.1"
              label="Default margin"
              suffix="%"
              hint="Share of the selling price."
              error={errors.defaultMarginPercent?.message}
              {...register('defaultMarginPercent')}
            />
          </div>

          <div className="mt-4 rounded-lg bg-surface-2 px-4 py-3.5">
            <p className="font-mono text-sm text-ink-600">
              markup = margin ÷ (100 − margin) × 100
            </p>

            {impliedMarkup !== null && impliedMargin !== null && (
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                A {round1(margin)}% margin is a {round1(impliedMarkup)}% markup. A {round1(markup)}%
                markup is a {round1(impliedMargin)}% margin.
                {sellAtMarkup !== null && (
                  <>
                    {' '}
                    A part costing {money(EXAMPLE_COST)} sells at {money(sellAtMarkup)}.
                  </>
                )}
              </p>
            )}

            {/* Two fields describing one markup can drift apart silently. This
                says so, and offers the one-click fix, rather than letting the
                form store a contradiction. */}
            {!agree && impliedMarkup !== null && (
              <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink-600">
                  These two do not describe the same markup. That is allowed - they pre-fill
                  different fields - but it is usually a slip.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setValue('defaultMarkupPercent', round1(impliedMarkup), {
                      shouldDirty: true,
                    });
                    setSaved(false);
                  }}
                >
                  <ArrowLeftRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  Match markup to margin
                </Button>
              </div>
            )}
          </div>
        </Panel>

        {/*
          Its own panel, and the separation is the point: everything above
          pre-fills a blank form and changes nothing that exists, while this is
          read live by five screens and re-sorts the catalogue the moment it is
          saved. Putting them in one panel under one description would make the
          "pre-fill only" promise above cover a field it is not true of.
        */}
        <Panel
          title="Low stock"
          description="When a product counts as running low, and needs reordering."
        >
          <Input
            type="number"
            min="1"
            step="1"
            label="Reorder point"
            suffix="units"
            hint="Used for products with no reorder point of their own."
            error={errors.lowStockThreshold?.message}
            {...register('lowStockThreshold')}
          />

          <p className="mt-4 rounded-lg bg-surface-2 px-4 py-3.5 text-sm leading-relaxed text-ink-600">
            A product is low when its stock reaches its own reorder point, or this number when it
            has none. Unlike the defaults above, this one applies immediately: it is what the
            dashboard badge counts, what the Inventory pills sort by, and what fills the reorder
            queue.{' '}
            <span className="text-ink-500">
              The storefront never sees it - a buyer is told in stock or out of stock, never a
              count.
            </span>
          </p>
        </Panel>

        <SettingsFormActions
          unsavedLabel="the inventory defaults"
          dirty={isDirty}
          saving={isSubmitting || saveInventorySettings.isPending}
          saved={saved}
          error={errors.root?.message}
          onReset={() => {
            reset();
            setSaved(false);
          }}
        />
      </form>
    </div>
  );
}

export default AdminInventorySettingsPage;
