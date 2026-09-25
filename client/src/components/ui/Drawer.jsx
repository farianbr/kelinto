import { useId } from 'react';
import { X } from 'lucide-react';
import Overlay from './Overlay';
import cn from '@/lib/cn';
import { sheet, pressable } from '@/lib/motion';

/**
 * Edge-anchored panel. Used by the mobile navigation drawer and the mobile
 * filter sheet; the mini-cart is a header dropdown at every width.
 */
export function Drawer({
  open,
  onClose,
  side = 'left',
  title,
  children,
  footer,
  width = 'w-[86vw] max-w-[380px]',
  className,
  bodyClassName,
  header,
}) {
  const titleId = useId();

  return (
    <Overlay
      open={open}
      onClose={onClose}
      align={side}
      labelledBy={title ? titleId : undefined}
      label={title ? undefined : 'Panel'}
      panelMotion={sheet[side]}
      panelClassName={cn('h-full', width, className)}
    >
      <div
        className={cn(
          'flex h-full flex-col bg-surface',
          side === 'left' ? 'border-r border-line' : 'border-l border-line',
        )}
      >
        {(header || title) && (
          <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3.5">
            <div className="min-w-0 flex-1">
              {header ?? (
                <h2 id={titleId} className="text-lg">
                  {title}
                </h2>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={cn(pressable, '-mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-surface-3 hover:text-ink-900')}
            >
              <X className="size-[18px]" strokeWidth={1.75} />
            </button>
          </header>
        )}

        <div className={cn('scroll-slim flex-1 overflow-y-auto', bodyClassName)}>{children}</div>

        {footer && <footer className="shrink-0 border-t border-line">{footer}</footer>}
      </div>
    </Overlay>
  );
}

export default Drawer;
