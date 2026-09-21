import { useCallback } from 'react';
import { useForm } from 'react-hook-form';

/**
 * `useForm`, with this project's rules about failed submits already applied.
 *
 * ## Why this exists
 *
 * A form that refuses to submit has to say which field is wrong and put the
 * person in front of it. Ours did neither reliably: an invalid form reported a
 * message somewhere on the page and left the scroll position alone, so on any
 * form longer than the viewport - most of `/admin` - the screen simply did not
 * move and the submit read as broken rather than as refused.
 *
 * Two things were behind that, and this hook fixes both in one place rather
 * than in each of the fifty-odd forms:
 *
 * 1. **The field could not be focused.** `shouldFocusError` is on by default in
 *    react-hook-form, but it can only focus a node it was given a ref for.
 *    Custom controls - our dropdowns above all - registered through
 *    `Controller` and never handed their button back, so RHF had nothing to
 *    focus and quietly did nothing. `SelectField` now forwards `field.ref`, and
 *    this hook keeps the flag on explicitly so it reads as a decision.
 *
 * 2. **Focus alone is not enough.** A focused control inside a scrolling panel
 *    can still be behind a sticky header, and `focus()` scrolls the minimum
 *    distance needed - which puts the field flush against the top edge, often
 *    under the admin shell's own header. `onInvalid` below scrolls the first
 *    error into the middle of the viewport, where it can actually be read.
 *
 * ## Use
 *
 * ```jsx
 * const { register, handleSubmit, formState: { errors } } = useAdminForm({
 *   resolver: zodResolver(schema),
 *   defaultValues: { ... },
 * });
 * ```
 *
 * `handleSubmit` takes the same arguments as RHF's. A second argument still
 * works and runs after the scroll, so a form needing its own invalid handling
 * keeps it.
 *
 * ## When errors appear
 *
 * **On submit, never before** - see `mode` below. A field the person has not
 * filled in yet is not a field they got wrong, and marking it red as they tab
 * past accuses them of a mistake they have not made.
 */
export function useAdminForm(options = {}) {
  const form = useForm({
    /*
      Nothing is validated until the person presses the button.

      This was `onTouched`, on the reasoning that somebody correcting one field
      should not have to submit again to find out whether they got it right.
      What it did in practice was accuse people of mistakes they had not made
      yet: tabbing through a form to see what it asks for - clicking into Email,
      clicking out to Phone - lit up every field left empty on the way past,
      before a single character had been typed. An empty field somebody has not
      filled in yet is not an error, it is a field they have not reached.

      `onSubmit` holds until the button, and `reValidateMode` then takes over:
      once a field HAS been rejected, it re-checks as the person types, so the
      message clears the moment it is fixed rather than at the next submit.
      That keeps the correction loop `onTouched` was reaching for, without
      pre-emptively marking untouched fields wrong.
    */
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    ...options,
  });

  const { handleSubmit: rhfHandleSubmit } = form;

  const handleSubmit = useCallback(
    (onValid, onInvalid) =>
      rhfHandleSubmit(onValid, (errors, event) => {
        scrollFirstErrorIntoView(errors);
        return onInvalid?.(errors, event);
      }),
    [rhfHandleSubmit],
  );

  return { ...form, handleSubmit };
}

/**
 * Put the first invalid field somewhere it can be read.
 *
 * RHF has already focused it by the time this runs, so the work here is only
 * about position: `focus()` scrolls by the smallest amount that makes the node
 * visible, which frequently means "flush with the top of the scroll container"
 * - and in `/admin` that is underneath the sticky header. Centring it costs
 * nothing when the field was already comfortably in view, because the browser
 * skips a scroll that changes nothing.
 *
 * Deliberately best-effort: it reads the first key out of the error object and
 * gives up quietly if it cannot find a matching node. A form that fails to
 * scroll still shows its errors, and throwing here would replace a small
 * annoyance with a blank screen.
 */
function scrollFirstErrorIntoView(errors) {
  const firstName = firstErrorName(errors);
  if (!firstName || typeof document === 'undefined') return;

  const escaped =
    typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(firstName) : firstName.replace(/"/g, '\\"');

  const node =
    document.querySelector(`[name="${escaped}"]`) ??
    document.querySelector(`#${escaped}`) ??
    document.querySelector(`[aria-invalid="true"]`);

  node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

/**
 * The name of the first field in error, including nested ones.
 *
 * RHF nests errors the same way it nests values, so an address line comes back
 * as `{ address: { postal: {...} } }` while the field itself is named
 * `address.postal`. An error object is recognised by carrying a `type`, which
 * is what separates a leaf from a branch on the way down.
 */
function firstErrorName(errors, prefix = '') {
  if (!errors || typeof errors !== 'object') return null;

  for (const [key, value] of Object.entries(errors)) {
    if (!value || typeof value !== 'object') continue;

    const path = prefix ? `${prefix}.${key}` : key;
    if (value.type || value.message) return path;

    const nested = firstErrorName(value, path);
    if (nested) return nested;
  }

  return null;
}

export default useAdminForm;
