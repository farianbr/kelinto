import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { passwordSchema } from '@shared/schemas/auth';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  CreditCard,
  Globe,
  KeyRound,
  LogIn,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import KelintoLogo from '@/components/platform/KelintoLogo';
import SignInLayout, { SignInHeading } from '@/components/layout/SignInLayout';

import { PlatformButton } from '@/components/superadmin/PlatformUI';
import { PlatformError, PlatformInput } from '@/components/superadmin/PlatformForm';
import { useSuperAdminMutations } from '@/hooks/useSuperAdmin';
import { usePlatformBrand } from '@/hooks/usePlatformBrand';

/**
 * Signing in to the platform console.
 *
 * **Deliberately not any business.** This is not a tenant's login - it reaches
 * every tenant - so it carries no business name and no storefront chrome.
 *
 * It is also the **first screen an operator sees**, which makes it the one
 * place the identity most has to be right: a red-accented sheet here would
 * announce a tenant's brand before anybody has signed in to the platform. The
 * mark, the palette and the wording are the console's own.
 *
 * **The same door as every other sign-in** (client ruling 2026-09-28): remember
 * me, and a forgotten-password path. It used to have neither, on the argument
 * that an operator is reset by another operator; with one operator that is
 * nobody. The reset mail is Kelinto's own, and a reset ends every session the
 * old password opened (`SuperAdmin.sessionsValidFrom`).
 *
 * Three views, one page: sign in, ask for a link, and set a new password from
 * that link (`/superadmin/reset?token=`), which the shell renders here because
 * a signed-out visitor to any console path gets this page.
 *
 * One error message for a bad email and a bad password, as every other sign-in
 * here uses: telling them apart is an account-enumeration oracle, and it
 * matters more on this door than on any other.
 */
export function SuperAdminLoginPage() {
  const { pathname, search } = useLocation();
  const token = pathname.startsWith('/superadmin/reset') ? new URLSearchParams(search).get('token') : null;
  const [view, setView] = useState(token ? 'reset' : 'sign-in');
  // Kelinto's own icon, from console › Brand, at the centre of the picture.
  const { data: brand } = usePlatformBrand();

  return (
    <SignInLayout
      mark={<KelintoLogo size="lg" stacked />}
      art={{
        centre: { icon: Globe, image: brand?.faviconUrl || null },
        nodes: [Building2, Users, CreditCard, Globe, ShieldCheck, SlidersHorizontal],
        title: 'Every business on Kelinto, from one console.',
        body: 'Set each business up, then look after it from here.',
      }}
    >
      {view === 'reset' && token ? (
        <ResetPassword token={token} onBack={() => setView('sign-in')} />
      ) : view === 'forgot' ? (
        <ForgotPassword onBack={() => setView('sign-in')} />
      ) : (
        <SignIn onForgot={() => setView('forgot')} />
      )}
    </SignInLayout>
  );
}

function SignIn({ onForgot }) {
  const { signIn } = useSuperAdminMutations();
  const [error, setError] = useState(null);
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { email: '', password: '', remember: true },
  });

  function submit(values) {
    setError(null);
    signIn.mutate(values, { onError: (err) => setError(err.message) });
  }

  return (
    <>
      <SignInHeading>Welcome back. Sign in to the console.</SignInHeading>

      {error && (
        <div className="mt-6">
          <PlatformError>
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </PlatformError>
        </div>
      )}

      <form onSubmit={handleSubmit(submit)} className="mt-6">
        <PlatformInput
          label="Email"
          type="email"
          autoComplete="username"
          required
          {...register('email', { required: 'Enter your email.' })}
          error={formState.errors.email?.message}
        />
        <PlatformInput
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-3"
          {...register('password', { required: 'Enter your password.' })}
          error={formState.errors.password?.message}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-plat-muted">
            <input type="checkbox" className="size-4 rounded border-plat-line accent-plat-accent" {...register('remember')} />
            Remember me
          </label>
          <button
            type="button"
            onClick={onForgot}
            className={cn(pressable, 'rounded text-sm font-medium text-plat-accent-soft')}
          >
            Forgot password?
          </button>
        </div>

        <PlatformButton variant="primary" type="submit" icon={LogIn} className="mt-4 w-full" loading={signIn.isPending}>
          Sign in
        </PlatformButton>
      </form>
    </>
  );
}

/** Asks for a link. The same answer whatever the address, as the server gives. */
function ForgotPassword({ onBack }) {
  const { forgotPassword } = useSuperAdminMutations();
  const form = useForm({ defaultValues: { email: '' } });

  return (
    <>
      <SignInHeading title="Reset your password">We will email you a link to choose a new one.</SignInHeading>
      {forgotPassword.isSuccess ? (
        <p className="mt-6 flex items-start gap-2 text-sm text-plat-ok">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          If that address has a console account, a reset link is on its way. It works for an hour.
        </p>
      ) : (
        <form onSubmit={form.handleSubmit((values) => forgotPassword.mutate(values))} className="mt-6">
          <PlatformError>{forgotPassword.error?.message}</PlatformError>
          <PlatformInput
            label="Email"
            type="email"
            autoComplete="username"
            required
            {...form.register('email', { required: 'Enter your email.' })}
            error={form.formState.errors.email?.message}
          />
          <PlatformButton variant="primary" type="submit" className="mt-6 w-full" loading={forgotPassword.isPending}>
            Email me a link
          </PlatformButton>
        </form>
      )}
      <BackLink onClick={onBack}>Back to sign in</BackLink>
    </>
  );
}

/** The server's own password rule, plus the second copy matching the first. */
const resetFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'The two passwords do not match.',
  });

/** Sets the new password from the emailed link, then opens the console. */
function ResetPassword({ token, onBack }) {
  const navigate = useNavigate();
  const { resetPassword } = useSuperAdminMutations();
  const form = useForm({ resolver: zodResolver(resetFormSchema), defaultValues: { password: '', confirm: '' } });

  function submit({ password }) {
    resetPassword.mutate({ token, password }, { onSuccess: () => navigate('/superadmin', { replace: true }) });
  }

  return (
    <>
      <SignInHeading title="Choose a new password">Signing in with it ends every other console session.</SignInHeading>
      <form onSubmit={form.handleSubmit(submit)} className="mt-6">
        <PlatformError>{resetPassword.error?.message}</PlatformError>
        <PlatformInput
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, with a letter and a number."
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        <PlatformInput
          label="Type it again"
          type="password"
          autoComplete="new-password"
          required
          className="mt-3"
          {...form.register('confirm')}
          error={form.formState.errors.confirm?.message}
        />
        <PlatformButton variant="primary" type="submit" icon={KeyRound} className="mt-6 w-full" loading={resetPassword.isPending}>
          Set password and sign in
        </PlatformButton>
      </form>
      <BackLink onClick={onBack}>Back to sign in</BackLink>
    </>
  );
}

function BackLink({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(pressable, 'mt-5 inline-flex items-center gap-1.5 rounded text-sm font-medium text-plat-accent-soft')}
    >
      <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
      {children}
    </button>
  );
}

export default SuperAdminLoginPage;
