import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useSearchParams } from 'react-router';
import { AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { supplierResetSchema } from '@shared/schemas/admin';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { useSupplierPortalMutations, useSupplierSession } from '@/hooks/useSupplierPortal';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import useBusinessTheme from '@/hooks/useBusinessTheme';

/**
 * Where a supplier sets a password from an emailed link
 * (`/supplier/reset?token=`): the invitation's first password
 * (`&invite=1`) or a reset. Both are single-use links to this business's
 * portal, and the page says which business, because a supplier to several
 * businesses on Kelinto has a separate login at each.
 *
 * A route of its own, outside the portal layout, because that layout answers
 * a signed-out visitor with the sign-in form.
 */
export function SupplierResetPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const invite = params.get('invite') === '1';
  useDocumentTitle(invite ? 'Set your password' : 'Reset password');
  const { resetPassword } = useSupplierPortalMutations();
  const { business } = useSupplierSession();
  const portal = business?.name ? `the ${business.name} supplier portal` : 'this supplier portal';
  const theme = useBusinessTheme(business?.colorToken);

  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(supplierResetSchema),
    defaultValues: { token, password: '' },
  });

  return (
    // In the business's own colour, like the portal it leads into.
    <div style={theme} data-business-theme="supplier" className="flex min-h-dvh items-center justify-center bg-surface-2 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-gradient-compact text-white">
            <KeyRound className="size-4.5" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold leading-tight text-ink-900">
              {invite ? 'Set your password' : 'Choose a new password'}
            </h1>
            <p className="text-sm text-ink-500">For {portal}.</p>
          </div>
        </div>

        <Panel>
          {!token ? (
            <p className="flex items-start gap-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              This link is incomplete. Open the one in your email again, or ask for a new one from
              the sign-in page.
            </p>
          ) : resetPassword.isSuccess ? (
            <>
              <p className="flex items-start gap-2 text-sm text-ok">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                {invite ? 'Your password is set. Sign in with it now.' : 'Your password is changed. Sign in with it now.'}
              </p>
              <Link to="/supplier" className="mt-4 inline-block text-sm font-semibold text-brand">
                Go to sign in
              </Link>
            </>
          ) : (
            <form
              onSubmit={handleSubmit((values) => resetPassword.mutate(values))}
              className="space-y-3"
            >
              {resetPassword.isError && (
                <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {resetPassword.error.message}
                </p>
              )}
              <input type="hidden" {...register('token')} />
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                required
                error={formState.errors.password?.message}
                {...register('password')}
              />
              <Button type="submit" fullWidth loading={resetPassword.isPending}>
                {invite ? 'Set password' : 'Set new password'}
              </Button>
            </form>
          )}
        </Panel>
      </div>
    </div>
  );
}

export default SupplierResetPage;
