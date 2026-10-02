import { useFieldArray, useWatch } from 'react-hook-form';
import { GripVertical, Plus, Trash2 } from 'lucide-react';

import { ATTRIBUTE_TYPES } from '@shared/catalog';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import useDragSort from '@/hooks/useDragSort';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';

/** A new feature: a list, shown everywhere a feature can be shown except as a filter. */
export const blankFeature = () => ({
  key: '',
  label: '',
  type: 'select',
  optionsText: '',
  unit: '',
  required: false,
  inventory: true,
  filter: false,
  product: true,
});

/** The four places a feature can appear, as the switches under it. */
const SWITCHES = [
  { name: 'required', label: 'Required', hint: 'The inventory form will not save without it' },
  { name: 'inventory', label: 'Inventory column', hint: 'A column in Purchase › Inventory for this type' },
  { name: 'filter', label: 'Website filter', hint: "A filter in the website's rail for this type" },
  { name: 'product', label: 'Product page', hint: "Listed on the product's page" },
];

/**
 * A product type's features (taxonomy phase 1, client ruling 2026-10-02).
 *
 * ## What it is opened for
 *
 * "Phones have a colour and a storage size." So each feature is one row: its
 * name, what kind of answer it takes, the choices when it is a list, and four
 * switches saying where it shows. The row is the whole definition; nothing is
 * hidden behind a second dialog. Rows drag by their grip (or the arrow keys on
 * it), and the order here is the order the inventory form asks them.
 *
 * Choices are typed as one comma-separated line, because that is how a list
 * of colours is written down; the page turns it into the list on save.
 */
export function CategoryFeaturesEditor({ control, register, errors, heading = true }) {
  const features = useFieldArray({ control, name: 'attributes' });
  const values = useWatch({ control, name: 'attributes' }) ?? [];
  const drag = useDragSort(features.move, features.fields.length);

  return (
    <fieldset>
      {heading && (
        <>
          <legend className="mb-1 text-sm font-medium text-ink-700">Features</legend>
          <p className="mb-3 text-xs text-ink-500">
            What tells two products of this type apart: colour, storage, size. Asked on the inventory form, in
            this order. Grade is set above, not here.
          </p>
        </>
      )}
      {features.fields.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {features.fields.map((field, index) => {
            const value = values[index] ?? {};
            const fieldErrors = errors?.attributes?.[index] ?? {};
            const name = value.label || 'Feature';
            return (
              <li
                key={field.id}
                {...drag.rowProps(index)}
                className={cn(
                  'grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 px-2 py-2.5',
                  drag.dragging === index && 'opacity-50',
                  drag.over === index && drag.dragging !== index && 'bg-surface-2',
                )}
              >
                <button
                  type="button"
                  {...drag.gripProps(index, name)}
                  className="mt-1 flex size-8 cursor-grab items-center justify-center rounded-md text-ink-300 hover:bg-surface-2 hover:text-ink-700"
                >
                  <GripVertical className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>

                <div className="min-w-0 space-y-2">
                  <input type="hidden" {...register(`attributes.${index}.key`)} />
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1.3fr)]">
                    <Input
                      aria-label="Feature name"
                      placeholder="Colour"
                      error={fieldErrors.label?.message}
                      {...register(`attributes.${index}.label`)}
                    />
                    <SelectField
                      control={control}
                      name={`attributes.${index}.type`}
                      srLabel={`${name}: kind of answer`}
                      options={ATTRIBUTE_TYPES}
                    />
                    {value.type === 'select' ? (
                      <Input
                        aria-label={`${name}: choices, separated by commas`}
                        placeholder="Black, White, Blue"
                        error={fieldErrors.options?.message}
                        {...register(`attributes.${index}.optionsText`)}
                      />
                    ) : value.type === 'number' ? (
                      <Input
                        aria-label={`${name}: unit`}
                        placeholder="Unit, e.g. GB"
                        {...register(`attributes.${index}.unit`)}
                      />
                    ) : (
                      <span className="self-center text-xs text-ink-400">
                        {value.type === 'boolean' ? 'Answered yes or no.' : 'Typed in on each product.'}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {SWITCHES.map((toggle) => (
                      <label key={toggle.name} title={toggle.hint} className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
                        <input type="checkbox" className="size-3.5 accent-brand" {...register(`attributes.${index}.${toggle.name}`)} />
                        {toggle.label}
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  title={`Remove ${name}`}
                  onClick={() => features.remove(index)}
                  className={cn(pressable, 'mt-1 flex size-8 items-center justify-center rounded-md text-ink-300 hover:bg-danger-50 hover:text-danger')}
                >
                  <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {errors?.attributes?.message && <p className="mt-2 text-sm text-danger">{errors.attributes.message}</p>}

      <button
        type="button"
        onClick={() => features.append(blankFeature())}
        className={cn(pressable, 'mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900')}
      >
        <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
        Add a feature
      </button>
    </fieldset>
  );
}

/** Saved features into the form's shape: the choices as one line. */
export const featuresToForm = (attributes = []) =>
  attributes.map((attribute) => ({ ...blankFeature(), ...attribute, optionsText: (attribute.options ?? []).join(', ') }));

/** The form's features back into the payload: the line split into choices. */
export const featuresToPayload = (attributes = []) =>
  attributes.map(({ optionsText, ...attribute }) => ({
    ...attribute,
    options: String(optionsText ?? '')
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean),
  }));

export default CategoryFeaturesEditor;
