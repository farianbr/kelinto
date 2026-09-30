import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';

/**
 * The kiosk's primary and secondary action.
 *
 * Deliberately larger than `ui/Button`: this is a touch target on a tablet
 * reached at arm's length, not a control under a mouse. The primary tone takes
 * the business's gradient because it is the one thing on each screen the
 * customer is meant to press next; the quiet tone is for the way back.
 */
export function KioskButton({ children, tone = 'primary', className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cn(
        pressable,
        'inline-flex min-h-16 items-center justify-center gap-3 rounded-xl px-8 font-display text-xl font-bold',
        'disabled:cursor-not-allowed',
        // A disabled primary drops the gradient for flat grey, as ui/Button does:
        // a faded ramp reads as a muddy, half-pressed button, not an unavailable one.
        tone === 'primary' && 'bg-brand-gradient text-white disabled:bg-none disabled:bg-surface-3 disabled:text-ink-400',
        tone === 'quiet' && 'border border-line bg-surface text-ink-700 disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export default KioskButton;
