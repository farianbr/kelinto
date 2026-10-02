import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Check, Globe, Layers, ListChecks, Network, Save, SlidersHorizontal, Tag, X } from 'lucide-react';

import {
  catalogCategorySchema,
  DEFAULT_LEVEL_LABELS,
  MAX_LEVELS,
  SYSTEM_MAX_LEVELS,
  TREE_LEVEL_KEYS,
} from '@shared/catalog';
import api from '@/lib/api';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import useAdminForm from '@/hooks/useAdminForm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import CategoryLevelsEditor, { CategoryGradesEditor } from '@/components/admin/CategoryLevelsEditor';
import CategoryFeaturesEditor, { featuresToForm, featuresToPayload } from '@/components/admin/CategoryFeaturesEditor';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminCatalogCategories, useAdminMutations } from '@/hooks/useAdmin';

/**
 * Add or edit a product type (ERP › Settings › Taxonomy; a page since
 * 2026-10-02, client: "add a product type should be on the page not a modal
 * anymore as it has become sophisticated").
 *
 * ## What it is opened for
 *
 * "We sell accessories now" (or "Phones need a Battery health feature"). A
 * type is several decisions, and each one is a section that says what it
 * decides, in the order they are made:
 *
 * 1. **Name and web address**: what it is called, where it lives on the
 *    website (checked as it is typed, so a taken address is caught before
 *    saving), the line under its name in the Shop menu, and its place in
 *    that menu.
 * 2. **Category levels**: what somebody picks to reach one of its products.
 * 3. **Grades**: the condition its products are sold at, which is also their
 *    badge on the website. None means no badge.
 * 4. **Features**: the facts that tell two of its products apart.
 * 5. **On the website**: whether its page is live.
 *
 * Saving a new type lands on its empty category tree, where its first rows go
 * in. The form is the confirmation (§3.0.1): it was opened and filled in on
 * purpose.
 */

const schemaResolver = zodResolver(catalogCategorySchema);

/** What is sent: the levels the form keeps, as the API takes them. */
const toPayload = (values) => {
  const { depth, hasFirst, ...rest } = values;
  return {
    ...rest,
    address: values.address || undefined,
    facetLabel: hasFirst ? (values.facetLabel ?? '').trim() : '',
    facetRequired: Boolean(values.facetRequired),
    levels: (values.levels ?? []).slice(0, Number(depth) || 4).map((level) => ({ ...level, required: Boolean(level.required) })),
    grades: (values.grades ?? []).filter((grade) => String(grade.label ?? '').trim()),
    attributes: featuresToPayload(values.attributes),
  };
};

const resolver = async (values, context, options) => {
  const result = await schemaResolver(toPayload(values), context, options);
  if (values.hasFirst && !String(values.facetLabel ?? '').trim()) {
    return { values: {}, errors: { ...result.errors, facetLabel: { type: 'custom', message: 'Name the first level.' } } };
  }
  return Object.keys(result.errors ?? {}).length ? result : { values, errors: {} };
};

const DEFAULT_LEVELS = TREE_LEVEL_KEYS.map((key) => ({ key, label: DEFAULT_LEVEL_LABELS[key], required: true }));
const allLevels = (levels = []) =>
  DEFAULT_LEVELS.map((level, index) => (levels[index] ? { ...levels[index], required: levels[index].required !== false } : level));

const slugify = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);

const BLANK = {
  name: '',
  address: '',
  description: '',
  hasFirst: false,
  facetLabel: '',
  facetRequired: true,
  levels: DEFAULT_LEVELS,
  depth: '2',
  grades: [],
  isActive: true,
  order: 10,
  attributes: [],
};

const nounOf = (category) =>
  category?.slug === 'phones' ? 'phone' : category?.slug === 'parts' ? 'part' : category?.kind === 'service' ? 'service' : 'product';

/** Whether an address is free, asked as it is typed. */
function useAddressCheck(address, except) {
  const debounced = useDebouncedValue(address, 350);
  return useQuery({
    queryKey: ['admin', 'catalog-slug', debounced, except],
    queryFn: () => api.get('/admin/catalog-categories/slug-check', { slug: debounced, except: except || undefined }),
    enabled: Boolean(debounced),
    staleTime: 10 * 1000,
  });
}

export function AdminCatalogTypePage() {
  const { slug: editingSlug } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(editingSlug);
  const route = ADMIN_ROUTES[editing ? '/admin/settings/taxonomy/types/:slug' : '/admin/settings/taxonomy/types/new'];
  const { data: categories = [], isLoading } = useAdminCatalogCategories();
  const category = editing ? categories.find((entry) => entry.slug === editingSlug) : null;
  const { createCatalogCategory, saveCatalogCategory } = useAdminMutations();
  const [addressTouched, setAddressTouched] = useState(editing);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useAdminForm({ resolver, defaultValues: BLANK });

  useEffect(() => {
    if (!category) return;
    reset({
      name: category.name,
      address: category.address || category.slug,
      description: category.description,
      hasFirst: Boolean(category.facetLabel),
      facetLabel: category.facetLabel,
      facetRequired: category.facetRequired !== false,
      levels: allLevels(category.levels),
      depth: String(category.levels?.length || 4),
      grades: category.grades ?? [],
      isActive: category.isActive,
      order: category.order,
      attributes: featuresToForm(category.attributes),
    });
  }, [category?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new type's address follows its name until somebody types their own.
  const name = watch('name');
  const address = watch('address');
  useEffect(() => {
    if (!addressTouched) setValue('address', slugify(name));
  }, [name, addressTouched, setValue]);

  // Every type's page is /catalogue/<address>, Parts, Phones and Services
  // included (2026-10-03), and every address is the type's to change.
  const check = useAddressCheck(address, category?.slug);
  const addressState = check.data;
  const moved = editing && address && address !== (category?.address || category?.slug);

  const back = () => navigate('/admin/settings/taxonomy');
  const noun = nounOf(category);

  async function onSubmit(formValues) {
    if (addressState && !addressState.available) {
      setError('address', { message: addressState.reason });
      return;
    }
    const values = toPayload(formValues);
    try {
      if (editing) {
        await saveCatalogCategory.mutateAsync({ slug: category.slug, ...values });
        back();
      } else {
        const result = await createCatalogCategory.mutateAsync(values);
        // A new type has an empty tree; that is the next thing to do.
        navigate(`/admin/settings/taxonomy/tree?category=${result.category.slug}`);
      }
    } catch (err) {
      setError('root', { message: err.message });
    }
  }

  if (editing && isLoading) {
    return (
      <div className="form-page space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="form-page">
      <button
        type="button"
        onClick={back}
        className={cn(pressable, 'mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900')}
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        Back to Taxonomy
      </button>

      <PageHeader
        icon={adminIcon(route.icon)}
        title={editing ? `Edit ${category?.name ?? 'type'}` : 'Add a product type'}
        description={
          editing
            ? 'Rename it, change its levels, grades and features, or take its page off the website.'
            : 'A new section of the website, sold as products with stock, with its own category tree.'
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Panel icon={Globe} title="Name and web address" description="What it is called, and where its page lives on the website.">
          <div className="space-y-4">
            <Input label="Name" required placeholder="Accessories" error={errors.name?.message} {...register('name')} />

            <div>
              <Input
                label="Web address"
                required
                placeholder="accessories"
                className="font-mono"
                error={errors.address?.message}
                {...register('address', {
                  onChange: (event) => {
                    setAddressTouched(true);
                    setValue('address', slugify(event.target.value), { shouldDirty: true });
                  },
                })}
              />
              {address && (
                <p className={cn('mt-1.5 flex items-center gap-1.5 text-xs', addressState?.available === false ? 'text-danger' : 'text-ink-500')}>
                  {check.isFetching ? (
                    'Checking…'
                  ) : addressState?.available ? (
                    <>
                      <Check className="size-3.5 text-ok" strokeWidth={2.5} aria-hidden="true" />
                      {moved ? `${addressState.path} is free. Links to the old address keep working.` : `Its page is ${addressState.path}.`}
                    </>
                  ) : addressState ? (
                    <>
                      <X className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                      {addressState.reason}
                    </>
                  ) : null}
                </p>
              )}
            </div>

            <Input
              label="Line under the name"
              placeholder="Cases, cables and chargers"
              hint="Shown under its name in the website's Shop menu."
              error={errors.description?.message}
              {...register('description')}
            />
            <Input
              label="Position in the Shop menu"
              type="number"
              min="0"
              className="max-w-40"
              hint="Lower comes first, in the website's Shop menu and in the Taxonomy list."
              error={errors.order?.message}
              {...register('order')}
            />
          </div>
        </Panel>

        <Panel
          icon={Network}
          title="Category levels"
          description={`What somebody picks, in order, to reach a ${noun}. The same levels file a ${noun} when it is added; their entries go in the category tree.`}
        >
          <CategoryLevelsEditor
            control={control}
            register={register}
            setValue={setValue}
            errors={errors}
            heading={false}
            // Services file from the four-level serviced-items list.
            maxLevels={category?.kind === 'service' ? SYSTEM_MAX_LEVELS : MAX_LEVELS}
            noun={noun}
          />
        </Panel>

        {category?.kind !== 'service' && (
          <Panel
            icon={Tag}
            title="Grades"
            description="The condition each product is sold at. Also its badge on the website's cards and product page, and a website filter. Leave it empty for no grade and no badge."
          >
            <CategoryGradesEditor control={control} register={register} errors={errors} heading={false} />
          </Panel>
        )}

        {category?.kind !== 'service' && (
          <Panel
            icon={SlidersHorizontal}
            title="Features"
            description="What tells two products of this type apart: colour, storage, size. Asked on the product form in this order; each can be a column, a filter and a line on the product page."
          >
            <CategoryFeaturesEditor control={control} register={register} errors={errors} heading={false} />
          </Panel>
        )}

        {(
          <Panel icon={ListChecks} title="On the website">
            <label className="flex items-start gap-2.5">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand" {...register('isActive')} />
              <span className="text-sm leading-relaxed text-ink-700">
                <span className="font-medium">Its page is live</span>
                <span className="mt-0.5 block text-ink-500">
                  Switched off, its page and its Shop menu entry go. Its products and tree stay.
                </span>
              </span>
            </label>
          </Panel>
        )}

        {errors.root?.message && (
          <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
            {errors.root.message}
          </p>
        )}

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-surface-2/95 px-4 py-3 backdrop-blur-[2px]">
          <Button type="submit" icon={editing ? Save : Layers} loading={isSubmitting}>
            {editing ? 'Save changes' : 'Add type and set up its tree'}
          </Button>
          <Button type="button" variant="outline" onClick={back}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

export default AdminCatalogTypePage;
