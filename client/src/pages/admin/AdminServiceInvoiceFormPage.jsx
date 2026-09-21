import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  ArrowLeft,
  Car,
  CheckCircle2,
  Info,
  Lock,
  Receipt,
  Smartphone,
  StickyNote,
  Wrench,
} from 'lucide-react';

import { SERVICE_INVOICE_TYPES } from '@shared/schemas/admin';
import { PROVINCES } from '@shared/schemas/checkout';
import { money } from '@/lib/format';
import cn from '@/lib/cn';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import SelectField from '@/components/ui/SelectField';
import PageHeader from '@/components/admin/PageHeader';
import { Section } from '@/components/admin/DeviceLines';
import DevicePicker from '@/components/admin/DevicePicker';
import PricedLines, { emptyLine } from '@/components/admin/PricedLines';
import { pressable } from '@/lib/motion';
import {
  useAdminUsers,
  useAdminServices,
  useAdminInventory,
  useAdminSettings,
  useAdminMutations,
} from '@/hooks/useAdmin';

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

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Bill a repair (Sales § Invoice, service businesses).
 *
 * ## Why this is a separate screen and not a separate model
 *
 * `Invoice` is the **money record**: payments, store credit, the referral
 * ledger, revenue reports, overdue notices and the customer portal all read it,
 * across fifty-odd call sites. A second collection would mean every one of them
 * querying two and merging - and the first that forgot would drop a service
 * invoice out of the P&L silently, noticed only when the figures were wrong.
 *
 * So the **screens** split and the record does not. A repair shop gets this
 * page; a wholesaler keeps the modal on the invoices list. Both write one
 * `Invoice`, which already carries `devices`, `serviceType` and the travel
 * fields because that is what a ticket converts into.
 *
 * ## Two things this page does NOT have
 *
 * **Payment terms.** A repair is paid when the device is collected; net-30 on a
 * phone screen is a wholesale idea, and offering it here would put a due date on
 * something nobody is invoicing on credit.
 *
 * **A typed travel allowance.** The staff member enters the distance and the shop's
 * own rate turns it into money - see the Travel section.
 */
export function AdminServiceInvoiceFormPage() {
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState(null);

  const { data: clientData } = useAdminUsers({ status: 'approved', limit: 500 });
  const { data: serviceData } = useAdminServices({ status: 'active', limit: 200 });
  const { data: inventoryData } = useAdminInventory({ limit: 500 });
  const { data: settingsData } = useAdminSettings();

  const { createInvoice } = useAdminMutations();

  const clients = clientData?.users ?? [];
  const services = serviceData?.services ?? [];

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

  /**
   * The mileage rate, from the shop's own settings.
   *
   * Read here only to show the staff member what a kilometre is worth; the server
   * recomputes the allowance from the same setting on save, so nothing this
   * page displays can decide what gets claimed.
   */
  const ratePerKm = Number(settingsData?.financial?.travelRateCentsPerKm ?? 0);

  const { register, control, handleSubmit, setValue } = useAdminForm({
    defaultValues: {
      user: '',
      issuedAt: today(),
      dueDate: '',
      technician: '',
      serviceType: 'walk_in',
      devices: [emptyDevice()],
      customerNotes: '',
      technicianNotes: '',
      internalNotes: '',
      travelKm: '',
      extendedServiceFee: false,
      extendedServiceFeeDollars: '',
      discountDollars: 0,
      discountCode: '',
      province: '',
      taxPercent: 5,
    },
  });

  const {
    fields: deviceFields,
    append: appendDevice,
    remove: removeDevice,
  } = useFieldArray({ control, name: 'devices' });

  const watched = useWatch({ control });
  const feeOn = Boolean(watched.extendedServiceFee);

  /**
   * The running total, and the allowance beside it.
   *
   * A preview so the counter can quote a figure while somebody is standing
   * there; the server computes all of it again from the same lines on save.
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

    const fee = watched.extendedServiceFee ? Number(watched.extendedServiceFeeDollars) || 0 : 0;
    const gross = lines + fee;
    const discount = Math.min(Number(watched.discountDollars) || 0, gross);
    const subtotal = gross - discount;
    const tax = subtotal * ((Number(watched.taxPercent) || 0) / 100);

    return {
      lines: Math.round(lines * 100),
      fee: Math.round(fee * 100),
      discount: Math.round(discount * 100),
      subtotal: Math.round(subtotal * 100),
      tax: Math.round(tax * 100),
      total: Math.round((subtotal + tax) * 100),
      // Internal, and deliberately kept out of every figure above.
      allowance: Math.round((Number(watched.travelKm) || 0) * ratePerKm),
    };
  }, [watched, ratePerKm]);

  function onSubmit(values) {
    setSubmitError(null);

    createInvoice.mutate(
      {
        user: values.user,
        issuedAt: values.issuedAt || undefined,
        dueDate: values.dueDate || undefined,
        // A repair is settled on collection, so it is raised prepaid rather
        // than on terms - see the note on this component.
        terms: 'prepaid',
        technician: values.technician || undefined,
        serviceType: values.serviceType,
        devices: (values.devices ?? []).map((device) => ({
          ...device,
          services: (device.services ?? []).filter((line) => String(line.name ?? '').trim()),
          parts: (device.parts ?? []).filter((line) => String(line.name ?? '').trim()),
        })),
        customerNotes: values.customerNotes || undefined,
        technicianNotes: values.technicianNotes || undefined,
        internalNotes: values.internalNotes || undefined,
        travelKm: Number(values.travelKm) || 0,
        extendedServiceFee: Boolean(values.extendedServiceFee),
        extendedServiceFeeDollars: Number(values.extendedServiceFeeDollars) || 0,
        discountDollars: Number(values.discountDollars) || 0,
        discountCode: values.discountCode || undefined,
        province: values.province || undefined,
        taxPercent: Number(values.taxPercent) || 0,
      },
      {
        onSuccess: (result) => {
          const number = result?.invoice?.number;
          navigate(number ? `/admin/invoices/${number}` : '/admin/invoices');
        },
        onError: (error) => setSubmitError(error.message),
      },
    );
  }

  return (
    <>
      <PageHeader
        icon={Receipt}
        title="New invoice"
        description="Bill a repair. The number is assigned on save."
        action={
          <Link
            to="/admin/invoices"
            className={cn(
              pressable,
              'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2',
            )}
          >
            <ArrowLeft className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            Back to invoices
          </Link>
        }
      />

      {submitError && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {submitError}
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 pb-24">
        <Section icon={Info} title="Basic information">
          <div className="grid gap-3 lg:grid-cols-4">
            <SelectField
              control={control}
              name="user"
              label="Customer"
              size="sm"
              options={[
                { value: '', label: '– Choose a customer –' },
                ...clients.map((client) => ({
                  value: client.id,
                  label: `${client.displayName}${client.email ? ` · ${client.email}` : ''}`,
                })),
              ]}
            />
            <Input label="Invoice date" type="date" className="h-9" {...register('issuedAt')} />
            <Input label="Due date" type="date" className="h-9" {...register('dueDate')} />
            <SelectField
              control={control}
              name="serviceType"
              label="Service type"
              size="sm"
              options={SERVICE_INVOICE_TYPES}
            />
          </div>

          <p className="mt-2 text-xs text-ink-400">
            No account yet?{' '}
            <Link to="/admin/clients/new" className="font-medium text-brand underline">
              Add a customer
            </Link>{' '}
            first - an invoice is raised against somebody.
          </p>
        </Section>

        <Section icon={Smartphone} title="Devices and services">
          <div className="space-y-3">
            {deviceFields.map((field, index) => (
              <div key={field.id} className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
                  <p className="flex items-center gap-2 font-display text-sm font-bold text-ink-900">
                    <Smartphone
                      className="size-4 shrink-0 text-brand"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                    Device #{index + 1}
                  </p>
                  {deviceFields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => removeDevice(index)}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                <DevicePicker
                  control={control}
                  register={register}
                  setValue={setValue}
                  index={index}
                />

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Serial number"
                    placeholder="e.g. IMEI or S/N"
                    className="h-9"
                    {...register(`devices.${index}.serial`)}
                  />
                  <Input
                    label="Passcode / PIN"
                    placeholder="For testing (optional)"
                    className="h-9"
                    {...register(`devices.${index}.passcode`)}
                  />
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <Textarea
                    label="Problem"
                    rows={2}
                    placeholder="What was wrong with this device..."
                    {...register(`devices.${index}.problem`)}
                  />
                  <Textarea
                    label="Solution"
                    rows={2}
                    placeholder="How it was fixed..."
                    {...register(`devices.${index}.solution`)}
                  />
                  <Textarea
                    label="Notes"
                    rows={2}
                    placeholder="Anything else about this device..."
                    {...register(`devices.${index}.notes`)}
                  />
                </div>

                <PricedLines
                  control={control}
                  register={register}
                  setValue={setValue}
                  name={`devices.${index}.services`}
                  label="Services"
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
                  label="Parts used"
                  addLabel="Add part"
                  placeholder="Search inventory…"
                  emptyHint="No parts yet."
                  catalogue={parts}
                  refField="product"
                />
              </div>
            ))}
          </div>

          <Button
            type="button"
            className="mt-3"
            onClick={() => appendDevice(emptyDevice())}
          >
            Add device
          </Button>
        </Section>

        <Section icon={StickyNote} title="Notes">
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <Textarea
                label="Client notes"
                hint="On the PDF"
                rows={2}
                placeholder="Visible to the client on the PDF..."
                {...register('customerNotes')}
              />
              <Textarea
                label="Technician notes"
                hint="On the PDF"
                rows={2}
                placeholder="Technician notes (on the PDF)..."
                {...register('technicianNotes')}
              />
            </div>

            <div className="rounded-md border border-warn-200 bg-warn-50 p-3">
              <Textarea
                label="Internal notes"
                rows={2}
                placeholder="NOT on the PDF..."
                {...register('internalNotes')}
              />
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warn">
                <Lock className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                These notes never appear on the customer&apos;s PDF.
              </p>
            </div>
          </div>
        </Section>

        <Section icon={Car} title="Travel" hint="Internal, not on the invoice">
          {/*
            The distinction this whole section exists to hold.

            The allowance is the shop's own cost for the journey - it is claimed,
            reported on, and never billed. The extended service area fee is the
            opposite: a real charge that lands in the subtotal and carries tax.
            They sit together because they both come from one visit, and the
            note is what stops somebody reading the allowance as revenue.
          */}
          <p className="mb-3 flex items-start gap-2 rounded-md bg-info-50 px-3 py-2.5 text-xs leading-snug text-info">
            <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>
              The travel allowance is internal tracking only and is <strong>not</strong> added to the
              customer&apos;s total. The extended service area fee, if ticked, <strong>is</strong>.
            </span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Input
                label="Total km travelled"
                type="number"
                step="0.1"
                min="0"
                placeholder="e.g. 45"
                className="h-9"
                {...register('travelKm')}
              />
              <p className="mt-1 text-xs text-ink-400">
                {/*
                  Three decimals, not `money()`.

                  `money()` takes cents and rounds to two places, so 56.7¢ came
                  out as "$0.57" - the tenth of a cent the CRA rate actually
                  carries, dropped from the one label whose job is stating the
                  rate. Over a few hundred kilometres that rounding is real
                  money, and an admin checking the figure against the CRA table
                  would find it did not match.
                */}
                Auto-calculated at ${(ratePerKm / 100).toFixed(3)}/km (Settings, Financial,
                Sale).
              </p>
            </div>

            {/* Read-only: the staff member enters the distance, the shop's rate
                decides the money. A typed allowance would be a mileage claim
                nobody checked. */}
            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink-700">
                Travel allowance (internal only)
              </span>
              <output className="tnum flex h-9 w-full items-center rounded-md border border-line bg-surface-2 px-3.5 text-md text-ink-700">
                {totals.allowance > 0 ? money(totals.allowance) : 'Auto-calculated'}
              </output>
              <p className="mt-1 text-xs text-ink-400">Not added to the customer invoice.</p>
            </div>
          </div>

          <div className="mt-3">
            <Checkbox
              label="Extended service area fee (added to the invoice)"
              {...register('extendedServiceFee')}
            />

            {/*
              The amount appears only once the fee is ticked.

              It is typed per job rather than read from a setting: an
              out-of-area call is priced by distance and awkwardness and gets
              negotiated, so a fixed figure would be one the counter has to work
              around. Hidden until ticked because an amount box beside an
              unticked charge is a number that looks like it is being applied.
            */}
            {feeOn && (
              <div className="mt-3 max-w-xs">
                <Input
                  label="Service fee amount (CAD)"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="h-9"
                  {...register('extendedServiceFeeDollars')}
                />
              </div>
            )}
          </div>
        </Section>

        <Section icon={Wrench} title="Invoice summary">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Discount (CAD)"
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-9"
                  {...register('discountDollars')}
                />
                <Input
                  label="Discount code"
                  placeholder="e.g. SUMMER10"
                  className="h-9"
                  {...register('discountCode')}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  control={control}
                  name="province"
                  label="Province"
                  size="sm"
                  options={PROVINCE_OPTIONS}
                />
                <Input
                  label="GST %"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  hint="0 means tax exempt"
                  className="h-9"
                  {...register('taxPercent')}
                />
              </div>
            </div>

            <div className="rounded-lg border border-line bg-surface-2 p-4">
              <dl className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-500">Services total</dt>
                  <dd className="tnum text-ink-900">{money(totals.lines)}</dd>
                </div>
                {totals.fee > 0 && (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-500">Service fee</dt>
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
                  <dt className="text-ink-500">GST</dt>
                  <dd className="tnum text-ink-900">{money(totals.tax)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                  <dt className="font-display font-bold text-ink-900">Total</dt>
                  <dd className="tnum font-display text-lg font-bold text-ink-900">
                    {money(totals.total)}
                  </dd>
                </div>
              </dl>

              {/* Below the total, outside the sum - the same placement the
                  printed document uses, and for the same reason. */}
              {totals.allowance > 0 && (
                <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-xs">
                  <span className="text-ink-400">Travel allowance (internal)</span>
                  <span className="tnum text-ink-500">{money(totals.allowance)}</span>
                </p>
              )}

              <p className="mt-3 text-2xs text-ink-400">Recalculated on save from the lines above.</p>
            </div>
          </div>
        </Section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate('/admin/invoices')}>
            Cancel
          </Button>
          <Button type="submit" loading={createInvoice.isPending} icon={CheckCircle2}>
            Create invoice
          </Button>
        </div>
      </form>
    </>
  );
}

export default AdminServiceInvoiceFormPage;
