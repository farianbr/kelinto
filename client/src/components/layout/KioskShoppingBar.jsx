import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { LogOut, Store } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { KIOSK_CLOCKS } from '@shared/kiosk';
import { kioskPath, useAuth, useSignOut } from '@/hooks/useAuth';
import { useKioskConfig, useSpeech } from '@/hooks/useKiosk';
import useIdleTimer from '@/hooks/useIdleTimer';
import { endKioskShopping, useKioskShopping } from '@/lib/kioskShopping';
import { getBusiness, setBusiness } from '@/store/businessStore';
import KioskIdleWarning from '@/components/kiosk/KioskIdleWarning';

/**
 * The strip across the website while a customer shops from the kiosk.
 *
 * ## Where it sits, and why there
 *
 * **Inside the sticky header, in the announcement bar's place.** The header
 * measures its own height (`--header-h`, `--chrome-h`) and every scrim, mega
 * menu and sticky sidebar hangs off that measurement, so a strip inside it
 * moves all of them down with it and nothing overlaps. A fixed bar on top or at
 * the foot would have covered the cart button, the bottom nav or the
 * checkout's summary on one width or another. The announcement is dropped for
 * the visit: a promotion banner is not what a customer at a counter is there
 * to read, and two strips would take a fifth of a tablet's height.
 *
 * ## What it carries
 *
 * Who is signed in (so a customer who walks up to a tablet somebody else left
 * can see it is not theirs), and the way out. Signing out confirms, like every
 * sign-out in the app; the idle clock is the one sign-out that does not,
 * because by then there is nobody there to ask.
 */
export function KioskShoppingBar() {
  const active = useKioskShopping();
  const { user, isLoading, isRetryingAuth } = useAuth();
  const { data: config } = useKioskConfig();
  const askSignOut = useSignOut();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  // The warning is read aloud on the website too, under the tablet's own
  // read-aloud setting: the customer is still standing at the kiosk.
  const { speak } = useSpeech(active && config?.readAloud !== false);

  const leave = useCallback(async () => {
    const business = getBusiness();
    try {
      await signOut();
    } catch {
      // The tablet moves on regardless; the session also expires on its own.
    }
    if (business) setBusiness(business);
    endKioskShopping();
    navigate(kioskPath(business));
  }, [signOut, navigate]);

  // Signed out some other way (the session expired, or the account menu) while
  // still in kiosk mode: hand the tablet back rather than leave a signed-out
  // website on it.
  useEffect(() => {
    // Waits out a refetch: straight after the kiosk signs somebody in, the
    // cached answer is still the signed-out one until `/auth/me` returns.
    if (!active || isLoading || isRetryingAuth || user) return;
    const business = getBusiness();
    endKioskShopping();
    navigate(kioskPath(business));
  }, [active, isLoading, isRetryingAuth, user, navigate]);

  const idle = useIdleTimer({
    active: active && Boolean(user),
    timeoutSeconds: config?.idleTimeoutSeconds ?? KIOSK_CLOCKS.idleTimeoutSeconds.default,
    warningSeconds: config?.idleWarningSeconds ?? KIOSK_CLOCKS.idleWarningSeconds.default,
    onTimeout: leave,
  });

  if (!active || !user) return null;

  return (
    <>
      <div className="bg-ink-900 text-white">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-3 py-2 sm:px-4 lg:px-6">
          <Store className="size-4 shrink-0 text-white/70" strokeWidth={2} aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold">In-store kiosk</span>
            <span className="text-white/70"> · Signed in as {user.displayName ?? user.email}</span>
          </p>
          <button
            type="button"
            onClick={askSignOut}
            className={cn(
              pressable,
              'inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-surface px-3.5 text-sm font-semibold text-ink-900',
            )}
          >
            <LogOut className="size-4" strokeWidth={2} aria-hidden="true" />
            Finish and sign out
          </button>
        </div>
      </div>

      <KioskIdleWarning
        open={idle.warning}
        remaining={idle.remaining}
        onStay={idle.stillHere}
        onLeave={leave}
        leaveLabel="Sign me out"
        speak={speak}
      />
    </>
  );
}

export default KioskShoppingBar;
