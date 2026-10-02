import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, ExternalLink, GripVertical, Minus, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { DEFAULT_MEMBERSHIP, PLAN_INTERVALS, PLAN_TIERS, membershipSettingsSchema } from '@shared/schemas/membership';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import useAdminForm from '@/hooks/useAdminForm';
import useDragSort from '@/hooks/useDragSort';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import SelectMenu from '@/components/ui/SelectMenu';
import PageHeader from '@/components/admin/PageHeader';
import { useTableClasses } from '@/components/admin/DataTable';
import { SettingsFormActions } from '@/components/admin/settings/SettingsForm';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminMembership, useAdminMutations } from '@/hooks/useAdmin';
import { useStorefrontUrl } from '@/hooks/useStorefrontUrl';

/**
 * Membership plans (ERP › Purchase › Membership Plans; moved out of Settings
 * and redrawn on 2026-10-02 at the client's request).
 *
 * ## What the screen is opened for
 *
 * Changing a price or a benefit. Both are tables now, and nothing else: the
 * plans are three rows of one table rather than three boxed forms, and the
 * benefits are ONE matrix, its sections as heading rows inside it, rather than
 * a bordered table per section inside a bordered panel. The client's word for
 * the old screen was "boxes everywhere"; every box that was only a container
 * is gone, and the edges left are the table's own rules.
 *
 * ## Reordering
 *
 * Sections and benefits drag by their grip (`useDragSort`); the arrow keys on a
 * grip move it too. Order here is the order on the website.
 *
 * ## A cell
 *
 * Included, not included, or a value: two toggles and a field in one row. Typing
 * makes it a value; clearing the field leaves it not included.
 *
 * ## Warranty is not typed as text
 *
 * The plan's warranty is the base days in Sale Settings plus the tier's bonus,
 * the same figure a repair on that tier carries. The bonus is edited on the
 * plan row, and the "Warranty coverage" benefit fills itself from it.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/membership-plans'], icon: adminIcon('Crown') };

const TIER_LABEL = { silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };
const SWATCH = { silver: 'bg-tier-silver', gold: 'bg-tier-gold', platinum: 'bg-tier-platinum' };
const blankCells = () => Object.fromEntries(PLAN_TIERS.map((tier) => [tier, { kind: 'yes', text: '' }]));
const blankRow = () => ({ label: '', highlight: false, source: '', cells: blankCells() });

/** The stored shape, as the form edits it: dollars, and a cell for every tier. */
function toForm(membership = DEFAULT_MEMBERSHIP, bonus = {}) {
  const plans = PLAN_TIERS.map((tier) => {
    const plan = membership.plans.find((entry) => entry.tier === tier);
    return plan
      ? {
          tier,
          name: plan.name,
          priceDollars: plan.priceCents / 100,
          interval: plan.interval ?? 'year',
          tagline: plan.tagline ?? '',
          isFeatured: Boolean(plan.isFeatured),
          isActive: plan.isActive !== false,
        }
      : { tier, name: TIER_LABEL[tier], priceDollars: 0, interval: 'year', tagline: '', isFeatured: false, isActive: false };
  });

  return {
    plans,
    sections: membership.sections.map((section) => ({
      title: section.title,
      rows: section.rows.map((row) => ({
        label: row.label,
        highlight: Boolean(row.highlight),
        source: row.source ?? '',
        cells: { ...blankCells(), ...(row.cells ?? {}) },
      })),
    })),
    warrantyBonusByTier: Object.fromEntries(PLAN_TIERS.map((tier) => [tier, Number(bonus[tier] ?? 0)])),
  };
}

/** The grip a row is dragged by. A real button, so the arrow keys reach it. */
function Grip(props) {
  return (
    <button
      type="button"
      {...props}
      className="flex size-8 cursor-grab items-center justify-center rounded-md text-ink-300 hover:bg-surface-2 hover:text-ink-700 active:cursor-grabbing"
    >
      <GripVertical className="size-4" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

function IconButton({ label, icon: Icon, onClick, tone = 'quiet' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        pressable,
        'inline-flex size-8 items-center justify-center rounded-md text-ink-300',
        tone === 'danger' ? 'hover:bg-danger-50 hover:text-danger' : 'hover:bg-surface-2 hover:text-ink-900',
      )}
    >
      <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

// ---- plans --------------------------------------------------------------------

function PlansTable({ control, register, errors, setValue, baseDays }) {
  const t = useTableClasses();
  const plans = useWatch({ control, name: 'plans' }) ?? [];
  const bonus = useWatch({ control, name: 'warrantyBonusByTier' }) ?? {};

  return (
    <div className="scroll-slim relative overflow-x-auto">
      <table className="w-full min-w-[920px] table-fixed text-left">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[12%]" />
          <col className="w-[13%]" />
          <col />
          <col className="w-[13%]" />
          <col className="w-[8%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead>
          <tr className={t.headRow}>
            <th scope="col" className={t.headCell()}>Plan</th>
            <th scope="col" className={t.headCell()}>Price ($)</th>
            <th scope="col" className={t.headCell()}>Billed</th>
            <th scope="col" className={t.headCell()}>Line under the name</th>
            <th scope="col" className={t.headCell()}>Warranty bonus</th>
            <th scope="col" className={t.headCell('center')}>Featured</th>
            <th scope="col" className={t.headCell('center')}>On sale</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan, index) => {
            const fieldErrors = errors.plans?.[index] ?? {};
            const days = baseDays + (Number(bonus[plan.tier]) || 0);
            return (
              <tr key={plan.tier} className={cn(t.row, 'align-top', !plan.isActive && 'opacity-60')}>
                <td className={t.cell()}>
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-full', SWATCH[plan.tier])} />
                    <Input
                      aria-label={`${TIER_LABEL[plan.tier]} plan name`}
                      required
                      error={fieldErrors.name?.message}
                      {...register(`plans.${index}.name`)}
                    />
                  </div>
                </td>
                <td className={t.cell()}>
                  <Input
                    aria-label={`${TIER_LABEL[plan.tier]} price in dollars`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="99"
                    error={fieldErrors.priceDollars?.message}
                    {...register(`plans.${index}.priceDollars`)}
                  />
                </td>
                <td className={t.cell()}>
                  <Controller
                    control={control}
                    name={`plans.${index}.interval`}
                    render={({ field }) => (
                      <SelectMenu
                        srLabel={`${TIER_LABEL[plan.tier]} billed`}
                        options={PLAN_INTERVALS}
                        value={field.value}
                        onChange={field.onChange}
                        fieldRef={field.ref}
                      />
                    )}
                  />
                </td>
                <td className={t.cell()}>
                  <Input
                    aria-label={`${TIER_LABEL[plan.tier]} line under the name`}
                    placeholder="Serious repair savings, faster turnaround."
                    error={fieldErrors.tagline?.message}
                    {...register(`plans.${index}.tagline`)}
                  />
                </td>
                <td className={t.cell()}>
                  <Input
                    aria-label={`${TIER_LABEL[plan.tier]} warranty bonus in days`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    suffix="days"
                    error={errors.warrantyBonusByTier?.[plan.tier]?.message}
                    {...register(`warrantyBonusByTier.${plan.tier}`)}
                  />
                  <p className="tnum mt-1 text-xs text-ink-400">{days} in all</p>
                </td>
                <td className={t.cell('center')}>
                  {/* One plan at most, so ticking one clears the others. */}
                  <input
                    type="radio"
                    name="featured-plan"
                    aria-label={`Feature ${TIER_LABEL[plan.tier]} as most popular`}
                    className="mt-2.5 size-4 accent-brand"
                    checked={Boolean(plan.isFeatured)}
                    onChange={() =>
                      plans.forEach((_, other) =>
                        setValue(`plans.${other}.isFeatured`, other === index, { shouldDirty: true }),
                      )
                    }
                  />
                </td>
                <td className={t.cell('center')}>
                  <input
                    type="checkbox"
                    aria-label={`${TIER_LABEL[plan.tier]} on sale`}
                    className="mt-2.5 size-4 accent-brand"
                    {...register(`plans.${index}.isActive`)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(errors.plans?.root?.message || errors.plans?.message) && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errors.plans?.root?.message || errors.plans?.message}
        </p>
      )}
    </div>
  );
}

// ---- benefits -----------------------------------------------------------------

/** Included, not included, or a value, in one row. */
function CellEditor({ control, setValue, name, label }) {
  const cell = useWatch({ control, name }) ?? { kind: 'no', text: '' };
  const set = (next) => setValue(name, next, { shouldDirty: true });

  const toggle = (kind, Icon, words) => (
    <button
      type="button"
      aria-pressed={cell.kind === kind}
      aria-label={`${label}: ${words}`}
      title={words}
      onClick={() => set({ kind, text: '' })}
      className={cn(
        pressable,
        'flex size-9 shrink-0 items-center justify-center rounded-md border',
        cell.kind === kind
          ? kind === 'yes'
            ? 'border-ok/40 bg-ok-50 text-ok'
            : 'border-line-strong bg-surface-2 text-ink-700'
          : 'border-transparent text-ink-300 hover:bg-surface-2 hover:text-ink-700',
      )}
    >
      <Icon className="size-4" strokeWidth={2.5} aria-hidden="true" />
    </button>
  );

  return (
    <div className="flex min-w-0 items-start gap-1">
      {toggle('yes', Check, 'Included')}
      {toggle('no', Minus, 'Not included')}
      <Textarea
        rows={1}
        aria-label={`${label}, value`}
        placeholder="Value"
        containerClassName="min-w-0 flex-1"
        className="field-sizing-content min-h-9 resize-none"
        value={cell.kind === 'text' ? cell.text : ''}
        onChange={(event) => {
          const text = event.target.value;
          set(text.trim() ? { kind: 'text', text } : { kind: 'no', text: '' });
        }}
      />
    </div>
  );
}

/** One section: its heading row, its benefits, and an "Add benefit" row. */
function SectionRows({ index, control, register, setValue, errors, sectionDrag, onRemove, canRemove }) {
  const t = useTableClasses();
  const rows = useFieldArray({ control, name: `sections.${index}.rows` });
  const values = useWatch({ control, name: `sections.${index}.rows` }) ?? [];
  const title = useWatch({ control, name: `sections.${index}.title` }) || 'Section';
  const rowDrag = useDragSort(rows.move, rows.fields.length);

  return (
    <tbody
      {...sectionDrag.rowProps(index)}
      className={cn(sectionDrag.dragging === index && 'opacity-50', sectionDrag.over === index && sectionDrag.dragging !== index && 'outline-2 -outline-offset-2 outline-brand/40')}
    >
      <tr className="border-t-2 border-line bg-surface-2">
        <td className="px-1 py-2 align-middle">
          <Grip {...sectionDrag.gripProps(index, `Section ${title}`)} />
        </td>
        <td colSpan={5} className="py-2 pr-2">
          <Input
            aria-label="Section title"
            required
            placeholder="Repair benefits"
            className="font-display font-semibold"
            error={errors.sections?.[index]?.title?.message}
            {...register(`sections.${index}.title`)}
          />
        </td>
        <td className="py-2 pr-2 text-right align-middle">
          {canRemove && <IconButton label={`Remove the ${title} section`} icon={Trash2} tone="danger" onClick={onRemove} />}
        </td>
      </tr>

      {rows.fields.map((row, rowIndex) => {
        const base = `sections.${index}.rows.${rowIndex}`;
        const label = values[rowIndex]?.label || 'Benefit';
        const isWarranty = values[rowIndex]?.source === 'warranty';
        return (
          <tr
            key={row.id}
            {...rowDrag.rowProps(rowIndex)}
            className={cn(
              t.row,
              'align-top',
              rowDrag.dragging === rowIndex && 'opacity-50',
              rowDrag.over === rowIndex && rowDrag.dragging !== rowIndex && 'bg-surface-2',
            )}
          >
            <td className="px-1 py-1.5">
              <Grip {...rowDrag.gripProps(rowIndex, label)} />
            </td>
            <td className={t.cell()}>
              <Input
                aria-label="Benefit name"
                placeholder="Doorstep fix"
                error={errors.sections?.[index]?.rows?.[rowIndex]?.label?.message}
                {...register(`${base}.label`)}
              />
            </td>
            {isWarranty ? (
              <td colSpan={3} className={cn(t.cell(), 'text-sm text-ink-500')}>
                <span className="inline-flex items-center gap-1.5 pt-2">
                  <ShieldCheck className="size-4 text-ink-400" strokeWidth={2} aria-hidden="true" />
                  From each plan&apos;s warranty bonus above.
                </span>
              </td>
            ) : (
              PLAN_TIERS.map((tier) => (
                <td key={tier} className={t.cell()}>
                  <CellEditor
                    control={control}
                    setValue={setValue}
                    name={`${base}.cells.${tier}`}
                    label={`${label}, ${TIER_LABEL[tier]}`}
                  />
                </td>
              ))
            )}
            <td className={t.cell('center')}>
              <input
                type="checkbox"
                aria-label={`Show ${label} on the plan cards`}
                className="mt-2.5 size-4 accent-brand"
                {...register(`${base}.highlight`)}
              />
            </td>
            <td className={cn(t.cell('right'), 'pt-2')}>
              <IconButton label={`Remove ${label}`} icon={Trash2} tone="danger" onClick={() => rows.remove(rowIndex)} />
            </td>
          </tr>
        );
      })}

      <tr>
        <td />
        <td colSpan={6} className="pb-3 pt-1">
          <button
            type="button"
            onClick={() => rows.append(blankRow())}
            className={cn(pressable, 'inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900')}
          >
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            Add a benefit to {title}
          </button>
        </td>
      </tr>
    </tbody>
  );
}

function BenefitsTable({ control, register, setValue, errors }) {
  const t = useTableClasses();
  const sections = useFieldArray({ control, name: 'sections' });
  const sectionDrag = useDragSort(sections.move, sections.fields.length);
  const plans = useWatch({ control, name: 'plans' }) ?? [];

  return (
    <>
      <div className="scroll-slim relative overflow-x-auto">
        <table className="w-full min-w-[980px] table-fixed text-left">
          <colgroup>
            <col className="w-10" />
            <col className="w-[22%]" />
            <col />
            <col />
            <col />
            <col className="w-20" />
            <col className="w-12" />
          </colgroup>
          <thead>
            <tr className={t.headRow}>
              <th scope="col"><span className="sr-only">Order</span></th>
              <th scope="col" className={t.headCell()}>Benefit</th>
              {PLAN_TIERS.map((tier) => (
                <th key={tier} scope="col" className={t.headCell()}>
                  {plans.find((plan) => plan.tier === tier)?.name || TIER_LABEL[tier]}
                </th>
              ))}
              <th scope="col" className={t.headCell('center')}>On card</th>
              <th scope="col"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          {sections.fields.map((field, index) => (
            <SectionRows
              key={field.id}
              index={index}
              control={control}
              register={register}
              setValue={setValue}
              errors={errors}
              sectionDrag={sectionDrag}
              canRemove={sections.fields.length > 1}
              onRemove={() => sections.remove(index)}
            />
          ))}
        </table>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        icon={Plus}
        className="mt-3"
        onClick={() => sections.append({ title: '', rows: [blankRow()] })}
      >
        Add a section
      </Button>
    </>
  );
}

// ---- the page -----------------------------------------------------------------

export function AdminMembershipPlansPage() {
  const storefrontUrl = useStorefrontUrl();
  const { data, isLoading } = useAdminMembership();
  const { saveMembership } = useAdminMutations();
  const [saved, setSaved] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = useAdminForm({
    resolver: zodResolver(membershipSettingsSchema),
    defaultValues: toForm(),
  });

  const loaded = data?.membership;
  useEffect(() => {
    if (!loaded || isDirty) return;
    reset(toForm(loaded, data.warrantyBonusByTier));
  }, [loaded, data, isDirty, reset]);

  async function onSubmit(values) {
    setSaved(false);
    try {
      const next = await saveMembership.mutateAsync(values);
      reset(toForm(next.membership, next.warrantyBonusByTier));
      setSaved(true);
    } catch (err) {
      setError('root', { message: err.message });
    }
  }

  const baseDays = data?.warrantyBaseDays ?? 90;

  return (
    <div>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <a href={storefrontUrl('/membership')} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" icon={ExternalLink}>
              View on the website
            </Button>
          </a>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="rounded-lg border border-line bg-surface">
          <section aria-labelledby="plans-heading" className="p-4 sm:p-5">
            <div className="mb-3">
              <h2 id="plans-heading" className="font-display text-md font-bold text-ink-900">Plans</h2>
              <p className="mt-0.5 text-sm text-ink-500">
                A plan not on sale is hidden from the website; customers already on it keep it. Warranty
                is the {baseDays}-day base plus the bonus.
              </p>
            </div>
            <PlansTable control={control} register={register} errors={errors} setValue={setValue} baseDays={baseDays} />
          </section>

          <section aria-labelledby="benefits-heading" className="border-t border-line p-4 sm:p-5">
            <div className="mb-3">
              <h2 id="benefits-heading" className="font-display text-md font-bold text-ink-900">Benefits</h2>
              <p className="mt-0.5 text-sm text-ink-500">
                Each row is a line of the comparison table on the website, in this order. Drag the grips
                to reorder. Tick On card to show a benefit on the plan cards too.
              </p>
            </div>
            <BenefitsTable control={control} register={register} setValue={setValue} errors={errors} />
          </section>

          <div className="border-t border-line px-4 sm:px-5">
            <SettingsFormActions
              dirty={isDirty}
              saving={isSubmitting}
              saved={saved}
              error={errors.root?.message}
              onReset={() => reset(toForm(loaded, data?.warrantyBonusByTier))}
              unsavedLabel="the membership plans"
            />
          </div>
        </form>
      )}
    </div>
  );
}

export default AdminMembershipPlansPage;
