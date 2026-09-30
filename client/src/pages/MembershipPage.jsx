import { Link } from 'react-router';
import { BadgeCheck } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useMembership } from '@/hooks/useContent';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import useUiStore from '@/store/uiStore';

/**
 * Membership, on the website (`/membership`, 2026-09-30).
 *
 * Built only from what the ERP holds (client ruling): the four tiers staff
 * set on a customer, and the repair warranty each one carries (Sale Settings:
 * base days plus the tier's bonus). A tier does not change a price anywhere in
 * the system, so this page promises no discount, and it names no rule for
 * moving up because none exists: staff decide.
 *
 * ## What the page is opened for
 *
 * "What does each level get me, and which am I on?" So the warranty figure is
 * the largest thing on each tier, and a signed-in customer's own tier is
 * marked where they will look for it.
 */
export function MembershipPage() {
  useDocumentTitle('Membership');

  const { data, isLoading, error } = useMembership();
  const { user, isAuthenticated, isPanelAccount } = useAuth();
  const openAccount = useUiStore((s) => s.openAccount);

  const tiers = data?.tiers ?? [];
  const mine = isAuthenticated && !isPanelAccount ? (user?.tier ?? 'standard') : null;

  return (
    <div className="mx-auto max-w-[1100px] px-3 py-6 sm:px-4 lg:px-6 lg:py-8">
      <header className="rounded-xl border border-line bg-surface px-5 py-7 sm:px-8 sm:py-9">
        <p className="eyebrow flex items-center gap-2 text-brand">
          <BadgeCheck className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
          Membership
        </p>
        <h1 className="mt-3 max-w-xl font-display text-2xl font-bold leading-tight text-ink-900 sm:text-d-sm">
          The higher your tier, the longer every repair is covered.
        </h1>
        <p className="mt-3 max-w-xl text-md leading-relaxed text-ink-500">
          Every repair carries our warranty. Membership adds days on top of it, on each repair we do
          for you.
        </p>
      </header>

      <div className="mt-6">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-40 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <p className="py-16 text-center text-md text-ink-500">{error.message}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiers.map((tier) => {
              const current = mine === tier.value;
              return (
                <li
                  key={tier.value}
                  aria-current={current ? 'true' : undefined}
                  className={cn(
                    'flex flex-col rounded-lg border bg-surface p-4 sm:p-5',
                    current ? 'border-brand' : 'border-line',
                  )}
                >
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-display text-md font-bold text-ink-900">{tier.label}</span>
                    {current && <span className="eyebrow text-brand">Your tier</span>}
                  </p>
                  <p className="mt-4">
                    <span className="tnum font-display text-d-sm font-bold text-ink-900">
                      {tier.warrantyDays}
                    </span>
                    <span className="ml-1.5 text-sm text-ink-500">days</span>
                  </p>
                  <p className="text-sm text-ink-500">warranty on repairs</p>
                  <p className="mt-auto pt-3 text-xs text-ink-400">
                    {tier.warrantyBonusDays > 0
                      ? `${tier.warrantyBonusDays} more days than the standard ${data.warrantyBaseDays}`
                      : 'Where every account starts'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <section className="mt-6 rounded-lg border border-line bg-surface px-5 py-5 sm:px-6">
        <h2 className="font-display text-lg font-bold text-ink-900">How tiers work</h2>
        <p className="mt-2 max-w-2xl text-md leading-relaxed text-ink-500">
          Every customer account starts on Standard. Our team moves accounts up; if you think yours
          should be on a higher tier, ask at the counter or send us a message.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!isAuthenticated && (
            <Button onClick={() => openAccount('signup')}>Create an account</Button>
          )}
          <Link
            to="/contact"
            className={cn(
              pressable,
              'inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink-700 hover:border-line-strong hover:text-ink-900',
            )}
          >
            Contact us
          </Link>
        </div>
      </section>
    </div>
  );
}

export default MembershipPage;
