import { useId } from 'react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';

/**
 * "Active" on a message form: whether the message sends at all.
 *
 * A form field, not a write. It changes the form's state and goes out with the
 * form's own Save, so switching a message on is never a one-click send to
 * customers (Instructions §3.0.1). Shared by every Communications form that
 * holds a message, so the three read the same way.
 */
export function ActiveSwitch({ checked, onChange, label = 'Active', detail }) {
  const id = useId();

  return (
    <div className="flex items-start gap-3 rounded-md bg-surface-2 px-3 py-2.5">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={detail ? `${id}-detail` : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          pressable,
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-ok' : 'bg-line-strong',
        )}
      >
        <span
          className={cn('size-4 rounded-full bg-white transition-transform', checked && 'translate-x-4')}
        />
      </button>

      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm leading-relaxed text-ink-700">
        <span className="font-medium">{label}</span>
        <span className="text-ink-400"> · {checked ? 'on' : 'off'}</span>
        {detail && (
          <span id={`${id}-detail`} className="mt-0.5 block text-sm text-ink-500">
            {detail}
          </span>
        )}
      </label>
    </div>
  );
}

export default ActiveSwitch;
