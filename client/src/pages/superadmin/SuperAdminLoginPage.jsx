import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AlertCircle, Layers, LogIn } from 'lucide-react';

import { PlatformButton } from '@/components/superadmin/PlatformUI';
import { PlatformError, PlatformInput } from '@/components/superadmin/PlatformForm';
import { useSuperAdminMutations } from '@/hooks/useSuperAdmin';

/**
 * Signing in to the platform console.
 *
 * **Deliberately austere, and deliberately not Cellvix.** This is not a
 * tenant's login - it reaches every tenant - so it carries no business name, no
 * storefront chrome and no "forgot password" self-service path. An account that
 * can reconfigure the platform is issued and reset by another operator, not
 * recovered by email.
 *
 * It is also the **first screen an operator sees**, which makes it the one
 * place the identity most has to be right: a red-accented sheet here would
 * announce a tenant's brand before anybody has signed in to the platform. The
 * mark, the palette and the wording are the console's own.
 *
 * One error message for a bad email and a bad password, as every other sign-in
 * here uses: telling them apart is an account-enumeration oracle, and it
 * matters more on this door than on any other.
 */
export function SuperAdminLoginPage() {
  const { signIn } = useSuperAdminMutations();
  const [error, setError] = useState(null);

  const { register, handleSubmit, formState } = useForm({
    defaultValues: { email: '', password: '' },
  });

  function submit(values) {
    setError(null);
    signIn.mutate(values, { onError: (err) => setError(err.message) });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-plat-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-plat-accent">
            <Layers className="size-5 text-white" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold leading-tight tracking-[-0.01em] text-plat-text">
              Kelinto
            </span>
            <span className="block text-xs leading-tight text-plat-dim">Super admin</span>
          </span>
        </div>

        <div className="rounded-xl border border-plat-line bg-plat-surface p-6">
          {/* Tracking tightens as the size grows - the optical correction that
              separates a set headline from a scaled-up paragraph. */}
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-plat-text">
            Sign in
          </h1>
          <p className="mt-1 text-[13px] leading-normal text-plat-muted">
            This panel reaches every tenant on Kelinto.
          </p>

          {error && (
            <div className="mt-4">
              <PlatformError>
                <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {error}
              </PlatformError>
            </div>
          )}

          <form onSubmit={handleSubmit(submit)} className="mt-4">
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

            <PlatformButton
              variant="primary"
              type="submit"
              icon={LogIn}
              className="mt-4 w-full"
              loading={signIn.isPending}
            >
              Sign in
            </PlatformButton>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-plat-dim">
          Accounts are issued by another operator. There is no self-service reset.
        </p>
      </div>
    </div>
  );
}

export default SuperAdminLoginPage;
