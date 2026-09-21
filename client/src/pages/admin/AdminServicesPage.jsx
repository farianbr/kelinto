import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  Clock,
  FileSpreadsheet,
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
import { useAdminServices, useAdminMutations } from '@/hooks/useAdmin';
import {
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
} from '@shared/schemas/admin.js';

const ADMIN_PAGE = {
  ...ADMIN_ROUTES['/admin/services'],
  icon: adminIcon('Wrench'),
};

const CATEGORY_OPTIONS = SERVICE_CATEGORIES.map((value) => ({
  value,
  label: SERVICE_CATEGORY_LABELS[value] ?? value,
}));

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
 * `serviceCatalogSchema` describes the payload: `deviceTypes` is an array
 * there and a comma-separated string here, and `cost` is deliberately blank
 * rather than zero when nobody has said what the work costs. Validating the
 * payload shape against these fields would refuse input that is perfectly
 * correct, so the two that differ are restated.
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
  deviceTypes: z.string().trim().max(600).optional().or(z.literal('')),
  taxable: z.boolean(),
  isActive: z.boolean(),
  order: z.coerce.number().int().min(0).max(10_000),
});

function ServiceForm({ service, onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    control,
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
      deviceTypes: (service?.deviceTypes ?? []).join(', '),
      taxable: service?.taxable ?? true,
      isActive: service?.isActive ?? true,
      order: service?.order ?? 0,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField control={control} name="category" label="Category" options={CATEGORY_OPTIONS} />
        <Input
          label="Device types"
          placeholder="phone, tablet - blank means any"
          {...register('deviceTypes')}
        />
      </div>

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
export function AdminServicesPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');

  const { data, isLoading } = useAdminServices({ status, q: query || undefined, limit: 200 });
  const { createService, updateService, deleteService } = useAdminMutations();

  const services = data?.services ?? [];

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
      deviceTypes: String(values.deviceTypes ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
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
      render: (service) => (
        <>
          <span className="block truncate text-sm font-medium text-ink-900">{service.name}</span>
          {service.description && (
            <span className="block truncate text-2xs text-ink-400">{service.description}</span>
          )}
        </>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      priority: 3,
      render: (service) => (
        <span className="text-xs text-ink-500">
          {SERVICE_CATEGORY_LABELS[service.category] ?? service.category}
        </span>
      ),
    },
    {
      key: 'deviceTypes',
      header: 'Devices',
      priority: 4,
      render: (service) => (
        <span className="text-xs text-ink-500">
          {service.deviceTypes.length ? service.deviceTypes.join(' · ') : 'Any'}
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
      onSelect: (service) =>
        updateService.mutate({ id: service.id, isActive: !service.isActive }),
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
            isPending={createService.isPending}
            error={createService.error?.message}
            onCancel={() => setCreating(false)}
            onSubmit={(values) =>
              createService.mutate(toPayload(values), {
                onSuccess: () => setCreating(false),
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
            service={editing}
            isPending={updateService.isPending}
            error={updateService.error?.message}
            onCancel={() => setEditing(null)}
            onSubmit={(values) =>
              updateService.mutate(
                { id: editing.id, ...toPayload(values) },
                { onSuccess: () => setEditing(null) },
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

export default AdminServicesPage;
