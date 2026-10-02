import { useFieldArray, useWatch } from 'react-hook-form';
import { Plus, Trash2, X } from 'lucide-react';

import { DEFAULT_LEVEL_LABELS, TREE_LEVEL_KEYS } from '@shared/catalog';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';

/**
 * A type's category levels, as one list (client rulings 2026-10-02: "all the
 * finder levels customization should be treated same", "just keep add a step
 * button", "the level required or not should be specified in" the levels).
 *
 * ## What it is opened for
 *
 * "What does somebody pick, in order, to reach one of these?" Every level is a
 * row with the same controls: its name and whether it is required. Required
 * means a product (or a row of the tree) must be filed that deep; an optional
 * level may be skipped, like a model hanging straight off its brand. Steps are
 * added at the end and the last one can be removed. The entries of every
 * level, the first included, are added in the category tree, not here.
 *
 * Form values it owns: `facetLabel` and `facetRequired` (the first level, on
 * the types that have one: Component Type, Repair Type), `levels` (all six,
 * each `{ key, label, required }`) and `depth` (how many the type keeps).
 */
export function CategoryLevelsEditor({ control, register, setValue, errors, maxLevels, noun = 'product', heading = true }) {
  const facetLabel = useWatch({ control, name: 'facetLabel' });
  const hasFirst = Boolean(useWatch({ control, name: 'hasFirst' }));
  const depth = Number(useWatch({ control, name: 'depth' })) || 1;
  const offset = hasFirst ? 1 : 0;

  return (
    <fieldset>
      {heading && (
        <>
          <legend className="mb-1 text-sm font-medium text-ink-700">Category levels</legend>
          <p className="mb-3 text-xs text-ink-500">
            What somebody picks, in order, to reach a {noun}. The same levels file a {noun} when it is added, and
            their entries are added in the category tree.
          </p>
        </>
      )}
      <ol className="divide-y divide-line rounded-md border border-line">
        {hasFirst && (
          <li className="px-3 py-2.5">
            <LevelRow
              number={1}
              requiredProps={register('facetRequired')}
              note="Picked first; its entries apply across every level below it."
            >
              <Input
                aria-label="Level 1 name"
                placeholder="Component Type"
                error={errors?.facetLabel?.message}
                {...register('facetLabel')}
              />
            </LevelRow>
          </li>
        )}

        {TREE_LEVEL_KEYS.slice(0, depth).map((key, index) => {
          const last = index === depth - 1;
          return (
            <li key={key} className="px-3 py-2.5">
              <input type="hidden" value={key} {...register(`levels.${index}.key`)} />
              <LevelRow
                number={offset + index + 1}
                requiredProps={register(`levels.${index}.required`)}
                onRemove={last && depth > 1 ? () => setValue('depth', String(depth - 1), { shouldDirty: true }) : null}
                removeLabel={`Remove level ${offset + index + 1}`}
              >
                <Input
                  aria-label={`Level ${offset + index + 1} name`}
                  placeholder={DEFAULT_LEVEL_LABELS[key]}
                  error={errors?.levels?.[index]?.label?.message}
                  {...register(`levels.${index}.label`)}
                />
              </LevelRow>
            </li>
          );
        })}
      </ol>

      {depth < maxLevels && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={Plus}
          className="mt-2"
          onClick={() => setValue('depth', String(depth + 1), { shouldDirty: true })}
        >
          Add a step
        </Button>
      )}
      <p className="mt-1.5 text-xs text-ink-400">
        {hasFirst && facetLabel ? `Up to ${maxLevels} levels after ${facetLabel}.` : `Up to ${maxLevels} levels.`} A level
        with entries or {noun}s under it cannot be removed.
      </p>
    </fieldset>
  );
}

/** One level: its number, its name, whether it is required, and its remove. */
function LevelRow({ number, requiredProps, note = null, onRemove = null, removeLabel = '', children }) {
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto_2rem] items-start gap-x-2">
      <span className="tnum mt-2 text-right font-mono text-sm text-ink-400">{number}</span>
      <div className="min-w-0">
        {children}
        {note && <p className="mt-1 text-xs text-ink-400">{note}</p>}
      </div>
      <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
        <input type="checkbox" className="size-3.5 accent-brand" {...requiredProps} />
        Required
      </label>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className={cn(pressable, 'mt-1 flex size-8 items-center justify-center rounded-md text-ink-400 hover:bg-danger-50 hover:text-danger')}
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * A type's grades, in the order a buyer reads them (grades per type,
 * 2026-10-02): Parts' New, OEM, Pull Grade A…; Phones' Excellent, Good, Fair.
 * A grade keeps its stored value through a rename; one still on a product
 * cannot be removed (the server says which).
 */
export function CategoryGradesEditor({ control, register, errors, heading = true }) {
  const grades = useFieldArray({ control, name: 'grades' });

  return (
    <fieldset>
      {heading && (
        <>
          <legend className="mb-1 text-sm font-medium text-ink-700">Grades</legend>
          <p className="mb-3 text-xs text-ink-500">
            The condition each product is sold at. It is also the badge on the website's cards and product page, and a
            website filter. Leave it empty for no grade and no badge.
          </p>
        </>
      )}
      {grades.fields.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {grades.fields.map((field, index) => (
            <li key={field.id} className="flex items-start gap-1.5">
              <input type="hidden" {...register(`grades.${index}.value`)} />
              <Input
                aria-label={`Grade ${index + 1}`}
                placeholder="Good"
                containerClassName="flex-1"
                error={errors?.grades?.[index]?.label?.message}
                {...register(`grades.${index}.label`)}
              />
              <button
                type="button"
                onClick={() => grades.remove(index)}
                aria-label={`Remove grade ${index + 1}`}
                className={cn(
                  pressable,
                  'mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-danger-50 hover:text-danger',
                )}
              >
                <X className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="ghost" size="sm" icon={Plus} className="mt-2" onClick={() => grades.append({ value: '', label: '' })}>
        Add grade
      </Button>
    </fieldset>
  );
}

export default CategoryLevelsEditor;
