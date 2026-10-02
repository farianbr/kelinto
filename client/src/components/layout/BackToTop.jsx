import { AnimatePresence, motion } from '@/lib/motionReact';
import { ArrowUp } from 'lucide-react';
import useScrollProgress from '@/hooks/useScrollProgress';
import { ease } from '@/lib/motion';

/** Roughly a screen and a half down - before that, the header is a short flick away. */
const REVEAL_AT = 480;

const RADIUS = 21;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Back-to-top, ringed by a read-progress arc.
 *
 * The ring is the point: on a 24-per-page grid the arc tells a buyer how much of
 * the page is left, which a bare arrow does not. It sits clear of the bottom bar
 * (`MobileBottomNav`), which is always on screen by the time this appears.
 */
export function BackToTop() {
  const { y, progress } = useScrollProgress();
  const visible = y > REVEAL_AT;

  function toTop() {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={toTop}
          aria-label={`Back to top - ${Math.round(progress * 100)}% of the page read`}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2, ease: ease.entrance }}
          className="fixed right-3 bottom-[calc(78px+env(safe-area-inset-bottom))] z-30 flex size-12 items-center justify-center rounded-full bg-surface text-ink-700 shadow-pop transition-colors active:bg-surface-2 lg:hidden"
        >
          <svg
            viewBox="0 0 48 48"
            className="pointer-events-none absolute inset-0 size-full -rotate-90"
            aria-hidden="true"
          >
            <circle cx="24" cy="24" r={RADIUS} fill="none" stroke="var(--color-line)" strokeWidth="2.5" />
            <circle
              cx="24"
              cy="24"
              r={RADIUS}
              fill="none"
              stroke="var(--color-brand)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
              style={{ transition: 'stroke-dashoffset 120ms linear' }}
            />
          </svg>
          <ArrowUp className="relative size-[19px]" strokeWidth={2.25} aria-hidden="true" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export default BackToTop;
