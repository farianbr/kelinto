import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

import api from '@/lib/api';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import Spinner from '@/components/ui/Spinner';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * The unsubscribe landing page (§6.13).
 *
 * **This exists because the law requires it**, not because it is a nice touch.
 * CASL says a commercial email must carry a working unsubscribe that takes no
 * more than two clicks - so this page is public, needs no sign-in, and does the
 * work on arrival rather than presenting a form to fill in. The HMAC in the
 * link is what authorises it; a guessed account id gets nowhere.
 *
 * It is deliberately outside `RootLayout`: somebody arriving here is leaving,
 * and putting a shop header with a mega menu in front of them would be reading
 * the moment badly.
 */
export function UnsubscribePage() {
  // CASL requires the sender be identified, so this page naming the wrong
  // business is a compliance problem rather than a branding one.
  const info = useBusinessInfo();
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: 'working' });

  // React 18 mounts twice in development. Without this the request fires
  // twice - harmless, because unsubscribing is idempotent, but the second
  // response would overwrite the first for no reason.
  const fired = useRef(false);

  const u = params.get('u');
  const t = params.get('t');

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    if (!u || !t) {
      setState({
        status: 'error',
        message: 'That link is incomplete. Use the unsubscribe link from the email itself.',
      });
      return;
    }

    api
      .post('/unsubscribe', { u, t })
      .then((result) => setState({ status: 'done', ...result }))
      .catch((error) => setState({ status: 'error', message: error.message }));
  }, [u, t]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-5 py-16 text-center">
      {state.status === 'working' && (
        <>
          <Spinner size="lg" className="text-ink-300" />
          <p className="mt-4 text-md text-ink-500">Updating your preferences…</p>
        </>
      )}

      {state.status === 'done' && (
        <>
          <span className="flex size-14 items-center justify-center rounded-full bg-ok-50 text-ok">
            <CheckCircle2 className="size-7" strokeWidth={1.5} aria-hidden="true" />
          </span>

          <h1 className="mt-5 font-display text-2xl font-bold text-ink-900">You are unsubscribed</h1>

          <p className="mt-3 text-md leading-relaxed text-ink-600">
            {state.email ? <strong className="font-medium">{state.email}</strong> : 'This address'}{' '}
            will not receive marketing email from {info.name} again.
          </p>

          {/* The distinction matters and people ask about it: opting out of
              marketing must not stop an order confirmation or an invoice from
              arriving, and saying so here prevents a support call. */}
          <p className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-sm leading-relaxed text-ink-500">
            You will still receive messages about your account and your orders - confirmations,
            invoices and delivery updates. Those are not marketing and are not affected by this.
          </p>

          <Link
            to="/"
            className={cn(pressable, 'mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
          >
            Back to the shop
          </Link>
        </>
      )}

      {state.status === 'error' && (
        <>
          <span className="flex size-14 items-center justify-center rounded-full bg-danger-50 text-danger">
            <AlertCircle className="size-7" strokeWidth={1.5} aria-hidden="true" />
          </span>

          <h1 className="mt-5 font-display text-2xl font-bold text-ink-900">
            That link did not work
          </h1>
          <p className="mt-3 text-md leading-relaxed text-ink-600">{state.message}</p>

          {/* An unsubscribe that cannot complete must still lead somewhere a
              person can act - a dead end here is a compliance failure. */}
          <p className="mt-4 text-sm leading-relaxed text-ink-500">
            Email{' '}
            <a
              href={`mailto:${info.email}`}
              className="text-brand underline underline-offset-2"
            >
              {info.email}
            </a>{' '}
            and we will remove you by hand.
          </p>

          <Link
            to="/"
            className={cn(pressable, 'mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
          >
            Back to the shop
          </Link>
        </>
      )}
    </main>
  );
}

export default UnsubscribePage;
