import { useFieldArray, useWatch, Controller } from 'react-hook-form';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  ClipboardCheck,
  Info,
  Lock,
  Plus,
  Smartphone,
  StickyNote,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_PRIORITIES,
  TICKET_SOURCES,
  TAX_RATES,
  provinceTaxOptions,
} from '@shared/schemas/admin';

import cn from '@/lib/cn';
import { money, titleize } from '@/lib/format';
import Input from '@/components/ui/Input';
import PhoneField from '@/components/ui/PhoneField';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import { pressable } from '@/lib/motion';
import {
  emptyLine,
  Section,
  LineEditor,
  DeviceBlock,
  useTicketTotal,
} from '@/components/admin/DeviceLines';

/**
 * Taking a repair in at the counter.
 *
 * **The form is the intake sheet**, not a thin wrapper over the ticket record.
 * A shop takes in a device by writing down what came in, what state it was in,
 * what the customer says is wrong, and what the job is expected to cost - and
 * every one of those is evidence later. So the form is sectioned the way that
 * conversation actually goes: who, what devices, what notes, what it costs.
 *
 * ## The parts that are not obvious
 *
 * **Condition is graded before work starts.** It is the shop's protection: a
 * customer who says the back camera worked when they handed the phone over is
 * answered by the row they were shown at drop-off, not by anybody's memory.
 * `untested` is a real answer and is deliberately distinct from `not present`.
 *
 * **The total is a preview.** Every figure below the lines is computed here for
 * the staff member to see, and computed *again* on the server from the same lines
 * (§5.3). Nothing this form calculates is trusted - a client that could set the
 * price of the work would be setting the price of the work.
 *
 * **Short intake still works.** Every field except the customer is optional, so
 * a walk-in can be booked in under a minute and priced properly later. That is
 * the case this form exists to serve; the long version is for when the counter
 * already knows the job.
 */

const PROVINCE_OPTIONS = provinceTaxOptions();

const STATUS_OPTIONS = TICKET_STATUSES.map((value) => ({
  value,
  label: TICKET_STATUS_LABELS[value],
}));
const PRIORITY_OPTIONS = TICKET_PRIORITIES.map((value) => ({ value, label: titleize(value) }));
const SOURCE_OPTIONS = TICKET_SOURCES.map((value) => ({ value, label: titleize(value) }));

/** One blank device. Only the model is required, so the rest starts empty. */
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
  services: [],
  parts: [],
});


export function TicketForm({
  ticket,
  seed,
  technicians = [],
  clients = [],
  onSubmit,
  onCancel,
  isPending,
  error,
}) {
  const editing = Boolean(ticket);

  // `useAdminForm`, not raw `useForm`: this form was the one that missed the
  // submit-only validation and the scroll-to-first-error, so intake alone still
  // marked untouched fields red and refused a submit without moving the page.
  const { register, handleSubmit, control, setValue } = useAdminForm({
    defaultValues: {
      customerName: ticket?.customer.name ?? seed?.name ?? '',
      customerPhone: ticket?.customer.phone ?? seed?.phone ?? '',
      customerEmail: ticket?.customer.email ?? seed?.email ?? '',
      // The linked account, when there is one. Blank for a walk-in, which is
      // the common case - see the picker above the contact fields.
      // `customer.userId` is where the serializer puts it, not `ticket.user`.
      user: ticket?.customer?.userId ?? seed?.client ?? '',

      devices: ticket?.devices?.length
        ? ticket.devices.map((device) => ({
            ...emptyDevice(),
            ...device,
            condition: device.condition ?? {},
            services: (device.services ?? []).map((line) => ({
              ...line,
              priceDollars: String((line.priceCents ?? 0) / 100),
            })),
            parts: (device.parts ?? []).map((line) => ({
              ...line,
              priceDollars: String((line.priceCents ?? 0) / 100),
            })),
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
      priority: ticket?.priority ?? 'normal',
      source: ticket?.source ?? 'counter',
      technician: ticket?.technician?.id ?? '',
      dueDate: ticket?.dueDate ? new Date(ticket.dueDate).toISOString().slice(0, 10) : '',

      clientNotes: ticket?.clientNotes ?? '',
      technicianNotes: ticket?.technicianNotes ?? '',
      notes: ticket?.notes ?? '',

      discountDollars: ticket ? String((ticket.discountCents ?? 0) / 100) : '',
      discountCode: ticket?.discountCode ?? '',
      province: ticket?.province ?? '',
      taxRate: ticket?.taxRate ?? 5,
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
      onSubmit={handleSubmit((values) =>
        onSubmit({
          ...values,
          // A blank grade means "not recorded", which is not the same fact as
          // `untested` - so empty keys are dropped rather than sent as ''.
          devices: values.devices.map((device) => ({
            ...device,
            condition: Object.fromEntries(
              Object.entries(device.condition ?? {}).filter(([, grade]) => grade),
            ),
          })),
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

      <Section icon={Info} title="Basic information">
        {/* Three contact fields on one row, not two and a full-width third.

            Email used to sit outside this grid, so it ran the entire width of
            the page while the name and phone above it were half of it - a
            22-character address in a 900px box, ragged against the two fields
            it belongs with. A field's width is a hint about its content, and
            an address is not four times a phone number. */}
        {/* Pick an existing customer, or just type one.

            A ticket stores its customer as free TEXT - a walk-in with no
            account is the normal case at a repair counter, and a picker that
            insisted on an account would block the fastest intake there is. So
            the name stays a text field and the picker sits above it as a
            shortcut: choosing somebody fills the name, phone and email in one
            action and links the ticket to their account, and typing over any
            of it afterwards still works.

            `user` is a hidden field rather than state so it travels with the
            form on submit, the same way the seeded `client` already did. */}
        {clients.length > 0 && (
          <div className="mb-2">
            <SelectField
              control={control}
              name="user"
              label="Existing customer"
              hint="Optional - fills the three fields below, or leave it and type a walk-in."
              searchable
              searchPlaceholder="Name, business or email…"
              options={[
                { value: '', label: '– Walk-in / type below –' },
                ...clients.map((client) => ({
                  value: client.id,
                  label: `${client.displayName}${client.email ? ` · ${client.email}` : ''}`,
                })),
              ]}
              onValueChange={(value) => {
                const picked = clients.find((client) => client.id === value);
                if (!picked) return;
                setValue('customerName', picked.displayName ?? '', { shouldDirty: true });
                setValue('customerPhone', picked.phone ?? '', { shouldDirty: true });
                setValue('customerEmail', picked.email ?? '', { shouldDirty: true });
              }}
              // Typing the name onto the ticket, NOT navigating to the customer
              // form: intake is half-filled by this point and leaving the page
              // would lose it. A walk-in does not need an account, and one can
              // be opened later from the ticket - so the useful answer here is
              // "use what I typed", which is exactly what the free-text name
              // below already supports.
              onCreate={(typed) => {
                setValue('customerName', typed, { shouldDirty: true });
                setValue('user', '', { shouldDirty: true });
              }}
              createLabel={'Use "{q}" as a walk-in'}
              createLabelEmpty="Type a name to use it as a walk-in"
            />
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="Customer name" required {...register('customerName')} />
          <Controller
            name="customerPhone"
            control={control}
            render={({ field }) => (
              <PhoneField
                label="Phone"
                required
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <Input
            label="Email"
            type="email"
            // Every other field on this row shows the shape of its answer; this
            // one was the only empty box, which reads as a field that wants
            // something different from what it wants.
            placeholder="name@example.com"
            hint="Optional - used only if the shop emails a receipt."
            {...register('customerEmail')}
          />
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {!editing && (
            <SelectField control={control} name="status" label="Status" options={STATUS_OPTIONS} />
          )}
          <SelectField control={control} name="priority" label="Priority" options={PRIORITY_OPTIONS} />
          <Input label="Est. completion" type="date" {...register('dueDate')} />
          <SelectField
            control={control}
            name="technician"
            label="Assign technician"
            // Staff grows; status and priority do not. That is the line for
            // `searchable` - whether the list tracks the business, not what it
            // happens to hold today.
            searchable
            searchPlaceholder="Technician name…"
            options={technicianOptions}
          />
          <SelectField control={control} name="source" label="Source" options={SOURCE_OPTIONS} />
        </div>
      </Section>

      <Section icon={Wrench} title="Devices & services">
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
                <span className="text-2xs font-normal text-warn">
                  confidential - never printed
                </span>
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
            // field beside it. Neither happened before: the list was bare
            // province names and the rate never moved, so a ticket priced in
            // Ontario kept whatever rate was already in the box.
            options={PROVINCE_OPTIONS}
            onValueChange={(value) => setValue('taxRate', TAX_RATES[value] ?? 0)}
          />
          <Input
            label="Tax rate (%)"
            inputMode="decimal"
            hint="0 = tax exempt."
            {...register('taxRate')}
          />
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
            <dd className="tnum font-display text-lg font-bold text-ink-900">
              {money(totals.total)}
            </dd>
          </div>
        </dl>

        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          An estimate, not an invoice. Nothing here moves a balance - billing a finished repair is
          a separate step.
        </p>
      </Section>

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
