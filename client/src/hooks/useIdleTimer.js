import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Anything a person does to a screen. Scroll and wheel count: a customer
 * reading a long product page is using the tablet without touching a control.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'input'];

/**
 * Notice a person walking away from a shared screen.
 *
 * ## The two phases
 *
 * `timeoutSeconds` of no activity, then a warning that counts down
 * `warningSeconds`, then `onTimeout`. The warning exists because a customer
 * reading their terms or hunting for a model number is not touching anything
 * either, and signing them out without a word loses everything they typed.
 *
 * ## Why a ticking interval and not one long `setTimeout`
 *
 * The countdown has to show a number that goes down, so something ticks every
 * second anyway, and one clock deciding both "warn now" and "time up" cannot
 * disagree with itself. It also survives a tablet that slept: on waking, the
 * elapsed time is read off the wall clock rather than trusted to a timer the
 * browser paused.
 *
 * Any activity during the warning counts as "still here", which is what a
 * customer tapping the screen in a hurry means.
 */
export function useIdleTimer({ active, timeoutSeconds, warningSeconds, onTimeout }) {
  const lastActivity = useRef(Date.now());
  const [remaining, setRemaining] = useState(null);

  // The latest callback without restarting the clock every render.
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const stillHere = useCallback(() => {
    lastActivity.current = Date.now();
    setRemaining(null);
  }, []);

  useEffect(() => {
    if (!active) {
      setRemaining(null);
      return undefined;
    }

    lastActivity.current = Date.now();
    const mark = () => {
      lastActivity.current = Date.now();
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, mark, { capture: true, passive: true });
    }

    const idleMs = timeoutSeconds * 1000;
    const totalMs = idleMs + warningSeconds * 1000;

    const tick = setInterval(() => {
      const elapsed = Date.now() - lastActivity.current;
      if (elapsed >= totalMs) {
        setRemaining(null);
        lastActivity.current = Date.now();
        onTimeoutRef.current?.();
      } else if (elapsed >= idleMs) {
        setRemaining(Math.ceil((totalMs - elapsed) / 1000));
      } else {
        setRemaining(null);
      }
    }, 250);

    return () => {
      clearInterval(tick);
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, mark, { capture: true });
      }
    };
  }, [active, timeoutSeconds, warningSeconds]);

  return { warning: remaining != null, remaining: remaining ?? 0, stillHere };
}

export default useIdleTimer;
