import { useFieldArray, useWatch, useFormState } from 'react-hook-form';
import { ClipboardCheck, Plus, Smartphone, Trash2 } from 'lucide-react';
import cn from '@/lib/cn';
import Input from '@/components/ui/Input';
import DeviceFinder from '@/components/admin/DeviceFinder';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import SelectField from '@/components/ui/SelectField';
import { pressable } from '@/lib/motion';
import { CONDITION_GRADES, CONDITION_PARTS } from '@shared/schemas/admin';

/** The intake grid's options, with an explicit "not yet answered" first. */
const CONDITION_OPTIONS = [{ value: '', label: ' - select - ' }, ...CONDITION_GRADES];

/**
 * The device / services / parts editor, shared by the repair ticket and the
 * itemised invoice.
 *
 * Both documents describe the same object - a device, what was wrong with it,
 * what was done and what each of those cost - so they use one editor rather
 * than two that drift. It lives here for the same reason `ApproveClientForm`
 * and `StockForms` do: a second copy is how the two screens end up disagreeing
 * about what a line is.
 */
const emptyLine = () => ({ name: '', description: '', priceDollars: '', qty: 1 });

/** A titled slab. The form is long, and unbroken it reads as one wall of inputs. */
function Section({ icon: Icon, title, hint, children, className }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface p-4', className)}>
      <h3 className="mb-3 flex items-center gap-2 border-b border-line pb-2.5 font-display text-md font-bold text-ink-900">
        <Icon className="size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
        {title}
        {hint && <span className="font-normal text-xs text-ink-400">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/**
 * The priced lines on one device - services performed, or parts fitted.
 *
 * One component for both because they are the same thing on an invoice: a
 * description and a price. They are separate arrays only because a technician
 * thinks about them separately.
 */
function LineEditor({ control, register, name, label, addLabel }) {
  const { fields, append, remove } = useFieldArray({ control, name });

  // This array's own errors. Scoped by `name` so a rejected line re-renders
  // its own block rather than every line editor on a multi-device ticket.
  const { errors } = useFormState({ control, name });
  const lineErrors = at(errors, name);

  return (
    <div className="mt-3">
      <p className="eyebrow mb-2 text-ink-400">{label}</p>

      {fields.length === 0 && (
        <p className="mb-2 text-xs text-ink-400">Nothing added yet.</p>
      )}

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_90px_80px_auto]">
            {/* Required once the row has been started - an untouched row is
                dropped on submit rather than rejected. The star rides on the
                placeholder because this grid is deliberately label-less. */}
            <Input
              placeholder="Name *"
              aria-label={`${label} name`}
              error={lineErrors?.[index]?.name?.message}
              {...register(`${name}.${index}.name`)}
            />
            <Input
              placeholder="Description (optional)"
              aria-label={`${label} description`}
              error={lineErrors?.[index]?.description?.message}
              {...register(`${name}.${index}.description`)}
            />
            <Input
              placeholder="0.00"
              inputMode="decimal"
              aria-label={`${label} price`}
              error={lineErrors?.[index]?.priceDollars?.message}
              {...register(`${name}.${index}.priceDollars`)}
            />
            <Input
              placeholder="Qty"
              inputMode="numeric"
              aria-label={`${label} quantity`}
              error={lineErrors?.[index]?.qty?.message}
              {...register(`${name}.${index}.qty`)}
            />
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={`Remove this ${label.toLowerCase()} line`}
              className={cn(pressable, 'flex size-9 shrink-0 items-center justify-center self-end rounded-md border border-line text-ink-400 hover:border-danger/40 hover:text-danger')}
            >
              <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        size="xs"
        variant="outline"
        icon={Plus}
        className="mt-2"
        onClick={() => append(emptyLine())}
      >
        {addLabel}
      </Button>
    </div>
  );
}

/** One device block: what it is, what is wrong, how it tested, what it costs. */
/**
 * One device block: what it is, what is wrong, what it costs.
 *
 * `variant` is what the two callers differ on, and it is deliberately a
 * variant rather than two components: an intake ticket grades the device's
 * condition and stores an unlock code so a technician can test it, and an
 * invoice does neither - a passcode has no business on a document the customer
 * keeps, and a condition grid records the state at drop-off, which an invoice
 * issued afterwards is not describing.
 */
function DeviceBlock({ control, register, setValue, index, canRemove, onRemove, variant = 'ticket' }) {
  const isIntake = variant === 'ticket';

  // The model's error, if a submit was refused for it. The finder is a set of
  // step cards rather than an input, so there is nothing for the browser to
  // mark and the message has to be placed by hand - see the note below.
  const { errors } = useFormState({ control, name: `devices.${index}.model` });
  const modelError = at(errors, `devices.${index}.model`)?.message;

  return (
    <div className="rounded-md border border-line bg-surface-2/50 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-display text-sm font-bold text-ink-900">
          <Smartphone className="size-3.5 text-brand" strokeWidth={2.25} aria-hidden="true" />
          Device #{index + 1}
        </p>
        {canRemove && (
          <Button type="button" size="xs" variant="outline" icon={Trash2} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>

      {/* Four free-text boxes became a stepped finder over the shop's own
          device tree.

          As typing they were four unguided fields that agreed with nothing:
          the same phone arrived as "iphone", "iPhone" and "Apple iPhone"
          depending on who was at the counter, and none of them matched the
          device list the shop had actually built. The finder narrows each step
          to the children of the last, and adds a missing one in place rather
          than sending somebody to a settings screen mid-intake.

          The model is still effectively required on intake - a ticket for an
          unnamed device cannot be found again - but the requirement now lives
          on the schema rather than on an input attribute, because a step card
          is not a form control the browser can mark. */}
      {/* The one required field in the block, so it says so. The star is on a
          heading rather than a label because the finder has no single control
          to hang one off, and `Input`'s own treatment is reused verbatim so it
          reads as the same mark the fields below it carry. */}
      <p className="mb-1.5 block text-xs font-medium text-ink-700">
        Device
        <span className="ml-0.5 text-danger" aria-hidden="true">
          *
        </span>
      </p>

      <DeviceFinder control={control} setValue={setValue} index={index} />

      {modelError ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {modelError}
        </p>
      ) : (
        isIntake && (
          <p className="mt-1.5 text-xs text-ink-400">
            Pick down to the model where you can - it is how this ticket is found again.
          </p>
        )
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Input label="Serial number" placeholder="e.g. IMEI or S/N" {...register(`devices.${index}.serial`)} />
        {isIntake && (
          <Input
            label="Passcode / PIN"
            placeholder="For testing (optional)"
            hint="Never printed on a customer document."
            {...register(`devices.${index}.passcode`)}
          />
        )}
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-3">
        <Textarea label="Problem" rows={2} placeholder="What's wrong with this device…" {...register(`devices.${index}.problem`)} />
        <Textarea label="Solution" rows={2} placeholder="How it was / will be fixed…" {...register(`devices.${index}.solution`)} />
        <Textarea label="Notes" rows={2} placeholder="Anything else about this device…" {...register(`devices.${index}.notes`)} />
      </div>

      {/* Graded at drop-off, so it belongs to intake and not to billing. */}
      {isIntake && (
      <div className="mt-3">
        <p className="eyebrow mb-2 flex items-center gap-1.5 text-ink-400">
          <ClipboardCheck className="size-3.5 text-brand" strokeWidth={2.25} aria-hidden="true" />
          Device condition <span className="normal-case tracking-normal">(at drop-off)</span>
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {CONDITION_PARTS.map((part) => (
            <SelectField
              key={part.key}
              control={control}
              name={`devices.${index}.condition.${part.key}`}
              label={part.label}
              options={CONDITION_OPTIONS}
            />
          ))}
        </div>
      </div>
      )}

      <LineEditor
        control={control}
        register={register}
        name={`devices.${index}.services`}
        label="Services for this device"
        addLabel="Add service"
      />
      <LineEditor
        control={control}
        register={register}
        name={`devices.${index}.parts`}
        label="Parts required for this device"
        addLabel="Add part"
      />
    </div>
  );
}

/**
 * The running total.
 *
 * Recomputed on every keystroke from the lines above, and **recomputed again by
 * the server** from the same lines when the form is submitted. This is a
 * preview so the counter can quote a figure while the customer is standing
 * there; it is never the number that gets stored.
 */
function useTicketTotal(control) {
  const devices = useWatch({ control, name: 'devices' }) ?? [];
  const discount = Number(useWatch({ control, name: 'discountDollars' }) ?? 0) || 0;
  const taxRate = Number(useWatch({ control, name: 'taxRate' }) ?? 0) || 0;

  const gross = devices.reduce((sum, device) => {
    const lines = [...(device?.services ?? []), ...(device?.parts ?? [])];
    return (
      sum +
      lines.reduce(
        (n, line) => n + (Number(line?.priceDollars) || 0) * (Number(line?.qty) || 1),
        0,
      )
    );
  }, 0);

  // A discount can never exceed the work - the server clamps it the same way.
  const applied = Math.min(discount, gross);
  const subtotal = gross - applied;
  const tax = subtotal * (taxRate / 100);

  return {
    gross: Math.round(gross * 100),
    discount: Math.round(applied * 100),
    subtotal: Math.round(subtotal * 100),
    tax: Math.round(tax * 100),
    total: Math.round((subtotal + tax) * 100),
  };
}

/**
 * Walk a dotted path into the error tree.
 *
 * `name` arrives as `devices.0.services` - where RHF nests this array's errors
 * - and the error object has no lookup of its own. Undefined at the first
 * missing step, which is the normal case: the tree is empty until a submit is
 * refused.
 */
function at(errors, path) {
  return String(path)
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), errors);
}

export { emptyLine, Section, LineEditor, DeviceBlock, useTicketTotal };
