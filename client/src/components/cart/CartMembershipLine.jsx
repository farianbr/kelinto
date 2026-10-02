import { AlertTriangle, Crown, Trash2 } from 'lucide-react';

import cn from '@/lib/cn';
import { date, money } from '@/lib/format';
import { pressable } from '@/lib/motion';
import { useAuth } from '@/hooks/useAuth';

/**
 * A membership plan in the cart (2026-10-02).
 *
 * One of a kind, so no quantity: a second plan replaces it. The term is said
 * plainly ("1 year"), because what the buyer is agreeing to is a period, not
 * a thing. A plan taken off sale stays visible and says why, and checkout
 * refuses it until it is removed, like a sold phone.
 */
export function CartMembershipLine({ line, onRemove, compact = false }) {
  const { user } = useAuth();
  const term = line.interval === 'month' ? '1 month' : '1 year';
  // Buying the plan already held is a renewal: checkout adds the term on.
  const renewsFrom =
    user?.tier === line.tier && user?.membershipRenewsAt && new Date(user.membershipRenewsAt) > new Date()
      ? user.membershipRenewsAt
      : null;

  return (
    <li className={cn('relative', compact ? 'px-3 py-3' : 'px-4 py-4 sm:px-5', !line.available && 'bg-warn-50/40')}>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-brand-gradient-compact text-white">
          <Crown className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="eyebrow mb-1 block text-ink-400">Membership · {term}</span>
              <p className="text-md font-semibold leading-snug text-ink-900">{line.name}</p>
              {renewsFrom ? (
                <p className="mt-0.5 text-xs text-ink-500">Extends your current plan from {date(renewsFrom)}.</p>
              ) : line.warrantyDays ? (
                <p className="mt-0.5 text-xs text-ink-500">{line.warrantyDays}-day warranty on repairs.</p>
              ) : null}
            </div>
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
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
              No longer on sale. Remove it to check out.
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

export default CartMembershipLine;
