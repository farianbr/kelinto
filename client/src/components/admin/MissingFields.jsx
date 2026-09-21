import { AlertCircle } from 'lucide-react';

import cn from '@/lib/cn';

/**
 * What a refused submit is still missing, named beside the button that refused.
 *
 * ## Why this is not a disabled button
 *
 * The obvious reading of "the submit should show if a mandatory field is
 * missing" is to grey the button out until the form is complete. That is the
 * version to avoid. A disabled button answers nothing: it cannot be pressed,
 * so it cannot explain itself, and on a form the length of an intake sheet the
 * one field holding it back is usually off screen. The person presses nothing,
 * learns nothing and concludes the page is broken - which is exactly the
 * failure `useAdminForm` was written to fix, from the other direction.
 *
 * So the button stays pressable. Pressing it validates, `useAdminForm` scrolls
 * the first bad field into the middle of the viewport, and this line names
 * every one of them next to the button that was just pressed. The red stars on
 * the fields say what is required before the attempt; this says what is still
 * outstanding after it.
 *
 * ## Before the first submit it says nothing
 *
 * `errors` is empty until `mode: 'onSubmit'` fills it, so this renders nothing
 * on a form somebody has only just opened. A form that greets you by listing
 * what you have not typed yet is accusing you of a mistake you have not made -
 * the same reasoning that took `useAdminForm` off `onTouched`.
 *
 * ## Use
 *
 * ```jsx
 * const { formState: { errors } } = useAdminForm({ resolver: zodResolver(schema) });
 * …
 * <MissingFields errors={errors} labels={{ user: 'Customer', 'devices.0.model': 'Device' }} />
 * ```
 *
 * `labels` maps a field path to what the form calls it on screen, because
 * `devices.0.model` is not a name anybody at a counter would recognise. A path
 * with no entry falls back to its own zod message, which is already written as
 * a sentence ("Pick a model."), so an unmapped field degrades to something
 * readable rather than to a key.
 */
export function MissingFields({ errors, labels = {}, className }) {
  const names = missingNames(errors, labels);
  if (names.length === 0) return null;

  return (
    <p
      // Assertive rather than polite: this is the answer to a button the person
      // just pressed, and a queued announcement arrives after they have already
      // started hunting for the reason themselves.
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span>
        {names.length === 1 ? 'Still needed: ' : `Still needed (${names.length}): `}
        <strong className="font-semibold">{names.join(' · ')}</strong>
      </span>
    </p>
  );
}

/**
 * The on-screen name of every field in error, in the order they were found.
 *
 * Deduplicated, because a repeater puts the same label on every row it rejects
 * and "Device · Device · Device" names a problem three times without saying
 * which row. The count in the heading still carries how many there are.
 */
function missingNames(errors, labels) {
  const names = [];

  for (const [path, message] of flatten(errors)) {
    const label = labels[path] ?? labels[generalise(path)] ?? message;
    if (label && !names.includes(label)) names.push(label);
  }

  return names;
}

/**
 * Every leaf error as `[path, message]`.
 *
 * RHF nests errors the way it nests values, so a device model arrives as
 * `{ devices: [{ model: {...} }] }` while the field is named
 * `devices.0.model`. A leaf is recognised by carrying a `type` or a `message`,
 * which is the same test `useAdminForm` uses to find the first one to scroll
 * to - the two have to agree about what an error is or the summary names a
 * field the page never scrolled to.
 */
function flatten(errors, prefix = '') {
  if (!errors || typeof errors !== 'object') return [];

  const found = [];

  for (const [key, value] of Object.entries(errors)) {
    if (!value || typeof value !== 'object') continue;

    const path = prefix ? `${prefix}.${key}` : key;

    if (value.type || value.message) {
      found.push([path, typeof value.message === 'string' ? value.message : '']);
      continue;
    }

    found.push(...flatten(value, path));
  }

  return found;
}

/**
 * `devices.0.model` as `devices.*.model`, so a repeater is labelled once.
 *
 * Every row of a field array has the same field with the same name on screen,
 * and writing an entry per index would mean a `labels` map that has to be
 * extended every time somebody adds a fourth device.
 */
function generalise(path) {
  return path.replace(/\.\d+\./g, '.*.');
}

export default MissingFields;
