import { AnimatePresence, motion } from '@/lib/motionReact';
import { Pencil } from 'lucide-react';
import cn from '@/lib/cn';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { ease } from '@/lib/motion';

/**
 * One section of the conversational checkout (brief §7).
 *
 * Exactly one section is expanded at a time. A completed section collapses to a
 * compact summary bar that stays clickable **forever** - including after the
 * buyer has reached Payment. Nothing locks.
 *
 * Uses the shared StepIndicator, so a completed checkout section looks like a
 * completed wizard tab and a completed tracking step.
 */
export function StepSection({
  index,
  label,
  state, // 'upcoming' | 'active' | 'completed'
  summary,
  onEdit,
  children,
  isLast = false,
}) {
  const isActive = state === 'active';
  const isCompleted = state === 'completed';

  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border bg-surface transition-[border-color,box-shadow] duration-panel',
        isActive ? 'border-line-strong shadow-card' : 'border-line',
        !isLast && 'mb-3',
      )}
    >
      <header
        className={cn(
          'flex items-center gap-3 px-4 py-3.5 sm:px-5',
          isCompleted && 'cursor-pointer hover:bg-surface-2',
        )}
        onClick={isCompleted ? onEdit : undefined}
        role={isCompleted ? 'button' : undefined}
        tabIndex={isCompleted ? 0 : undefined}
        onKeyDown={
          isCompleted
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onEdit();
                }
              }
            : undefined
        }
      >
        <StepIndicator state={state} index={index} size="md" />

        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              'font-display text-md font-bold',
              state === 'upcoming' ? 'text-ink-300' : 'text-ink-900',
            )}
          >
            {label}
          </h2>

          {/* The collapsed state has to carry the answer, not just the label
              otherwise the buyer has to reopen it to check what they entered. */}
          {isCompleted && summary && (
            <p className="mt-0.5 truncate text-sm text-ink-500">{summary}</p>
          )}
        </div>

        {isCompleted && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-brand">
            <Pencil className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Edit
          </span>
        )}
      </header>

      <AnimatePresence initial={false}>
        {isActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: ease.entrance }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-4 py-4 sm:px-5 sm:py-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default StepSection;
