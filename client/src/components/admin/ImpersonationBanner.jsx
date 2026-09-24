import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { useSuperAdminMutations } from '@/hooks/useSuperAdmin';
import { superAdminUrl } from '@/lib/surface';

/**
 * "You are inside somebody else's business" (SAAS_PLATFORM §4.5).
 *
 * **The one piece of chrome that may never be dismissed.** Everything else in
 * the panel can be collapsed, filtered away or scrolled past; this cannot,
 * because the failure it guards against is a staff member forgetting which
 * business they are in and editing a real tenant's records believing they are
 * in a test one. A dismissible warning is a warning that is dismissed.
 *
 * It sits above the panel rather than inside it, in a colour the panel never
 * otherwise uses, and it carries the way out. A staff member who navigates deep
 * into a screen must never have to find their way back to wherever they entered
 * from in order to leave.
 *
 * The countdown is not decoration: a grant expires on a clock, and a staff member
 * whose session dies mid-edit should have seen it coming rather than meeting a
 * wall of failed requests.
 */

/** `mm:ss` remaining, or null once the grant is spent. */
function useCountdown(expiresAt) {
  const [left, setLeft] = useState(() => remaining(expiresAt));

  useEffect(() => {
    // A second is the coarsest tick that still reads as a live countdown; the
    // banner is the only thing on the page that needs it, so the cost is one
    // timer rather than a render loop.
    const id = setInterval(() => setLeft(remaining(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return left;
}

function remaining(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;

  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function ImpersonationBanner({ impersonation }) {
  const { leaveBusiness } = useSuperAdminMutations();
  const left = useCountdown(impersonation?.expiresAt);

  if (!impersonation) return null;

  const leave = () =>
    leaveBusiness.mutate(undefined, {
      // A full reload rather than a route change: leaving invalidates the
      // session every open query was fetched under, and the cleanest way to be
      // certain nothing cached under the grant survives is to start again.
      // Back to the super admin panel, on its own host when it has one.
      onSuccess: () => {
        window.location.assign(superAdminUrl('/superadmin'));
      },
    });

  return (
    <div
      // `alert` rather than `status`: this is not a passive update, and a
      // screen-reader user needs it announced when it appears rather than
      // whenever they next happen to reach it.
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-danger px-4 py-2 text-white sm:px-6"
    >
      <ShieldAlert className="size-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />

      <span className="min-w-0 text-sm font-medium">
        You are inside{' '}
        <span className="font-bold">{impersonation.businessName}</span> as platform
        support. Everything you do is written into their activity log.
      </span>

      {left && (
        <span className="tnum rounded-md bg-white/20 px-1.5 py-0.5 text-xs font-semibold">
          {left} left
        </span>
      )}

      <button
        type="button"
        onClick={leave}
        disabled={leaveBusiness.isPending}
        className={cn(
          pressable,
          'ml-auto rounded-md bg-white px-2.5 py-1 text-sm font-semibold text-danger',
          'disabled:opacity-60',
        )}
      >
        {leaveBusiness.isPending ? 'Leaving…' : 'Leave'}
      </button>
    </div>
  );
}

export default ImpersonationBanner;
