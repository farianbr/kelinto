import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  Car,
  Download,
  FileText,
  Info,
  Mail,
  Pencil,
  Plus,
  Receipt,
  Smartphone,
  RotateCcw,
  StickyNote,
  Tag,
  Trash2,
  Wallet,
} from 'lucide-react';
import { money, date, count as formatCount, titleize } from '@/lib/format';
import { apiUrl } from '@/lib/api';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import SelectMenu from '@/components/ui/SelectMenu';
import PageHeader from '@/components/admin/PageHeader';
import BadgeExplainer from '@/components/admin/BadgeExplainer';
import { TERMS } from '@/components/admin/ApproveClientForm';
import { Section, DeviceBlock } from '@/components/admin/DeviceLines';

import { TAX_RATES, INVOICE_SERVICE_TYPES, invoicePaymentSchema, provinceTaxOptions } from '@shared/schemas/admin';
import KpiRow from '@/components/admin/KpiRow';
import FilterStrip from '@/components/admin/FilterStrip';
import BulkBar from '@/components/admin/BulkBar';
import useAuth from '@/hooks/useAuth';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import {
  useAdminInvoices,
  useAdminUsers,
  useAdminTickets,
  useAdminInvoiceLabels,
  useAdminMutations,
} from '@/hooks/useAdmin';
import useCreateParam from '@/hooks/useCreateParam';
import useCreateRedirect from '@/hooks/useCreateRedirect';
import downloadExport from '@/lib/exportDownload';
import cn from '@/lib/cn';
import { toast } from '@/store/toastStore';

/** Provinces, each carrying its tax name and rate. See `provinceTaxOptions`. */
const PROVINCE_OPTIONS = provinceTaxOptions();

/** A device as the invoice form starts it - no condition grid, that is intake. */
const emptyInvoiceDevice = () => ({
  category: '',
  brand: '',
  series: '',
  model: '',
  serial: '',
  problem: '',
  solution: '',
  notes: '',
  services: [],
  parts: [],
});

/**
 * The running total, in the order the server applies it.
 *
 * A preview, recomputed on every keystroke, and deliberately mirroring
 * `invoiceTotals()` step for step - lines, then the fee, then the discount,
 * then tax on what is left. Two different orders of operation between the form
 * and the server is how a staff member quotes one number and the customer receives
 * another.
 */
function useInvoiceTotal(control) {
  const devices = useWatch({ control, name: 'devices' }) ?? [];
  const taxPercent = Number(useWatch({ control, name: 'taxPercent' }) ?? 0) || 0;
  const discount = Number(useWatch({ control, name: 'discountDollars' }) ?? 0) || 0;
  const chargeFee = useWatch({ control, name: 'extendedServiceFee' });
  const feeDollars = Number(useWatch({ control, name: 'extendedServiceFeeDollars' }) ?? 0) || 0;

  const lineCents = devices.reduce((sum, device) => {
    const lines = [...(device?.services ?? []), ...(device?.parts ?? [])];
    return (
      sum +
      lines.reduce(
        (n, line) =>
          n + Math.round((Number(line?.priceDollars) || 0) * 100) * Math.max(1, Number(line?.qty) || 1),
        0,
      )
    );
  }, 0);

  const feeCents = chargeFee ? Math.round(feeDollars * 100) : 0;
  const subtotalCents = lineCents + feeCents;
  // Clamped exactly as the server clamps it: a discount cannot exceed the work.
  const discountCents = Math.min(Math.round(discount * 100), subtotalCents);
  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round((taxableCents * taxPercent) / 100);

  return {
    lineCents,
    feeCents,
    discountCents,
    taxPercent,
    taxCents,
    totalCents: taxableCents + taxCents,
  };
}

/**
 * Header metadata read from the same table the breadcrumb uses, so a page
 * title can never drift from its crumb.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/invoices'], icon: adminIcon('FileText') };

/**
 * `overdue` is derived from the due date rather than stored, so it sits
 * alongside the real statuses as a filter without ever being written to a row.
 * The dashboard links straight here with `?status=overdue`.
 */
const PILLS = [
  { value: 'all', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
];

const STATUS_TONES = { paid: 'ok', partial: 'warn', unpaid: 'neutral', overdue: 'danger' };

/**
 * The manual status pill, tinted by the token the admin chose for it.
 *
 * A separate map from `STATUS_TONES` above, and deliberately so: that one is
 * payment state, which the shop does not get to colour. These are the shop's
 * own words and its own choice of six semantic tints (§2b).
 */
const LABEL_PILL = {
  ink: 'bg-surface-2 text-ink-600',
  brand: 'bg-brand-50 text-brand-700',
  info: 'bg-info-50 text-info',
  ok: 'bg-ok-50 text-ok',
  warn: 'bg-warn-50 text-warn',
  danger: 'bg-danger-50 text-danger',
};

const METHODS = [
  { value: 'e-transfer', label: 'e-Transfer' },
  { value: 'bank-transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'credit-card', label: 'Credit card' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

/** `YYYY-MM-DD` in local time - `toISOString()` would shift the day westward. */
function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Record a payment.
 *
 * The form sends an amount, a date, a method and a reference. It never sends a
 * status or a running total: the server recomputes `amountPaid` and the status
 * from the payment rows, which is the only way the header can be trusted to
 * agree with the rows beneath it.
 */
function PaymentForm({ invoice, onSubmit, onCancel, isPending, error }) {
  const outstanding = invoice.balance;
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useAdminForm({
    // The same schema the route validates against - it takes dollars, so it
    // describes this form exactly.
    resolver: zodResolver(invoicePaymentSchema),
    defaultValues: {
      amountDollars: (outstanding / 100).toFixed(2),
      at: todayIso(),
      method: 'e-transfer',
      reference: '',
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="rounded-md bg-surface-2 p-3.5">
        <p className="font-mono text-sm font-medium text-ink-900">{invoice.number}</p>
        <p className="mt-0.5 text-sm text-ink-500">{invoice.displayName ?? invoice.businessName}</p>
        <p className="tnum mt-1.5 text-sm text-ink-500">
          {money(invoice.amount)} invoiced · {money(invoice.amountPaid)} paid ·{' '}
          <span className="font-medium text-ink-900">{money(outstanding)} outstanding</span>
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
          label="Amount"
          inputMode="decimal"
          suffix="CAD"
          placeholder="0.00"
          required
          error={errors.amountDollars?.message}
          {...register('amountDollars')}
        />
        <Input label="Received on" type="date" max={todayIso()} {...register('at')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField control={control} name="method" label="Method" options={METHODS} />
        <Input label="Reference" placeholder="Cheque no. or transfer id" {...register('reference')} />
      </div>

      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
        The invoice status is recalculated from its payments - record the amount received, not the
        new balance.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending} disabled={outstanding <= 0}>
          Record payment
        </Button>
      </div>
    </form>
  );
}

/**
 * A standalone invoice - one raised against an account for something no order
 * covers: a restocking fee, a repair, an agreed adjustment (§7.2).
 *
 * **Two documents share this form, and the staff member picks which by what they
 * type.** Leave the devices alone and it is a flat charge: one amount, a
 * reference saying what for. Add a device and it becomes an itemised repair
 * invoice - services, parts, tax and a computed total. The server decides the
 * same way (`isItemised`), so the form and the API cannot disagree about which
 * kind of document was just raised.
 *
 * The flat path stays first and stays cheap because most standalone invoices
 * genuinely are one number, and making somebody open a device panel to type it
 * would be a worse form than the one this replaces.
 *
 * **Every figure here is a preview.** The running total exists so the counter
 * can quote while the customer is standing there; the amount that gets stored
 * is recomputed server-side from the same lines. PROJECT_INSTRUCTIONS is
 * explicit that the client never sends a price it wants honoured.
 *
 * **A blank due date is not empty, it is "use the terms".** The hint says so,
 * because a date field that silently fills itself in after submission looks
 * like the form ignored what was typed.
 */
function InvoiceForm({ clients, technicians = [], defaultUser, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, control, watch, setValue } = useAdminForm({
    defaultValues: {
      // `defaultUser` is how the customer profile raises an invoice against the
      // account already on screen (`?new=1&client=<id>`): it pre-picks the
      // customer instead of forking a second, near-identical form that would
      // eventually disagree with this one about terms or due dates.
      user: defaultUser ?? clients[0]?.id ?? '',
      amountDollars: '',
      terms: 'prepaid',
      issuedAt: todayIso(),
      dueDate: '',
      reference: '',
      notes: '',

      serviceType: 'walk_in',
      technician: '',
      devices: [],

      province: '',
      taxPercent: 0,
      discountDollars: '',
      discountCode: '',

      travelKm: '',
      extendedServiceFee: false,
      extendedServiceFeeDollars: '',

      customerNotes: '',
      technicianNotes: '',
      internalNotes: '',
    },
  });

  const terms = watch('terms');
  const devices = useFieldArray({ control, name: 'devices' });

  // Which document this is. Adding a device is the gesture that switches it,
  // so the summary and the amount field follow that rather than a mode toggle
  // the staff member would have to find and understand first.
  const itemised = devices.fields.length > 0;

  const totals = useInvoiceTotal(control);

  return (
    <form
      onSubmit={handleSubmit((values) => {
        const lines = (values.devices ?? []).map((device) => ({
          ...device,
          services: (device.services ?? []).filter((line) => line.name?.trim()),
          parts: (device.parts ?? []).filter((line) => line.name?.trim()),
        }));

        onSubmit({
          user: values.user,
          // Sent only on the flat path. On the itemised one the server bills
          // the lines and ignores whatever this says.
          amount: itemised ? undefined : Math.round(Number(values.amountDollars || 0) * 100),
          terms: values.terms,
          issuedAt: values.issuedAt || undefined,
          dueDate: values.dueDate || undefined,
          reference: values.reference || undefined,
          notes: values.notes || undefined,

          devices: lines,
          serviceType: values.serviceType,
          technician: values.technician || undefined,

          province: values.province || undefined,
          taxPercent: Number(values.taxPercent || 0),
          discountDollars: Number(values.discountDollars || 0),
          discountCode: values.discountCode || undefined,

          travelKm: Number(values.travelKm || 0),
          extendedServiceFee: Boolean(values.extendedServiceFee),
          extendedServiceFeeDollars: Number(values.extendedServiceFeeDollars || 0),

          customerNotes: values.customerNotes || undefined,
          technicianNotes: values.technicianNotes || undefined,
          internalNotes: values.internalNotes || undefined,
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

      <Section icon={Info} title="Basic information">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            control={control}
            name="user"
            label="Customer"
            options={clients.map((client) => ({
              value: client.id,
              label: client.displayName ?? client.businessName,
            }))}
          />
          <Input label="Issued" type="date" {...register('issuedAt')} />
          <Input
            label="Due"
            type="date"
            hint={terms === 'prepaid' ? 'Blank means on issue.' : `Blank uses ${terms}.`}
            {...register('dueDate')}
          />
          <SelectField control={control} name="terms" label="Payment terms" options={TERMS} />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SelectField
            control={control}
            name="serviceType"
            label="Service type"
            options={INVOICE_SERVICE_TYPES}
          />
          <SelectField
            control={control}
            name="technician"
            label="Technician"
            options={[
              { value: '', label: 'Unassigned' },
              ...technicians.map((person) => ({
                value: person.id,
                label: person.displayName ?? person.contactName ?? person.email,
              })),
            ]}
          />
        </div>

        <Input
          label="Reference"
          className="mt-3"
          placeholder="Restocking fee, workshop repair, agreed adjustment…"
          hint="What this invoice is for. It is what a statement shows beside the number."
          {...register('reference')}
        />
      </Section>

      {/* The flat amount, and it disappears the moment there is a device.
          Two ways to state the same total on one form is how an invoice ends
          up billing a figure nobody meant. */}
      {!itemised && (
        <Section icon={Wallet} title="Amount">
          <Input
            label="Amount"
            inputMode="decimal"
            suffix="CAD"
            hint="Or add a device below to bill by service and part instead."
            {...register('amountDollars')}
          />
        </Section>
      )}

      <Section
        icon={Smartphone}
        title="Devices and services"
        hint={itemised ? undefined : '(optional - for a repair invoice)'}
      >
        {devices.fields.length === 0 ? (
          <p className="text-sm text-ink-500">
            Nothing itemised. Add a device to bill for services and parts, and the amount above
            gives way to a calculated total.
          </p>
        ) : (
          <div className="space-y-3">
            {devices.fields.map((field, index) => (
              <DeviceBlock
                key={field.id}
                control={control}
                register={register}
                setValue={setValue}
                index={index}
                variant="invoice"
                canRemove
                onRemove={() => devices.remove(index)}
              />
            ))}
          </div>
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          icon={Plus}
          className="mt-3"
          onClick={() => devices.append(emptyInvoiceDevice())}
        >
          Add device
        </Button>
      </Section>

      <Section icon={StickyNote} title="Notes">
        <div className="grid gap-3 lg:grid-cols-2">
          <Textarea
            label="Customer notes"
            rows={2}
            hint="Printed on the invoice."
            {...register('customerNotes')}
          />
          <Textarea
            label="Technician notes"
            rows={2}
            hint="Printed on the invoice."
            {...register('technicianNotes')}
          />
        </div>

        {/* Visually separated because the difference is the whole point: one of
            these three reaches the customer and two do not. */}
        <div className="mt-3 rounded-md border border-warn/30 bg-warn-50/50 p-3">
          <Textarea
            label="Internal notes"
            rows={2}
            hint="Never printed, and never shown to the customer."
            {...register('internalNotes')}
          />
        </div>

        <Textarea label="Reference notes" rows={2} className="mt-3" {...register('notes')} />
      </Section>

      {itemised && (
        <>
          <Section icon={Car} title="Travel" hint="(internal - not on the invoice)">
            <p className="mb-3 rounded-md bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-500">
              Mileage is recorded for the business and is <strong>not</strong> added to what the
              customer owes. The extended service area fee, if charged, is.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Total km travelled"
                inputMode="decimal"
                placeholder="e.g. 45"
                hint="Internal only."
                {...register('travelKm')}
              />
              <Input
                label="Extended service area fee"
                inputMode="decimal"
                suffix="CAD"
                placeholder="0.00"
                hint="Charged only when the box below is ticked."
                {...register('extendedServiceFeeDollars')}
              />
            </div>

            <Checkbox
              className="mt-3"
              label="Charge the extended service area fee"
              {...register('extendedServiceFee')}
            />
          </Section>

          <Section icon={Receipt} title="Invoice summary">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Discount"
                inputMode="decimal"
                suffix="CAD"
                placeholder="0.00"
                {...register('discountDollars')}
              />
              <Input label="Discount code" placeholder="e.g. SUMMER10" {...register('discountCode')} />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SelectField
                control={control}
                name="province"
                label="Province"
                // Each option names its tax and rate, so the list says what is
                // being charged rather than leaving the reader to remember
                // which provinces are harmonised.
                options={PROVINCE_OPTIONS}
                // Picking a province fills the rate in; the rate stays editable
                // because zero is a real answer for an exempt customer.
                onValueChange={(value) => setValue('taxPercent', TAX_RATES[value] ?? 0)}
              />
              <Input
                label="Tax rate"
                inputMode="decimal"
                suffix="%"
                hint="0 is tax exempt."
                {...register('taxPercent')}
              />
            </div>

            {/* The arithmetic, shown in the order the server applies it. A
                staff member who can see the steps can spot the wrong one. */}
            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
              <TotalRow label="Services and parts" value={money(totals.lineCents)} />
              {totals.feeCents > 0 && (
                <TotalRow label="Extended service area fee" value={money(totals.feeCents)} />
              )}
              {totals.discountCents > 0 && (
                <TotalRow label="Discount" value={`− ${money(totals.discountCents)}`} />
              )}
              <TotalRow
                label={`Tax${totals.taxPercent ? ` (${totals.taxPercent}%)` : ''}`}
                value={money(totals.taxCents)}
              />
              <div className="flex items-baseline justify-between border-t border-line pt-2 font-display text-md font-bold text-ink-900">
                <dt>Total</dt>
                <dd className="tnum">{money(totals.totalCents)}</dd>
              </div>
            </dl>

            <p className="mt-2 text-2xs text-ink-400">
              Recalculated by the server when this is raised - this figure is a preview.
            </p>
          </Section>
        </>
      )}

      {terms !== 'prepaid' && (
        <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm text-ink-500">
          On terms, this draws on the customer's line of credit until it is paid - the same as an
          invoice raised by an order.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Raise invoice
        </Button>
      </div>
    </form>
  );
}

/** One line of the summary. Label left, figure right, tabular so they line up. */
function TotalRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between text-ink-600">
      <dt>{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}

export function AdminInvoicesPage() {
  const [query, setQuery] = useState('');
  const [paying, setPaying] = useState(null);
  const [selected, setSelected] = useState([]);

  // `sales.services` is on exactly when the business sells labour - the same
  // test the quotes list branches on.
  const { features } = useAuth();
  const isService = Boolean(features?.['sales.services']);
  // The invoice awaiting a typed number before it is destroyed.
  const [deleting, setDeleting] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Opened directly by `+ Create` (§7.2), which arrives with `?new=1`.
  // `client` seeds the form when the customer profile sends us here to raise
  // an invoice against the account already on screen.
  //
  // On a service business the create screen is a full page, so the flag is
  // forwarded to it instead of opening a modal this branch does not use.
  const redirecting = useCreateRedirect(isService ? '/admin/invoices/create' : null);
  const [rawCreating, setCreating, createSeed] = useCreateParam(true, false, ['client']);

  /**
   * Whether we yet know which kind of business this is.
   *
   * `features` is `null` until `/auth/me` resolves, so on a FRESH load of
   * `/admin/invoices?new=1` - which is exactly what `+ Create > Invoice` does
   * from another page - `isService` was false for the first render or two.
   * The redirect was therefore armed with `null`, the modal opened, and only
   * then did the features arrive. That is the "it opens the modal again" from
   * the customer page: the flag was right and the answer had not loaded.
   *
   * So the modal waits for the answer rather than assuming wholesale. Waiting
   * costs one paint of the list behind it; assuming costs the wrong form.
   */
  const knowsBusinessKind = features !== null;

  /**
   * The modal, suppressed while a redirect is on its way.
   *
   * `useCreateParam` reads `?new=1` in its initialiser, so `creating` is true
   * on the FIRST render - before any effect, including the redirect's, has
   * run. Without this the service business paints the modal for a frame and
   * then navigates away from underneath it, which is the "it still opens the
   * modal" this was meant to fix. Gating on render rather than in the effect
   * is what keeps that frame from ever existing.
   *
   * It also waits for `features`: until those load we do not know whether this
   * business wants the modal or the page, and opening one to find out is the
   * bug above.
   *
   * **And `isService` is the last word.** The gates above are about timing -
   * whether a redirect is owed, whether the features have landed - and each of
   * them fails open once it resolves. A service business must never reach this
   * modal by ANY route: not the create menu, not the customer profile's "New
   * invoice", not a bookmarked `?new=1`, not a redirect that lost a race. This
   * is the one that does not depend on when it is asked.
   */
  const creating = isService || redirecting || !knowsBusinessKind ? false : rawCreating;

  const status = searchParams.get('status') ?? 'all';

  const { data, isLoading } = useAdminInvoices({ status, q: query || undefined });
  // Any client can be invoiced - unlike an order, this does not need approval:
  // a pending account can still owe money for a repair.
  const { data: clientData } = useAdminUsers({});
  const { recordInvoicePayment, createInvoice, setInvoiceLabel, deleteInvoice } =
    useAdminMutations();

  // Active only: offering a retired status in a picker is how it gets put back
  // on an invoice. The settings screen is the one place that passes `all`.
  const { data: labelData } = useAdminInvoiceLabels();

  /**
   * The status change waiting to be confirmed: `{ invoice, label }`.
   *
   * `label` is null for "no status". Confirmed for the same reason a ticket
   * status is: one of these emails the customer their warranty, and picking the
   * wrong row from a menu would send it to somebody who did not ask.
   */
  const [statusMove, setStatusMove] = useState(null);
  const labels = labelData?.labels ?? [];

  const clients = clientData?.users ?? [];

  // The tickets list already returns the technicians, and it is not admin-only
  // the way `useAdminStaff` is - a staff account with invoice permission has to
  // be able to assign one. Same source the ticket form uses, for the same
  // reason: a second endpoint whose only caller is this screen earns nothing.
  const { data: ticketData } = useAdminTickets({ status: 'all', limit: 1 });
  const technicians = ticketData?.technicians ?? [];

  const invoices = data?.invoices ?? [];

  // The KPI tiles are summed from the whole filtered set; the table gets a
  // page of it. See `useTablePage` for why paging is client-side.
  const { pageRows: pageInvoices, page, totalPages, from, setPage } = useTablePage(invoices);
  const counts = data?.counts ?? {};
  const totals = data?.totals ?? {};

  function setStatus(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  }

  const columns = [
    {
      key: 'number',
      header: 'Invoice',
      priority: 1,
      render: (invoice) => (
        <>
          <span className="block whitespace-nowrap font-mono text-sm font-medium text-ink-900">
            {invoice.number}
          </span>
          {invoice.orderNumber && (
            <span className="block whitespace-nowrap text-2xs text-ink-400">
              {invoice.orderNumber}
            </span>
          )}
        </>
      ),
    },
    {
      // The account's name is the person's (§0); `businessName` renders blank
      // for a sole trader.
      key: 'displayName',
      header: 'Customer',
      priority: 2,
      className: 'max-w-[180px] truncate',
    },
    {
      key: 'issuedAt',
      header: 'Issued',
      priority: 3,
      render: (invoice) => (
        <span className="text-sm text-ink-500">{date(invoice.issuedAt)}</span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      priority: 2,
      render: (invoice) =>
        invoice.dueDate ? (
          <span
            className={`text-sm ${invoice.status === 'overdue' ? 'font-medium text-danger' : 'text-ink-500'}`}
          >
            {date(invoice.dueDate)}
          </span>
        ) : (
          <span className="text-xs text-ink-300">-</span>
        ),
    },
    /**
     * Terms for a wholesaler, service type for a repair shop.
     *
     * One slot, because they answer the same question in the two businesses:
     * how this sale works. Credit terms are meaningless on a walk-in repair
     * paid at the counter, and "Pick-up & Drop-off" is meaningless to a parts
     * wholesaler who ships every order.
     */
    isService
      ? {
          key: 'serviceType',
          header: 'Service type',
          priority: 2,
          render: (invoice) =>
            invoice.serviceType ? (
              <span className="text-sm text-ink-500">
                {INVOICE_SERVICE_TYPES.find((entry) => entry.value === invoice.serviceType)
                  ?.label ?? titleize(invoice.serviceType)}
              </span>
            ) : (
              <span className="text-xs text-ink-300">–</span>
            ),
        }
      : {
          key: 'terms',
          header: 'Terms',
          priority: 3,
          render: (invoice) => (
            <span className="text-sm text-ink-500">
              {invoice.terms.replace('net', 'Net ')}
            </span>
          ),
        },
    {
      key: 'status',
      header: 'Payment',
      priority: 1,
      // Headed "Payment", not "Status": the column beside it is also a status,
      // and two columns both called Status is a table nobody can read twice.
      render: (invoice) => (
        <Badge tone={STATUS_TONES[invoice.status]} size="sm">
          {invoice.status === 'partial' ? 'partly paid' : invoice.status}
        </Badge>
      ),
    },
    {
      key: 'label',
      // "Status", not "Manual status": the qualifier was there to tell it apart
      // from the payment column, which now says "Payment" and does that itself.
      // A staff member does not think of it as manual, they think of it as the
      // status - the other one is whether the money arrived.
      header: 'Status',
      priority: 2,
      /**
       * The status an admin sets, which is NOT the payment status beside it.
       *
       * A picker rather than a badge, because setting one is the whole point and
       * a staff member should not have to open the invoice to do it. Built like
       * the ticket list's status pill: no border, the tint carries the meaning,
       * and a chevron to say it opens.
       */
      render: (invoice) => {
        // Nothing to pick from yet. A dead control would read as broken, so the
        // cell says where the list is made instead.
        if (labels.length === 0) {
          return <span className="text-xs text-ink-300">–</span>;
        }

        return (
          /* The guard is the control, not the cell - the empty space beside a
             short status still falls through and opens the invoice, the way
             every other cell in the row does. */
          <div className="inline-flex" onClick={(event) => event.stopPropagation()}>
            <SelectMenu
              srLabel={`Status for ${invoice.number}`}
              value={invoice.label?.id ?? ''}
              options={[
                { value: '', label: 'No status' },
                ...labels.map((label) => ({
                  value: label.id,
                  label: label.sendsWarrantyEmail ? `${label.name} (emails)` : label.name,
                })),
              ]}
              align="left"
              buttonClassName={cn(
                'h-7 w-auto gap-1 rounded-full border-0 px-2.5 text-xs font-semibold',
                'hover:border-0 focus:border-0 focus:ring-1',
                invoice.label
                  ? (LABEL_PILL[invoice.label.colorToken] ?? LABEL_PILL.ink)
                  : 'bg-transparent text-ink-400',
              )}
              menuTitle="Set the manual status"
              /* The consequence the list cannot show. One of these statuses can
                 email the customer, and a menu that looks like it only edits a
                 field is one somebody uses to tidy a board at midnight. */
              menuFootnote={
                <>
                  <Mail className="mt-px size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span>
                    A status marked “emails” sends the warranty and review email once, and only
                    on a paid invoice.
                  </span>
                </>
              }
              onChange={(next) => {
                const current = invoice.label?.id ?? '';
                if (next === current) return;
                setStatusMove({
                  invoice,
                  label: labels.find((entry) => entry.id === next) ?? null,
                });
              }}
            />
          </div>
        );
      },
    },
    {
      /**
       * The invoice total, with what is still owed underneath it.
       *
       * The two were the other way round - balance in the large type, total in
       * the small. The total is the figure the invoice IS, the one read out on
       * the phone and matched against a customer's own copy, so it leads. The
       * balance is a state that changes as payments land, which is what the
       * Payment column beside it already says in words.
       *
       * A settled invoice says so in words rather than showing "$0.00": a
       * column of zeroes is a column nobody reads, and "Paid in full" is the
       * fact anyway.
       */
      key: 'amount',
      header: 'Amount',
      priority: 1,
      align: 'right',
      className: 'tnum',
      render: (invoice) => (
        <>
          <span className="text-sm font-medium text-ink-900">{money(invoice.amount)}</span>
          {invoice.balance > 0 ? (
            <span className="block text-2xs text-ink-400">
              {money(invoice.balance)} due
            </span>
          ) : (
            <span className="block text-2xs text-ok">Paid in full</span>
          )}
        </>
      ),
    },
  ];

  /**
   * `false` entries are dropped at the end, which is how an entry that only
   * exists on one kind of business is expressed - the row menu takes a plain
   * array and has no notion of a hidden item.
   */
  const rowMenu = [
    {
      key: 'pay',
      label: 'Record payment',
      icon: Wallet,
      disabled: (invoice) => invoice.balance <= 0,
      onSelect: setPaying,
    },
    /**
     * The full edit form, at any status (ruled 2026-09-21).
     *
     * Service businesses only: a wholesale invoice is raised in a modal over
     * this list and has no full-page form to send anybody to, so a wholesaler
     * correcting what was billed there means deleting and raising again.
     */
    isService && {
      key: 'edit',
      label: 'Edit invoice',
      icon: Pencil,
      onSelect: (invoice) => navigate(`/admin/invoices/${invoice.number}/edit`),
    },
    {
      key: 'document',
      label: 'Open document',
      icon: Download,
      // Rendered by the same renderer as the buyer's copy, so what an admin
      // reads over the phone is exactly what the customer is looking at.
      onSelect: (invoice) =>
        window.open(apiUrl(`/admin/invoices/${invoice.number}/document`), '_blank', 'noopener'),
    },
    {
      /**
       * Opens the invoice rather than refunding from here.
       *
       * A refund needs an amount, a destination and a reason - it is a form, not
       * a click - and the form already exists on the detail page. Duplicating it
       * into this list would be a second place for the cap and the
       * cash-versus-credit copy to drift out of step, on the screen where a
       * staff member is moving fastest and reading least.
       */
      key: 'refund',
      label: 'Refund…',
      icon: RotateCcw,
      disabled: (invoice) => (invoice.refundableCents ?? 0) <= 0,
      onSelect: (invoice) => navigate(`/admin/invoices/${invoice.number}?refund=1`),
    },
    {
      /**
       * Deleting, at any status (ruled 2026-09-21).
       *
       * **The payments go with it.** An invoice is the only record that its
       * payments were applied to anything, so deleting it and keeping them
       * would leave money recorded against nothing. They are removed with the
       * invoice and the customer's balance is put back, which the confirm
       * states in full before the staff member types the number.
       */
      key: 'delete',
      label: 'Delete invoice',
      icon: Trash2,
      tone: 'danger',
      onSelect: setDeleting,
    },
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          /**
           * A service business gets the full page; a wholesaler keeps the modal.
           *
           * The RECORD is one collection either way - `Invoice` is the money
           * record that payments, credit and every report read, and splitting it
           * would mean fifty call sites querying two. What differs is the form: a
           * repair carries devices, services, parts and travel, which is more
           * than a dialog holds without scrolling past what it is asking about.
           */
          isService ? (
            <Button onClick={() => navigate('/admin/invoices/create')} icon={Plus}>
              New invoice
            </Button>
          ) : (
            <Button onClick={() => setCreating(true)} icon={Plus} disabled={!clients.length}>
              New invoice
            </Button>
          )
        }
      />

      <BadgeExplainer />

      <KpiRow
        tiles={[
          {
            key: 'billed',
            label: 'Invoiced',
            value: money(totals.billed ?? 0),
            hint: `${formatCount(invoices.length)} shown`,
            tone: 'brand',
            icon: Receipt,
          },
          {
            key: 'paid',
            label: 'Paid',
            value: money(totals.paid ?? 0),
            hint: 'Received against these invoices',
            tone: 'ok',
            icon: Wallet,
          },
          {
            key: 'outstanding',
            label: 'Outstanding',
            value: money(totals.outstanding ?? 0),
            hint: 'Still owed on these invoices',
            tone: (totals.outstanding ?? 0) > 0 ? 'warn' : 'ok',
            icon: FileText,
          },
          {
            key: 'overdue',
            label: 'Overdue',
            value: formatCount(counts.overdue ?? 0),
            hint: 'Past their due date, unpaid',
            tone: (counts.overdue ?? 0) > 0 ? 'danger' : 'ok',
            icon: AlertCircle,
          },
        ]}
      />

      <Panel flush>
        <FilterStrip
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Invoice number, business or email…"
          pills={PILLS.map((pill) => ({ ...pill, count: counts[pill.value] }))}
          activePill={status}
          onPillChange={setStatus}
          onExport={(format) => downloadExport('invoices', format, { status, q: query || undefined })}
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={invoices.length}
            shown={pageInvoices.length}
            from={from}
            noun={invoices.length === 1 ? 'invoice' : 'invoices'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={pageInvoices}
          rowKey={(invoice) => invoice.number}
          selectable
          selected={selected}
          onSelectionChange={setSelected}
          // The row opens the invoice, the same way it already does on a
          // customer's profile. A table of invoice numbers whose rows are inert
          // teaches the staff member to hunt for the menu instead.
          onRowClick={(invoice) => navigate(`/admin/invoices/${invoice.number}`)}
          rowMenu={rowMenu}
          loading={isLoading}
          defaultSort={{ key: 'issuedAt', direction: 'desc' }}
          empty={
            <PanelEmpty
              icon={FileText}
              title="No invoices match"
              body="Try a different filter or search."
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

      {/*
        Export, and only export.

        **Neither of the other two row actions batches.** Recording a payment
        needs an amount per invoice and deleting destroys a record and its
        payments, so a bulk version of either would be answering a question on
        the staff member's behalf about money. Export asks nothing, and pulling
        a chosen set into a spreadsheet is the thing an accounts person
        actually reaches for.
      */}
      <BulkBar count={selected.length} noun="selected" onClear={() => setSelected([])}>
        <Button
          size="xs"
          variant="outline"
          icon={Download}
          onClick={() => downloadExport('invoices', 'csv', { numbers: selected.join(',') })}
        >
          Export CSV
        </Button>
        <Button
          size="xs"
          variant="outline"
          icon={Download}
          onClick={() => downloadExport('invoices', 'xlsx', { numbers: selected.join(',') })}
        >
          Export Excel
        </Button>
      </BulkBar>

      <Modal
        open={Boolean(paying)}
        onClose={() => setPaying(null)}
        title="Record a payment"
        size="md"
        align="top"
      >
        {paying && (
          <PaymentForm
            invoice={paying}
            isPending={recordInvoicePayment.isPending}
            error={recordInvoicePayment.error?.message}
            onCancel={() => setPaying(null)}
            onSubmit={(values) =>
              recordInvoicePayment.mutate(
                { number: paying.number, ...values },
                { onSuccess: () => setPaying(null) },
              )
            }
          />
        )}
      </Modal>

      {/* Confirms, like a ticket status change and for the same reason: one of
          these statuses emails the customer their warranty, and a picker in a
          table row is clicked on the wrong line eventually.

          `tone="info"` - it is reversible and moves no money. Red on an ordinary
          move teaches staff to click through reds. */}
      <ConfirmDialog
        open={Boolean(statusMove)}
        onClose={() => setStatusMove(null)}
        tone="info"
        heading="Change status?"
        title={
          statusMove ? (
            <>
              {statusMove.label ? (
                <>
                  Set <strong className="font-semibold text-ink-900">{statusMove.invoice.number}</strong>{' '}
                  to{' '}
                  <strong className="font-semibold text-ink-900">{statusMove.label.name}</strong>?
                </>
              ) : (
                <>
                  Clear the status on{' '}
                  <strong className="font-semibold text-ink-900">{statusMove.invoice.number}</strong>?
                </>
              )}
            </>
          ) : (
            ''
          )
        }
        body={
          statusMove?.label?.sendsWarrantyEmail ? (
            <p className="flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm text-warn">
              <Mail className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>
                {statusMove.invoice.status === 'paid' && !statusMove.invoice.labelEmailSentAt
                  ? 'This emails the customer their warranty and a review link. It sends once per invoice.'
                  : statusMove.invoice.labelEmailSentAt
                    ? 'The warranty email has already gone for this invoice, so it will not send again.'
                    : 'The warranty email sends only on a paid invoice, so nothing will be sent yet.'}
              </span>
            </p>
          ) : (
            'This is where the invoice has got to with the customer. It moves no money and changes no balance.'
          )
        }
        confirmLabel="Confirm change"
        loading={setInvoiceLabel.isPending}
        error={setInvoiceLabel.error?.message}
        onConfirm={() =>
          setInvoiceLabel.mutate(
            {
              number: statusMove.invoice.number,
              labelId: statusMove.label?.id ?? null,
            },
            {
              onSuccess: (result) => {
                setStatusMove(null);
                // Whether the email actually went is the half the screen cannot
                // work out for itself.
                if (result?.emailed) {
                  toast.ok('Warranty email sent', `${result.labelName} is set, and the customer has their warranty.`);
                }
              },
            },
          )
        }
      />
      {/*
        Deleting, and saying exactly what goes with it.

        **The payments are named and counted.** They are destroyed with the
        invoice and nothing is refunded, so this is the last screen on which
        that money is mentioned anywhere - a staff member who reads "delete"
        and assumes the payment survives somewhere else is the failure this
        copy exists to prevent. `critical`, so the number has to be typed.
      */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleteInvoice.mutate(
            { number: deleting.number },
            {
              onSuccess: (payload) => {
                setDeleting(null);
                toast.ok(
                  'Invoice deleted',
                  payload?.deletedPayments
                    ? `${deleting.number} is gone, along with ${formatCount(payload.deletedPayments)} payment${payload.deletedPayments === 1 ? '' : 's'} recorded against it.`
                    : `${deleting.number} is gone.`,
                );
              },
            },
          )
        }
        title={`Delete ${deleting?.number}?`}
        body={
          deleting
            ? `The invoice for ${deleting.displayName ?? deleting.businessName} is destroyed and leaves no document behind.${
                (deleting.amountPaid ?? 0) > 0
                  ? ` The ${money(deleting.amountPaid)} recorded as paid against it is deleted with it and is NOT refunded - if the customer is owed that money back, refund the invoice first.`
                  : ''
              } This cannot be undone.`
            : ''
        }
        tone="critical"
        confirmPhrase={deleting?.number}
        confirmPhraseLabel="the invoice number"
        confirmLabel="Delete invoice"
        loading={deleteInvoice.isPending}
        error={deleteInvoice.error?.message}
      />

      <Modal
        open={Boolean(creating)}
        onClose={() => setCreating(false)}
        title="New invoice"
        // `xl`: a device block is four fields across plus its service and part
        // rows, and at `lg` those wrapped into a column of stacked inputs that
        // read as a list rather than a device.
        size="xl"
        align="top"
      >
        {creating && (
          <InvoiceForm
            clients={clients}
            technicians={technicians}
            defaultUser={createSeed.client}
            isPending={createInvoice.isPending}
            error={createInvoice.error?.message}
            onCancel={() => setCreating(false)}
            onSubmit={(values) =>
              createInvoice.mutate(values, {
                onSuccess: (payload) => {
                  setCreating(false);
                  // Straight to the invoice - the next thing a staff member does is
                  // send it or record what has already been paid against it.
                  if (payload?.invoice?.number) {
                    navigate(`/admin/invoices/${payload.invoice.number}`);
                  }
                },
              })
            }
          />
        )}
      </Modal>
    </>
  );
}

export default AdminInvoicesPage;
