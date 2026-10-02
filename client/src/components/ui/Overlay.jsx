import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from '@/lib/motionReact';
import useFocusTrap from '@/hooks/useFocusTrap';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import cn from '@/lib/cn';
import { scrim } from '@/lib/motion';

/**
 * The base every overlay in the app is built on: portal + scrim + focus trap +
 * scroll lock + Escape. Modal, Drawer and the wizard overlay all wrap this so
 * overlay behaviour cannot drift between them.
 *
 * `panelMotion` lets each consumer supply its own entrance (fade-up for modals,
 * slide-in for drawers) while sharing everything else.
 */
export function Overlay({
  open,
  onClose,
  children,
  labelledBy,
  /**
   * The element describing the dialog, announced after its name.
   *
   * A confirm dialog's whole payload is the sentence under the title - without
   * this a screen reader reads "Delete this address, dialog" and stops, leaving
   * out the part that says what deleting it costs.
   */
  describedBy,
  label,
  className,
  panelClassName,
  panelMotion,
  scrimClassName,
  align = 'center',
  closeOnScrimClick = true,
}) {
  useLockBodyScroll(open);
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const alignment = {
    center: 'items-center justify-center p-4',
    top: 'items-start justify-center p-4 pt-[8vh]',
    left: 'items-stretch justify-start',
    right: 'items-stretch justify-end',
    bottom: 'items-end justify-center',
  }[align];

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={cn('fixed inset-0 z-50 flex', alignment, className)}>
          <motion.div
            {...scrim}
            onClick={closeOnScrimClick ? onClose : undefined}
            className={cn('absolute inset-0 bg-ink-900/45 backdrop-blur-[2px]', scrimClassName)}
          />
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            className={cn('relative', panelClassName)}
            {...panelMotion}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default Overlay;
