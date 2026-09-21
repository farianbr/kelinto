import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, useParams, Link } from 'react-router';
import { useFieldArray, useWatch } from 'react-hook-form';
import useAdminForm from '@/hooks/useAdminForm';
import deviceFormResolver from '@/lib/deviceFormResolver';
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

import {
  SERVICE_INVOICE_TYPES,
  TAX_RATES,
  provinceTaxOptions,
  adminInvoiceSchema,
} from '@shared/schemas/admin';
import { money } from '@/lib/format';
import cn from '@/lib/cn';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import SelectField from '@/components/ui/SelectField';
import PageHeader from '@/components/admin/PageHeader';
import MissingFields from '@/components/admin/MissingFields';
import { Section } from '@/components/admin/DeviceLines';
import DeviceFinder from '@/components/admin/DeviceFinder';
import PricedLines, { emptyLine } from '@/components/admin/PricedLines';
import { pressable } from '@/lib/motion';
import {
  useAdminUsers,
  useAdminServices,
  useAdminInventory,
  useAdminSettings,
  useAdminInvoice,
  useAdminMutations,
} from '@/hooks/useAdmin';
import Skeleton from '@/components/ui/Skeleton';

// Each option carries its tax name and rate - see `provinceTaxOptions`.
const PROVINCE_OPTIONS = provinceTaxOptions();

/**
 * One resolver for both modes: the edit page sends the whole invoice and is
 * validated exactly as the create form is, because it IS the create form with
 * a record loaded into it - the same reasoning `invoiceUpdateSchema` gives for
 * branching on `user` rather than accepting a partial.
 *
 * Wrapped, because a fresh device block seeds a blank priced line that this
 * form drops on submit and `invoiceLineSchema` would reject - see
 * `deviceFormResolver`.
 *
 * `billable` because an invoice has to bill from something: this form has no
 * flat-amount box, so the rule resolves to "add a service or part", and it is
 * checked against the real rows rather than the placeholders standing in for
 * the blank ones.
 */
const INVOICE_RESOLVER = deviceFormResolver(adminInvoiceSchema, { billable: true });

/**
 * What the summary beside the submit calls each field. See `MissingFields`.
 *
 * `amount` is the itemised-or-flat rule landing somewhere: this form has no
 * flat-amount box, so the only way to satisfy it is to bill from lines, and
 * the label says that rather than naming a field the page does not show.
 */
const INVOICE_FIELD_LABELS = {
  user: 'Customer',
  amount: 'At least one service or part',
  issuedAt: 'Invoice date',
  dueDate: 'Due date',
  'devices.*.model': 'Device model',
  taxPercent: 'Tax rate',
  discountDollars: 'Discount',
  travelKm: 'Distance driven',
  // A half-filled priced line. Named as a thing rather than left to fall back
  // to the schema's "Name the line.", which is an instruction sitting in a
  // list of nouns.
  'devices.*.services.*.name': 'A name on every service line',
  'devices.*.parts.*.name': 'A name on every part line',
  'devices.*.services.*.priceDollars': 'Service line price',
  'devices.*.parts.*.priceDollars': 'Part line price',
};

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
 * Bill a repair, and correct one (Sales § Invoice, service businesses).
 *
 * ## One screen, two modes
 *
 * `/admin/invoices/create` raises a new invoice; `/admin/invoices/:number/edit`
 * loads an existing one into the same form. **The same component on purpose**:
 * the client asked for the edit screen to look like the new-invoice screen, and
 * the surest way to keep two screens identical is for there to be one of them.
 * A second component would drift the first time a field was added to either.
 *
 * The mode is `useParams().number`. Everything downstream branches on that -
 * the heading, the submit label, which mutation runs and where it navigates.
 *
 * **An edit posts the whole invoice**, not a patch: the server re-prices it
 * from the lines exactly as it prices a new one, so what you see on this form
 * is what the record becomes. What the form does NOT carry - the number, the
 * payments, what has been paid - is what an edit must not touch.
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

  /**
   * The customer this was opened for, from `?client=<id>`.
   *
   * The profile's "Invoice" button and `+ Create > Invoice` both land here
   * through the invoices list, which forwards the whole query string
   * (`useCreateRedirect`). Without reading it the staff member arrives at a
   * form that has forgotten which account they pressed the button on.
   */
  const [searchParams] = useSearchParams();
  const seededClient = searchParams.get('client') ?? '';

  /**
   * Present on `/admin/invoices/:number/edit`, absent on create.
   *
   * The one value the whole screen branches on. Read from the path rather than
   * a prop so the route table stays the only place the two URLs are named.
   */
  const { number: editingNumber } = useParams();
  const editing = Boolean(editingNumber);

  const { data: invoiceData, isLoading: loadingInvoice, error: loadError } =
    useAdminInvoice(editingNumber);
  const existing = invoiceData?.invoice;

  const { data: clientData } = useAdminUsers({ status: 'approved', limit: 500 });
  const { data: serviceData } = useAdminServices({ status: 'active', limit: 200 });
  const { data: inventoryData } = useAdminInventory({ limit: 500 });
  const { data: settingsData } = useAdminSettings();

  const { createInvoice, updateInvoice } = useAdminMutations();
  const saving = editing ? updateInvoice : createInvoice;

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

  const {
    register,
    control,
    handleSubmit,
    setValue,
    reset,
    clearErrors,
    formState: { errors },
  } = useAdminForm({
    resolver: INVOICE_RESOLVER,
    defaultValues: {
      user: seededClient,
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

  /**
   * Load the invoice into the form, once it arrives.
   *
   * **Money comes back in cents and the form works in dollars**, so every
   * price, the discount and the out-of-area fee are divided on the way in.
   * Getting this wrong does not fail - it silently multiplies the invoice by a
   * hundred - so the conversion lives here, in one place, rather than at each
   * field.
   *
   * Dates arrive as ISO timestamps and `<input type="date">` wants
   * `YYYY-MM-DD`; `slice(0, 10)` is that, and it takes the UTC day the server
   * stored rather than re-deriving a local one that can land a day earlier.
   *
   * An invoice with no devices - a flat charge, or one an order raised - seeds
   * one empty device block, because the form has no flat-amount field and an
   * empty repeater reads as a broken screen.
   */
  useEffect(() => {
    if (!existing) return;

    const toDollars = (cents) => (cents ?? 0) / 100;
    const line = (entry) => ({
      name: entry.name ?? '',
      description: entry.description ?? '',
      qty: entry.qty ?? 1,
      priceDollars: toDollars(entry.priceCents),
      product: entry.product ?? undefined,
    });

    const devices = (existing.devices ?? []).map((device) => ({
      category: device.category ?? '',
      brand: device.brand ?? '',
      series: device.series ?? '',
      model: device.model ?? '',
      serial: device.serial ?? '',
      passcode: '',
      problem: device.problem ?? '',
      solution: device.solution ?? '',
      notes: device.notes ?? '',
      services: (device.services ?? []).map(line),
      parts: (device.parts ?? []).map(line),
    }));

    reset({
      user: existing.userId ?? '',
      issuedAt: existing.issuedAt ? String(existing.issuedAt).slice(0, 10) : today(),
      dueDate: existing.dueDate ? String(existing.dueDate).slice(0, 10) : '',
      technician: existing.technician ?? '',
      serviceType: existing.serviceType ?? 'walk_in',
      devices: devices.length ? devices : [emptyDevice()],
      customerNotes: existing.customerNotes ?? '',
      technicianNotes: existing.technicianNotes ?? '',
      internalNotes: existing.internalNotes ?? '',
      travelKm: existing.travelKm || '',
      extendedServiceFee: Boolean(existing.extendedServiceFee),
      extendedServiceFeeDollars: existing.extendedServiceFee
        ? toDollars(existing.extendedServiceFeeCents)
        : '',
      discountDollars: toDollars(existing.discountCents),
      discountCode: existing.discountCode ?? '',
      province: existing.province ?? '',
      taxPercent: existing.taxPercent ?? 0,
    });
  }, [existing, reset]);

  const {
    fields: deviceFields,
    append: appendDevice,
    remove: removeDevice,
  } = useFieldArray({ control, name: 'devices' });

  const watched = useWatch({ control });
  const feeOn = Boolean(watched.extendedServiceFee);

  /**
   * Take the "add a service or part" message down once one has been added.
   *
   * `amount` is not a field on this form - the rule is about the lines - so
   * react-hook-form has nothing to revalidate when a line is typed, and
   * `reValidateMode: 'onChange'` only re-runs the fields that are already in
   * error. Without this the message survives the very edit that satisfies it,
   * still asking for a service the person has just entered.
   *
   * Only ever clears. Putting the error back is the resolver's job, on the
   * next submit, so a line emptied again is not re-flagged mid-typing.
   */
  const billable = (watched.devices ?? []).some((device) =>
    [...(device?.services ?? []), ...(device?.parts ?? [])].some((row) =>
      String(row?.name ?? '').trim() || String(row?.priceDollars ?? '').trim(),
    ),
  );

  useEffect(() => {
    if (billable && errors.amount) clearErrors('amount');
  }, [billable, errors.amount, clearErrors]);

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

    saving.mutate(
      {
        // Identifies the record on an edit; ignored by `createInvoice`, which
        // assigns the number itself.
        ...(editing ? { number: editingNumber } : {}),
        user: values.user,
        issuedAt: values.issuedAt || undefined,
        /**
         * Blank means "derive it from the terms", on both paths.
         *
         * Sent as `undefined` rather than `''`: the schema wants a calendar
         * date or nothing at all, and an empty string is neither. On an edit
         * that hands the server the same instruction a create gives it, so an
         * invoice whose due date is cleared here gets the terms' own date back
         * rather than keeping a date the form no longer shows.
         */
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
          // On an edit the number is already known and the response is the
          // updated record; on a create it is the number just assigned.
          const number = result?.invoice?.number ?? editingNumber;
          navigate(number ? `/admin/invoices/${number}` : '/admin/invoices');
        },
        onError: (error) => setSubmitError(error.message),
      },
    );
  }

  /**
   * An edit cannot render its form until the record is in hand.
   *
   * Showing the empty defaults first and filling them a tick later reads as an
   * invoice that has been blanked, and a staff member who starts typing into
   * that loses it to the `reset` below. The create path has nothing to wait
   * for and skips both of these.
   */
  if (editing && loadError) {
    return (
      <div className="record-page">
        <PageHeader icon={Receipt} title="Edit invoice" />
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {loadError.message}
        </p>
      </div>
    );
  }

  if (editing && (loadingInvoice || !existing)) {
    return (
      <div className="record-page space-y-4">
        <Skeleton className="h-16 w-72" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    /* Measured, not full-bleed - see `AdminTicketFormPage` for the argument.
       `.record-page` rather than `.form-page` because the device blocks and
       priced lines below are tables, which a 760px column would crush. */
    <div className="record-page">
      <PageHeader
        icon={Receipt}
        title={editing ? `Edit ${editingNumber}` : 'New invoice'}
        description={
          editing
            ? 'The invoice keeps its number and anything already paid against it. Everything else is re-priced from these lines on save.'
            : 'Bill a repair. The number is assigned on save.'
        }
        action={
          <Link
            to={editing ? `/admin/invoices/${editingNumber}` : '/admin/invoices'}
            className={cn(
              pressable,
              'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2',
            )}
          >
            <ArrowLeft className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {editing ? `Back to ${editingNumber}` : 'Back to invoices'}
          </Link>
        }
      />

      {submitError && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {submitError}
        </p>
      )}

      {/* `noValidate`: the browser's native bubble would refuse the submit
          before react-hook-form runs, one field at a time and unstyled, so the
          summary beside the button would never appear. See `TicketForm`. */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 pb-24" noValidate>
        <Section icon={Info} title="Basic information">
          <div className="grid gap-3 lg:grid-cols-4">
            <SelectField
              control={control}
              name="user"
              label="Customer"
              // An invoice is raised against somebody, so the schema requires
              // it on both paths - unlike the estimate, the customer stays
              // editable on an edit here.
              required
              // Searchable explicitly, not by row count: this is every approved
              // account and it grows with the business.
              searchable
              searchPlaceholder="Name, business or email…"
              options={[
                { value: '', label: '– Choose a customer –' },
                ...clients.map((client) => ({
                  value: client.id,
                  label: `${client.displayName}${client.email ? ` · ${client.email}` : ''}`,
                })),
              ]}
              onCreate={(typed) =>
                navigate(
                  `/admin/clients?new=1${typed ? `&name=${encodeURIComponent(typed)}` : ''}`,
                )
              }
              createLabelEmpty="Add a customer"
            />
            {/* No `size` or `h-9` here any more: the density context sets the
                height, and hand-sizing a field beside it is what let the two
                drift apart in the first place. */}
            <Input
              label="Invoice date"
              type="date"
              error={errors.issuedAt?.message}
              {...register('issuedAt')}
            />
            <Input
              label="Due date"
              type="date"
              hint="Leave blank to derive it from the terms."
              error={errors.dueDate?.message}
              {...register('dueDate')}
            />
            <SelectField
              control={control}
              name="serviceType"
              label="Service type"
              options={SERVICE_INVOICE_TYPES}
            />
          </div>

          <p className="mt-2 text-xs text-ink-400">
            No account yet?{' '}
            <Link to="/admin/clients?new=1" className="font-medium text-brand underline">
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

                {/* The stepped finder over the shop's own device tree - the
                    same control the ticket and the quote use. */}
                <DeviceFinder control={control} setValue={setValue} index={index} />

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Serial number"
                    placeholder="e.g. IMEI or S/N"
                    {...register(`devices.${index}.serial`)}
                  />
                  <Input
                    label="Passcode / PIN"
                    placeholder="For testing (optional)"
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
                  placeholder="0.00"
                  error={errors.discountDollars?.message}
                  {...register('discountDollars')}
                />
                <Input
                  label="Discount code"
                  placeholder="e.g. SUMMER10"
                  {...register('discountCode')}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  control={control}
                  name="province"
                  label="Province"
                  options={PROVINCE_OPTIONS}
                  // Picking a province fills the rate in. Without this the
                  // province read Ontario while the rate beside it still said
                  // 5%, and the invoice went out under-taxed. Editable after,
                  // because zero is a real answer for an exempt customer.
                  onValueChange={(value) => setValue('taxPercent', TAX_RATES[value] ?? 0)}
                />
                <Input
                  // "Tax", not "GST": this same field carries HST in Ontario
                  // and GST+QST in Quebec, and labelling all three GST names
                  // the tax wrongly on nine provinces out of thirteen.
                  label="Tax %"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  hint="0 means tax exempt"
                  placeholder="e.g. 5"
                  error={errors.taxPercent?.message}
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

        {/* What a refused submit is still waiting on, beside the button that
            refused it. The button stays pressable - see `MissingFields`. */}
        <MissingFields errors={errors} labels={INVOICE_FIELD_LABELS} />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            // Back to the invoice on an edit, not the list: it is the screen
            // the staff member came from and the one they want to check.
            onClick={() =>
              navigate(editing ? `/admin/invoices/${editingNumber}` : '/admin/invoices')
            }
          >
            Cancel
          </Button>
          <Button type="submit" loading={saving.isPending} icon={CheckCircle2}>
            {editing ? 'Save changes' : 'Create invoice'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default AdminServiceInvoiceFormPage;
