import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from '@/lib/motionReact';
import cn from '@/lib/cn';

/**
 * Milestone counter that runs once when scrolled into view (brief §9).
 *
 * Deliberately not a spring: an eased ramp that decelerates into the final
 * figure reads as a number settling, where a bouncy one reads as a toy. Under
 * `prefers-reduced-motion` it renders the final value immediately - a counting
 * animation is exactly the kind of motion that setting exists to stop.
 */
export function CountUp({ to, duration = 1400, prefix = '', suffix = '', className }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? to : 0);

  useEffect(() => {
    if (!inView || reduce) return undefined;

    let frame;
    const start = performance.now();
    // ease-out-quint: fast start, long settle.
    const ease = (t) => 1 - (1 - t) ** 5;

    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      setValue(Math.round(to * ease(progress)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduce, to, duration]);

  return (
    <span ref={ref} className={cn('tnum', className)}>
      {prefix}
      {new Intl.NumberFormat('en-CA').format(value)}
      {suffix}
    </span>
  );
}

export default CountUp;
