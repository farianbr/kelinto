import { useForm } from 'react-hook-form';
import { AlertCircle } from 'lucide-react';
import cn from '@/lib/cn';
import { count as formatCount } from '@/lib/format';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import SelectMenu from '@/components/ui/SelectMenu';
import { optionsFor } from '@/lib/taxonomy';
import { GRADE_ORDER, GRADES } from '@/lib/constants';

/** Condition grades, in the order the scale reads. Moved here with the form. */
const GRADE_OPTIONS = GRADE_ORDER.map((grade) => ({
  value: grade,
  label: GRADES[grade]?.label ?? grade,
}));

/**
 * The two stock forms, shared by the inventory list and a product's own page.
 *
 * They live here rather than inside `AdminProductsPage` because both screens
 * open them and a copy on each is how the two eventually disagree - one gaining
 * a field, or a validation rule, that the other never gets. Same reason
 * `ApproveClientForm` sits in `components/`.
 */
/**
 * The operations fields (§6.10) - reorder point, cost, bin, default supplier
 * and barcode.
 *
 * Deliberately a separate form from `ProductForm`: the catalogue form owns what
 * a buyer sees and this one owns what the warehouse sees, and a single form
 * writing both would let one screen's stale copy overwrite the other's fields.
 */
function OpsForm({ product, suppliers, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, control } = useForm({
    defaultValues: {
      minStock: product?.minStock ?? 0,
      costDollars: product?.cost ? (product.cost / 100).toFixed(2) : '',
      location: product?.location ?? '',
      supplier: product?.supplier?.id ?? '',
      barcode: product?.barcode ?? '',
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="rounded-md bg-surface-2 p-3.5">
        <p className="text-sm font-medium text-ink-900">{product.name}</p>
        <p className="font-mono text-xs text-ink-400">{product.sku}</p>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Reorder point"
          type="number"
          min="0"
          hint="Zero means no point set."
          {...register('minStock')}
        />
        <Input
          label="Unit cost"
          inputMode="decimal"
          suffix="CAD"
          placeholder="0.00"
          {...register('costDollars')}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Location" placeholder="A-12-3" {...register('location')} />
        <Input label="Barcode" {...register('barcode')} />
      </div>

      <SelectField
        control={control}
        name="supplier"
        label="Default supplier"
        options={[
          { value: '', label: 'None' },
          ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
        ]}
      />

      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
        Cost is what you pay, and is separate from the price a client pays. Receiving a purchase
        order updates it automatically from what the delivery actually cost.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * A manual stock correction.
 *
 * Signed, and the reason is required - "why is this 40 and not 47" is a
 * question somebody asks later, and an unexplained correction cannot answer it.
 * The change goes through the same ledger every receipt does.
 */
function AdjustForm({ product, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, control, watch } = useForm({
    defaultValues: { qtyChange: '', type: 'adjustment', note: '' },
  });

  const delta = Number(watch('qtyChange') || 0);
  const projected = product.stock + (Number.isFinite(delta) ? delta : 0);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="rounded-md bg-surface-2 p-3.5">
        <p className="text-sm font-medium text-ink-900">{product.name}</p>
        <p className="tnum mt-0.5 text-xs text-ink-500">
          <span className="font-mono">{product.sku}</span> · {formatCount(product.stock)} on hand
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Change"
          type="number"
          placeholder="-3"
          hint="Negative removes stock."
          {...register('qtyChange')}
        />
        <SelectField
          control={control}
          name="type"
          label="Reason"
          options={[
            { value: 'adjustment', label: 'Count adjustment' },
            { value: 'damage', label: 'Damaged' },
            { value: 'return', label: 'Returned to stock' },
            { value: 'transfer', label: 'Transfer' },
          ]}
        />
      </div>

      <Input label="Note" placeholder="Cycle count 2026-08-28" {...register('note')} />

      {delta !== 0 && (
        <p
          className={cn(
            'tnum rounded-md px-3 py-2.5 text-sm',
            projected < 0 ? 'bg-danger-50 text-danger' : 'bg-surface-2 text-ink-600',
          )}
        >
          {projected < 0
            ? `That would take ${product.sku} below zero, which the server will refuse.`
            : `${formatCount(product.stock)} → ${formatCount(projected)} on hand.`}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending} disabled={delta === 0}>
          Record adjustment
        </Button>
      </div>
    </form>
  );
}

/**
 * Product form.
 *
 * The four taxonomy selects cascade - picking a brand narrows the series list
 * so a product cannot be filed under a model that does not belong to its brand.
 * That mis-filing would be invisible in this form but would break the shop's
 * filter hierarchy, which reads the same four slugs.
 */
function ProductForm({ product, tree, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, watch, setValue, formState, control } = useForm({
    defaultValues: {
      sku: product?.sku ?? '',
      name: product?.name ?? '',
      description: product?.description ?? '',
      partType: product?.partType ?? '',
      partTypeLabel: product?.partTypeLabel ?? '',
      grade: product?.grade ?? 'NEW',
      priceDollars: product ? (product.price / 100).toFixed(2) : '',
      stock: product?.stock ?? 0,
      deviceTypeSlug: product?.deviceTypeSlug ?? '',
      brandSlug: product?.brandSlug ?? '',
      seriesSlug: product?.seriesSlug ?? '',
      modelSlug: product?.modelSlug ?? '',
      isActive: product?.isActive ?? true,
    },
  });

  const path = {
    deviceType: watch('deviceTypeSlug'),
    brand: watch('brandSlug'),
    series: watch('seriesSlug'),
    model: watch('modelSlug'),
  };

  const deviceTypes = optionsFor(tree, path, 'deviceType');
  const brands = optionsFor(tree, path, 'brand');
  const seriesList = optionsFor(tree, path, 'series');
  const models = optionsFor(tree, path, 'model');

  // Clear the levels below whichever one changed, so a stale model cannot
  // survive a brand switch.
  function pick(level, value) {
    const order = ['deviceTypeSlug', 'brandSlug', 'seriesSlug', 'modelSlug'];
    const index = order.indexOf(level);
    setValue(level, value);
    for (const below of order.slice(index + 1)) setValue(below, '');
  }

  const toOptions = (nodes, placeholder) => [
    { value: '', label: placeholder },
    ...nodes.map((node) => ({ value: node.slug, label: node.name })),
  ];

  return (
    <form
      onSubmit={handleSubmit((values) =>
        onSubmit({
          ...values,
          price: Math.round(Number(values.priceDollars) * 100) || 0,
          stock: Number(values.stock) || 0,
        }),
      )}
      className="space-y-4"
    >
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="SKU"
          placeholder="CVX-SAM-SA-1224"
          className="font-mono"
          error={formState.errors.sku?.message}
          data-autofocus
          {...register('sku', { required: 'Enter a SKU.' })}
        />
        <SelectField control={control} name="grade" label="Grade" options={GRADE_OPTIONS} />
      </div>

      <Input
        label="Product name"
        placeholder="Galaxy S23 Ultra Screen Assembly"
        error={formState.errors.name?.message}
        {...register('name', { required: 'Enter a name.' })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Component type slug"
          placeholder="screen-assembly"
          className="font-mono"
          {...register('partType', { required: true })}
        />
        <Input
          label="Component type label"
          placeholder="Screen Assembly"
          {...register('partTypeLabel', { required: true })}
        />
      </div>

      <fieldset className="rounded-md border border-line p-3.5">
        <legend className="eyebrow px-1 text-ink-400">Fitment</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectMenu
            label="Device type"
            size="md"
            align="left"
            options={toOptions(deviceTypes, 'Select…')}
            value={path.deviceType}
            onChange={(next) => pick('deviceTypeSlug', next)}
          />
          <SelectMenu
            label="Brand"
            size="md"
            align="left"
            options={toOptions(brands, path.deviceType ? 'Select…' : 'Pick a device type first')}
            value={path.brand}
            disabled={!path.deviceType}
            onChange={(next) => pick('brandSlug', next)}
          />
          <SelectMenu
            label="Series"
            size="md"
            align="left"
            options={toOptions(seriesList, path.brand ? 'Select…' : 'Pick a brand first')}
            value={path.series}
            disabled={!path.brand}
            onChange={(next) => pick('seriesSlug', next)}
          />
          <SelectMenu
            label="Model"
            size="md"
            align="left"
            options={toOptions(models, path.series ? 'Select…' : 'Pick a series first')}
            value={path.model}
            disabled={!path.series}
            onChange={(next) => pick('modelSlug', next)}
          />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Price"
          inputMode="decimal"
          suffix="CAD"
          error={formState.errors.priceDollars?.message}
          {...register('priceDollars', { required: 'Enter a price.' })}
        />
        <Input
          label="Stock on hand"
          inputMode="numeric"
          hint="The website only shows in stock or out of stock."
          {...register('stock')}
        />
      </div>

      <Input label="Description" {...register('description')} />

      <Checkbox label="Listed on the website" className="-ml-2" {...register('isActive')} />

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={isPending}
          disabled={!path.deviceType || !path.brand || !path.series || !path.model}
        >
          {product ? 'Save changes' : 'Create product'}
        </Button>
      </div>
    </form>
  );
}

export { OpsForm, AdjustForm, ProductForm };
