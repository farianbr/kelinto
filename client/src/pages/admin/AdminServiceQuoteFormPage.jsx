import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileSignature,
  Info,
  Lock,
  MapPin,
  Plus,
  Smartphone,
  StickyNote,
  Trash2,
  Wrench,
} from 'lucide-react';

import { INVOICE_SERVICE_TYPES } from '@shared/schemas/admin';
import { PROVINCES } from '@shared/schemas/checkout';
import { money } from '@/lib/format';
import cn from '@/lib/cn';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import SelectField from '@/components/ui/SelectField';
import Panel from '@/components/ui/Panel';
import PageHeader from '@/components/admin/PageHeader';
import { Section } from '@/components/admin/DeviceLines';
import DevicePicker from '@/components/admin/DevicePicker';
import PricedLines, { emptyLine } from '@/components/admin/PricedLines';
import { pressable } from '@/lib/motion';
import {
  useAdminUsers,
  useAdminServices,
  useAdminInventory,
  useAdminServiceQuote,
  useAdminMutations,
} from '@/hooks/useAdmin';

const SERVICE_TYPE_OPTIONS = INVOICE_SERVICE_TYPES;

// `PROVINCES` is already `{value, label}`, which is what `SelectField` wants.
const PROVINCE_OPTIONS = [{ value: '', label: '– Pick province –' }, ...PROVINCES];

const emptyDevice = () => ({
  category: '',
  brand: '',
  series: '',
  model: '',
  serial: '',
  passcode: '',
  problem: '',
  solution: '',
  notes: '',
  services: [emptyLine()],
  parts: [],
});

/** Today, as the `<input type="date">` value. */
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * One device on the estimate.
 *
 * The same block the ticket intake uses, minus the condition grid: a
 * component-by-component check is done with the hardware on the counter, and a
 * grid of "untested" rows filled in over the phone is a record that looks like
 * evidence and is not.
 */
function DeviceBlock({ control, register, setValue, index, onRemove, canRemove, services, parts }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
        <p className="flex items-center gap-2 font-display text-sm font-bold text-ink-900">
          <Smartphone className="size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
          Device #{index + 1}
        </p>
        {canRemove && (
          <Button type="button" variant="ghost" size="xs" icon={Trash2} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>

      {/* Linked to the shop's own device tree, falling back to free text at any
          level the tree has nothing for - see `DevicePicker`. */}
      <DevicePicker control={control} register={register} setValue={setValue} index={index} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Input label="Serial number" placeholder="e.g. IMEI or S/N" {...register(`devices.${index}.serial`)} />
        <Input
          label="Passcode / PIN"
          placeholder="For testing (optional)"
          {...register(`devices.${index}.passcode`)}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Textarea
          label="Problem"
          rows={3}
          placeholder="What's wrong with this device..."
          {...register(`devices.${index}.problem`)}
        />
        <Textarea
          label="Solution"
          rows={3}
          placeholder="How it will be fixed..."
          {...register(`devices.${index}.solution`)}
        />
        <Textarea
          label="Notes"
          rows={3}
          placeholder="Anything else about this device..."
          {...register(`devices.${index}.notes`)}
        />
      </div>

      <PricedLines
        control={control}
        register={register}
        setValue={setValue}
        name={`devices.${index}.services`}
        label="Services for this device"
        addLabel="Add service"
        placeholder="Search a service…"
        emptyHint="No services yet."
        catalogue={services}
        refField="service"
      />

      <PricedLines
        control={control}
        register={register}
        setValue={setValue}
        name={`devices.${index}.parts`}
        label="Parts required for this device"
        addLabel="Add part"
        placeholder="Search inventory…"
        emptyHint="No parts yet."
        catalogue={parts}
        refField="product"
      />
    </div>
  );
}

/**
 * Build a repair estimate (Sales § Quote, service businesses).
 *
 * **A full page, not a modal.** The form carries a customer, any number of
 * devices, each with its own services and parts, three sets of notes and a
 * tax block - a dialog that scrolls past the viewport is a dialog that hides
 * half of what the staff member is about to promise somebody.
 *
 * **Every figure here is a preview.** The server recomputes the subtotal, the
 * tax and the total from the same lines on submit (invariant 8). A client that
 * could set the total would be setting the price of the work.
 */
export function AdminServiceQuoteFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = Boolean(id);

  const [submitError, setSubmitError] = useState(null);

  const { data: existing, isLoading: loadingQuote } = useAdminServiceQuote(id);
  const { data: clientData } = useAdminUsers({ status: 'approved', limit: 500 });
  const { data: serviceData } = useAdminServices({ status: 'active', limit: 200 });
  const { data: inventoryData } = useAdminInventory({ limit: 500 });

  const { createServiceQuote, updateServiceQuote } = useAdminMutations();

  const clients = clientData?.users ?? [];
  const services = serviceData?.services ?? [];

  // Inventory lines carry a price in cents; the picker works in dollars, like
  // every other amount a staff member types.
  const parts = useMemo(
    () =>
      (inventoryData?.products ?? []).map((product) => ({
        id: product.id,
        name: product.name,
        price: (product.price ?? 0) / 100,
        description: product.sku ?? '',
      })),
    [inventoryData],
  );

  const quote = existing?.quote;

  const { register, control, handleSubmit, setValue, reset } = useAdminForm({
    values: quote
      ? {
          user: quote.user ?? '',
          serviceType: quote.serviceType ?? 'walk_in',
          quoteDate: quote.quoteDate ? String(quote.quoteDate).slice(0, 10) : today(),
          validUntil: quote.validUntil ? String(quote.validUntil).slice(0, 10) : '',
          devices: quote.devices?.length
            ? quote.devices.map((device) => ({
                ...device,
                services: device.services.map((line) => ({
                  ...line,
                  priceDollars: line.price,
                })),
                parts: device.parts.map((line) => ({ ...line, priceDollars: line.price })),
              }))
            : [emptyDevice()],
          clientNotes: quote.clientNotes ?? '',
          technicianNotes: quote.technicianNotes ?? '',
          internalNotes: quote.internalNotes ?? '',
          extendedServiceFee: quote.extendedServiceFee ?? false,
          extendedServiceFeeDollars: (quote.extendedServiceFeeCents ?? 0) / 100,
          discountDollars: (quote.discountCents ?? 0) / 100,
          discountCode: quote.discountCode ?? '',
          province: quote.province ?? '',
          taxRate: quote.taxRate ?? 5,
        }
      : undefined,
    defaultValues: {
      user: '',
      serviceType: 'walk_in',
      quoteDate: today(),
      validUntil: '',
      devices: [emptyDevice()],
      clientNotes: '',
      technicianNotes: '',
      internalNotes: '',
      extendedServiceFee: false,
      extendedServiceFeeDollars: 0,
      discountDollars: 0,
      discountCode: '',
      province: '',
      taxRate: 5,
    },
  });

  const {
    fields: deviceFields,
    append: appendDevice,
    remove: removeDevice,
  } = useFieldArray({ control, name: 'devices' });

  const watched = useWatch({ control });

  /**
   * The running total, recomputed on every keystroke.
   *
   * A preview so the counter can quote a figure while somebody is on the phone;
   * the server computes it again from the same lines and that one is what gets
   * stored.
   */
  const totals = useMemo(() => {
    const devices = watched.devices ?? [];
    const lines = devices.reduce(
      (sum, device) =>
        sum +
        [...(device?.services ?? []), ...(device?.parts ?? [])].reduce(
          (n, line) => n + (Number(line?.priceDollars) || 0) * (Number(line?.qty) || 1),
          0,
        ),
      0,
    );

    const fee = watched.extendedServiceFee
      ? Number(watched.extendedServiceFeeDollars) || 0
      : 0;
    const gross = lines + fee;
    // Clamped the way the server clamps it: a discount larger than the work
    // would tax backwards.
    const discount = Math.min(Number(watched.discountDollars) || 0, gross);
    const subtotal = gross - discount;
    const tax = subtotal * ((Number(watched.taxRate) || 0) / 100);

    return {
      lines: Math.round(lines * 100),
      fee: Math.round(fee * 100),
      discount: Math.round(discount * 100),
      subtotal: Math.round(subtotal * 100),
      tax: Math.round(tax * 100),
      total: Math.round((subtotal + tax) * 100),
    };
  }, [watched]);

  function toPayload(values) {
    return {
      user: values.user,
      serviceType: values.serviceType,
      quoteDate: values.quoteDate || undefined,
      validUntil: values.validUntil || undefined,
      devices: (values.devices ?? []).map((device) => ({
        ...device,
        services: (device.services ?? []).filter((line) => String(line.name ?? '').trim()),
        parts: (device.parts ?? []).filter((line) => String(line.name ?? '').trim()),
      })),
      clientNotes: values.clientNotes || undefined,
      technicianNotes: values.technicianNotes || undefined,
      internalNotes: values.internalNotes || undefined,
      extendedServiceFee: Boolean(values.extendedServiceFee),
      extendedServiceFeeDollars: Number(values.extendedServiceFeeDollars) || 0,
      discountDollars: Number(values.discountDollars) || 0,
      discountCode: values.discountCode || undefined,
      taxRate: Number(values.taxRate) || 0,
      province: values.province || undefined,
    };
  }

  function onSubmit(values) {
    setSubmitError(null);
    const payload = toPayload(values);

    const mutation = editing ? updateServiceQuote : createServiceQuote;
    mutation.mutate(editing ? { id, ...payload } : payload, {
      onSuccess: (result) => {
        const next = result?.quote?.id ?? id;
        navigate(next ? `/admin/quotes/${next}` : '/admin/quotes');
      },
      onError: (error) => setSubmitError(error.message),
    });
  }

  const isPending = createServiceQuote.isPending || updateServiceQuote.isPending;

  if (editing && loadingQuote) {
    return (
      <Panel>
        <p className="py-8 text-center text-sm text-ink-400">Loading estimate…</p>
      </Panel>
    );
  }

  return (
    <>
      <PageHeader
        icon={FileSignature}
        title={editing ? `Edit ${quote?.quoteNumber ?? 'estimate'}` : 'Create estimate'}
        description="Prepare a service quote for a customer who has not left their device."
        action={
          <Link
            to="/admin/quotes"
            className={cn(
              pressable,
              'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2',
            )}
          >
            <ArrowLeft className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            Back to quotes
          </Link>
        }
      />

      {!editing && (
        <p className="mb-4 flex items-center gap-2 rounded-md bg-ok-50 px-3 py-2.5 text-sm text-ok">
          <CheckCircle2 className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          The estimate number is assigned on save, as <strong>EST-{new Date().getFullYear()}-…</strong>
        </p>
      )}

      {submitError && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {submitError}
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pb-24">
        <Section icon={Info} title="Basic information">
          <div className="grid gap-3 lg:grid-cols-3">
            <SelectField
              control={control}
              name="user"
              label="Customer"
              options={[
                { value: '', label: '– Choose a customer –' },
                ...clients.map((client) => ({
                  value: client.id,
                  label: `${client.displayName}${client.email ? ` · ${client.email}` : ''}`,
                })),
              ]}
            />
            <Input label="Quote date" type="date" {...register('quoteDate')} />
            <SelectField
              control={control}
              name="serviceType"
              label="Service type"
              options={SERVICE_TYPE_OPTIONS}
            />
          </div>

          <p className="mt-2 text-xs text-ink-400">
            No account yet?{' '}
            <Link to="/admin/clients/new" className="font-medium text-brand underline">
              Add a customer
            </Link>{' '}
            first - an estimate is addressed to somebody.
          </p>
        </Section>

        <Section icon={Smartphone} title="Devices and services">
          <div className="space-y-3">
            {deviceFields.map((field, index) => (
              <DeviceBlock
                key={field.id}
                control={control}
                register={register}
                setValue={setValue}
                index={index}
                canRemove={deviceFields.length > 1}
                onRemove={() => removeDevice(index)}
                services={services}
                parts={parts}
              />
            ))}
          </div>

          <Button
            type="button"
            icon={Plus}
            className="mt-3"
            onClick={() => appendDevice(emptyDevice())}
          >
            Add device
          </Button>
        </Section>

        <Section icon={StickyNote} title="Notes">
          <div className="space-y-3">
            <Textarea
              label="Client notes"
              hint="Visible to the customer on the PDF"
              rows={3}
              placeholder="Notes visible to the client on the PDF estimate..."
              {...register('clientNotes')}
            />
            <Textarea
              label="Technician notes"
              hint="Visible to the customer on the PDF"
              rows={3}
              placeholder="Technical details (visible on the PDF estimate)..."
              {...register('technicianNotes')}
            />

            {/* The one that must never print. Boxed and coloured, because the
                difference between this field and the two above it is the whole
                point of having three. */}
            <div className="rounded-md border border-warn-200 bg-warn-50 p-3">
              <Textarea
                label="Internal notes"
                rows={3}
                placeholder="Internal notes (NOT visible on the PDF estimate)..."
                {...register('internalNotes')}
              />
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warn">
                <Lock className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                These notes never appear on the customer's PDF.
              </p>
            </div>
          </div>
        </Section>

        <Section icon={Wrench} title="Estimate summary">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              <div>
                <Checkbox
                  label="Extended service area fee"
                  {...register('extendedServiceFee')}
                />
                <p className="mt-1 pl-7 text-xs text-ink-400">
                  Charge this when the customer is outside the standard service area.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label="Fee (CAD)"
                  type="number"
                  step="0.01"
                  min="0"
                  icon={MapPin}
                  {...register('extendedServiceFeeDollars')}
                />
                <Input
                  label="Discount (CAD)"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('discountDollars')}
                />
                <Input label="Discount code" placeholder="e.g. SUMMER10" {...register('discountCode')} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  control={control}
                  name="province"
                  label="Province"
                  options={PROVINCE_OPTIONS}
                />
                <Input
                  label="Tax rate (%)"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  hint="0 means tax exempt"
                  {...register('taxRate')}
                />
              </div>
            </div>

            {/* The figures, right-aligned in their own slab: this is the number
                the staff member reads out loud, so it gets the weight. */}
            <div className="rounded-lg border border-line bg-surface-2 p-4">
              <dl className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">Services and parts</dt>
                  <dd className="tnum text-ink-900">{money(totals.lines)}</dd>
                </div>
                {totals.fee > 0 && (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-500">Extended service area</dt>
                    <dd className="tnum text-ink-900">{money(totals.fee)}</dd>
                  </div>
                )}
                {totals.discount > 0 && (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-500">Discount</dt>
                    <dd className="tnum text-ok">−{money(totals.discount)}</dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">Subtotal</dt>
                  <dd className="tnum text-ink-900">{money(totals.subtotal)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">Tax</dt>
                  <dd className="tnum text-ink-900">{money(totals.tax)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                  <dt className="font-display font-bold text-ink-900">Total</dt>
                  <dd className="tnum font-display text-lg font-bold text-ink-900">
                    {money(totals.total)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-2xs text-ink-400">
                Recalculated on save from the lines above.
              </p>
            </div>
          </div>
        </Section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate('/admin/quotes')}>
            Cancel
          </Button>
          <Button type="submit" loading={isPending} icon={CheckCircle2}>
            {editing ? 'Save estimate' : 'Create estimate'}
          </Button>
        </div>
      </form>
    </>
  );
}

export default AdminServiceQuoteFormPage;
