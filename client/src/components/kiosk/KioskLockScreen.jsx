import { useState } from 'react';
import { ArrowRight, Delete, Lock } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';

/** The keypad, in phone order. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

const KEY_CLASS = cn(
  pressable,
  'min-h-16 rounded-lg bg-surface-2 font-display text-2xl font-bold text-ink-900',
);

/**
 * The lock screen.
 *
 * Staff enter the PIN once when the shop opens and the tablet stays unlocked
 * for the day. The lock is there so the device cannot be walked off with and
 * used, not so each customer has to be let in, which is also why an idle
 * timeout returns to the welcome screen and never to this one.
 *
 * Dots rather than digits, because somebody is standing at a counter.
 */
export function KioskLockScreen({ businessName, onUnlock, isPending, error }) {
  const [pin, setPin] = useState('');

  const press = (digit) => setPin((value) => (value.length >= 8 ? value : value + digit));
  const back = () => setPin((value) => value.slice(0, -1));
  const submit = () => {
    if (pin.length >= 4) onUnlock(pin, () => setPin(''));
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-2 px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 sm:p-8">
        <p className="flex items-center gap-2 text-md font-medium text-ink-500">
          <Lock className="size-4" strokeWidth={2} aria-hidden="true" />
          {businessName ?? 'Kiosk'}
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink-900">Kiosk locked</h1>
        <p className="mt-1.5 text-md text-ink-500">Staff: enter the kiosk PIN to open it for the day.</p>

        <div className="my-6 flex justify-center gap-3" aria-hidden="true">
          {Array.from({ length: Math.max(4, pin.length) }, (_, index) => (
            <span
              key={index}
              className={cn(
                'size-3 rounded-full transition-colors',
                index < pin.length ? 'bg-brand' : 'bg-line-strong',
              )}
            />
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {pin.length} digits entered
        </p>

        {error && (
          <p role="alert" className="mb-4 border-l-2 border-danger pl-3 text-md text-danger">
            {error}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((key) => (
            <button key={key} type="button" onClick={() => press(key)} className={KEY_CLASS}>
              {key}
            </button>
          ))}
          <button
            type="button"
            onClick={back}
            aria-label="Delete a digit"
            className={cn(pressable, 'min-h-16 rounded-lg border border-line bg-surface text-ink-700')}
          >
            <Delete className="mx-auto size-6" strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => press('0')} className={KEY_CLASS}>
            0
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pin.length < 4 || isPending}
            aria-label="Unlock"
            className={cn(
              pressable,
              'bg-brand-gradient-compact min-h-16 rounded-lg text-white disabled:bg-none disabled:bg-surface-3 disabled:text-ink-400',
            )}
          >
            <ArrowRight className="mx-auto size-6" strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-6 text-sm leading-snug text-ink-400">
          On an iPad, run this under <strong className="font-semibold">Guided Access</strong>{' '}
          (Settings, Accessibility) so it cannot be closed.
        </p>
      </div>
    </div>
  );
}

export default KioskLockScreen;
