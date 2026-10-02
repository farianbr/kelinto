import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowDown, Check, Minus } from 'lucide-react';

import cn from '@/lib/cn';
import { date, money } from '@/lib/format';
import { pressable } from '@/lib/motion';
import Skeleton from '@/components/ui/Skeleton';
import { toast } from '@/store/toastStore';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { useMembership } from '@/hooks/useContent';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import useUiStore from '@/store/uiStore';

/**
 * Membership, on the website (`/membership`; plans since 2026-10-01, redrawn
 * 2026-10-02).
 *
 * Every word and figure comes from ERP › Purchase › Membership Plans: the
 * plans, their prices and the benefit matrix. The cards and the comparison
 * table read the SAME matrix (a card shows the rows marked for it), so they
 * cannot disagree.
 *
 * ## What the page is opened for
 *
 * "Which plan, and what do I get for it?" So the plans come first, side by
 * side, each answering in the same order: name, price, button, then the
 * handful of benefits that separate it from the others. The full table is one
 * tap below for the reader who wants every line.
 *
 * ## Design (client ruling, 2026-10-02)
 *
 * The cards are white, and each has a metal FACE across its top, the way a
 * premium charge card does: brushed silver, bright bullion gold, cool pearl
 * platinum, in rising order of depth so the top tier reads as the top tier.
 * The old page drew the featured plan as a black card, which the client did
 * not want, set Gold's name in a dull ochre that barely read, and made
 * Platinum (a grey slate) look cheaper than Gold. Now the plan's name sits on
 * its own plate in ink, where it is always legible, and the featured plan is
 * marked by a heavier edge in its own metal and a "Most popular" tag, not by
 * a different colour of card.
 *
 * ## Subscribe
 *
 * Bought like anything else on the website (client ruling, 2026-10-02): the
 * plan goes in the cart and the customer is taken to checkout, where it
 * becomes an order with an invoice. Placing the order moves the account onto
 * the tier. Buying the plan already held renews it from its end date.
 */

const PLATE = {
  silver: 'bg-tier-plate-silver',
  gold: 'bg-tier-plate-gold',
  platinum: 'bg-tier-plate-platinum',
};

const EDGE = {
  silver: 'border-tier-silver',
  gold: 'border-tier-gold',
  platinum: 'border-tier-platinum',
};

const SWATCH = {
  silver: 'bg-tier-silver',
  gold: 'bg-tier-gold',
  platinum: 'bg-tier-platinum',
};

/** A price without cents when it has none: "$99", not "$99.00". */
function price(cents) {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-CA')}` : money(cents);
}

const per = (interval) => (interval === 'month' ? 'month' : 'year');

/** One matrix value, drawn the same in a card and in the table. */
function CellValue({ cell, align = 'left' }) {
  if (!cell || cell.kind === 'no') {
    return (
      <span className={cn('inline-flex', align === 'center' && 'justify-center')}>
        <Minus className="size-4 text-ink-200" strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">Not included</span>
      </span>
    );
  }
  if (cell.kind === 'yes') {
    return (
      <span className={cn('inline-flex', align === 'center' && 'justify-center')}>
        <Check className="size-4 text-ok" strokeWidth={2.5} aria-hidden="true" />
        <span className="sr-only">Included</span>
      </span>
    );
  }
  return <span className="whitespace-pre-line">{cell.text}</span>;
}

function PlanCard({ plan, highlights, held, renewsAt, viewer, busy, onSubscribe }) {
  const featured = plan.isFeatured;
  const label =
    viewer === 'staff' ? 'Customers subscribe here' : held ? 'Renew this plan' : `Choose ${plan.name}`;

  return (
    <li
      aria-current={held ? 'true' : undefined}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl bg-surface',
        featured || held ? cn('border-2', EDGE[plan.tier]) : 'border border-line',
      )}
    >
      {/* The face: the plan's metal, with its name and line on it in ink. */}
      <div className={cn('relative px-6 pb-6 pt-5 sm:px-7', PLATE[plan.tier])}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="pt-3 font-display text-3xl font-bold tracking-tight text-ink-900">{plan.name}</h3>
          {(held || featured) && (
            <span className="shrink-0 rounded-full bg-surface/80 px-2.5 py-1 text-xs font-semibold text-ink-900">
              {held ? 'Your plan' : 'Most popular'}
            </span>
          )}
        </div>
        {plan.tagline && <p className="mt-1.5 min-h-10 text-sm leading-snug text-ink-700">{plan.tagline}</p>}
      </div>

      <div className="flex flex-1 flex-col px-6 pb-7 pt-6 sm:px-7">
        <p className="flex items-baseline gap-1.5">
          <span className="tnum font-display text-d-sm font-bold tracking-tight text-ink-900">{price(plan.priceCents)}</span>
          <span className="text-sm text-ink-500">/ {per(plan.interval)}</span>
        </p>
        <p className="mt-1 text-sm text-ink-500">
          {held && renewsAt ? `Renews ${date(renewsAt)}` : `${plan.warrantyDays}-day warranty on every repair`}
        </p>

        <button
          type="button"
          onClick={() => onSubscribe(plan)}
          disabled={viewer === 'staff' || busy}
          aria-busy={busy || undefined}
          className={cn(
            pressable,
            'mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg font-display text-md font-semibold transition-[filter,background-color,border-color] disabled:pointer-events-none disabled:opacity-60',
            featured && !held
              ? 'bg-brand-gradient text-white hover:brightness-110'
              : 'border border-line-strong bg-surface text-ink-900 hover:bg-surface-2',
          )}
        >
          {busy ? 'Adding…' : label}
        </button>

        {highlights.length > 0 && (
          <dl className="mt-7 space-y-3 border-t border-line pt-6 text-sm">
            {highlights.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-4">
                <dt className="text-ink-500">{row.label}</dt>
                <dd className="shrink-0 text-right font-semibold text-ink-900">
                  <CellValue cell={row.cells[plan.tier]} align="right" />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}

function CompareTable({ plans, sections }) {
  return (
    // `relative`: the screen-reader-only labels inside are absolutely placed,
    // and without a positioned ancestor here they escape the scroller and
    // widen the whole page on a phone.
    <div className="scroll-slim relative overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[600px] border-collapse text-left text-sm">
        <caption className="sr-only">Every benefit, plan by plan</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="sticky left-0 z-10 w-[34%] bg-surface px-4 py-4 sm:px-5">
              <span className="sr-only">Benefit</span>
            </th>
            {plans.map((plan) => (
              <th key={plan.tier} scope="col" className="px-3 py-4 text-center align-bottom">
                <span className="flex items-center justify-center gap-2 font-display text-md font-bold text-ink-900">
                  <span aria-hidden="true" className={cn('size-2.5 rounded-full', SWATCH[plan.tier])} />
                  {plan.name}
                </span>
                <span className="tnum mt-0.5 block font-normal text-ink-500">
                  {price(plan.priceCents)} / {per(plan.interval)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section.title}>
            <tr>
              <th
                scope="colgroup"
                colSpan={plans.length + 1}
                className="eyebrow sticky left-0 bg-surface-2 px-4 py-2.5 text-ink-500 sm:px-5"
              >
                {section.title}
              </th>
            </tr>
            {section.rows.map((row) => (
              <tr key={row.label} className="border-t border-line">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3.5 font-normal text-ink-700 sm:px-5">
                  {row.label}
                </th>
                {plans.map((plan) => (
                  <td key={plan.tier} className="px-3 py-3.5 text-center text-ink-900">
                    <CellValue cell={row.cells[plan.tier]} align="center" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function MembershipPage() {
  useDocumentTitle('Membership');
  const navigate = useNavigate();

  const { data, isLoading, error } = useMembership();
  const { user, isAuthenticated, isApproved, isPanelAccount } = useAuth();
  const { setMembership } = useCart();
  const openAccount = useUiStore((s) => s.openAccount);
  const [adding, setAdding] = useState(null);

  const plans = data?.plans ?? [];
  const sections = data?.sections ?? [];
  const highlights = sections.flatMap((section) => section.rows.filter((row) => row.highlight));
  const viewer = isPanelAccount ? 'staff' : isAuthenticated ? 'customer' : 'guest';
  const mine = viewer === 'customer' ? (user?.tier ?? 'standard') : null;
  const minePlan = plans.find((plan) => plan.tier === mine);
  const renewsAt = viewer === 'customer' ? user?.membershipRenewsAt : null;

  /**
   * Into the cart, then straight to checkout: subscribing is buying. An
   * account still under review can hold a cart but not order, so it lands on
   * the cart, which says why.
   */
  async function subscribe(plan) {
    if (viewer === 'guest') {
      openAccount('signin');
      return;
    }
    setAdding(plan.tier);
    try {
      await setMembership(plan.tier);
      navigate(isApproved ? '/checkout' : '/cart');
    } catch (err) {
      toast.error('Could not add the plan', err.message);
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] px-3 py-8 sm:px-4 lg:px-6 lg:py-12">
      <header className="mx-auto max-w-2xl text-center">
        <p className="eyebrow text-ink-500">Membership</p>
        <h1 className="mt-3 text-balance font-display text-d-sm font-bold leading-tight text-ink-900 sm:text-d-md">
          Cover for the devices you can&apos;t be without.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-md leading-relaxed text-ink-500">
          One plan: savings on the essentials, faster repairs and a longer warranty on every job we
          do for you.
        </p>
        {minePlan && (
          <p className="mt-4 text-sm text-ink-700">
            You are on <strong className="font-semibold">{minePlan.name}</strong>
            {renewsAt ? `, until ${date(renewsAt)}` : ''}.
          </p>
        )}
      </header>

      <section aria-label="Plans" className="mt-10 lg:mt-12">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-[560px] rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <p className="py-16 text-center text-md text-ink-500">{error.message}</p>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface px-6 py-16 text-center">
            <p className="font-display text-lg font-bold text-ink-900">No plans on offer right now</p>
            <p className="mt-2 text-md text-ink-500">Ask at the counter about membership.</p>
          </div>
        ) : (
          <ul className={cn('grid gap-4 lg:gap-5', plans.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.tier}
                plan={plan}
                highlights={highlights}
                held={mine === plan.tier}
                renewsAt={renewsAt}
                viewer={viewer}
                busy={adding === plan.tier}
                onSubscribe={subscribe}
              />
            ))}
          </ul>
        )}

        {minePlan && plans.length > 1 && (
          <p className="mt-4 text-center text-sm text-ink-500">
            Switching plan starts the new one on the day you pay; days left on {minePlan.name} are not
            carried over. Renewing {minePlan.name} adds a full term to the end of the current one.
          </p>
        )}

        {sections.length > 0 && plans.length > 0 && (
          <div className="mt-8 text-center">
            <a
              href="#compare-plans"
              className={cn(
                pressable,
                'inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-semibold text-ink-700 hover:border-line-strong hover:text-ink-900',
              )}
            >
              Compare every benefit
              <ArrowDown className="size-4" strokeWidth={2} aria-hidden="true" />
            </a>
          </div>
        )}
      </section>

      {sections.length > 0 && plans.length > 0 && (
        <section id="compare-plans" aria-labelledby="compare-heading" className="mt-14 scroll-mt-40 lg:mt-20">
          <h2 id="compare-heading" className="font-display text-2xl font-bold text-ink-900">
            Compare plans
          </h2>
          <p className="mt-2 max-w-2xl text-md text-ink-500">
            Every benefit, plan by plan. Warranty is on each repair we do for you while the plan is
            active.
          </p>
          <div className="mt-6">
            <CompareTable plans={plans} sections={sections} />
          </div>
        </section>
      )}

      <section className="mt-14 border-t border-line pt-8 lg:mt-20">
        <h2 className="font-display text-lg font-bold text-ink-900">How subscribing works</h2>
        <p className="mt-2 max-w-2xl text-md leading-relaxed text-ink-500">
          Choose a plan and pay for it at checkout, like anything else on this website. Your invoice
          is emailed to you, and the plan starts as soon as the order is placed.
        </p>
      </section>
    </div>
  );
}

export default MembershipPage;
