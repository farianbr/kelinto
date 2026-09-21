import { useFieldArray } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';

import cn from '@/lib/cn';
import { money } from '@/lib/format';
import Input from '@/components/ui/Input';
import SelectMenu from '@/components/ui/SelectMenu';
import Button from '@/components/ui/Button';
import { useAdminMutations } from '@/hooks/useAdmin';
import { toast } from '@/store/toastStore';
import { pressable } from '@/lib/motion';

/**
 * A priced line with a catalogue picker, shared by the estimate and the
 * service invoice.
 *
 * Extracted rather than copied: the two screens bill the same work in the same
 * shape, and a second copy is how one of them quietly stops writing the
 * reference field or stops honouring an override. `emptyLine` lives here too,
 * so both pages agree on what a blank row is.
 */
const emptyLine = () => ({ name: '', description: '', priceDollars: '', qty: 1, service: '', product: '' });

/**
 * One priced line, with a picker in front of it.
 *
 * **The picker fills the line; it does not become the line.** Choosing "Screen
 * replacement" copies its name and list price into the two fields beside it and
 * then gets out of the way - the staff member raises the price for a bent frame,
 * and the line keeps the id so reporting can still group by what was sold. A
 * picker that owned the price would make the override impossible, and the
 * override is the normal case.
 *
 * **One component, two catalogues.** A service business sells labour AND parts,
 * so this fills from `Service` for one list and the shop's own `Product`
 * inventory for the other. `refField` is which reference the picked id belongs
 * in; everything else about a line is identical, which is why they share an
 * editor rather than having two that drift.
 */
function PricedLines({
  control,
  register,
  setValue,
  name,
  label,
  addLabel,
  catalogue,
  placeholder,
  emptyHint,
  // `service` or `product`: which reference field the picked id belongs in.
  refField,
}) {
  const { fields, append, remove } = useFieldArray({ control, name });
  const { createService } = useAdminMutations();

  /**
   * Add a service to the price book from inside the picker.
   *
   * **Services only, and deliberately.** `serviceCatalogSchema` needs a name
   * and defaults the rest, so a labour line somebody has just described can
   * become a catalogue entry in one step. A PART is an inventory record - SKU,
   * cost, stock, supplier, reorder point - and inventing one from a name would
   * create a product with no stock and no cost that then appears in reordering
   * and valuation reports as a real thing. So a part typed here stays a
   * free-typed line on this document, which is what the line already supports.
   *
   * The catalogue entry is created AND the line is filled, because the reason
   * somebody is adding it is that they are billing it right now.
   */
  const canCreate = refField === 'service';

  async function addToCatalogue(index, typed) {
    // The server refuses a one-character name (`SERVICE_NAME_REQUIRED`), so it
    // is caught here rather than as a failed request the staff member has to
    // interpret.
    if (typed.length < 2) {
      toast.error('That name is too short', 'A service needs at least two characters.');
      return;
    }

    try {
      const created = await createService.mutateAsync({ name: typed });
      const service = created?.service;

      setValue(`${name}.${index}.name`, typed, { shouldDirty: true });
      if (service?.id) setValue(`${name}.${index}.service`, service.id, { shouldDirty: true });

      toast.ok(`${typed} added`, 'It is on the service list now - set its price here.');
    } catch (error) {
      // The line still gets the name: the staff member is billing this job
      // either way, and losing what they typed because a catalogue write
      // failed is the worse of the two outcomes.
      setValue(`${name}.${index}.name`, typed, { shouldDirty: true });
      toast.error('It was not added to the service list', error.message);
    }
  }

  return (
    <div className="mt-3">
      <p className="eyebrow mb-2 text-ink-400">{label}</p>

      {fields.length === 0 && <p className="mb-2 text-xs text-ink-400">{emptyHint}</p>}

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="rounded-md border border-line bg-surface-2 p-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              {/* Searchable, because this list is the whole price book.

                  A native `<select>` over 200 services or 500 parts gives no
                  way to type past the first letter, so finding a line meant
                  scrolling a list the platform sized itself. It is also
                  deliberately a PICKER, not a value: choosing an entry writes
                  the name, price and id onto the line below and resets, so the
                  same entry can be added twice in a row. */}
              <SelectMenu
                srLabel={placeholder}
                size="md"
                align="left"
                placeholder={placeholder}
                searchable
                searchPlaceholder={placeholder}
                value=""
                options={[
                  { value: '', label: placeholder },
                  ...catalogue.map((entry) => ({
                    value: entry.id,
                    label: entry.price
                      ? `${entry.name} · ${money(Math.round(entry.price * 100))}`
                      : entry.name,
                  })),
                ]}
                onChange={(next) => {
                  const picked = catalogue.find((entry) => entry.id === next);
                  if (!picked) return;
                  setValue(`${name}.${index}.name`, picked.name, { shouldDirty: true });
                  setValue(`${name}.${index}.priceDollars`, picked.price ?? 0, {
                    shouldDirty: true,
                  });
                  /**
                   * The id goes in the field for its OWN kind.
                   *
                   * A service business sells two things and this editor fills
                   * both: labour from `Service`, and parts from the shop's own
                   * `Product` inventory. They are different collections, so a
                   * part's id written into `service` would point at a service
                   * that does not exist - the line would still read correctly,
                   * because it snapshots its own name and price, and every
                   * report grouping by service would silently miss it.
                   */
                  setValue(`${name}.${index}.${refField}`, picked.id, { shouldDirty: true });
                  if (picked.description) {
                    setValue(`${name}.${index}.description`, picked.description, {
                      shouldDirty: true,
                    });
                  }
                  // Nothing resets here: `value` is held at `''` above, so the
                  // control is already back to the placeholder on the next
                  // render and the same entry can be picked again.
                }}
                // Parts are inventory records and are not invented from a
                // name - see `addToCatalogue`.
                onCreate={canCreate ? (typed) => addToCatalogue(index, typed) : undefined}
                createLabel={'Add "{q}" to the service list'}
                createLabelEmpty="Type a service name to add it"
              />

              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove line ${index + 1}`}
                className={cn(
                  pressable,
                  // Matches the picker beside it at admin density. `size-11`
                  // left this button 8px taller than the control it sits next
                  // to, which is the ragged edge this pass exists to remove.
                  'inline-flex size-9 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-400 hover:border-danger hover:text-danger',
                )}
              >
                <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_90px_90px]">
              <Input placeholder="Line name" {...register(`${name}.${index}.name`)} />
              <Input
                placeholder="Description (optional)"
                {...register(`${name}.${index}.description`)}
              />
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...register(`${name}.${index}.priceDollars`)}
              />
              <Input
                type="number"
                min="1"
                placeholder="Qty"
                {...register(`${name}.${index}.qty`)}
              />
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={Plus}
        className="mt-2"
        onClick={() => append(emptyLine())}
      >
        {addLabel}
      </Button>
    </div>
  );
}

export { emptyLine, PricedLines };
export default PricedLines;
