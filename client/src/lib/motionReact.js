import { createElement, forwardRef } from 'react';
import { motion as baseMotion } from 'motion/react';

export * from 'motion/react';

/**
 * Motion, without the end-of-animation blink. Import Motion from HERE, never
 * from `motion/react` directly (PROJECT_INSTRUCTIONS §2.5).
 *
 * ## The blink (2026-10-02)
 *
 * Motion 11 hands opacity, transform, filter and clip-path to the browser's
 * own animation engine (WAAPI). When that animation finishes, Motion sets the
 * final value on its motion value, which reaches the inline style on the NEXT
 * frame, and cancels the WAAPI animation straight away. For that one frame the
 * element falls back to its inline style, which is still the `initial` one: a
 * dropdown that has just faded in drops to opacity 0 and comes back. Every
 * entrance in the app did it, which is the flicker the client reported across
 * the website. The landing page was fixed on 2026-09-27 by moving its reveals
 * to CSS; this fixes every other call site at once.
 *
 * ## The fix
 *
 * Motion refuses WAAPI for any component with an `onUpdate` handler (it cannot
 * read values back from the browser each frame), and animates on the main
 * thread instead, writing the inline style itself every frame, including the
 * last. So every `motion.*` element from here carries a no-op `onUpdate`. A
 * component passing its own keeps it. The animations here are 150 to 500ms
 * fades and short translates; the main thread runs those without strain.
 */
const noop = () => {};
const wrapped = new Map();

function withoutWaapi(Component, name) {
  const Wrapped = forwardRef(function MotionNoWaapi(props, ref) {
    return createElement(Component, { onUpdate: noop, ...props, ref });
  });
  Wrapped.displayName = `motion.${name}`;
  return Wrapped;
}

export const motion = new Proxy(baseMotion, {
  get(target, key) {
    const value = target[key];
    // Only element names (`div`, `li`, `circle`): anything else, `create` and
    // the probes React and bundlers make (`$$typeof`, `then`), passes through.
    if (typeof key !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(key) || key === 'create' || key === 'then') {
      return value;
    }
    if (!wrapped.has(key)) wrapped.set(key, withoutWaapi(value, key));
    return wrapped.get(key);
  },
});

export default motion;
