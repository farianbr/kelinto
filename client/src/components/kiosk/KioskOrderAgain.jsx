import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

import KioskChrome from './KioskChrome';
import KioskButton from './KioskButton';

/**
 * "Order again?", after a purchase on the kiosk.
 *
 * ## Why the order is restated here
 *
 * The website's thank-you page hands straight back to the tablet, so this is
 * the screen the customer is looking at when they walk to the counter. The
 * order number and "pay at the counter" are what they need there; the question
 * is second.
 *
 * ## The clock
 *
 * The likeliest answer is that they have already walked off with their number.
 * So after `seconds` (Settings › Kiosk › "Order again?" waits) it answers No for
 * them: signed out, back to the welcome screen. It counts down on screen,
 * because a session ending with no warning reads as the tablet crashing.
 */
export function KioskOrderAgain({ orderNumber, seconds, onAgain, onFinish, busy, chrome }) {
  const [left, setLeft] = useState(seconds);
  const finished = useRef(false);

  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0 && !finished.current) {
        finished.current = true;
        onFinish();
      }
    }, 250);
    return () => clearInterval(tick);
  }, [seconds, onFinish]);

  return (
    <KioskChrome {...chrome}>
      <div className="text-center">
        <p className="inline-flex items-center gap-2 text-lg font-medium text-ok">
          <Check className="size-5" strokeWidth={2.75} aria-hidden="true" />
          Order placed
        </p>
        {orderNumber && (
          <p className="tnum mt-2 font-mono text-d-sm font-bold text-ink-900">{orderNumber}</p>
        )}
        <p className="mx-auto mt-2 max-w-md text-xl text-ink-500">
          Pay and collect it at the counter. Give them this number.
        </p>

        <h1 className="mt-12 font-display text-d-sm font-bold text-ink-900">
          Would you like to order anything else?
        </h1>

        <div className="mx-auto mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
          <KioskButton onClick={onAgain} disabled={busy}>
            Yes, keep shopping
          </KioskButton>
          <KioskButton tone="quiet" onClick={onFinish} disabled={busy}>
            No, sign me out
          </KioskButton>
        </div>

        <p className="mt-6 text-lg text-ink-500" role="timer">
          Signing you out in <span className="tnum font-semibold text-ink-900">{left}</span> seconds
        </p>
      </div>
    </KioskChrome>
  );
}

export default KioskOrderAgain;
