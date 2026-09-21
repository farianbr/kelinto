import { forwardRef, useId } from 'react';
import { AlertCircle } from 'lucide-react';
import cn from '@/lib/cn';
import { useDensity, labelSize, hintSize } from './density';

/**
 * Multi-line field. Mirrors `Input`'s API - label, hint, error - so a form can
 * swap one for the other without changing anything around it.
 */
export const Textarea = forwardRef(function Textarea(
  {
    label,
    hint,
    error,
    className,
    containerClassName,
    id: idProp,
    rows = 4,
    counter,
    value,
    // Same contract as `Input`: the asterisk beside the label and the native
    // attribute, so the mark and the browser cannot disagree about which
    // fields are mandatory.
    required,
    ...props
  },
  ref,
) {
  const density = useDensity();
  const generatedId = useId();
  const id = idProp || generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('w-full', containerClassName)}>
      {(label || counter) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={id} className={cn(labelSize(density).replace(/^mb-[d.]+ /, ''), 'block font-medium text-ink-700')}>
              {label}
              {required && (
                <span className="ml-0.5 text-danger" aria-hidden="true">
                  *
                </span>
              )}
            </label>
          )}
          {counter ? (
            <span className="tnum text-xs text-ink-300">
              {String(value ?? '').length} / {counter}
            </span>
          ) : null}
        </div>
      )}

      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        // The asterisk is decorative, so the requirement reaches a screen
        // reader through the field rather than a character it never announces.
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          // 16px on a phone whatever the density - see `ui/density.js` on why
          // that number is load-bearing on iOS.
          density === 'compact'
            ? 'w-full rounded-md border bg-surface px-3 py-2 text-lg leading-relaxed text-ink-900 sm:text-sm'
            : 'w-full rounded-md border bg-surface px-3.5 py-2.5 text-lg leading-relaxed text-ink-900 sm:text-md',
          'placeholder:text-ink-300',
          'transition-[border-color,box-shadow] duration-press',
          'hover:border-line-strong',
          'focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900/15',
          'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-400',
          error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-line',
          className,
        )}
        {...props}
      />

      {error ? (
        <p id={`${id}-error`} className="mt-1.5 flex items-center gap-1.5 text-sm text-danger">
          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Textarea;
