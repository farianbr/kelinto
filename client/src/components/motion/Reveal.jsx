import { motion, useReducedMotion } from '@/lib/motionReact';
import cn from '@/lib/cn';
import { ease } from '@/lib/motion';

/**
 * Scroll-triggered reveal (brief §9).
 *
 * "Animated but soothing" - an 18px rise over 500ms, once, when the element is
 * a third of the way into view. Under `prefers-reduced-motion` it degrades to a
 * plain fade, which is the rule from PROJECT_INSTRUCTIONS.md §2.5: opacity only,
 * no transform.
 */
export function Reveal({ children, delay = 0, y = 18, className, as = 'div' }) {
  const reduce = useReducedMotion();
  const Component = motion[as] ?? motion.div;

  return (
    <Component
      initial={reduce ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.33 }}
      transition={{ duration: 0.5, delay, ease: ease.entrance }}
      className={className}
    >
      {children}
    </Component>
  );
}

/** Staggers a list of children without each one needing its own delay prop. */
export function RevealGroup({ children, className, stagger = 0.08 }) {
  return (
    <div className={cn(className)}>
      {Array.isArray(children)
        ? children.map((child, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <Reveal key={index} delay={index * stagger}>
              {child}
            </Reveal>
          ))
        : children}
    </div>
  );
}

export default Reveal;
