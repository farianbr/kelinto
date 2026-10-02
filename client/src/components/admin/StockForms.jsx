import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { AlertCircle, Boxes, Globe, Image as ImageIcon, Network, SlidersHorizontal, Wallet } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import cn from '@/lib/cn';
import { count as formatCount } from '@/lib/format';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import SelectMenu from '@/components/ui/SelectMenu';
import { entriesUnder, nodeBySlug } from '@/lib/taxonomy';
import { FIRST_LEVEL_KEY, TREE_LEVEL_KEYS, categoryLevels } from '@shared/catalog';
import { GRADE_ORDER, GRADES } from '@/lib/constants';
import AssetUpload from '@/components/admin/AssetUpload';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import useUploadSession from '@/hooks/useUploadSession';
import useUnsavedGuard from '@/hooks/useUnsavedGuard';
import { useAdminCatalogCategories, useAdminTaxonomyTree } from '@/hooks/useAdmin';

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

/** The picker value for "Any" at a category level; never a real slug. */
const ANY = '__any__';

/**
 * Product form.
 *
 * The four taxonomy selects cascade - picking a brand narrows the series list
 * so a product cannot be filed under a model that does not belong to its brand.
 * That mis-filing would be invisible in this form but would break the shop's
 * filter hierarchy, which reads the same four slugs.
 */
function ProductForm({ product, tree, onSubmit, onCancel, isPending, error, initialCategory = 'parts' }) {
  const { register, handleSubmit, watch, setValue, formState, control } = useForm({
    defaultValues: {
      sku: product?.sku ?? '',
      name: product?.name ?? '',
      description: product?.description ?? '',
      partType: product?.partType ?? '',
      partTypeLabel: product?.partTypeLabel ?? '',
      grade: product?.grade ?? '',
      priceDollars: product ? (product.price / 100).toFixed(2) : '',
      stock: product?.stock ?? 0,
      deviceTypeSlug: product?.deviceTypeSlug ?? '',
      brandSlug: product?.brandSlug ?? '',
      seriesSlug: product?.seriesSlug ?? '',
      modelSlug: product?.modelSlug ?? '',
      level5Slug: product?.level5Slug ?? '',
      level6Slug: product?.level6Slug ?? '',
      anyFrom: '',
      category: product?.category ?? initialCategory,
      isActive: product?.isActive ?? true,
      image: product?.image ?? '',
      images: product?.images ?? [],
      video: product?.video ?? '',
      videoPoster: product?.videoPoster ?? '',
      attributes: product?.attributes ?? {},
    },
  });

  // Pictures and video uploaded in this form but not saved yet. Leaving the
  // page asks first; cancelling asks first; either way they are deleted.
  const uploads = useUploadSession();
  const guard = useUnsavedGuard(uploads.hasPending);
  const [confirmCancel, setConfirmCancel] = useState(false);
  function cancel() {
    if (uploads.hasPending) setConfirmCancel(true);
    else onCancel();
  }

  /**
   * Whether this form knows the product's pictures. A new product does, and so
   * does one opened from its detail page; a row from a list that never carried
   * them does not, and posting its empty fields back would delete every upload
   * the product has. So the media fields are sent only when they were known.
   */
  // `images`, not `image`: an inventory list row carries its main picture but
  // not the gallery, and posting that row back would have emptied the gallery.
  const knowsMedia = !product || 'images' in product;
  // The same rule for its feature answers: sent only when the form loaded them.
  const knowsAttributes = !product || 'attributes' in product;

  /**
   * The type the product is sold under, and with it its category levels,
   * grades and features. Every type with stock is offered, Phones included
   * (phones are products with stock since 2026-10-02). The tree is the whole,
   * unpruned one, so a model with nothing filed under it yet can still take
   * its first product.
   */
  const { data: allCategories = [] } = useAdminCatalogCategories();
  const typeOptions = allCategories.filter((entry) => entry.kind === 'part' && entry.isActive);
  const category = watch('category') || 'parts';
  const currentCategory = allCategories.find((entry) => entry.slug === category);
  // This type's features, asked in their order.
  const features = currentCategory?.attributes ?? [];
  // This type's grades (grades per type, 2026-10-02).
  const gradeOptions = (currentCategory ? (currentCategory.grades ?? []) : GRADE_OPTIONS).map((grade) => ({
    value: grade.value,
    label: grade.label,
  }));
  const { data: fullTree } = useAdminTaxonomyTree(category);
  const pickerTree = fullTree ?? (category === 'parts' ? tree : []);

  const path = Object.fromEntries(TREE_LEVEL_KEYS.map((key) => [key, watch(`${key}Slug`)]));

  /**
   * The type's category levels, its first level (Component Type) included,
   * every one alike: a picker per level, marked required as the type says
   * (Settings › Taxonomy). Its entries come from the type's tree.
   */
  const levels = currentCategory ? categoryLevels(currentCategory) : [];
  const treeKeys = levels.filter((level) => level.key !== FIRST_LEVEL_KEY).map((level) => level.key);
  const firstOptions = currentCategory?.facetOptions ?? [];

  /**
   * "Any" (2026-10-03): a level the product fits every entry of. It is filed
   * no deeper than the level above, and the website's filters show it under
   * each option from there down. `anyFrom` names the first such level; every
   * level below it is Any too.
   */
  const anyFrom = watch('anyFrom') ?? '';
  const anyAt = treeKeys.indexOf(anyFrom);
  const isAnyAt = (key) => anyAt >= 0 && treeKeys.indexOf(key) >= anyAt;

  // An existing product filed short of a required level is one set to Any there.
  const [anySeeded, setAnySeeded] = useState(false);
  useEffect(() => {
    if (!product || anySeeded || !currentCategory) return;
    setAnySeeded(true);
    const deepest = treeKeys.findLastIndex((key) => product[`${key}Slug`]);
    const short = treeKeys.slice(deepest + 1).find((key) => levels.find((level) => level.key === key)?.required !== false);
    if (short) setValue('anyFrom', short);
  }, [product, anySeeded, currentCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Picking an entry sets the levels above it from its own path (an optional
   * level skipped above it may still have an entry) and clears every level
   * below it, so a stale model cannot survive a brand switch. Picking Any
   * clears the level and everything below it.
   */
  function pick(key, value) {
    const index = TREE_LEVEL_KEYS.indexOf(key);
    if (value === ANY) {
      for (const [at, other] of TREE_LEVEL_KEYS.entries()) if (at >= index) setValue(`${other}Slug`, '');
      setValue('anyFrom', key, { shouldDirty: true });
      return;
    }
    const node = value ? nodeBySlug(pickerTree, value) : null;
    for (const [at, other] of TREE_LEVEL_KEYS.entries()) {
      if (at < index && node?.path?.[other]) setValue(`${other}Slug`, node.path[other]);
      if (at > index) setValue(`${other}Slug`, '');
    }
    setValue(`${key}Slug`, value, { shouldDirty: true });
    if (isAnyAt(key)) setValue('anyFrom', '', { shouldDirty: true });
  }

  const missing = levels.some((level) =>
    level.required === false
      ? false
      : level.key === FIRST_LEVEL_KEY
        ? !watch('partType')
        : !path[level.key] && !isAnyAt(level.key),
  );

  return (
    <form
      onSubmit={handleSubmit((values) => {
        // Handed to the save now. If the save fails the files stay on the form
        // for a retry, and anything never saved is swept by the server.
        uploads.settle();
        return onSubmit({
          ...values,
          price: Math.round(Number(values.priceDollars) * 100) || 0,
          stock: Number(values.stock) || 0,
          anyFrom: values.anyFrom || undefined,
          // Only this type's answers, blanks left out; not sent at all when the
          // form never loaded them, so a save cannot wipe them.
          attributes: knowsAttributes
            ? Object.fromEntries(
                features
                  .map((feature) => [feature.key, String(values.attributes?.[feature.key] ?? '').trim()])
                  .filter(([, value]) => value),
              )
            : undefined,
          ...(knowsMedia
            ? { images: (values.images ?? []).filter(Boolean) }
            : { image: undefined, images: undefined, video: undefined, videoPoster: undefined }),
        });
      })}
      className="space-y-4"
    >
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Panel icon={Boxes} title="What it is" description="Its type decides the category levels, grades and features below, so it comes first.">
        <div className="space-y-4">
      <SelectMenu
        label="Product type"
        size="md"
        align="left"
        hint="Which section of the website it is sold in. The category, grades and features below are that type's."
        options={typeOptions.map((entry) => ({ value: entry.slug, label: entry.name }))}
        value={category}
        disabled={typeOptions.length < 2}
        onChange={(next) => {
          setValue('category', next);
          // Another type is another tree, another grade list and another set of features.
          for (const key of TREE_LEVEL_KEYS) setValue(`${key}Slug`, '');
          setValue('anyFrom', '');
          setValue('partType', '');
          setValue('grade', allCategories.find((entry) => entry.slug === next)?.grades?.[0]?.value ?? '');
          setValue('attributes', {});
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="SKU"
          placeholder="CVX-SAM-SA-1224"
          className="font-mono"
          error={formState.errors.sku?.message}
          data-autofocus
          {...register('sku', { required: 'Enter a SKU.' })}
        />
        {gradeOptions.length > 0 ? (
          <SelectField
            control={control}
            name="grade"
            label="Grade"
            hint="Also its badge on the website."
            options={gradeOptions}
            rules={{ required: 'Pick a grade.' }}
            error={formState.errors.grade?.message}
          />
        ) : (
          <p className="self-end pb-2 text-sm text-ink-400">{currentCategory?.name ?? 'This type'} has no grades, so no badge.</p>
        )}
      </div>

      <Input
        label="Product name"
        placeholder="Galaxy S23 Ultra Screen Assembly"
        error={formState.errors.name?.message}
        {...register('name', { required: 'Enter a name.' })}
      />
      <Input label="Description" hint="Shown under the price on its page." {...register('description')} />
        </div>
      </Panel>

      <Panel icon={Network} title="Category" description="Where it is filed, level by level. The website's finder and filters read these.">
        {/* One picker per category level of the type, its first included (2026-10-02). */}
        <div className="grid gap-3 sm:grid-cols-2">
          {levels.map((level) => {
            const required = level.required !== false;
            if (level.key === FIRST_LEVEL_KEY) {
              return (
                <SelectField
                  key={level.key}
                  control={control}
                  name="partType"
                  label={level.label}
                  required={required}
                  searchable={firstOptions.length > 8}
                  options={[
                    { value: '', label: required ? 'Select…' : 'None' },
                    ...firstOptions.map((option) => ({ value: option.value, label: option.label })),
                  ]}
                  rules={required ? { required: `Pick a ${level.label.toLowerCase()}.` } : undefined}
                  error={formState.errors.partType?.message}
                />
              );
            }
            const entries = entriesUnder(pickerTree, path, level.key, treeKeys);
            const isAny = isAnyAt(level.key);
            // Below a level set to Any there is nothing left to pick.
            const belowAny = isAny && level.key !== anyFrom;
            return (
              <SelectMenu
                key={level.key}
                label={level.label}
                required={required}
                size="md"
                align="left"
                searchable={entries.length > 8}
                options={[
                  { value: '', label: entries.length ? (required ? 'Select…' : 'None') : 'Pick the level above first' },
                  { value: ANY, label: `Any ${level.label.toLowerCase()}` },
                  ...entries.map((node) => ({ value: node.slug, label: node.name })),
                ]}
                value={isAny ? ANY : (path[level.key] ?? '')}
                disabled={belowAny || (!entries.length && !isAny)}
                hint={level.key === anyFrom ? 'Fits every entry here, so it shows under each one in the website filters.' : undefined}
                onChange={(next) => pick(level.key, next)}
              />
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Missing an entry? Add a row to the {currentCategory?.name ?? 'type'} category tree in Settings › Taxonomy.
        </p>
      </Panel>

      {knowsAttributes && features.length > 0 && (
        <Panel icon={SlidersHorizontal} title="Features" description={`What sets it apart from other ${(currentCategory?.name ?? 'products').toLowerCase()}, as the type defines them.`}>
          <div className="grid gap-3 sm:grid-cols-2">
            {features.map((feature) => {
              const name = `attributes.${feature.key}`;
              const label = feature.label;
              if (feature.type === 'select' || feature.type === 'boolean') {
                const options =
                  feature.type === 'boolean'
                    ? [
                        { value: 'yes', label: 'Yes' },
                        { value: 'no', label: 'No' },
                      ]
                    : feature.options.map((option) => ({ value: option, label: option }));
                return (
                  <SelectField
                    key={feature.key}
                    control={control}
                    name={name}
                    label={label}
                    required={feature.required}
                    searchable={options.length > 8}
                    options={[{ value: '', label: 'Not set' }, ...options]}
                    rules={feature.required ? { required: `Enter the ${label.toLowerCase()}.` } : undefined}
                    error={formState.errors.attributes?.[feature.key]?.message}
                  />
                );
              }
              return (
                <Input
                  key={feature.key}
                  label={label}
                  required={feature.required}
                  inputMode={feature.type === 'number' ? 'decimal' : undefined}
                  suffix={feature.type === 'number' ? feature.unit || undefined : undefined}
                  error={formState.errors.attributes?.[feature.key]?.message}
                  {...register(name, {
                    required: feature.required ? `Enter the ${label.toLowerCase()}.` : false,
                    validate:
                      feature.type === 'number'
                        ? (value) => !value || Number.isFinite(Number(value)) || `${label} must be a number.`
                        : undefined,
                  })}
                />
              );
            })}
          </div>
        </Panel>
      )}

      <Panel icon={Wallet} title="Price and stock" description="What a buyer pays, and how many are on the shelf. The website only says in stock or out of stock.">
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
          hint="What you have now. The website only says in stock or out of stock."
          {...register('stock')}
        />
      </div>
      </Panel>

      {knowsMedia && (
        <Panel icon={ImageIcon} title="Pictures and video" description="The main picture is on its card and page; the rest are on its page.">
          <div className="space-y-4">
            <Controller
              name="image"
              control={control}
              render={({ field }) => (
                <AssetUpload
                  label="Main picture"
                  endpoint="catalogue"
                  kind="product-image"
                  hint="Shown on the product card and page. Without one, the stock photo for this brand and component type is used."
                  value={field.value}
                  onChange={field.onChange}
                  session={uploads}
                />
              )}
            />
            <Controller
              name="images"
              control={control}
              render={({ field }) => {
                const list = field.value ?? [];
                // Every picture so far, plus one empty slot to add the next
                // (up to eight).
                const slots = list.length < 8 ? [...list, ''] : list;
                return (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {slots.map((url, index) => (
                      <AssetUpload
                        key={`${index}-${url}`}
                        label={index === 0 ? 'More pictures' : `Picture ${index + 1}`}
                        endpoint="catalogue"
                        kind="product-image"
                        placeholder="Add"
                        session={uploads}
                        value={url}
                        onChange={(next) => {
                          const updated = [...list];
                          if (next) updated[index] = next;
                          else updated.splice(index, 1);
                          field.onChange(updated.filter(Boolean));
                        }}
                      />
                    ))}
                  </div>
                );
              }}
            />
            <Controller
              name="video"
              control={control}
              render={({ field }) => (
                <AssetUpload
                  label="Video"
                  endpoint="catalogue"
                  kind="product-video"
                  shape="video"
                  hint="Optional. MP4, MOV or WebM, up to 100 MB and 2 minutes. Compressed for the web on upload."
                  value={field.value}
                  poster={watch('videoPoster')}
                  onChange={(url, extra) => {
                    field.onChange(url);
                    setValue('videoPoster', extra?.poster ?? '', { shouldDirty: true });
                  }}
                  session={uploads}
                />
              )}
            />
          </div>
        </Panel>
      )}

      <Panel icon={Globe} title="On the website">
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand" {...register('isActive')} />
          <span className="text-sm leading-relaxed text-ink-700">
            <span className="font-medium">Listed</span>
            <span className="mt-0.5 block text-ink-500">Switched off, it is hidden from the website. Its stock and history stay.</span>
          </span>
        </label>
      </Panel>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-surface-2/95 px-4 py-3 backdrop-blur-[2px]">
        <Button type="submit" loading={isPending} disabled={missing}>
          {product ? 'Save changes' : 'Create product'}
        </Button>
        <Button type="button" variant="outline" onClick={cancel}>
          Cancel
        </Button>
        {missing && <span className="text-sm text-ink-400">Fill in the required category levels to save.</span>}
      </div>

      {/* Names what is lost: the files, which are deleted, not just the edits. */}
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          uploads.discardAll();
          setConfirmCancel(false);
          onCancel();
        }}
        title={`Discard ${uploads.count === 1 ? 'the file' : `the ${uploads.count} files`} you uploaded?`}
        body={`${product ? product.name : 'This product'} has not been saved, so ${uploads.count === 1 ? 'it is' : 'they are'} deleted if you close the form now.`}
        confirmLabel="Discard and close"
        cancelLabel="Keep editing"
        tone="danger"
      />
      <ConfirmDialog
        open={guard.blocked}
        onClose={guard.stay}
        onConfirm={guard.leave}
        title="Leave without saving the product?"
        body="Pictures or video you uploaded here are not saved yet. Leaving this page deletes them."
        confirmLabel="Leave and delete them"
        cancelLabel="Stay on this page"
        tone="danger"
      />
    </form>
  );
}

export { OpsForm, AdjustForm, ProductForm };
