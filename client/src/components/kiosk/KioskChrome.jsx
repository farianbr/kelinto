import { RotateCcw, Volume2, VolumeX } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';

/**
 * The frame every kiosk screen past the lock sits in.
 *
 * The business's name on the left, because the customer should know whose
 * tablet this is before typing their number into it. Progress in the middle,
 * as a bar and not "Question 4 of 14": the count changes as answers open and
 * close branches, and a total that jumps reads as the tablet losing track.
 *
 * **Start over** is always there once a flow has begun. On a shared screen the
 * next person in the queue must never be stuck behind somebody else's half
 * check-in waiting for a timer.
 */
export function KioskChrome({
  businessName,
  progress,
  readAloud,
  onToggleAloud,
  speechSupported,
  onStartOver,
  children,
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-2">
      <header className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
        <p className="min-w-0 shrink truncate font-display text-md font-bold text-ink-900 sm:text-lg">
          {businessName}
        </p>

        {progress != null ? (
          <div
            className="h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div
              className="bg-brand-gradient-compact h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
            />
          </div>
        ) : (
          <span className="flex-1" />
        )}

        {onStartOver && (
          <button
            type="button"
            onClick={onStartOver}
            className={cn(
              pressable,
              'inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-md font-medium text-ink-700',
            )}
          >
            <RotateCcw className="size-4" strokeWidth={2} aria-hidden="true" />
            <span className="hidden sm:inline">Start over</span>
            <span className="sr-only sm:hidden">Start over</span>
          </button>
        )}

        {speechSupported && (
          <button
            type="button"
            onClick={onToggleAloud}
            aria-label={readAloud ? 'Stop reading aloud' : 'Read questions aloud'}
            aria-pressed={readAloud}
            className={cn(
              pressable,
              'inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface',
              readAloud ? 'text-brand' : 'text-ink-400',
            )}
          >
            {readAloud ? (
              <Volume2 className="size-5" strokeWidth={2} aria-hidden="true" />
            ) : (
              <VolumeX className="size-5" strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        )}
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-10 pt-4 sm:px-6">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}

export default KioskChrome;
