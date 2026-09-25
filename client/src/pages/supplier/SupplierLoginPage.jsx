import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AlertCircle, CheckCircle2, Send } from 'lucide-react';
import cn from '@/lib/cn';
import { BUSINESS_INFO } from '@shared/business';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
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
 * **One error for every failure.** Unknown address, wrong password, no portal
 * access yet: the server answers all three identically, and this page must not
 * undo that by guessing. Telling an outsider which addresses have accounts is
 * telling them who supplies Cellvix.
 */
/**
 * @param businessName whose portal this is, resolved from the host by the
 *   shell. Falls back to `BUSINESS_INFO.name` for a deployment that has not
 *   pointed a host at a business yet - never to a hardcoded "Cellvix", which
 *   is what this page used to greet a CellShoppe supplier with.
 */
export function SupplierLoginPage({ businessName = null }) {
  /**
   * Who is asking for the password: the business whose address this is. Every
   * business has its own supplier portal, so there is no shared door and no
   * reason to name anybody else.
   */
  const seller = businessName ?? BUSINESS_INFO.name;
  const [forgot, setForgot] = useState(false);
  const { signIn, forgotPassword } = useSupplierPortalMutations();

  const { register, handleSubmit } = useForm({ defaultValues: { email: '', password: '' } });
  const forgotForm = useForm({ defaultValues: { email: '' } });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-2 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-gradient-compact text-white">
            <Send className="size-4.5" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold leading-tight text-ink-900">
              {seller} suppliers
            </h1>
            <p className="text-sm text-ink-500">
              Price the requests we send you, in one place.
            </p>
          </div>
        </div>

        {forgot ? (
          <Panel>
            {forgotPassword.isSuccess ? (
              <>
                <p className="flex items-start gap-2 text-sm text-ok">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {/* Says "if" on purpose: the server answers the same way for an
                      address it has never seen, and the copy has to match or it
                      leaks what the endpoint refused to. */}
                  If that address has portal access, a reset link is on its way.
                </p>
                <button
                  type="button"
                  onClick={() => setForgot(false)}
                  className={cn(pressable, 'mt-4 text-sm font-semibold text-brand hover:underline')}
                >
                  Back to sign in
                </button>
              </>
            ) : (
              <form
                onSubmit={forgotForm.handleSubmit((values) => forgotPassword.mutate(values))}
                className="space-y-3"
              >
                <p className="text-sm text-ink-500">
                  Enter the address we send your requests to and we will email a reset link.
                </p>
                <Input
                  label="Email"
                  type="email"
                  required
                  autoComplete="email"
                  {...forgotForm.register('email')}
                />
                <div className="flex items-center gap-2">
                  <Button type="submit" loading={forgotPassword.isPending}>
                    Email me a link
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setForgot(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </Panel>
        ) : (
          <Panel>
            <form
              onSubmit={handleSubmit((values) => signIn.mutate(values))}
              className="space-y-3"
            >
              {signIn.isError && (
                <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {signIn.error.message}
                </p>
              )}

              <Input
                label="Email"
                type="email"
                required
                autoComplete="email"
                {...register('email')}
              />
              <Input
                label="Password"
                type="password"
                required
                autoComplete="current-password"
                {...register('password')}
              />

              <Button type="submit" fullWidth loading={signIn.isPending}>
                Sign in
              </Button>

              <button
                type="button"
                onClick={() => setForgot(true)}
                className={cn(pressable, 'block text-sm font-semibold text-brand hover:underline')}
              >
                I forgot my password
              </button>
            </form>
          </Panel>
        )}

        <p className="mt-4 text-center text-xs leading-relaxed text-ink-400">
          Supply {seller} and have no login? Reply to any email from our purchasing team
          and we will send you one.
        </p>
      </div>
    </div>
  );
}

export default SupplierLoginPage;
