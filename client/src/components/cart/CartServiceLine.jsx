import { AlertTriangle, Trash2, Wrench } from 'lucide-react';

import cn from '@/lib/cn';
import { money } from '@/lib/format';
import { pressable } from '@/lib/motion';
import QtyStepper from '@/components/product/QtyStepper';

/**
 * A repair service in the cart (2026-10-01).
 *
 * A quantity, because two cracked screens are two repairs; no stock, because
 * labour has none. A service switched off or no longer priced stays visible and
 * says why, like a sold phone, and checkout refuses until it is removed.
 */
export function CartServiceLine({ line, onQtyChange, onRemove, compact = false }) {
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
            <Wrench className="size-5 text-ink-300" strokeWidth={1.5} aria-hidden="true" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="eyebrow mb-1 block text-ink-400">Repair service</span>
              <p className="text-md font-semibold leading-snug text-ink-900">{line.name}</p>
              {line.scopeLabel && <p className="mt-0.5 text-xs text-ink-500">{line.scopeLabel}</p>}
              <p className="tnum mt-0.5 font-mono text-2xs text-ink-300">{line.sku}</p>
            </div>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(line.serviceId)}
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
              No longer booked online. Remove it to check out.
            </p>
          )}

          <div className="mt-2 flex items-center justify-between gap-3">
            {onQtyChange ? (
              <QtyStepper
                value={line.qty}
                onChange={(qty) => onQtyChange(line.serviceId, qty)}
                max={20}
                size="sm"
                label={`How many of ${line.name}`}
              />
            ) : (
              <span className="text-sm text-ink-500">Qty {line.qty}</span>
            )}
            {line.priceVisible && (
              <p className="tnum font-display text-lg font-bold text-ink-900">{money(line.lineTotal)}</p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default CartServiceLine;
