import { useEffect, useMemo, useState } from 'react';
import { useWatch } from 'react-hook-form';
import { Check, ChevronRight, Plus, RotateCcw, Search } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { useAdminDevices, useAdminMutations } from '@/hooks/useAdmin';
import { toast } from '@/store/toastStore';

/**
 * Pick a device by walking the shop's own tree, one step at a time.
 *
 * ## Why this is not the storefront's `TabWizard`
 *
 * It is the same *interaction* - numbered steps, each opening a searchable
 * list, each narrowing the next - and deliberately so: that is the control the
 * client asked for, and it is the one people here already know.
 *
 * It is not the same *component*, because the two walk different trees and
 * answer different questions. `TabWizard` is bound to the storefront Zustand
 * filter store and the PARTS taxonomy - five levels led by component type,
 * pruned to what is in stock, whose job is narrowing a product grid. This walks
 * the repair shop's `DeviceCatalog` - four levels, no component type, never
 * pruned by stock - and its job is naming one device on a record. Reusing the
 * wizard would have meant teaching it a second tree, a second level set and a
 * mode where it writes to a form instead of a filter, which is two components
 * wearing one name.
 *
 * What IS shared is the shape of the thing: `DevicePicker`'s four dropdowns
 * still exist and still back this, so a value typed before the tree knew about
 * it survives untouched.
 *
 * ## Add new
 *
 * Each step can add a node **at its own level**, parented to the step above.
 * The server derives the level from the parent (see `deviceCatalogSchema`), so
 * a brand added from the Brand step cannot land anywhere but under the chosen
 * category. Adding from the last step is the common case - a model nobody has
 * booked before - and it costs a counter no trip to a settings screen.
 *
 * The record stores the **name**, not the id, exactly as `DevicePicker` does,
 * so a device retired next year does not blank out a repair done today.
 */

/** The four levels, outermost first. `field` is the form key each one writes. */
const LEVELS = [
  { field: 'category', label: 'Category', hint: 'Phone, tablet, laptop…' },
  { field: 'brand', label: 'Brand', hint: 'Apple, Samsung…' },
  { field: 'series', label: 'Device / series', hint: 'iPhone 15' },
  { field: 'model', label: 'Model', hint: 'iPhone 15 Pro Max' },
];

/**
 * One step's card.
 *
 * Three states, and each says something different: answered (the value, and it
 * can be changed), open next (the thing to do now), and waiting (what it needs
 * first). A step that cannot be opened says why rather than being inert.
 */
function StepCard({ index, level, value, disabled, blockedBy, onOpen, onClear }) {
  const done = Boolean(value);

  return (
    <div
      className={cn(
        'rounded-lg border p-2.5 text-left transition-colors',
        done ? 'border-brand bg-brand-50' : 'border-line bg-surface',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold',
            // The compact ramp: below ~120px the full ramp's near-black
            // opening reads as a stripe rather than as depth.
            done ? 'bg-brand-gradient-compact text-white' : 'bg-surface-2 text-ink-400',
          )}
        >
          {done ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : index + 1}
        </span>
        <span className="eyebrow truncate text-ink-400">{level.label}</span>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onOpen}
        className={cn(
          pressable,
          'mt-1.5 flex w-full items-center justify-between gap-2 text-left',
          disabled && 'cursor-not-allowed',
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            done ? 'font-semibold text-ink-900' : 'text-ink-400',
          )}
        >
          {value || (disabled ? `Pick a ${blockedBy} first` : level.hint)}
        </span>
        {!disabled && (
          <ChevronRight className="size-3.5 shrink-0 text-ink-400" strokeWidth={2.25} aria-hidden="true" />
        )}
      </button>

      {done && (
        <button
          type="button"
          onClick={onClear}
          className={cn(pressable, 'mt-1 inline-flex items-center gap-1 text-2xs font-medium text-ink-400 hover:text-danger')}
        >
          <RotateCcw className="size-3" strokeWidth={2.25} aria-hidden="true" />
          Clear
        </button>
      )}
    </div>
  );
}

/**
 * The list one step opens into: search, the options, and a way to add one.
 *
 * Dense rows rather than icon tiles. `WizardOverlay` uses tiles for component
 * and device types because a battery and a keyboard look like something; a
 * shop's own brands and models have no honest picture, and the monogram that
 * would fill that slot is a placeholder in the most prominent position.
 */
function StepOverlay({ open, step, level, options, picked, onClose, onPick, onAdd, onBack, adding }) {
  const [query, setQuery] = useState('');

  /**
   * The search box empties whenever the step changes.
   *
   * Without this, walking Category to Brand carried "iPhone" into a list of
   * brands, which matches nothing - so the step the walk just unlocked opened
   * showing an empty list and an offer to add a brand called iPhone. Keyed on
   * the step rather than cleared in the handler because the step also changes
   * by going back, and both directions want a fresh box.
   */
  useEffect(() => {
    setQuery('');
  }, [step]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((node) => node.name.toLowerCase().includes(needle));
  }, [options, query]);

  const typed = query.trim();
  // Only offer to add what is not already there, matched case-insensitively:
  // offering "Add Apple" under a list containing Apple is how duplicates are
  // made by people who are being careful.
  const canAdd = typed && !options.some((node) => node.name.toLowerCase() === typed.toLowerCase());

  function close() {
    setQuery('');
    onClose();
  }

  const last = step === LEVELS.length - 1;

  return (
    <Modal open={open} onClose={close} title="Find the device" size="md" align="top">
      {/* The trail, so the walk reads as one continuous narrowing rather than
          four unrelated lists. Each answered level is a way back to itself: the
          commonest correction is realising the brand was wrong two steps in,
          and the alternative is cancelling out and starting again. */}
      <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-line pb-3">
        {LEVELS.map((entry, index) => {
          if (index > step) return null;
          const value = picked?.[index];
          const here = index === step;

          return (
            <span key={entry.field} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRight className="size-3 shrink-0 text-ink-300" strokeWidth={2.5} aria-hidden="true" />
              )}
              <button
                type="button"
                disabled={here}
                onClick={() => onBack(index)}
                className={cn(
                  pressable,
                  'rounded px-1.5 py-0.5 text-xs font-medium',
                  here
                    ? 'cursor-default bg-surface-2 text-ink-900'
                    : 'text-ink-500 hover:bg-surface-2 hover:text-ink-900',
                )}
              >
                {value || entry.label}
              </button>
            </span>
          );
        })}
      </div>

      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${level?.label.toLowerCase()}…`}
        icon={Search}
        autoFocus
      />

      <ul className="scroll-slim mt-3 max-h-80 space-y-1 overflow-y-auto">
        {matches.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              // Advancing rather than closing is the whole point: the storefront
              // walks a buyer from component type to model without ever handing
              // the panel back, and a counter naming a device should not have to
              // reopen the same control four times to answer four questions.
              // Only the last level has nothing left to narrow, so only it closes.
              onClick={() => {
                onPick(node.name);
                if (last) close();
              }}
              className={cn(
                pressable,
                'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-700 hover:bg-surface-2 hover:text-ink-900',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              <ChevronRight className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
            </button>
          </li>
        ))}

        {matches.length === 0 && !canAdd && (
          <li className="px-3 py-6 text-center text-sm text-ink-400">
            {options.length === 0 ? 'Nothing on this level yet.' : `Nothing matches “${typed}”.`}
          </li>
        )}
      </ul>

      {/* Adding is the answer to an empty search, so it sits where the search
          ends rather than above the list somebody came to read. */}
      {canAdd && (
        <div className="mt-3 border-t border-line pt-3">
          <Button
            type="button"
            icon={Plus}
            loading={adding}
            // Adding answers the step too, so it advances exactly as picking
            // does - a model added at the last step is the end of the walk, one
            // added higher up unlocks the level below it.
            onClick={async () => {
              const created = await onAdd(typed);
              if (created && last) close();
            }}
          >
            Add “{typed}” as a {level?.label.toLowerCase()}
          </Button>
          <p className="mt-1.5 text-xs text-ink-400">
            It joins this shop&rsquo;s device list, so it is here next time too.
          </p>
        </div>
      )}

      {/* A walk that stops early is still an answer - plenty of repairs are
          booked against a brand with no model anybody recognises - so there is
          a way out that is not the X in the corner. It says what has been
          named rather than "Done", because at this point the staff member is
          deciding whether that is enough. */}
      <div className="sticky bottom-0 -mx-5 mt-4 flex items-center justify-between gap-3 border-t border-line bg-surface px-5 pb-1 pt-3">
        <p className="min-w-0 flex-1 truncate text-sm text-ink-500">
          {picked?.[step]
            ? [...picked].slice(0, step + 1).filter(Boolean).join(' · ')
            : `Choose a ${level?.label.toLowerCase()}`}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={close}>
          {last ? 'Done' : 'Use this'}
        </Button>
      </div>
    </Modal>
  );
}

export function DeviceFinder({ control, setValue, index, prefix = 'devices' }) {
  const base = `${prefix}.${index}`;
  const { data } = useAdminDevices({ status: 'active' });
  const { createDevice } = useAdminMutations();
  const tree = data?.tree ?? [];

  const [openStep, setOpenStep] = useState(null);

  /**
   * The four values, in one subscription.
   *
   * One `useWatch` over an array of names rather than four calls in a `map`:
   * a hook inside a loop is a hook whose call order depends on the array, and
   * even a fixed-length one reads as the bug it resembles.
   */
  const values = useWatch({
    control,
    name: LEVELS.map((level) => `${base}.${level.field}`),
  });

  /**
   * The node chosen at each level, and therefore the options at the next.
   *
   * Matched by name because the form holds names - see the note on this
   * component. A name the tree no longer has simply yields no children, which
   * leaves the steps below it free-standing rather than broken.
   */
  // `useWatch` hands back a sparse array before the fields register, so the
  // levels are normalised once here rather than guarded at each use.
  const picked = LEVELS.map((_, step) => values?.[step] ?? '');

  const nodes = useMemo(() => {
    const out = [];
    let siblings = tree;
    for (const value of picked) {
      const found = siblings.find((node) => node.name === value);
      out.push(found ?? null);
      siblings = found?.children ?? [];
    }
    return out;
    // Joined on a character a device name cannot contain, so the memo tracks
    // the four values rather than a new array identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, picked.join('\u0000')]);

  /** The options a step offers: the children of the step above it. */
  function optionsAt(step) {
    if (step === 0) return tree;
    return nodes[step - 1]?.children ?? [];
  }

  /**
   * Choosing at one level clears every level below it.
   *
   * Picking Apple after Samsung has to drop "Galaxy S24": leaving it would
   * submit a device that does not exist, and it would look deliberate because
   * the box still holds a real model name.
   */
  function pick(step, value) {
    setValue(`${base}.${LEVELS[step].field}`, value, { shouldDirty: true });
    for (let below = step + 1; below < LEVELS.length; below += 1) {
      setValue(`${base}.${LEVELS[below].field}`, '', { shouldDirty: true });
    }
  }

  /**
   * Add a node at this level, under the level above.
   *
   * The parent is what decides the level - the server derives `kind` from it -
   * so a root is only created from the first step, where there is no parent to
   * send. Returns true when the tree accepted it, so the overlay only closes
   * on a real write.
   */
  async function add(step, name) {
    const parent = step === 0 ? undefined : nodes[step - 1]?.id;

    // A child with no parent id would be created as a ROOT category rather
    // than under the step above, which is a wrong record rather than a failed
    // one - so it is refused here instead.
    if (step > 0 && !parent) {
      toast.error(
        'Nothing to attach it to',
        `Pick a ${LEVELS[step - 1].label.toLowerCase()} that is in the device list first.`,
      );
      return false;
    }

    try {
      await createDevice.mutateAsync({ name, ...(parent ? { parent } : {}) });
      pick(step, name);
      toast.ok(`${name} added`, 'It is on this shop’s device list now.');
      return true;
    } catch (error) {
      toast.error('It was not added', error.message);
      return false;
    }
  }

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {LEVELS.map((level, step) => {
          // A step is reachable once the one above it has an answer. The first
          // is always reachable; the rest name what they are waiting for.
          const blocked = step > 0 && !picked[step - 1];

          return (
            <StepCard
              key={level.field}
              index={step}
              level={level}
              value={picked[step]}
              disabled={blocked}
              blockedBy={blocked ? LEVELS[step - 1].label.toLowerCase() : undefined}
              onOpen={() => setOpenStep(step)}
              onClear={() => pick(step, '')}
            />
          );
        })}
      </div>

      <StepOverlay
        open={openStep !== null}
        step={openStep ?? 0}
        level={openStep === null ? null : LEVELS[openStep]}
        options={openStep === null ? [] : optionsAt(openStep)}
        picked={picked}
        adding={createDevice.isPending}
        onClose={() => setOpenStep(null)}
        /**
         * Answer the step, then move to the next one.
         *
         * The walk stays inside one panel - which is the continuous behaviour
         * the storefront's wizard has and this did not. The last level has
         * nothing below it, so it leaves `openStep` where it is and the
         * overlay closes itself.
         */
        onPick={(name) => {
          pick(openStep, name);
          if (openStep < LEVELS.length - 1) setOpenStep(openStep + 1);
        }}
        onAdd={async (name) => {
          const created = await add(openStep, name);
          if (created && openStep < LEVELS.length - 1) setOpenStep(openStep + 1);
          return created;
        }}
        // Going back re-opens a level that already has an answer. It is not
        // cleared on the way in: the staff member may be checking it rather
        // than changing it, and picking again clears what is below anyway.
        onBack={(index) => setOpenStep(index)}
      />
    </>
  );
}

export default DeviceFinder;
