import { Check } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';

/**
 * One answer on a tap-to-choose question.
 *
 * `selected` is for the multi-choice questions (faults, contact channels),
 * where a tap toggles rather than advances and the customer needs to see what
 * they have already picked. A single-choice question advances on the tap and
 * never shows a selected state, because the next screen is the confirmation.
 */
export function KioskOption({ label, detail, selected, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected == null ? undefined : selected}
      className={cn(
        pressable,
        'flex min-h-16 items-center justify-center gap-2.5 rounded-xl border px-6 py-3 text-center',
        selected
          ? 'border-brand bg-brand-50 text-ink-900'
          : 'border-line bg-surface text-ink-900 hover:border-line-strong',
        className,
      )}
    >
      {selected && (
        <Check className="size-5 shrink-0 text-brand" strokeWidth={2.5} aria-hidden="true" />
      )}
      <span>
        <span className="block font-display text-xl font-semibold">{label}</span>
        {detail && <span className="mt-0.5 block text-md text-ink-500">{detail}</span>}
      </span>
    </button>
  );
}

export default KioskOption;
