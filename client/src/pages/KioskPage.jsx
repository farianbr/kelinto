import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import useDocumentTitle from '@/hooks/useDocumentTitle';
import useBusinessTheme from '@/hooks/useBusinessTheme';
import useIdleTimer from '@/hooks/useIdleTimer';
import { useKioskConfig, useKioskDevices, useKioskMutations, useSpeech } from '@/hooks/useKiosk';
import { getBusiness, setBusiness } from '@/store/businessStore';
import { DensityProvider } from '@/components/ui/density';
import { KIOSK_CLOCKS } from '@shared/kiosk';
import KioskLockScreen from '@/components/kiosk/KioskLockScreen';
import KioskHome from '@/components/kiosk/KioskHome';
import KioskDone from '@/components/kiosk/KioskDone';
import KioskIdleWarning from '@/components/kiosk/KioskIdleWarning';
import RepairFlow from '@/components/kiosk/RepairFlow';
import BuyFlow from '@/components/kiosk/BuyFlow';
import SellFlow from '@/components/kiosk/SellFlow';
import KioskOrderAgain from '@/components/kiosk/KioskOrderAgain';
import { useAuth } from '@/hooks/useAuth';
import { endKioskShopping, isKioskShopping, startKioskShopping } from '@/lib/kioskShopping';

/**
 * The kiosk (Sales § Kiosk): a tablet on the counter with three doors.
 *
 * **Repair** books a device in, **Sell your phone** asks for an offer on one,
 * **Buy parts** signs the customer into the website to shop and pay at the
 * counter. Each door is its own flow component; this page owns only what they
 * share: the lock, the welcome screen, the read-aloud switch, the theme, and
 * the idle clock that hands the tablet back to the next customer.
 *
 * ## The idle clock
 *
 * Every screen past the welcome runs on the business's own timeout (Settings ›
 * Kiosk). When it fires the flow is thrown away and the welcome screen comes
 * back, never the lock screen: the lock is for staff at opening time, and a
 * customer who walked off must not leave the next one facing a PIN pad.
 */

/**
 * Take the business out of the kiosk's own URL, once, before anything fetches.
 *
 * **A kiosk tab starts with no business.** The selected business lives in
 * `sessionStorage`, which a new tab does not inherit, and the kiosk is opened
 * in one. With nothing stored the request names no business, and on localhost
 * the server falls back to the default one: a staff member pressed Open kiosk
 * and was shown another business's kiosk, switched off.
 *
 * In a `useState` initialiser rather than an effect: an effect runs after the
 * first render, and the first render is where `useKioskConfig` fires. In
 * production the host names the business and the parameter is redundant.
 */
function useAdoptBusinessFromUrl() {
  useState(() => {
    try {
      const wanted = new URLSearchParams(window.location.search).get('business');
      if (wanted && wanted !== getBusiness()) setBusiness(wanted);
    } catch {
      // A malformed URL is not a reason to refuse a customer: with nothing
      // adopted the kiosk falls back to whatever the host resolves.
    }
  });
}

/**
 * The shop's colour and the kiosk's touch density, around every branch.
 *
 * Split from the flow so both survive the early returns: the kiosk draws one of
 * several quite different screens, and painting each separately is how four of
 * them end up correct and the fifth ships in the house colour.
 */
export function KioskPage() {
  useAdoptBusinessFromUrl();

  const { data: config } = useKioskConfig();
  const theme = useBusinessTheme(config?.colorToken, { portals: false });

  return (
    // A real box, not `display: contents`: every screen paints `bg-surface-2`
    // on its own root, and a wrapper with no box leaves a white band under a
    // short screen on a tablet.
    <div style={theme} className="min-h-dvh bg-surface-2">
      <DensityProvider value="touch">
        <KioskFlow />
      </DensityProvider>
    </div>
  );
}

/**
 * The order a kiosk shopper just placed, read once from `?ordered=`.
 *
 * The website's thank-you page sends the tablet here with it (see
 * `ThankYouPage`), and only while the tab is in kiosk shopping mode: a stray
 * `?ordered=` on a tablet nobody is shopping on is ignored rather than asking
 * nobody whether they want to order again.
 */
function readOrdered() {
  try {
    const value = new URLSearchParams(window.location.search).get('ordered');
    return value && isKioskShopping() ? value : null;
  } catch {
    return null;
  }
}

function KioskFlow() {
  useDocumentTitle('Kiosk');

  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { data: config, isLoading } = useKioskConfig();
  const { unlock } = useKioskMutations();

  const [unlockedHere, setUnlockedHere] = useState(false);
  const unlocked = unlockedHere || config?.unlocked === true;

  /** `home`, `ordered`, or the door the customer walked through. */
  const [ordered] = useState(readOrdered);
  const [screen, setScreen] = useState(ordered ? 'ordered' : 'home');
  const [signingOut, setSigningOut] = useState(false);
  const [done, setDone] = useState(null);
  /** Bumped to throw a flow's answers away and start it fresh. */
  const [run, setRun] = useState(0);
  const [readAloud, setReadAloud] = useState(true);
  /**
   * True when the idle clock, not a customer, brought the tablet home.
   *
   * The welcome screen reads itself aloud on arrival, and after a timeout
   * there is nobody standing there: it would announce the three doors to an
   * empty room after every abandoned check-in. Any customer action clears it.
   */
  const [quietHome, setQuietHome] = useState(false);

  const { data: deviceData } = useKioskDevices(unlocked);
  const { speak, supported: speechSupported } = useSpeech(readAloud);

  useEffect(() => {
    if (config?.readAloud === false) setReadAloud(false);
  }, [config?.readAloud]);

  const goHome = useCallback(() => {
    setQuietHome(false);
    setScreen('home');
    setDone(null);
    setRun((value) => value + 1);
  }, []);

  /**
   * End a kiosk shopper's website session and give the tablet back.
   *
   * No confirmation: "No, sign me out" is itself the answer to a question, and
   * the timeout is the tablet acting for somebody who has left. A failed
   * sign-out still ends kiosk mode, because a session the server may still hold
   * is better than a tablet stuck on somebody else's account; the website
   * session also expires on its own (`kioskService.SHOP_SESSION`).
   */
  const finishShopping = useCallback(async () => {
    setSigningOut(true);
    // Signing out forgets the selected business, and on a host that does not
    // name one (localhost) the kiosk would then fall back to the default.
    const business = getBusiness();
    try {
      await signOut();
    } catch {
      // See above: the tablet moves on either way.
    } finally {
      if (business) setBusiness(business);
      endKioskShopping();
      setSigningOut(false);
      // Drops `?ordered=` so a reload does not ask again.
      const url = new URL(window.location.href);
      url.searchParams.delete('ordered');
      window.history.replaceState(null, '', url.pathname + url.search);
      goHome();
    }
  }, [signOut, goHome]);

  /**
   * A tablet that lands on the welcome screen still in shopping mode (the page
   * was reloaded, or somebody typed /kiosk into the address bar) signs that
   * shopper out first. The next customer must never inherit an account.
   */
  useEffect(() => {
    if (screen === 'home' && isKioskShopping()) finishShopping();
  }, [screen, finishShopping]);

  const idle = useIdleTimer({
    // "Order again?" runs its own, shorter clock.
    active: unlocked && screen !== 'home' && screen !== 'ordered',
    timeoutSeconds: config?.idleTimeoutSeconds ?? KIOSK_CLOCKS.idleTimeoutSeconds.default,
    warningSeconds: config?.idleWarningSeconds ?? KIOSK_CLOCKS.idleWarningSeconds.default,
    onTimeout: () => {
      goHome();
      setQuietHome(true);
    },
  });

  useEffect(() => {
    if (done) speak(`${done.title}. ${done.message ?? config?.thankYouMessage ?? ''}`);
  }, [done, config?.thankYouMessage, speak]);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <span className="sr-only">Loading the kiosk</span>
      </div>
    );
  }

  if (config && !config.isEnabled) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-2xl font-bold text-ink-900">The kiosk is switched off</h1>
          <p className="mt-2 text-lg text-ink-500">
            Turn it on in Settings › Kiosk, and set a PIN, before putting this tablet out.
          </p>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <KioskLockScreen
        businessName={config?.businessName}
        isPending={unlock.isPending}
        error={unlock.error?.message}
        onUnlock={(pin, clear) =>
          unlock.mutate(
            { pin },
            {
              onSuccess: () => setUnlockedHere(true),
              onError: () => clear(),
            },
          )
        }
      />
    );
  }

  const chrome = {
    businessName: config?.businessName ?? 'Welcome',
    readAloud,
    onToggleAloud: () => {
      setQuietHome(false);
      setReadAloud((value) => !value);
    },
    speechSupported,
    onStartOver: screen === 'home' ? undefined : goHome,
  };

  const warning = (
    <KioskIdleWarning
      open={idle.warning}
      remaining={idle.remaining}
      onStay={idle.stillHere}
      onLeave={goHome}
    />
  );

  if (done) {
    return (
      <>
        <KioskDone
          title={done.title}
          message={done.message ?? config?.thankYouMessage}
          numberLabel={done.numberLabel}
          number={done.number}
          onDone={goHome}
          chrome={{ ...chrome, onStartOver: undefined }}
        />
        {warning}
      </>
    );
  }

  if (screen === 'repair') {
    return (
      <>
        <RepairFlow
          key={run}
          config={config}
          tree={deviceData?.devices ?? []}
          speak={speak}
          chrome={chrome}
          onDone={(result) =>
            setDone({
              title: result.firstName ? `You're all set, ${result.firstName}!` : "You're all set!",
              numberLabel: 'Your check-in number',
              number: result.ticketNumber,
            })
          }
        />
        {warning}
      </>
    );
  }

  if (screen === 'sell') {
    return (
      <>
        <SellFlow
          key={run}
          tree={deviceData?.devices ?? []}
          speak={speak}
          chrome={chrome}
          onDone={(result) =>
            setDone({
              title: result.firstName ? `Thank you, ${result.firstName}!` : 'Thank you!',
              message:
                'Please hand your phone to our team. We will check it and agree a price with you at the counter.',
              numberLabel: 'Your reference number',
              number: result.number,
            })
          }
        />
        {warning}
      </>
    );
  }

  if (screen === 'buy') {
    return (
      <>
        <BuyFlow key={run} speak={speak} chrome={chrome} />
        {warning}
      </>
    );
  }

  if (screen === 'ordered') {
    return (
      <KioskOrderAgain
        orderNumber={ordered}
        seconds={config?.orderAgainSeconds ?? KIOSK_CLOCKS.orderAgainSeconds.default}
        busy={signingOut}
        onAgain={() => {
          startKioskShopping();
          navigate('/shop');
        }}
        onFinish={finishShopping}
        chrome={{ ...chrome, onStartOver: undefined }}
      />
    );
  }

  return <KioskHome config={config} chrome={chrome} onChoose={setScreen} speak={speak} quiet={quietHome} />;
}

export default KioskPage;
