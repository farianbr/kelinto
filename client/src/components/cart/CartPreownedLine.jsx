import { AlertTriangle, Smartphone, Trash2 } from 'lucide-react';

import cn from '@/lib/cn';
import { money } from '@/lib/format';
import { pressable } from '@/lib/motion';

/**
 * A pre-owned phone in the cart.
 *
 * No quantity stepper: it is one handset. A phone somebody else bought first
 * stays visible and says so, like an unavailable bundle, rather than vanishing
 * from a cart the customer put it in; checkout refuses until it is removed.
 */
export function CartPreownedLine({ line, onRemove, compact = false }) {
  return (
    <li className={cn('relative', compact ? 'px-3 py-3' : 'px-4 py-4 sm:px-5', !line.available && 'bg-warn-50/40')}>
      <div className="flex items-start gap-3">
        {line.photo ? (
          <img
            src={line.photo}
            alt=""
            width={44}
            height={44}
            loading="lazy"
            className="size-11 shrink-0 rounded-md border border-line object-cover"
          />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2">
            <Smartphone className="size-5 text-ink-300" strokeWidth={1.5} aria-hidden="true" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="eyebrow mb-1 block text-ink-400">Pre-owned</span>
              <p className="text-md font-semibold leading-snug text-ink-900">{line.name.replace(/^Pre-owned /, '')}</p>
              <p className="tnum mt-0.5 font-mono text-2xs text-ink-300">{line.stockNumber}</p>
            </div>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(line.deviceId)}
                aria-label={`Remove ${line.name}`}
                className={cn(pressable, '-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-danger-50 hover:text-danger')}
              >
                <Trash2 className="size-4" strokeWidth={2} />
              </button>
            )}
          </div>

          {!line.available && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-warn">
              <AlertTriangle className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              Sold to another customer. Remove it to check out.
            </p>
          )}

          {line.priceVisible && (
            <p className="tnum mt-2 text-right font-display text-lg font-bold text-ink-900">{money(line.lineTotal)}</p>
          )}
        </div>
      </div>
    </li>
  );
}

export default CartPreownedLine;
