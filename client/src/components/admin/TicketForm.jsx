import { useFieldArray } from 'react-hook-form';
import useAdminForm from '@/hooks/useAdminForm';
import deviceFormResolver from '@/lib/deviceFormResolver';
import { AlertCircle, ClipboardCheck, Lock, Plus, StickyNote, Wrench } from 'lucide-react';
import {
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_SOURCES,
  ticketSchema,
  TAX_RATES,
  provinceTaxOptions,
} from '@shared/schemas/admin';
import { CONDITION_PARTS } from '@shared/deviceCondition';

import { money, titleize } from '@/lib/format';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import MissingFields from '@/components/admin/MissingFields';
import SalesCustomerSection from '@/components/admin/SalesCustomerSection';
import { Section, DeviceBlock, useTicketTotal } from '@/components/admin/DeviceLines';

/**
 * Taking a repair in at the counter.
 *
 * **The form is the intake sheet**, not a thin wrapper over the ticket record.
 * A shop takes in a device by writing down who it belongs to, what came in,
 * what state it was in, what the customer says is wrong, and what the job is
 * expected to cost - and every one of those is evidence later. So the form is
 * sectioned the way that conversation actually goes: who, what devices, what
 * notes, what it costs.
 *
 * ## The parts that are not obvious
 *
 * **Who is the quote's section, not a second version of it.** The customer
 * is an account picked from a list, the same block the quote and the
 * service invoice open with (`SalesCustomerSection`, client ruling 2026-10-05).
 *
 * **Condition is graded before work starts.** It is the shop's protection: a
 * customer who says the back camera worked when they handed the phone over is
 * answered by the row they were shown at drop-off, not by anybody's memory.
 * Every part is required (2026-10-02).
 *
 * **Lines are picked, not typed.** Services come from the shop's own price
 * book and parts are found by name, SKU or barcode, the same pickers the
 * quote uses, so one job is described the same way on all three documents.
 *
 * **The total is a preview.** Every figure below the lines is computed here for
 * the staff member to see, and computed *again* on the server from the same lines
 * (§5.5). A client that could set the price of the work would be setting the
 * price of the work.
 */

const PROVINCE_OPTIONS = provinceTaxOptions();

/** Every new document starts in Alberta (client ruling 2026-10-05). */
const DEFAULT_PROVINCE = 'AB';

const STATUS_OPTIONS = TICKET_STATUSES.map((value) => ({
  value,
  label: TICKET_STATUS_LABELS[value],
}));
const SOURCE_OPTIONS = TICKET_SOURCES.map((value) => ({ value, label: titleize(value) }));

/**
 * Built once at module scope: a resolver rebuilt on every render is a new
 * function identity each time, which RHF has to re-read the form against.
 * The technician picker emits '' for "unassigned" - see `deviceFormResolver`.
 */
const TICKET_RESOLVER = deviceFormResolver(ticketSchema, { optionalIds: ['technician'] });

/**
 * What the summary beside the submit calls each field.
 *
 * Keyed by the path RHF reports, with `devices.*.model` standing for every row
 * of the repeater - "Devices" names the group once however many blocks are
 * open, and the scroll has already put the offending one on screen.
 */
const TICKET_FIELD_LABELS = {
  user: 'Customer',
  dueDate: 'Est. completion',
  'devices.*.model': 'Device model',
  // A half-filled priced line. Named as a thing rather than left to fall back
  // to the schema's "Name the line.", which is an instruction sitting in a
  // list of nouns.
  'devices.*.services.*.name': 'A name on every service line',
  'devices.*.parts.*.name': 'A name on every part line',
  'devices.*.services.*.priceDollars': 'Service line price',
  'devices.*.parts.*.priceDollars': 'Part line price',
  // Every part of the drop-off condition is required (2026-10-02).
  ...Object.fromEntries(
    CONDITION_PARTS.map((part) => [`devices.*.condition.${part.key}`, `${part.label} condition`]),
  ),
};

/** One blank device, its lists empty until something is added. */
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
  condition: {},
  // No blank row: the add bar under the list is where a line starts.
  services: [],
  parts: [],
});

/** A stored line, in dollars and with its catalogue references as strings. */
function lineIn(line) {
  return {
    name: line.name ?? '',
    description: line.description ?? '',
    priceDollars: String((line.priceCents ?? 0) / 100),
    qty: line.qty ?? 1,
    service: line.service ?? '',
    product: line.product ?? '',
  };
}

export function TicketForm({
  ticket,
  seed,
  technicians = [],
  clients = [],
  services = [],
  onSubmit,
  onCancel,
  isPending,
  error,
}) {
  const editing = Boolean(ticket);

  // `useAdminForm`, not raw `useForm`: submit-only validation and the scroll to
  // the first error. The resolver is the ticket's own wire schema, so the form
  // refuses exactly what the server would.
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useAdminForm({
    resolver: TICKET_RESOLVER,
    defaultValues: {
      // `customer.userId` is where the serializer puts the account.
      user: ticket?.customer?.userId ?? seed?.client ?? '',
      serviceType: ticket?.serviceType ?? 'walk_in',

      devices: ticket?.devices?.length
        ? ticket.devices.map((device) => ({
            ...emptyDevice(),
            ...device,
            condition: device.condition ?? {},
            services: (device.services ?? []).map(lineIn),
            parts: (device.parts ?? []).map(lineIn),
          }))
        : [
            {
              ...emptyDevice(),
              // An older ticket has no `devices`, so its legacy columns seed the
              // first block rather than opening an empty form over real data.
              brand: ticket?.device?.brand ?? '',
              model: ticket?.device?.model ?? '',
              serial: ticket?.device?.serial ?? '',
              problem: ticket?.issue ?? '',
            },
          ],

      status: ticket?.status ?? 'diagnosis',
      source: ticket?.source ?? 'counter',
      technician: ticket?.technician?.id ?? '',
      dueDate: ticket?.dueDate ? new Date(ticket.dueDate).toISOString().slice(0, 10) : '',

      clientNotes: ticket?.clientNotes ?? '',
      technicianNotes: ticket?.technicianNotes ?? '',
      notes: ticket?.notes ?? '',

      discountDollars: ticket ? String((ticket.discountCents ?? 0) / 100) : '',
      discountCode: ticket?.discountCode ?? '',
      province: ticket ? (ticket.province ?? '') : DEFAULT_PROVINCE,
      taxRate: ticket ? (ticket.taxRate ?? 0) : TAX_RATES[DEFAULT_PROVINCE],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'devices' });
  const totals = useTicketTotal(control);

  const technicianOptions = [
    { value: '', label: 'Unassigned' },
    ...technicians.map((person) => ({ value: person.id, label: person.name })),
  ];

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4"
      /*
        The browser's own validation is off, so ours is the only one.

        `Input` sets the HTML `required` attribute along with the star, which
        makes the browser refuse the submit BEFORE react-hook-form ever runs:
        the person gets an unstyled "Please fill out this field." bubble on one
        field at a time, it disappears on scroll, and the summary beside the
        button never appears because the submit handler was never reached. The
        attribute stays for assistive technology; only the native UI goes.
      */
      noValidate
    >
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <SalesCustomerSection
        control={control}
        register={register}
        errors={errors}
        clients={clients}
        dateField={{ name: 'dueDate', label: 'Est. completion' }}
        addHint="a ticket is opened for somebody"
      >
        {/* What only a ticket has: where the job starts, who holds it and how it
            arrived. Under the shared row, so that row reads the same as the
            quote's and the invoice's. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {!editing && (
            <SelectField control={control} name="status" label="Repair status" options={STATUS_OPTIONS} />
          )}
          <SelectField
            control={control}
            name="technician"
            label="Assign technician"
            // Staff grows; the status list does not. That is the line for
            // `searchable` - whether the list tracks the business.
            searchable
            searchPlaceholder="Technician name…"
            options={technicianOptions}
          />
          <SelectField control={control} name="source" label="Source" options={SOURCE_OPTIONS} />
        </div>
      </SalesCustomerSection>

      <Section icon={Wrench} title="Devices and services">
        <div className="space-y-3">
          {fields.map((field, index) => (
            <DeviceBlock
              key={field.id}
              control={control}
              register={register}
              setValue={setValue}
              index={index}
              canRemove={fields.length > 1}
              onRemove={() => remove(index)}
              services={services}
            />
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          icon={Plus}
          className="mt-3"
          onClick={() => append(emptyDevice())}
        >
          Add device
        </Button>
      </Section>

      <Section icon={StickyNote} title="Notes">
        <div className="grid gap-2 lg:grid-cols-2">
          <Textarea
            label="Client notes"
            rows={2}
            hint="Visible to the customer on the printed ticket."
            placeholder="Visible to client…"
            {...register('clientNotes')}
          />
          <Textarea
            label="Technician notes"
            rows={2}
            hint="Also printed - technical detail the customer may keep."
            placeholder="Technician notes…"
            {...register('technicianNotes')}
          />
        </div>

        {/* The one field that must never reach a customer document, marked as
            such rather than left to be remembered. */}
        <div className="mt-2 rounded-md border border-warn/30 bg-warn-50/50 p-3">
          <Textarea
            label={
              <span className="flex items-center gap-1.5">
                <Lock className="size-3.5 text-warn" strokeWidth={2.25} aria-hidden="true" />
                Internal notes
                <span className="text-2xs font-normal text-warn">confidential - never printed</span>
              </span>
            }
            rows={2}
            placeholder="Not on any customer document…"
            {...register('notes')}
          />
        </div>
      </Section>

      <Section icon={ClipboardCheck} title="Ticket summary">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            label="Discount (CAD)"
            inputMode="decimal"
            hint="Applied before tax."
            placeholder="0.00"
            {...register('discountDollars')}
          />
          <Input label="Discount code" placeholder="e.g. SUMMER10" {...register('discountCode')} />
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <SelectField
            control={control}
            name="province"
            label="Province"
            // Each option names its tax and rate, and picking one fills the
            // field beside it.
            options={PROVINCE_OPTIONS}
            onValueChange={(value) => setValue('taxRate', TAX_RATES[value] ?? 0)}
          />
          <Input label="Tax rate (%)" inputMode="decimal" hint="0 = tax exempt." {...register('taxRate')} />
        </div>

        {/* A preview. The server recomputes all of this from the lines - see
            the note at the top of this file. */}
        <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Services &amp; parts</dt>
            <dd className="tnum text-ink-900">{money(totals.gross)}</dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Discount</dt>
              <dd className="tnum text-danger">−{money(totals.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Tax</dt>
            <dd className="tnum text-ink-900">{money(totals.tax)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-line pt-2">
            <dt className="font-display font-bold text-ink-900">Total</dt>
            <dd className="tnum font-display text-lg font-bold text-ink-900">{money(totals.total)}</dd>
          </div>
        </dl>

        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          A quote, not an invoice. Nothing here moves a balance - billing a finished repair is a
          separate step.
        </p>
      </Section>

      {/* Named beside the button that refused, not in place of it - the submit
          stays pressable on purpose. See `MissingFields`. */}
      <MissingFields errors={errors} labels={TICKET_FIELD_LABELS} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {editing ? 'Save ticket' : 'Create ticket'}
        </Button>
      </div>
    </form>
  );
}

export default TicketForm;
