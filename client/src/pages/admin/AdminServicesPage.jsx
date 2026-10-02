import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller } from 'react-hook-form';
import useAdminForm from '@/hooks/useAdminForm';
import useUploadSession from '@/hooks/useUploadSession';
import AssetUpload from '@/components/admin/AssetUpload';
import Textarea from '@/components/ui/Textarea';
import {
  AlertCircle,
  Clock,
  FileSpreadsheet,
  PackageOpen,
  CalendarClock,
  Pencil,
  Plus,
  Power,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';

import { money, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DeleteWithPreview from '@/components/admin/DeleteWithPreview';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import FilterStrip from '@/components/admin/FilterStrip';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminCatalogCategories, useAdminServices, useAdminMutations, useAdminTaxonomyTree } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import TabRow from '@/components/ui/TabRow';
import { featureEnabled } from '@shared/schemas/features';
import { AdminSupplierServicesPage } from '@/pages/admin/AdminSupplierServicesPage';
import { DEFAULT_REPAIR_TYPES } from '@shared/catalog';
import SelectMenu from '@/components/ui/SelectMenu';

const ADMIN_PAGE = {
  ...ADMIN_ROUTES['/admin/services'],
  icon: adminIcon('Wrench'),
};


const PILLS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

/**
 * Minutes as a staff member reads them.
 *
 * `90` is "1h 30m", not "90 minutes" - a bench time is compared against the
 * working day, and the hour is the unit that comparison happens in.
 */
function duration(minutes) {
  if (!minutes) return '–';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * Margin as a percentage of the price, or `null` when the cost is unrecorded.
 *
 * **Unrecorded is not zero.** A service with no cost against it would otherwise
 * show 100% margin, which is the most flattering possible lie and the one a
 * staff member is least likely to question.
 */
function marginOf(service) {
  if (service.costCents == null || !service.priceCents) return null;
  return Math.round(((service.priceCents - service.costCents) / service.priceCents) * 100);
}

/**
 * What the FORM holds.
 *
 * `serviceCatalogSchema` describes the payload: the device is four step
 * picks here and one node id there (`scopeNode`), and `cost` is deliberately
 * blank rather than zero when nobody has said what the work costs. Validating
 * the payload shape against these fields would refuse input that is perfectly
 * correct, so the ones that differ are restated.
 */
const serviceFormSchema = z.object({
  name: z.string().trim().min(2, 'Give the service a name.').max(160),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  category: z.string().trim(),
  price: z.coerce.number().min(0, 'Price cannot be negative.').max(1_000_000),
  cost: z
    .union([z.literal(''), z.coerce.number().min(0, 'Cost cannot be negative.').max(1_000_000)])
    .optional(),
  durationMinutes: z.coerce.number().int().min(0).max(100_000),
  warrantyDays: z.coerce.number().int().min(0).max(3650),
  deviceTypeSlug: z.string().trim().max(120).optional().or(z.literal('')),
  brandSlug: z.string().trim().max(120).optional().or(z.literal('')),
  seriesSlug: z.string().trim().max(120).optional().or(z.literal('')),
  modelSlug: z.string().trim().max(120).optional().or(z.literal('')),
  image: z.string().trim().max(1000).optional().or(z.literal('')),
  details: z.string().trim().max(6000, 'Keep the details to 6,000 characters.').optional().or(z.literal('')),
  taxable: z.boolean(),
  isActive: z.boolean(),
  order: z.coerce.number().int().min(0).max(10_000),
});

/** Sent when the tree has not loaded, so a save cannot clear a scope it never saw. */
const KEEP_SCOPE = 'keep';
const SCOPE_LEVELS = ['deviceType', 'brand', 'series', 'model'];

/** The children of the deepest step picked above `level` that are of its kind. */
function scopeEntries(tree, path, level) {
  let nodes = tree ?? [];
  for (const above of SCOPE_LEVELS.slice(0, SCOPE_LEVELS.indexOf(level))) {
    if (!path[above]) continue;
    nodes = nodes.find((node) => node.slug === path[above])?.children ?? [];
  }
  return nodes.filter((node) => node.kind === level);
}

/** The node the deepest pick names, walked down the tree. */
function scopeNodeOf(tree, path) {
  let nodes = tree ?? [];
  let found = null;
  for (const level of SCOPE_LEVELS) {
    if (!path[level]) continue;
    found = nodes.find((node) => node.slug === path[level]) ?? found;
    nodes = found?.children ?? [];
  }
  return found;
}

/**
 * Add or edit a service.
 *
 * Filed with the Services finder's own steps (client ruling 2026-10-02:
 * "these levels/filters should be used in creating products and services"):
 * its Repair Type from that step's entries, and the device it is for picked
 * step by step, Device › Brand › Series › Model, each optional. Stopping at
 * Phone means every phone; picking nothing means every device. It replaced a
 * free-typed device list and one long scope picker.
 */
function ServiceForm({ service, repairTypes, onSubmit, onCancel, isPending, error }) {
  const { data: scopeTree, isSuccess: treeLoaded } = useAdminTaxonomyTree('services');
  const { data: categories = [] } = useAdminCatalogCategories();
  const steps = (categories.find((entry) => entry.kind === 'service')?.levels ?? [])
    .filter((level) => SCOPE_LEVELS.includes(level.key));
  const scopeSteps = steps.length
    ? steps
    : SCOPE_LEVELS.map((key, index) => ({ key, label: ['Device', 'Brand', 'Series', 'Model'][index] }));
  // A picture uploaded here and not saved is deleted when the form closes;
  // the parent settles the session once the save has answered.
  const uploads = useUploadSession();
  const [scopeError, setScopeError] = useState(null);

  /**
   * A service written before scopes existed may carry one old device-type
   * word ("laptop"); when it names a device in the tree, the form starts on
   * it, so saving keeps the service where it was.
   */
  const hinted =
    !service?.scope?.deviceType && service?.deviceTypes?.length === 1
      ? (scopeTree ?? []).find((node) => node.name.toLowerCase() === service.deviceTypes[0])?.slug
      : null;

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: {
      name: service?.name ?? '',
      description: service?.description ?? '',
      category: service?.category ?? 'other',
      price: service?.price ?? 0,
      // Empty rather than 0, so leaving it alone records "not known" instead of
      // claiming the work is free to perform.
      cost: service?.cost ?? '',
      durationMinutes: service?.durationMinutes ?? 0,
      warrantyDays: service?.warrantyDays ?? 0,
      deviceTypeSlug: service?.scope?.deviceType ?? '',
      brandSlug: service?.scope?.brand ?? '',
      seriesSlug: service?.scope?.series ?? '',
      modelSlug: service?.scope?.model ?? '',
      image: service?.image ?? '',
      details: service?.details ?? '',
      taxable: service?.taxable ?? true,
      isActive: service?.isActive ?? true,
      order: service?.order ?? 0,
    },
  });

  // The tree arrives after the form; start on the hinted device once it has.
  useEffect(() => {
    if (hinted && !getValues('deviceTypeSlug')) setValue('deviceTypeSlug', hinted);
  }, [hinted, getValues, setValue]);

  const path = Object.fromEntries(SCOPE_LEVELS.map((level) => [level, watch(`${level}Slug`)]));
  const typeOptions = (repairTypes?.length ? repairTypes : DEFAULT_REPAIR_TYPES).map((option) => ({
    value: option.value,
    label: option.label,
  }));

  /** A change clears every step below it, so a model cannot outlive its brand. */
  function pick(level, value) {
    setValue(`${level}Slug`, value, { shouldDirty: true });
    for (const below of SCOPE_LEVELS.slice(SCOPE_LEVELS.indexOf(level) + 1)) setValue(`${below}Slug`, '');
  }

  function submit(values) {
    // A device level the Services type marks required must be picked (Settings › Taxonomy).
    const missing = scopeSteps.find((step) => step.required === true && !path[step.key]);
    if (missing) {
      setScopeError(`Pick a ${missing.label.toLowerCase()}.`);
      return undefined;
    }
    setScopeError(null);
    const node = scopeNodeOf(scopeTree, path);
    return onSubmit(
      {
        ...values,
        // The deepest node picked, read back by the server; blank is every device.
        scopeNode: treeLoaded ? (node?.id ?? '') : KEEP_SCOPE,
        // A device picked here replaces the old free-typed device words.
        ...(path.deviceType ? { deviceTypes: [] } : {}),
      },
      uploads.settle,
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Input
        label="Name"
        placeholder="e.g. Screen replacement"
        required
        error={errors.name?.message}
        {...register('name')}
      />
      <Input
        label="Description"
        placeholder="Shown under the name when picking it"
        {...register('description')}
      />

      <SelectField
        control={control}
        name="category"
        label="Repair type"
        hint="The first step of the Services finder. Its entries are set in Settings › Taxonomy."
        options={typeOptions}
        searchable={typeOptions.length > 8}
      />

      <fieldset className="rounded-md border border-line p-3.5">
        <legend className="eyebrow px-1 text-ink-400">For which devices</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {scopeSteps.map((step, index) => {
            const options = scopeEntries(scopeTree, path, step.key);
            const above = scopeSteps[index - 1];
            const any = step.required === true ? 'Select…' : index === 0 ? 'Every device' : `Every ${above.label.toLowerCase()} picked`;
            return (
              <SelectMenu
                key={step.key}
                label={step.label}
                required={step.required === true}
                size="md"
                align="left"
                searchable={options.length > 8}
                options={[{ value: '', label: any }, ...options.map((node) => ({ value: node.slug, label: node.name }))]}
                value={path[step.key] ?? ''}
                disabled={!options.length}
                onChange={(next) => pick(step.key, next)}
              />
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-400">
          Stop at any step: Phone alone is every phone, iPhone 15 is that phone only. Nothing picked is every device.
          {service?.deviceTypes?.length > 0 && !path.deviceType
            ? ` Saved earlier for: ${service.deviceTypes.join(', ')}.`
            : ''}
        </p>
        {scopeError && (
          <p role="alert" className="mt-2 border-l-2 border-danger pl-3 text-sm text-danger">
            {scopeError}
          </p>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Price (CAD)"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          required
          error={errors.price?.message}
          {...register('price')}
        />
        <Input
          label="Cost to us (CAD)"
          type="number"
          step="0.01"
          min="0"
          placeholder="Leave blank if unknown"
          {...register('cost')}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="Bench time (minutes)"
          type="number"
          min="0"
          {...register('durationMinutes')}
        />
        <Input
          label="Warranty (days)"
          type="number"
          min="0"
          placeholder="0"
          error={errors.warrantyDays?.message}
          {...register('warrantyDays')}
        />
        <Input
          label="Sort order"
          type="number"
          min="0"
          placeholder="0"
          error={errors.order?.message}
          {...register('order')}
        />
      </div>

      {/* The website's detail page (2026-10-02). */}
      <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        <Controller
          name="image"
          control={control}
          render={({ field }) => (
            <AssetUpload
              label="Picture"
              endpoint="catalogue"
              kind="product-image"
              hint={service?.picture && !field.value ? 'Using the stock photo for this repair.' : 'Shown on the card and the service page.'}
              value={field.value}
              onChange={field.onChange}
              session={uploads}
            />
          )}
        />
        <Textarea
          label="Details - optional"
          rows={7}
          placeholder={'What the repair involves, what is included, how long it takes.\n\n## What we check\n- Display and touch\n- Face ID and cameras'}
          hint="Shown on the service's own page. Use ## for a heading and - for a list."
          error={errors.details?.message}
          {...register('details')}
        />
      </div>

      <Checkbox label="Tax applies to this service" {...register('taxable')} />
      <Checkbox label="Active - offered on quotes and tickets" {...register('isActive')} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {service ? 'Save service' : 'Add service'}
        </Button>
      </div>
    </form>
  );
}

/**
 * The labour price list (Sales § Services).
 *
 * This is what the "Search a service" picker on the quote and ticket forms
 * reads. The price here is a **starting point**, not a price: the staff member
 * overrides it on the line when the job is not the standard one, so the column
 * is labelled "list price" rather than "price".
 */
function PriceListTab({ tabs }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');

  const { data, isLoading } = useAdminServices({ status, q: query || undefined, limit: 200 });
  const { createService, updateService, deleteService } = useAdminMutations();

  const services = data?.services ?? [];
  // The Services finder's first step, as the server lists it (2026-10-02).
  const repairTypes = data?.repairTypes ?? DEFAULT_REPAIR_TYPES;
  const repairTypeLabel = new Map(repairTypes.map((option) => [option.value, option.label]));

  const { pageRows: pageServices, page, totalPages, from, setPage } = useTablePage(services);

  const totals = useMemo(() => {
    const active = services.filter((service) => service.isActive);
    const priced = active.filter((service) => service.priceCents > 0);
    const withMargin = active.map(marginOf).filter((value) => value !== null);

    return {
      active: active.length,
      averagePrice: priced.length
        ? Math.round(priced.reduce((sum, s) => sum + s.priceCents, 0) / priced.length)
        : 0,
      averageMargin: withMargin.length
        ? Math.round(withMargin.reduce((sum, value) => sum + value, 0) / withMargin.length)
        : null,
      // What the margin tile is honest about: how much of the list it can
      // actually see a cost for.
      costed: withMargin.length,
    };
  }, [services]);

  function toPayload(values) {
    return {
      name: values.name,
      description: values.description || undefined,
      category: values.category,
      price: Number(values.price) || 0,
      // An empty box means "not known" and must not become a zero cost.
      cost: values.cost === '' || values.cost === null ? undefined : Number(values.cost),
      durationMinutes: Number(values.durationMinutes) || 0,
      warrantyDays: Number(values.warrantyDays) || 0,
      // Sent only to clear the old device words once a device is picked.
      ...(Array.isArray(values.deviceTypes) ? { deviceTypes: values.deviceTypes } : {}),
      // Unchanged: nothing sent, so the saved scope stands.
      ...(values.scopeNode === KEEP_SCOPE ? {} : { scopeNode: values.scopeNode ?? '' }),
      image: values.image ?? '',
      details: values.details ?? '',
      taxable: Boolean(values.taxable),
      isActive: Boolean(values.isActive),
      order: Number(values.order) || 0,
    };
  }

  const columns = [
    {
      key: 'name',
      header: 'Service',
      priority: 1,
      // The picture the website draws, so a missing or wrong one is seen here.
      render: (service) => (
        <span className="flex min-w-0 items-center gap-2.5">
          {service.picture ? (
            <img
              src={service.picture}
              alt=""
              width={32}
              height={32}
              loading="lazy"
              className="size-8 shrink-0 rounded-sm border border-line object-cover"
            />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-line bg-surface-2">
              <Wrench className="size-4 text-ink-300" strokeWidth={1.75} aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink-900">{service.name}</span>
            {service.description && (
              <span className="block truncate text-2xs text-ink-400">{service.description}</span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Repair type',
      priority: 3,
      render: (service) => (
        <span className="text-xs text-ink-500">
          {repairTypeLabel.get(service.category) ?? service.category}
        </span>
      ),
    },
    {
      key: 'deviceTypes',
      header: 'Devices',
      priority: 4,
      render: (service) => (
        <span className="text-xs text-ink-500">
          {service.scope?.label || (service.deviceTypes.length ? service.deviceTypes.join(' · ') : 'Any')}
        </span>
      ),
    },
    {
      key: 'priceCents',
      header: 'List price',
      priority: 1,
      align: 'right',
      className: 'tnum',
      render: (service) => (
        <span className="text-sm text-ink-900">{money(service.priceCents)}</span>
      ),
    },
    {
      key: 'margin',
      header: 'Margin',
      priority: 3,
      align: 'right',
      className: 'tnum',
      render: (service) => {
        const margin = marginOf(service);
        // An en dash, not 0% - the cost was never recorded, and a number here
        // would be an answer to a question nobody has asked yet.
        if (margin === null) return <span className="text-xs text-ink-300">–</span>;
        return (
          <span className={margin < 0 ? 'text-sm text-danger' : 'text-sm text-ink-900'}>
            {margin}%
          </span>
        );
      },
    },
    {
      key: 'durationMinutes',
      header: 'Bench time',
      priority: 4,
      align: 'right',
      render: (service) => (
        <span className="text-xs text-ink-500">{duration(service.durationMinutes)}</span>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      priority: 2,
      render: (service) => (
        <Badge tone={service.isActive ? 'ok' : 'neutral'} size="sm">
          {service.isActive ? 'active' : 'inactive'}
        </Badge>
      ),
    },
  ];

  const rowMenu = [
    { key: 'edit', label: 'Edit service', icon: Pencil, onSelect: setEditing },
    {
      key: 'toggle',
      label: (service) => (service.isActive ? 'Deactivate' : 'Reactivate'),
      icon: Power,
      confirm: (service) => ({
        title: service.isActive ? `Deactivate ${service.name}?` : `Reactivate ${service.name}?`,
        body: service.isActive
          ? 'It stops being offered on new tickets and quotes. Records that already carry it keep it.'
          : 'It is offered on new tickets and quotes again.',
        confirmLabel: service.isActive ? 'Deactivate' : 'Reactivate',
      }),
      onSelect: (service) =>
        updateService.mutateAsync({ id: service.id, isActive: !service.isActive }),
    },
    {
      key: 'delete',
      label: 'Delete service',
      icon: Trash2,
      tone: 'danger',
      onSelect: setDeleting,
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              icon={FileSpreadsheet}
              onClick={() => navigate('/admin/services/import')}
            >
              Import CSV
            </Button>
            <Button onClick={() => setCreating(true)} icon={Plus}>
              Add service
            </Button>
          </div>
        }
      />

      {tabs}

      <KpiRow
        tiles={[
          {
            key: 'active',
            label: 'On the price list',
            value: formatCount(totals.active),
            hint: 'Offered on quotes and tickets today',
            tone: 'brand',
            icon: Wrench,
          },
          {
            key: 'price',
            label: 'Average price',
            value: money(totals.averagePrice),
            hint: 'Across priced, active services',
            tone: 'info',
            icon: ShieldCheck,
          },
          {
            key: 'margin',
            label: 'Average margin',
            // Says so rather than showing a figure it cannot stand behind.
            value: totals.averageMargin === null ? '–' : `${totals.averageMargin}%`,
            hint:
              totals.averageMargin === null
                ? 'Record a cost to see margin'
                : `Across the ${formatCount(totals.costed)} with a cost recorded`,
            tone: totals.averageMargin !== null && totals.averageMargin < 0 ? 'warn' : 'ok',
            icon: Clock,
          },
        ]}
      />

      <Panel flush>
        <FilterStrip
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Service name or description…"
          pills={PILLS}
          activePill={status}
          onPillChange={setStatus}
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={services.length}
            shown={pageServices.length}
            from={from}
            noun={services.length === 1 ? 'service' : 'services'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={pageServices}
          rowKey={(service) => service.id}
          rowMenu={rowMenu}
          onRowClick={setEditing}
          loading={isLoading}
          defaultSort={{ key: 'name', direction: 'asc' }}
          empty={
            <PanelEmpty
              icon={Wrench}
              title={query || status !== 'active' ? 'No services match' : 'No services yet'}
              body={
                query || status !== 'active'
                  ? 'Try a different filter.'
                  : 'A quote picks its labour from this list. Add the work you do most often first.'
              }
              action={
                <Button onClick={() => setCreating(true)} icon={Plus} size="sm">
                  Add service
                </Button>
              }
            />
          }
        />

        <Pagination
          page={page}
          pages={totalPages}
          onChange={setPage}
          hideWhenSingle
          className="border-t border-line px-3 py-3 sm:px-4"
        />
      </Panel>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add a service"
        size="lg"
        align="top"
      >
        {creating && (
          <ServiceForm
            repairTypes={repairTypes}
            isPending={createService.isPending}
            error={createService.error?.message}
            onCancel={() => setCreating(false)}
            onSubmit={(values, settle) =>
              createService.mutate(toPayload(values), {
                onSuccess: () => {
                  settle();
                  setCreating(false);
                },
              })
            }
          />
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit service"
        size="lg"
        align="top"
      >
        {editing && (
          <ServiceForm
            repairTypes={repairTypes}
            service={editing}
            isPending={updateService.isPending}
            error={updateService.error?.message}
            onCancel={() => setEditing(null)}
            onSubmit={(values, settle) =>
              updateService.mutate(
                { id: editing.id, ...toPayload(values) },
                {
                  onSuccess: () => {
                    settle();
                    setEditing(null);
                  },
                },
              )
            }
          />
        )}
      </Modal>

      {/*
        The server refuses to delete a service any quote or ticket points at and
        says how many - so this dialog does not try to predict the answer, it
        names the record and the consequence and lets the refusal speak.
      */}
      {/* The real counts, fetched before the decision - this used to promise in
          prose what "would" happen if the service was in use, which is the same
          information one step too late. */}
      <DeleteWithPreview
        type="service"
        record={deleting}
        onClose={() => setDeleting(null)}
        confirmLabel="Delete service"
        loading={deleteService.isPending}
        error={deleteService.error?.message}
        onConfirm={() =>
          deleteService.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      />
    </>
  );
}

/**
 * Purchase › Services: the price list, Service Products and Subscriptions, as
 * tabs. Subscriptions (recurring supplier costs) joined on 2026-10-02, when its
 * own Purchase row became Membership Plans at the client's request.
 *
 * One row since 2026-09-30, at the client's request. The price list charges
 * a customer for labour; Service Products is what we pay a supplier for
 * (outsourced repair, freight, disposal). Each tab is gated on its own
 * feature, so a business with only one of them gets that screen and no tab
 * row, since a row of one tab only says where you already are.
 *
 * `?tab=products` picks the second tab, which is also where the old
 * `/admin/supplier-services` address lands.
 */
export function AdminServicesPage() {
  const [params, setParams] = useSearchParams();
  const { features } = useAuth();

  const tabs = [
    featureEnabled(features, 'sales.services') && {
      key: 'services',
      label: 'Services',
      icon: Wrench,
    },
    featureEnabled(features, 'purchase.services') && {
      key: 'products',
      label: 'Service Products',
      icon: PackageOpen,
    },
    featureEnabled(features, 'purchase.services') && {
      key: 'subscriptions',
      label: 'Subscriptions',
      icon: CalendarClock,
    },
  ].filter(Boolean);

  const requested = ['products', 'subscriptions'].includes(params.get('tab')) ? params.get('tab') : 'services';
  const tab = tabs.some((entry) => entry.key === requested) ? requested : tabs[0]?.key;

  const row =
    tabs.length > 1 ? (
      <TabRow
        panel
        value={tab}
        onChange={(next) => setParams(next === 'services' ? {} : { tab: next }, { replace: true })}
        tabs={tabs}
      />
    ) : null;

  if (tab === 'products') return <AdminSupplierServicesPage mode="service" tabs={row} />;
  if (tab === 'subscriptions') return <AdminSupplierServicesPage mode="subscription" tabs={row} />;
  return <PriceListTab tabs={row} />;
}

export default AdminServicesPage;
