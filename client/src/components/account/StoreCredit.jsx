import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, Plus, WalletCards } from 'lucide-react';
import cn from '@/lib/cn';
import { money, date } from '@/lib/format';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAccountMutations } from '@/hooks/useAccount';
import { pressable } from '@/lib/motion';

/**
 * Store credit - money the account already holds with Cellvix.
 *
 * Lives here rather than on the credit page because two pages show it: the
 * credit page, where it sits beside the line of credit, and payment methods,
 * where it is a way to pay like a card is. One implementation, so a top-up
 * cannot behave differently depending on which page it was made from.
 *
 * Never confuse this with the line of credit - see PROJECT_INSTRUCTIONS.md and
 * services/storeCreditService.js on the server.
 */

/** How each movement reads on the statement. */
const MOVEMENTS = {
  refund: { label: 'Refund', icon: ArrowDownLeft },
  recharge: { label: 'Top-up', icon: Plus },
  grant: { label: 'Added to your account', icon: ArrowDownLeft },
  adjustment: { label: 'Adjustment', icon: ArrowUpRight },
  redemption: { label: 'Applied to order', icon: ArrowUpRight },
};

const TOP_UPS = [250, 500, 1000];

/** The balance, as the one card on the dashboard that carries the gradient. */
export function StoreCreditCard({ balance, added, spent, className }) {
  return (
    // The PANEL ramp: this block carries small copy at white/65 and white/75,
    // and the standard ramp's bright end leaves those under 4.5:1. Same brand,
    // dark enough to read on.
    <div className={cn('rounded-lg bg-brand-gradient-panel p-5 text-white', className)}>
      <span className="flex size-10 items-center justify-center rounded-md bg-white/15">
        <WalletCards className="size-5" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <p className="tnum mt-4 font-display text-d-sm font-bold leading-none">{money(balance)}</p>
      <p className="mt-2 text-sm text-white/75">Store credit available to spend</p>

      {(added > 0 || spent > 0) && (
        <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-white/20 pt-3 text-xs">
          <div>
            <dt className="text-white/65">Added</dt>
            <dd className="tnum mt-0.5 font-medium">{money(added)}</dd>
          </div>
          <div>
            <dt className="text-white/65">Used</dt>
            <dd className="tnum mt-0.5 font-medium">{money(spent)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/** Prepay and hold the money as store credit. */
export function RechargeForm({ onDone, className }) {
  const { rechargeStoreCredit } = useAccountMutations();
  const [amount, setAmount] = useState('500');
  // A preset chip sits one click from the submit button, so $2,000 can be taken
  // in two clicks that look like one choice. The amount is restated on its own
  // before the money is actually charged.
  const [confirming, setConfirming] = useState(false);

  const dollars = Number(amount);
  const invalid = !Number.isFinite(dollars) || dollars < 25 || dollars > 25_000;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) return;
        setConfirming(true);
      }}
      className={cn('rounded-lg border border-line bg-surface-2 p-4', className)}
    >
      <p className="font-display text-md font-bold text-ink-900">Add funds</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-500">
        Prepay now and the balance comes off your next order automatically. Minimum $25.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {TOP_UPS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setAmount(String(value))}
            className={cn(
              pressable,
              'tnum h-9 rounded-full border px-3.5 text-sm font-medium',
              Number(amount) === value
                ? 'border-brand bg-brand-50 text-brand-700'
                : 'border-line bg-surface text-ink-500 hover:border-line-strong',
            )}
          >
            {money(value * 100)}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Input
          label="Amount"
          inputMode="decimal"
          suffix="CAD"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          containerClassName="max-w-[180px]"
        />
        <Button type="submit" loading={rechargeStoreCredit.isPending} disabled={invalid}>
          Add funds
        </Button>
      </div>

      {rechargeStoreCredit.isError && (
        <p className="mt-2.5 text-sm text-danger">{rechargeStoreCredit.error.message}</p>
      )}
      {rechargeStoreCredit.isSuccess && (
        <p className="mt-2.5 flex items-center gap-1.5 text-sm text-ok">
          <Check className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          {rechargeStoreCredit.data.message}
        </p>
      )}

      {/* Store credit is prepayment: it is charged now and comes back only as
          credit against future orders, never as cash. The amount is stated on
          its own line so it is read once more before the charge. */}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() =>
          rechargeStoreCredit.mutate(
            { amountDollars: dollars },
            {
              onSuccess: () => {
                setConfirming(false);
                onDone?.();
              },
            },
          )
        }
        title={`Add ${money(dollars * 100)} to your store credit?`}
        body="It is charged now and the balance comes off your next order automatically."
        tone="info"
        confirmLabel={`Pay ${money(dollars * 100)}`}
        cancelLabel="Go back"
        loading={rechargeStoreCredit.isPending}
        error={rechargeStoreCredit.error?.message}
      />
    </form>
  );
}

/** The movements behind the balance. */
export function StoreCreditActivity({ movements = [], isLoading }) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-12" />
        ))}
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <p className="rounded-lg bg-surface-2 px-4 py-6 text-center text-sm text-ink-400">
        No store credit on this account yet. Refunds, top-ups and anything your rep allocates will
        show here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {movements.map((row) => {
        const meta = MOVEMENTS[row.type] ?? MOVEMENTS.adjustment;
        const Icon = meta.icon;
        const added = row.amount > 0;

        return (
          <li key={row.id} className="flex items-center gap-3 bg-surface px-4 py-3">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full',
                added ? 'bg-ok-50 text-ok' : 'bg-surface-3 text-ink-500',
              )}
              aria-hidden="true"
            >
              <Icon className="size-4" strokeWidth={2} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-900">{meta.label}</p>
              <p className="mt-0.5 truncate text-xs text-ink-500">
                {row.note}
                {row.orderNumber ? ` · ${row.orderNumber}` : ''}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p
                className={cn(
                  'tnum font-display text-md font-bold',
                  added ? 'text-ok' : 'text-ink-900',
                )}
              >
                {added ? '+' : '−'}
                {money(Math.abs(row.amount))}
              </p>
              <p className="mt-0.5 text-xs text-ink-400">{date(row.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default StoreCreditCard;
