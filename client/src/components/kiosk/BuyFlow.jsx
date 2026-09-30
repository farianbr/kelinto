import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import Input from '@/components/ui/Input';
import PhoneField from '@/components/ui/PhoneField';
import { useAuth } from '@/hooks/useAuth';
import { useKioskMutations } from '@/hooks/useKiosk';
import { startKioskShopping } from '@/lib/kioskShopping';
import KioskStepper from './KioskStepper';
import KioskOption from './KioskOption';
import { hasNumber } from './customerSteps';

/**
 * "Buy parts": sign the customer in to the website from the tablet.
 *
 * ## What happens after
 *
 * The customer is handed the real website, signed in, with the kiosk bar
 * across it (`KioskShoppingBar`): the same catalogue, cart and checkout a
 * customer uses at home, except that checkout offers only pickup here and
 * payment at the counter. After the order the website sends them back to
 * `/kiosk` to be asked "Order again?".
 *
 * ## Why the account is approved here
 *
 * Signing in or signing up at the kiosk approves a pending account on the spot
 * (client ruling, 2026-09-29): the customer is standing in the shop and pays a
 * person before anything leaves it. The server does that, and only behind the
 * tablet's own session; nothing on this screen can.
 *
 * One question per screen, like the other doors, so a new account is five
 * short screens rather than one long form on a tablet.
 */
const BLANK = {
  have: '',
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  phone: '',
  newPassword: '',
};

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
const passwordProblem = (value) => {
  if (value.length < 8) return 'At least 8 characters.';
  if (!/[A-Za-z]/.test(value)) return 'Include a letter.';
  if (!/[0-9]/.test(value)) return 'Include a number.';
  return null;
};

export function BuyFlow({ speak, chrome }) {
  const [answers, setAnswers] = useState(BLANK);
  const { shopSignIn, shopSignUp } = useKioskMutations();
  const { refresh } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  /**
   * Signed in: hand the tablet over to the website.
   *
   * The session is written into the auth cache before navigating, as the
   * website's own sign-in does, so the first frame of the shop already knows
   * who is there; `refresh` then refetches prices for an approved viewer.
   */
  function toWebsite({ user }) {
    queryClient.setQueryData(['auth', 'me'], (current) => ({ ...(current ?? {}), user }));
    startKioskShopping();
    refresh();
    navigate('/shop');
  }

  const isNew = (a) => a.have === 'no';
  const hasAccount = (a) => a.have === 'yes';

  const steps = useMemo(
    () => [
      {
        key: 'have',
        prompt: 'Do you have an account with us?',
        hint: 'The one you use on our website.',
        footer: 'none',
        valid: (a) => Boolean(a.have),
        render: ({ next }) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <KioskOption label="Yes, sign me in" onClick={() => next({ have: 'yes' })} />
            <KioskOption
              label="No, I'm new"
              detail="Takes a minute"
              onClick={() => next({ have: 'no' })}
            />
          </div>
        ),
      },

      // ---- an existing account ---------------------------------------------
      {
        key: 'signIn',
        when: hasAccount,
        prompt: 'Sign in',
        valid: (a) => looksLikeEmail(a.email) && a.password.length > 0,
        nextLabel: 'Sign in',
        pending: shopSignIn.isPending,
        error: shopSignIn.error?.message,
        onNext: ({ answers: a }) =>
          shopSignIn.mutate({ email: a.email, password: a.password }, { onSuccess: toWebsite }),
        render: ({ answers: a, set }) => (
          <div className="space-y-4">
            <Input
              type="email"
              label="Email"
              autoComplete="username"
              autoCapitalize="off"
              value={a.email}
              onChange={(event) => set('email', event.target.value)}
              autoFocus
            />
            <Input
              type="password"
              label="Password"
              autoComplete="current-password"
              value={a.password}
              onChange={(event) => set('password', event.target.value)}
            />
          </div>
        ),
      },

      // ---- a new account ---------------------------------------------------
      {
        key: 'name',
        when: isNew,
        prompt: "What's your name?",
        valid: (a) => a.firstName.trim().length > 0 && a.lastName.trim().length > 0,
        render: ({ answers: a, set }) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              required
              autoComplete="given-name"
              value={a.firstName}
              onChange={(event) => set('firstName', event.target.value)}
              autoFocus
            />
            <Input
              label="Last name"
              required
              autoComplete="family-name"
              value={a.lastName}
              onChange={(event) => set('lastName', event.target.value)}
            />
          </div>
        ),
      },
      {
        key: 'email',
        when: isNew,
        prompt: "What's your email?",
        hint: 'You sign in with it, here and on our website.',
        valid: (a) => looksLikeEmail(a.email),
        render: ({ answers: a, set }) => (
          <Input
            type="email"
            aria-label="Email"
            autoComplete="email"
            autoCapitalize="off"
            placeholder="you@example.com"
            value={a.email}
            onChange={(event) => set('email', event.target.value)}
            className="text-center"
            autoFocus
          />
        ),
      },
      {
        key: 'phone',
        when: isNew,
        prompt: "What's your phone number?",
        hint: 'So we can reach you about your order.',
        valid: (a) => hasNumber(a.phone),
        render: ({ answers: a, set }) => (
          <PhoneField label="Phone number" value={a.phone} onChange={(value) => set('phone', value)} />
        ),
      },
      {
        key: 'password',
        when: isNew,
        prompt: 'Choose a password',
        hint: 'At least 8 characters, with a letter and a number.',
        valid: (a) => !passwordProblem(a.newPassword),
        nextLabel: 'Create account',
        pending: shopSignUp.isPending,
        error: shopSignUp.error?.message,
        onNext: ({ answers: a }) =>
          shopSignUp.mutate(
            {
              contactName: `${a.firstName.trim()} ${a.lastName.trim()}`,
              email: a.email.trim().toLowerCase(),
              phone: a.phone,
              password: a.newPassword,
            },
            { onSuccess: toWebsite },
          ),
        render: ({ answers: a, set }) => (
          <Input
            type="password"
            aria-label="Password"
            autoComplete="new-password"
            value={a.newPassword}
            onChange={(event) => set('newPassword', event.target.value)}
            autoFocus
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shopSignIn.isPending, shopSignIn.error, shopSignUp.isPending, shopSignUp.error],
  );

  return <KioskStepper steps={steps} answers={answers} setAnswers={setAnswers} speak={speak} chrome={chrome} />;
}

export default BuyFlow;
