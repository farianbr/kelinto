import { forwardRef, useEffect, useId, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

import Overlay from '@/components/ui/Overlay';
import cn from '@/lib/cn';
import { dialog, pressable } from '@/lib/motion';
import { PlatformButton } from '@/components/superadmin/PlatformUI';

/**
 * Form surfaces for the platform console (SAAS_PLATFORM §0.1).
 *
 * **The last piece of the separation.** The console's screens wear the
 * platform's own identity, and a modal is where the most consequential actions
 * happen, which makes it the worst place for the tenant's brand to slip in.
 *
 * **Built on the same `Overlay` as the tenant panel's `Modal`.** Focus
 * trapping, the scrim, escape-to-close and scroll locking are solved problems
 * with real accessibility work behind them; reimplementing them to change a
 * background colour would swap correctness for paint.
 */

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

/**
 * A dialog on the console's own surface.
 *
 * `footer` is the action row, pinned below a rule so reading and acting are
 * separated by a real edge and a long body scrolls without taking the buttons
 * with it.
 */
export function PlatformModal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  align = 'center',
  footer,
  children,
}) {
  const titleId = useId();

  return (
    <Overlay
      open={open}
      onClose={onClose}
      align={align}
      labelledBy={title ? titleId : undefined}
      label={title ? undefined : 'Dialog'}
      panelMotion={dialog}
      panelClassName={cn('w-full', SIZES[size])}
    >
      {/*
        A border AND a shadow here, unlike a panel on the page: a dialog floats
        above the layout, and on a dark ground a shadow alone does almost
        nothing to separate it. The hairline is what gives the sheet an edge.
      */}
      <div className="kelinto flex max-h-[88vh] flex-col overflow-hidden rounded-xl border border-plat-line bg-plat-surface shadow-flyout">
        {title && (
          <header className="flex shrink-0 items-start gap-4 border-b border-plat-line-soft px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-xl font-semibold leading-tight tracking-tight text-plat-text">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm leading-normal text-plat-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className={cn(
                pressable,
                '-mr-1.5 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-md',
                'text-plat-dim transition-colors duration-fast hover:bg-plat-text/6 hover:text-plat-text',
              )}
            >
              <X className="size-4.5" strokeWidth={1.75} />
            </button>
          </header>
        )}

        <div className="scroll-slim flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-plat-line-soft px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </Overlay>
  );
}

const fieldClasses = (error) =>
  cn(
    // 16px on a phone is load-bearing: below it mobile Safari zooms the page
    // on focus and never zooms back out. The console is desktop-first, so the
    // text drops to the compact 13px from `sm` up, the admin panel's density.
    'w-full rounded-lg border bg-plat-raised px-3 text-lg text-plat-text sm:text-sm',
    'placeholder:text-plat-dim',
    // The focus ring is the accent, the one place colour means "you are here".
    'outline-none transition-colors duration-fast',
    'focus:border-plat-accent focus:ring-2 focus:ring-plat-accent/25',
    'disabled:cursor-not-allowed disabled:opacity-60',
    error ? 'border-plat-danger' : 'border-plat-line',
  );

function FieldLabel({ id, label, required }) {
  if (!label) return null;
  return (
    <label htmlFor={id} className="mb-1.5 block text-sm font-medium leading-tight text-plat-muted">
      {label}
      {required && (
        <span className="ml-0.5 text-plat-danger" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
}

function FieldNote({ id, hint, error }) {
  if (error) {
    return (
      <p id={`${id}-error`} className="mt-1.5 text-xs text-plat-danger">
        {error}
      </p>
    );
  }
  if (!hint) return null;
  return (
    <p id={`${id}-hint`} className="mt-1.5 text-xs leading-normal text-plat-dim">
      {hint}
    </p>
  );
}

/**
 * A labelled field.
 *
 * The label is a real `<label>` bound by id rather than a placeholder: a
 * placeholder disappears the moment somebody types, which is exactly when they
 * most need to know what they are filling in. `prefix` is for a unit that
 * belongs to the value, such as `$`, so it is never typed twice.
 */
export const PlatformInput = forwardRef(function PlatformInput(
  { label, hint, error, required, className, prefix, suffix, ...props },
  ref,
) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={className}>
      <FieldLabel id={id} label={label} required={required} />
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-plat-dim">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
          className={cn(fieldClasses(error), 'h-9', prefix && 'pl-7', suffix && 'pr-24')}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-plat-dim">
            {suffix}
          </span>
        )}
      </div>
      <FieldNote id={id} hint={hint} error={error} />
    </div>
  );
});

/** A multi-line field, for notes and reasons that run to a sentence or three. */
export const PlatformTextarea = forwardRef(function PlatformTextarea(
  { label, hint, error, required, className, rows = 3, ...props },
  ref,
) {
  const id = useId();
  return (
    <div className={className}>
      <FieldLabel id={id} label={label} required={required} />
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
        className={cn(fieldClasses(error), 'resize-y py-2 leading-normal')}
      />
      <FieldNote id={id} hint={hint} error={error} />
    </div>
  );
});

/**
 * A native `<select>` rather than a custom menu.
 *
 * The console's option lists are short and static, and a native control brings
 * keyboard handling, mobile pickers and accessibility for free. A custom menu
 * earns its place when the options need icons, descriptions or search.
 */
export const PlatformSelect = forwardRef(function PlatformSelect(
  { label, hint, error, required, options = [], className, ...props },
  ref,
) {
  const id = useId();

  return (
    <div className={className}>
      <FieldLabel id={id} label={label} required={required} />
      <select ref={ref} id={id} required={required} {...props} className={cn(fieldClasses(error), 'h-9')}>
        {options.map((option) => (
          // Options render in the OS menu, which paints them itself; explicit
          // colours stop a dark system menu showing white on white.
          <option key={option.value} value={option.value} className="bg-plat-surface text-plat-text">
            {option.label}
          </option>
        ))}
      </select>
      <FieldNote id={id} hint={hint} error={error} />
    </div>
  );
});

/**
 * One choice from a few, each explained.
 *
 * For a decision whose options differ in consequence (a tenant's status, a
 * business's state) a dropdown hides the consequences until opened. Cards
 * show every option and what it does at once, so the choice is made reading
 * the effect rather than the label.
 */
export function PlatformChoice({ legend, value, onChange, options, name }) {
  return (
    <fieldset>
      {legend && <legend className="mb-2 text-sm font-medium text-plat-muted">{legend}</legend>}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                pressable,
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3',
                selected
                  ? 'border-plat-accent bg-plat-accent/10'
                  : 'border-plat-line bg-plat-raised hover:border-plat-dim',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 size-4 shrink-0 accent-plat-accent"
              />
              <span className="min-w-0">
                <span className="block text-md font-medium text-plat-text">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-xs leading-normal text-plat-muted">
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * An on/off control that stages rather than saves.
 *
 * A switch, not a checkbox, because what it holds is a setting rather than a
 * form answer. Whether flipping it writes anything is the caller's decision;
 * in the console it never does on its own (see `FeatureGrid`).
 */
export function PlatformSwitch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        pressable,
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-snap',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-plat-ok' : 'bg-plat-line',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full bg-white transition-[left] duration-snap',
          checked ? 'left-4.5' : 'left-0.5',
        )}
        aria-hidden="true"
      />
    </button>
  );
}

/** An inline error, in the shape every console form uses. */
export function PlatformError({ children }) {
  if (!children) return null;

  return (
    <p
      role="alert"
      className="mb-4 flex items-start gap-2 border-l-2 border-plat-danger bg-plat-danger/5 py-2 pl-3 pr-3 text-sm text-plat-text"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-plat-danger" strokeWidth={2} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * A consequence somebody should read before saving.
 *
 * Marked by a rule on the leading edge, not a coloured wash: coloured text on
 * its own tint makes every sentence read as an alarm, including the calm ones.
 */
export function PlatformNotice({ icon: Icon, tone = 'warn', children }) {
  return (
    <div
      className={cn(
        'mb-4 flex items-start gap-2.5 border-l-2 py-1 pl-3 text-sm leading-relaxed text-plat-text',
        tone === 'danger' ? 'border-plat-danger' : tone === 'accent' ? 'border-plat-accent' : 'border-plat-warn',
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            'mt-0.5 size-4 shrink-0',
            tone === 'danger' ? 'text-plat-danger' : tone === 'accent' ? 'text-plat-accent-soft' : 'text-plat-warn',
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The row of actions at the foot of a form. Cancel left, commit right. */
export function PlatformActions({ children }) {
  return <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-plat-line-soft pt-4">{children}</div>;
}

/**
 * Every write the console fires from one click goes through here (§3.0.1).
 *
 * **Names the record and states the consequence.** `title` is the act on a
 * named record ("Suspend Northline Group?"), `children` is what happens, and
 * `changes` lists before and after when the act replaces something - the one
 * thing an operator cannot see from the page they clicked on.
 *
 * **`confirmPhrase` is the second confirmation**, for anything irreversible,
 * money-moving, public or reaching a third party. The operator types the
 * record's own name or address back, which is a phrase they have to read to
 * type and so cannot be confirmed on reflex the way a second button can.
 */
export function PlatformConfirm({
  open,
  onClose,
  onConfirm,
  title,
  children,
  changes,
  confirmLabel = 'Confirm',
  confirmPhrase,
  tone = 'default',
  isPending,
  error,
}) {
  const [typed, setTyped] = useState('');
  const phraseId = useId();

  // A fresh dialog starts empty: a phrase typed for the last record must not
  // carry over and pre-confirm the next one.
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const phraseOk = !confirmPhrase || typed.trim().toLowerCase() === String(confirmPhrase).toLowerCase();

  return (
    <PlatformModal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      align="top"
      footer={
        <>
          <PlatformButton variant="ghost" onClick={onClose}>
            Cancel
          </PlatformButton>
          <PlatformButton
            variant={tone === 'danger' ? 'danger-solid' : 'primary'}
            disabled={!phraseOk}
            loading={isPending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </PlatformButton>
        </>
      }
    >
      <PlatformError>{error}</PlatformError>
      <div className="space-y-3 text-md leading-relaxed text-plat-muted">{children}</div>

      {changes?.length > 0 && (
        <dl className="mt-4 divide-y divide-plat-line-soft rounded-lg border border-plat-line-soft">
          {changes.map((change) => (
            <div key={change.label} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[9rem_1fr]">
              <dt className="text-xs text-plat-dim sm:pt-0.5">{change.label}</dt>
              <dd className="min-w-0 text-sm">
                <span className="block break-all font-mono text-plat-dim line-through decoration-plat-dim/60">
                  {change.from || 'None'}
                </span>
                <span className="block break-all font-mono text-plat-text">{change.to || 'None'}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {confirmPhrase && (
        <div className="mt-5">
          <label htmlFor={phraseId} className="mb-1.5 block text-sm text-plat-muted">
            Type <span className="font-mono text-plat-text">{confirmPhrase}</span> to confirm
          </label>
          <input
            id={phraseId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={cn(fieldClasses(false), 'h-9 font-mono')}
          />
        </div>
      )}
    </PlatformModal>
  );
}
