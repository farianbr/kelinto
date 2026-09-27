import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileText,
  Handshake,
  LogIn,
  Store,
  Tag,
  Truck,
} from 'lucide-react';
import cn from '@/lib/cn';
import BusinessMark from '@/components/layout/BusinessMark';
import SignInLayout, { SignInHeading } from '@/components/layout/SignInLayout';
import { PlatformButton } from '@/components/superadmin/PlatformUI';
import { PlatformError, PlatformInput } from '@/components/superadmin/PlatformForm';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import { useSupplierPortalMutations } from '@/hooks/useSupplierPortal';
import { pressable } from '@/lib/motion';

/**
 * Sign in to the supplier portal (§6.8a).
 *
 * Rendered by `SupplierPortalLayout` in place of the page a signed-out supplier
 * asked for, rather than at a route of its own - so a supplier who followed an
 * emailed request link lands back on that request after signing in, instead of
 * having to find the email again.
 *
 * **The same door as the ERP and the console** (`SignInLayout`): Kelinto's
 * frame, fields and buttons, in the business's logo and colour
 * (`tone="business"`). The portal lives at the business's website address and
 * is that business's, so a supplier sees who they are supplying; the controls
 * are the ones every other sign-in uses, so there is one standard, not two.
 *
 * **One error for every failure.** Unknown address, wrong password, no portal
 * access yet: the server answers all three identically, and this page must not
 * undo that by guessing. Telling an outsider which addresses have accounts is
 * telling them who supplies the business.
 */
export function SupplierLoginPage() {
  // Whose portal this is, from the website's own profile: the same record its
  // header draws from, never a hardcoded name (which is what this page used to
  // greet a CellShoppe supplier with).
  const info = useBusinessInfo();
  const [forgot, setForgot] = useState(false);
  const { signIn, forgotPassword } = useSupplierPortalMutations();

  const form = useForm({ defaultValues: { email: '', password: '', remember: true } });
  const forgotForm = useForm({ defaultValues: { email: '' } });

  return (
    <SignInLayout
      tone="business"
      mark={
        <div className="flex flex-col items-center gap-2 text-center">
          <BusinessMark size="lg" className="h-12 max-w-full object-contain" />
          <span className="text-xs font-semibold uppercase tracking-wider text-plat-dim">Supplier portal</span>
        </div>
      }
      art={{
        centre: { icon: Store, image: info.faviconUrl || null },
        // Orders, prices, paperwork, delivery, the agreement: the kinds of
        // work, not the portal's screen names.
        nodes: [ClipboardList, Tag, FileText, Truck, Handshake],
        title: 'Every order we send you, in one place.',
        body: 'From the first quote to the final delivery.',
      }}
    >
      {forgot ? (
        <>
          <SignInHeading title="Reset your password">We will email you a link to set a new one.</SignInHeading>
          {forgotPassword.isSuccess ? (
            <p className="mt-6 flex items-start gap-2 text-sm text-plat-ok">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {/* Says "if" on purpose: the server answers the same way for an
                  address it has never seen, and the copy has to match or it
                  leaks what the endpoint refused to. */}
              If that address has portal access, a reset link is on its way.
            </p>
          ) : (
            <form onSubmit={forgotForm.handleSubmit((values) => forgotPassword.mutate(values))} className="mt-6">
              <PlatformInput
                label="Email"
                type="email"
                autoComplete="username"
                required
                {...forgotForm.register('email', { required: 'Enter your email.' })}
                error={forgotForm.formState.errors.email?.message}
              />
              <PlatformButton variant="primary" type="submit" className="mt-6 w-full" loading={forgotPassword.isPending}>
                Email me a link
              </PlatformButton>
            </form>
          )}
          <button
            type="button"
            onClick={() => setForgot(false)}
            className={cn(pressable, 'mt-5 inline-flex items-center gap-1.5 rounded text-sm font-medium text-plat-accent-soft')}
          >
            <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
            Back to sign in
          </button>
        </>
      ) : (
        <>
          <SignInHeading>Welcome back. Sign in to see your orders.</SignInHeading>

          {signIn.isError && (
            <div className="mt-6">
              <PlatformError>
                <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {signIn.error.message}
              </PlatformError>
            </div>
          )}

          <form onSubmit={form.handleSubmit((values) => signIn.mutate(values))} className="mt-6">
            <PlatformInput
              label="Email"
              type="email"
              autoComplete="username"
              required
              {...form.register('email', { required: 'Enter your email.' })}
              error={form.formState.errors.email?.message}
            />
            <PlatformInput
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-3"
              {...form.register('password', { required: 'Enter your password.' })}
              error={form.formState.errors.password?.message}
            />

            <div className="mt-3 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-plat-muted">
                <input
                  type="checkbox"
                  className="size-4 rounded border-plat-line accent-plat-accent"
                  {...form.register('remember')}
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={() => setForgot(true)}
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
      )}
    </SignInLayout>
  );
}

export default SupplierLoginPage;
