import { useFieldArray, useFormState, useWatch } from 'react-hook-form';
import { Minus, Plus, X } from 'lucide-react';

import cn from '@/lib/cn';
import { money, count as formatCount } from '@/lib/format';
import InventoryPicker from '@/components/admin/InventoryPicker';
import ServicePicker from '@/components/admin/ServicePicker';
import { useAdminMutations } from '@/hooks/useAdmin';
import { toast } from '@/store/toastStore';
import { pressable } from '@/lib/motion';

/**
 * The priced lines on one device - its services, or its parts - shared by the
 * ticket, the quote and the service invoice.
 *
 * Extracted rather than copied: the three screens bill the same work in the
 * same shape, and a second copy is how one of them quietly stops writing the
 * reference field or stops honouring an override. `emptyLine` lives here too,
 * so the pages agree on what a blank row is.
 */
const emptyLine = () => ({
  name: '',
  description: '',
  priceDollars: '',
  qty: 1,
  service: '',
  product: '',
});

/**
 * ## How it works (redesigned 2026-10-06, client: "adding service and part feels robotic")
 *
 * It used to be a form per line: press "Add service", get an empty box with a
 * picker on top and four bare fields under it, pick, then check the fields the
 * pick had filled. Two steps and a wall of inputs for what a counter thinks of
 * as one act - "add a screen replacement".
 *
 * Now **the add bar is the action**. One search field under the list: pick a
 * service (or scan a part) and the line is on the document, named and priced,
 * and the field is ready for the next. Picking something already listed adds
 * one to its quantity instead of a duplicate row.
 *
 * **The lines read as lines.** Name and note are edited in place, styled as
 * text until touched; then a quantity stepper, the price, and the line total -
 * the figure a counter reads back, so it gets the weight. The heading carries
 * the count and the subtotal, so a closed-up device still says what it costs.
 *
 * **The picker fills the line; it does not own it.** The price stays editable:
 * raising it for a bent frame is the normal case, and the line keeps the
 * catalogue id either way so reporting can still group by what was sold.
 */
function PricedLines({
  control,
  register,
  setValue,
  name,
  label,
  catalogue = [],
  placeholder,
  emptyHint,
  // `service` or `product`: which reference field the picked id belongs in.
  refField,
  // Parts only: refuse one with nothing on the shelf (see `InventoryPicker`).
  requireStock = false,
}) {
  const { fields, append, remove } = useFieldArray({ control, name });
  const { createService } = useAdminMutations();
  const lines = useWatch({ control, name }) ?? [];

  /**
   * The device these lines belong to, so the part search stays on its shelf.
   * `name` is `devices.N.parts`, and the device's own fields sit beside it.
   */
  const devicePath = String(name).replace(/\.(parts|services)$/, '');
  const [deviceBrand, deviceModel] = useWatch({
    control,
    name: [`${devicePath}.brand`, `${devicePath}.model`],
  });
  const fits = deviceModel ? { brand: deviceBrand, model: deviceModel } : null;

  // This array's own errors, so a rejected line re-renders its own block only.
  const { errors } = useFormState({ control, name });
  const lineErrors = at(errors, name);

  const lineCents = (line) =>
    Math.round((Number(line?.priceDollars) || 0) * 100) * Math.max(1, Number(line?.qty) || 1);
  const subtotal = lines.reduce((sum, line) => sum + lineCents(line), 0);

  /** Add a picked entry, or one more of it if it is already listed. */
  function addLine(line) {
    const id = line[refField];
    const index = id ? lines.findIndex((existing) => existing?.[refField] === id) : -1;
    if (index >= 0) {
      setValue(`${name}.${index}.qty`, (Number(lines[index]?.qty) || 1) + 1, { shouldDirty: true });
      return;
    }
    // shouldFocus off: RHF otherwise moves focus to the new line's name field,
    // which pulled the cursor out of the add bar and left its list hanging open.
    append({ ...emptyLine(), ...line }, { shouldFocus: false });
  }

  function addService(service) {
    addLine({
      name: service.name,
      description: service.description ?? '',
      priceDollars: dollars(service.price),
      service: service.id,
    });
  }

  function addPart(product) {
    if (!product) return;
    addLine({
      name: product.name,
      description: product.sku ?? '',
      priceDollars: dollars((product.price ?? 0) / 100),
      product: product.id,
    });
  }

  /**
   * Add a typed service to the price book and bill it.
   *
   * Services only: a PART is an inventory record - SKU, cost, stock, supplier -
   * and inventing one from a name would put a stockless product into reordering
   * and valuation. The line is added either way, because the reason somebody
   * typed it is that they are billing it now.
   */
  async function createAndAdd(typed) {
    if (typed.length < 2) {
      toast.error('That name is too short', 'A service needs at least two characters.');
      return;
    }
    try {
      const created = await createService.mutateAsync({ name: typed });
      addLine({ name: typed, service: created?.service?.id ?? '' });
      toast.ok(`${typed} added`, 'It is on the service list now. Set its price on the line.');
    } catch (error) {
      addLine({ name: typed });
      toast.error('It was not added to the service list', error.message);
    }
  }

  const noun = refField === 'product' ? 'part' : 'service';

  return (
    <section className="mt-4">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="eyebrow text-ink-400">{label}</h4>
        {fields.length > 0 && (
          <p className="tnum text-xs text-ink-500">
            {formatCount(fields.length)} {fields.length === 1 ? noun : `${noun}s`} ·{' '}
            <span className="font-semibold text-ink-900">{money(subtotal)}</span>
          </p>
        )}
      </header>

      {fields.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {fields.map((field, index) => {
            const errorsHere = lineErrors?.[index];
            const qty = Math.max(1, Number(lines[index]?.qty) || 1);
            // The remove button is drawn twice and shown once: beside the name
            // on a phone, at the end of the row at desktop, so a phone's figures
            // row has room for the quantity, the price and the total.
            const lineTotal = () => (
              <p className="tnum min-w-14 shrink-0 text-right text-sm font-semibold text-ink-900">
                {money(lineCents(lines[index]))}
              </p>
            );
            const removeButton = (where) => (
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove ${lines[index]?.name || `this ${noun}`}`}
                className={cn(
                  pressable,
                  'size-8 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-danger-50 hover:text-danger',
                  where === 'phone' ? 'flex sm:hidden' : 'hidden sm:flex',
                )}
              >
                <X className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            );
            return (
              <li key={field.id} className="px-2 py-2 sm:px-3">
                {/* One row at desktop; on a phone the name takes the full width
                    and the figures sit on their own row under it. */}
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_7rem_5.5rem_auto] sm:items-center sm:gap-x-3">
                  {/* Name and note, edited in place. Styled as text until
                      hovered or focused: the line is a statement, and a box
                      round every word made it read as a form to fill. */}
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <input
                        aria-label={`${noun} name`}
                        placeholder={`Name this ${noun}`}
                        className={cn(
                          INLINE,
                          'font-medium text-ink-900',
                          errorsHere?.name && 'border-danger',
                        )}
                        {...register(`${name}.${index}.name`)}
                      />
                      <input
                        aria-label={`${noun} note`}
                        placeholder="Add a note"
                        className={cn(
                          INLINE,
                          'mt-0.5 text-xs text-ink-500 placeholder:text-ink-300',
                        )}
                        {...register(`${name}.${index}.description`)}
                      />
                    </div>
                    {removeButton('phone')}
                  </div>

                  <div className="flex items-center gap-1.5 sm:contents">
                    {/* Quantity: a stepper, because it is almost always 1 or 2
                      and a bare number box invites typing over it. */}
                    <div
                      className="flex shrink-0 items-center rounded-md border border-line"
                      role="group"
                      aria-label="Quantity"
                    >
                      <button
                        type="button"
                        aria-label="One fewer"
                        disabled={qty <= 1}
                        onClick={() =>
                          setValue(`${name}.${index}.qty`, qty - 1, { shouldDirty: true })
                        }
                        className={cn(pressable, STEP, 'disabled:opacity-40')}
                      >
                        <Minus className="size-3" strokeWidth={2.5} aria-hidden="true" />
                      </button>
                      <input
                        aria-label="Quantity"
                        inputMode="numeric"
                        className="tnum h-8 w-6 border-0 bg-transparent text-center text-base text-ink-900 focus:outline-none sm:w-9 sm:text-sm"
                        {...register(`${name}.${index}.qty`)}
                      />
                      <button
                        type="button"
                        aria-label="One more"
                        onClick={() =>
                          setValue(`${name}.${index}.qty`, qty + 1, { shouldDirty: true })
                        }
                        className={cn(pressable, STEP)}
                      >
                        <Plus className="size-3" strokeWidth={2.5} aria-hidden="true" />
                      </button>
                    </div>

                    <label className="relative block min-w-0 flex-1 sm:flex-none">
                      <span className="sr-only">Price each</span>
                      <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-sm text-ink-400 sm:left-2.5">
                        $
                      </span>
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        className={cn(
                          'tnum h-9 w-full rounded-md border border-line bg-surface pl-4 pr-1.5 text-right text-base text-ink-900 sm:pl-6 sm:pr-2 sm:text-sm',
                          'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25',
                          errorsHere?.priceDollars && 'border-danger',
                        )}
                        {...register(`${name}.${index}.priceDollars`)}
                      />
                    </label>

                    {lineTotal()}

                    {removeButton('desktop')}
                  </div>
                </div>

                {(errorsHere?.name || errorsHere?.priceDollars || errorsHere?.qty) && (
                  <p role="alert" className="mt-1 text-xs font-medium text-danger">
                    {errorsHere?.name?.message ??
                      errorsHere?.priceDollars?.message ??
                      errorsHere?.qty?.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* The add bar: the one action this block exists for. */}
      <div className={cn(fields.length > 0 && 'mt-2')}>
        {refField === 'product' ? (
          <InventoryPicker
            value={null}
            amount="price"
            appearance="add"
            placeholder={placeholder}
            fits={fits}
            requireStock={requireStock}
            onChange={addPart}
          />
        ) : (
          <ServicePicker
            catalogue={catalogue}
            placeholder={placeholder}
            onPick={addService}
            onCreate={createAndAdd}
            onCustom={(typed) => addLine({ name: typed })}
          />
        )}
        {fields.length === 0 && emptyHint && (
          <p className="mt-1.5 text-xs text-ink-400">{emptyHint}</p>
        )}
      </div>
    </section>
  );
}

/** "189.00", the way a price is read, rather than the bare number. */
const dollars = (value) => (Number(value) || 0).toFixed(2);

/** A field that reads as text until it is hovered or focused. */
const INLINE = cn(
  'block w-full rounded-sm border border-transparent bg-transparent px-1 -mx-1 text-base sm:text-sm',
  'transition-[border-color,background-color] duration-press',
  'hover:border-line focus:border-brand focus:bg-surface focus:outline-none',
);

/** One end of the quantity stepper. */
const STEP = 'flex h-8 w-6 items-center justify-center text-ink-500 hover:text-ink-900 sm:w-8';

/**
 * Walk a dotted path into the error tree. `name` arrives as `devices.0.services`,
 * which is where RHF nests this array's errors.
 */
function at(errors, path) {
  return String(path)
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), errors);
}

export { emptyLine, PricedLines };
export default PricedLines;
