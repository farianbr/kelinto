import useBusinessInfo from '@/hooks/useBusinessInfo';
import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CreditCard, Wallet } from 'lucide-react';
import cn from '@/lib/cn';
import { money, moneyCompact, date } from '@/lib/format';
import { CollapsiblePanel, StatTile } from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import PaymentModal from '@/components/payment/PaymentModal';
import {
  StoreCreditCard,
  RechargeForm,
  StoreCreditActivity,
} from '@/components/account/StoreCredit';
import {
  useAccountSummary,
  useAccountMutations,
  useCreditActivity,
  useStoreCredit,
} from '@/hooks/useAccount';

const TERMS_COPY = {
  prepaid: 'Payment is taken at checkout. No credit is extended on this account.',
  net15: 'Invoices are due 15 days after they are issued.',
  net30: 'Invoices are due 30 days after they are issued.',
  net60: 'Invoices are due 60 days after they are issued.',
};

/**
 * A single movement on the line of credit: an order drawing against the limit,
 * or a payment retiring part of it.
 */
function CreditActivityRow({ entry }) {
  const drawn = entry.type === 'draw';
  const Icon = drawn ? ArrowUpRight : ArrowDownLeft;

  return (
    <li className="flex items-center gap-3 bg-surface px-4 py-3">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          drawn ? 'bg-surface-3 text-ink-500' : 'bg-ok-50 text-ok',
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-900">
          {drawn ? 'Drawn on terms' : 'Payment received'}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-500">{entry.note}</p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={cn(
            'tnum font-display text-md font-bold',
            drawn ? 'text-ink-900' : 'text-ok',
          )}
        >
          {drawn ? '−' : '+'}
          {money(Math.abs(entry.amount))}
        </p>
        <p className="mt-0.5 text-xs text-ink-400">{date(entry.at)}</p>
      </div>
    </li>
  );
}

/**
 * The credit page carries two different things, and keeping them apart is the
 * whole point of the layout:
 *
 *   - **store credit** - money this account already holds with Cellvix, from a
 *     refund, a top-up or an allocation. It spends itself at checkout.
 *   - **line of credit** - what Cellvix lends the business, drawn against and
 *     repaid on terms.
 *
 * They were one "credit" number before, which meant a refund and a credit limit
 * looked like the same thing on the dashboard. They are not.
 *
 * The invoice statement is deliberately NOT repeated here - it is the whole of
 * the invoices page, and two copies of the same list drift.
 */
export function AccountCreditPage() {
  const info = useBusinessInfo();
  const { data: summary, isLoading } = useAccountSummary();
  const { data: creditData, isLoading: creditLoading } = useStoreCredit();
  const { data: activity, isLoading: activityLoading } = useCreditActivity();
  const { payOffCredit } = useAccountMutations();
  const [payingOff, setPayingOff] = useState(false);
  const [payError, setPayError] = useState(null);

  if (isLoading || !summary) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,290px)_minmax(0,1fr)]">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-56" />
      </div>
    );
  }

  const { credit } = summary;
  const tone = credit.utilisation >= 85 ? 'danger' : credit.utilisation >= 60 ? 'warn' : 'ok';
  const storeCredit = creditData?.balance ?? summary.storeCredit ?? 0;
  const movements = creditData?.transactions ?? [];
  const entries = activity?.entries ?? [];

  return (
    <div className="space-y-4">
      {/* ---- the two balances, side by side ------------------------------
          Both instruments at the top of the page, because "how much can I
          spend" is the question this page exists to answer. The gradient card
          is the money already held; the tiles are the money lent. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,290px)_minmax(0,1fr)]">
        <StoreCreditCard
          balance={storeCredit}
          added={creditData?.added ?? 0}
          spent={creditData?.spent ?? 0}
        />

        {/* Two up on a phone rather than a three-tile stack the buyer scrolls
            past to reach anything else. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile label="Credit limit" value={moneyCompact(credit.limit)} icon={Wallet} />
          <StatTile
            label="Current balance"
            value={moneyCompact(credit.balance)}
            hint="Drawn against your limit"
            tone={tone === 'ok' ? 'neutral' : tone}
          />
          <StatTile
            label="Available"
            value={moneyCompact(credit.available)}
            hint={`${credit.utilisation}% of limit used`}
            tone={credit.available > 0 ? 'ok' : 'danger'}
            className="col-span-2 lg:col-span-1"
          />
        </div>
      </div>

      {/* ---- line of credit ----------------------------------------------
          The four sections below are collapsible, and which of them start open
          is the layout: this page carried two instruments and two statements as
          four stacked panels, which meant the store-credit top-up sat below a
          fold on every laptop. Open by default: the two that state a position.
          Closed by default: the two statements, which are reference. */}
      <CollapsiblePanel
        title="Line of credit"
        description={`What ${info.name} extends to this account, and how much of it is drawn.`}
        defaultOpen
        summary={<span className="tnum">{money(credit.available)} available</span>}
        action={
          // The whole balance, cleared in one charge. Offered here because this
          // is the page showing the balance - asking a buyer to read the number
          // here and then go to another screen to act on it is a step with no
          // purpose. The amounts behind it are settled oldest first, server-side.
          credit.balance > 0 ? (
            <Button size="sm" icon={CreditCard} onClick={() => setPayingOff(true)}>
              Pay balance · {money(credit.balance)}
            </Button>
          ) : null
        }
      >
        <div
          className="h-3 overflow-hidden rounded-full bg-surface-3"
          role="meter"
          aria-valuenow={credit.utilisation}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Credit used"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500',
              tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : 'bg-brand-gradient',
            )}
            style={{ width: `${Math.max(2, credit.utilisation)}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="tnum text-ink-500">
            {money(credit.balance)} used of {money(credit.limit)}
          </span>
          <span className="tnum font-medium text-ink-900">{money(credit.available)} available</span>
        </div>

        <div className="mt-5 rounded-md bg-surface-2 px-4 py-3">
          <p className="eyebrow mb-1 text-ink-400">
            Payment terms · {credit.terms.replace('net', 'Net ')}
          </p>
          <p className="text-sm leading-relaxed text-ink-500">
            {TERMS_COPY[credit.terms] ?? TERMS_COPY.prepaid} To request a different limit or terms,
            contact your account representative.
          </p>
        </div>
      </CollapsiblePanel>

      {/* ---- line of credit activity ------------------------------------- */}
      <CollapsiblePanel
        title="Line of credit activity"
        description="Orders that drew against the limit, and the payments that retired them."
        summary={
          entries.length > 0 ? (
            <span className="tnum">
              {entries.length} {entries.length === 1 ? 'movement' : 'movements'}
            </span>
          ) : null
        }
      >
        {activityLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded-lg bg-surface-2 px-4 py-6 text-center text-sm text-ink-400">
            {credit.limit > 0
              ? 'Nothing drawn against your limit yet. Orders placed on terms will appear here.'
              : 'No line of credit on this account. Ask your rep about credit terms.'}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {entries.map((entry) => (
                <CreditActivityRow key={entry.id} entry={entry} />
              ))}
            </ul>

            <div className="tnum mt-3 flex flex-wrap justify-between gap-2 text-sm text-ink-500">
              <span>{money(activity.drawn)} drawn</span>
              <span>{money(activity.repaid)} repaid</span>
            </div>
          </>
        )}
      </CollapsiblePanel>

      {/* ---- store credit -------------------------------------------------
          Split from its statement below. They were one panel, which made the
          top-up form - the only thing on this page a buyer can act on - the
          header of a list they mostly scroll past. */}
      <CollapsiblePanel
        title="Top up store credit"
        description={`Money you hold with ${info.name}. It comes off your next order automatically.`}
        defaultOpen
        summary={<span className="tnum">{money(storeCredit)} on hand</span>}
      >
        <RechargeForm />
      </CollapsiblePanel>

      {/* ---- store credit statement --------------------------------------- */}
      <CollapsiblePanel
        title="Store credit activity"
        description="Refunds, top-ups and allocations, and what has been spent."
        summary={
          movements.length > 0 ? (
            <span className="tnum">
              {movements.length} {movements.length === 1 ? 'movement' : 'movements'}
            </span>
          ) : null
        }
      >
        <StoreCreditActivity movements={movements} isLoading={creditLoading} />
      </CollapsiblePanel>

      <PaymentModal
        open={payingOff}
        onClose={() => {
          setPayingOff(false);
          setPayError(null);
        }}
        amount={credit.balance}
        storeCredit={storeCredit}
        loading={payOffCredit.isPending}
        error={payError}
        title="Pay your balance"
        description="Everything outstanding, settled oldest first in one charge."
        onSubmit={(values) =>
          payOffCredit.mutate(values, {
            onSuccess: () => setPayingOff(false),
            onError: (error) =>
              setPayError(
                error?.message ?? 'That payment could not be completed. Nothing has been charged.',
              ),
          })
        }
      />
    </div>
  );
}

export default AccountCreditPage;
