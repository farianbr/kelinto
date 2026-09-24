import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, KeyRound, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { resetPasswordSchema } from '@shared/schemas/auth';

/**
 * Where a reset link lands.
 *
 * A page rather than a tab in the account dialog: the link arrives in an email
 * and is opened cold, often on a different device, so it has to be a URL that
 * stands on its own. The dialog handles *requesting* the link, which always
 * happens with the site already open.
 *
 * The token is read from the query string and posted back with the new
 * password. Everything that makes it safe is server-side - single use, one
 * hour, matched against a stored hash - because a client-side check of a token
 * the client already holds proves nothing.
 *
 * The server signs the session on success, so this navigates straight into the
 * account rather than asking for the password that was just chosen.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  // Which business holds the account, when the link says - the token's hash
  // lives in that business's database, so the request has to open it.
  const business = params.get('business') ?? '';
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
    shouldFocusError: true,
  });

  async function onSubmit(values) {
    setFormError(null);
    try {
      await api.post('/auth/reset-password', values, business ? { params: { business } } : undefined);
      // The cookie is set by the response; `refresh` is what makes the rest of
      // the app notice without a reload.
      await refresh?.();
      navigate('/account');
    } catch (error) {
      setFormError(error.message);
    }
  }

  // A link with no token at all is a mistyped or truncated URL, not a failed
  // reset - say so before asking for a password that cannot go anywhere.
  if (!token) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-warn-50 text-warn">
          <AlertCircle className="size-7" strokeWidth={1.5} />
        </span>
        <h1 className="mt-4 text-2xl">That link is incomplete</h1>
        <p className="mt-2 text-md leading-relaxed text-ink-500">
          Reset links expire after an hour and can only be used once. Ask for a new one from the
          sign-in panel.
        </p>
        <Button className="mt-6" onClick={() => navigate("/")}>
          Back to the shop
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-14 sm:py-20">
      <div className="mb-6 flex flex-col items-center text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand">
          <KeyRound className="size-6" strokeWidth={1.5} />
        </span>
        <h1 className="mt-4 text-2xl">Choose a new password</h1>
        <p className="mt-2 text-md leading-relaxed text-ink-500">
          Once it is saved you will be signed in on this device.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-4 rounded-lg border border-line bg-surface p-5 sm:p-6"
      >
        {formError && (
          <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {formError}
          </p>
        )}

        {/* The token rides along as a hidden field so the whole payload is one
            validated object rather than a value assembled at submit time. */}
        <input type="hidden" {...register('token')} />

        <Input
          label="New password"
          type="password"
          required
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
          error={errors.password?.message}
          data-autofocus
          {...register('password')}
        />

        <Input
          label="Confirm new password"
          type="password"
          required
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
          Save and sign in
        </Button>

        <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-400">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          This link stops working once it is used, and expires an hour after it was sent.
        </p>
      </form>
    </div>
  );
}

export default ResetPasswordPage;
