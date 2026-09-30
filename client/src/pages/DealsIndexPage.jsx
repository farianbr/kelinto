import { Link, Navigate } from 'react-router';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { findExclusive, useOffers } from '@/hooks/useContent';
import useDocumentTitle from '@/hooks/useDocumentTitle';

/**
 * `/deals` - where Offers › Exclusive Deals lands (2026-09-30).
 *
 * There is at most one exclusive deal and it has its own page, so this is a
 * door rather than a list: it forwards to the live deal, and when none is
 * running it says so and points at the offers that are (client ruling: the
 * menu row is always shown, with this empty state behind it).
 */
export function DealsIndexPage() {
  useDocumentTitle('Exclusive deals');

  const { isApproved } = useAuth();
  const { data, isLoading } = useOffers(isApproved);
  const exclusive = findExclusive(data);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[760px] px-4 py-10">
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }

  if (exclusive) return <Navigate to={`/deals/${exclusive.slug}`} replace />;

  const link = cn(
    pressable,
    'inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink-700 hover:border-line-strong hover:text-ink-900',
  );

  return (
    <div className="mx-auto max-w-[760px] px-3 py-10 sm:px-4">
      <div className="rounded-lg border border-line bg-surface px-6 py-12 text-center">
        <h1 className="font-display text-xl font-bold text-ink-900">No exclusive deal right now</h1>
        <p className="mx-auto mt-2 max-w-md text-md text-ink-500">
          An exclusive deal is one product at a special price, for a limited time. The next one
          will be here when it starts.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="/offers" className={link}>
            Combo deals
          </Link>
          <Link to="/clearance" className={link}>
            Stock clearance
          </Link>
        </div>
      </div>
    </div>
  );
}

export default DealsIndexPage;
