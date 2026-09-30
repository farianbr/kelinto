import { Check } from 'lucide-react';

import KioskChrome from './KioskChrome';
import KioskButton from './KioskButton';

/**
 * The thank-you screen at the end of a repair check-in or a phone sale.
 *
 * **The number is the one thing on it that matters after they walk away**, so
 * it takes the size. The check sits inline with the heading at glyph size: a
 * big disc holding a tick above "You're all set" would say the same thing
 * twice, louder.
 */
export function KioskDone({ title, message, numberLabel, number, onDone, chrome }) {
  return (
    <KioskChrome {...chrome}>
      <div className="text-center">
        <h1 className="inline-flex items-center gap-3 font-display text-d-sm font-bold text-ink-900">
          <Check className="size-9 shrink-0 text-ok" strokeWidth={2.75} aria-hidden="true" />
          {title}
        </h1>
        {message && <p className="mx-auto mt-3 max-w-xl text-xl text-ink-500">{message}</p>}

        <p className="mt-10 text-lg text-ink-500">{numberLabel}</p>
        <p className="tnum mt-1 font-mono text-d-md font-bold text-ink-900">{number}</p>

        <KioskButton tone="quiet" onClick={onDone} className="mx-auto mt-10 w-full max-w-xs">
          Done
        </KioskButton>
      </div>
    </KioskChrome>
  );
}

export default KioskDone;
