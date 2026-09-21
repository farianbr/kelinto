import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { useDensity, fieldSize, labelSize, hintSize } from './density';

/**
 * Large-touch-target text field. The checkout brief asks for friction-free fields,
 * so the same control is used in checkout, sign-up and the account forms.
 */
export const Input = forwardRef(function Input(
  {
    label,
    hint,
    error,
    icon: Icon,
    className,
    containerClassName,
    type = 'text',
    id: idProp,
    suffix,
    // Draws the red asterisk beside the label AND sets the native attribute, so
    // the mark and the browser's own validation can never disagree about which
    // fields are mandatory.
    required,
    ...props
  },
  ref,
) {
  const density = useDensity();
  const generatedId = useId();
  const id = idProp || generatedId;
  const [revealed, setRevealed] = useState(false);

  const isPassword = type === 'password';
  const resolvedType = isPassword && revealed ? 'text' : type;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('w-full', containerClassName)}>
      {label && (
        <label
          htmlFor={id}
          className={cn(labelSize(density), 'block font-medium text-ink-700')}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-ink-300"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        )}

        <input
          ref={ref}
          id={id}
          type={resolvedType}
          // The asterisk is decorative (aria-hidden), so the requirement
          // reaches a screen reader through the field itself rather than
          // through a character it never announces.
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            // 16px on a phone, 14 from sm up. Mobile Safari zooms the page in
            // when a focused input's text is under 16px and never zooms back
            // out, which leaves the sticky header wider than the viewport for
            // the rest of the visit. Same rule in Textarea, Select and LiveSearch.
            // Height and text come from the density in scope - 44px on the
            // storefront, 36px in the admin panel. See `ui/density.js`.
            fieldSize(density),
            'w-full rounded-md border bg-surface px-3.5 text-ink-900',
            'placeholder:text-ink-300',
            'transition-[border-color,box-shadow] duration-press',
            'hover:border-line-strong',
            'focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900/15',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-400',
            Icon && 'pl-10',
            (isPassword || suffix) && 'pr-11',
            error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-line',
            className,
          )}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className={cn(pressable, 'absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 hover:bg-surface-3 hover:text-ink-700')}
          >
            {revealed ? (
              <EyeOff className="size-[18px]" strokeWidth={1.75} />
            ) : (
              <Eye className="size-[18px]" strokeWidth={1.75} />
            )}
          </button>
        )}

        {!isPassword && suffix && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-400">
            {suffix}
          </span>
        )}
      </div>

      {error ? (
        <p
          id={`${id}-error`}
          className={cn(hintSize(density), 'flex items-center gap-1.5 text-danger')}
        >
          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={cn(hintSize(density), 'text-ink-400')}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Input;
