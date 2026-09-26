import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  LogIn,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import KelintoLogo from '@/components/platform/KelintoLogo';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { PlatformButton } from '@/components/superadmin/PlatformUI';
import { PlatformError, PlatformInput } from '@/components/superadmin/PlatformForm';
import RouteFallback from '@/components/layout/RouteFallback';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { panelBusiness, surface } from '@/lib/surface';

/**
 * The front door of the admin host (`PANEL_HOST`), in the console's theme.
 *
 * One page for every tenant's owners and staff. The login directory finds the
 * business an address belongs to, so nobody picks one before signing in.
 *
 * **Dressed as the platform, not as any business.** It serves all of them and
 * at this point nobody knows which, so it wears the operator console's palette
 * rather than the first tenant's red - a CellShoppe technician should not be
 * greeted in Cellvix's colours. The panel beyond it takes the business's own
 * accent as soon as one is known.
 *
 * Its own form rather than the storefront's `SignInTab`, because that one is
 * built from storefront controls. The behaviour is the same and the server is
 * the same: one password opening accounts at several businesses gets the
 * choice, and a customer who lands here is told where to go instead.
 *
 * **On a business's own panel domain it is that business's door** (`panelBusiness`):
 * named after it, and the server signs in only its accounts, so there is never
 * a choice to offer.
 *
 * **It is also what `/admin` shows anybody the ERP will not open for**, drawn
 * by `AdminShell` in place of the screen they asked for rather than redirected
 * here. The address they typed or bookmarked stays in the bar, so signing in
 * lands them on it instead of on the dashboard. It replaced a wall reading
 * "Admin access only" that offered no way forward: a signed-out owner
 * following their own invoice link met a permission error and nothing to press.
 */
export function PanelSignInPage() {
  const {
    user,
    isLoading,
    canUseAdmin,
    signIn,
    signOut,
    storefrontOrigin,
    authError,
    retryAuth,
    isRetryingAuth,
  } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [view, setView] = useState('sign-in');
  const [error, setError] = useState(null);
  const [choice, setChoice] = useState(null);
  const [choosing, setChoosing] = useState(null);
  useDocumentTitle(panelBusiness ? `Sign in to ${panelBusiness}` : 'Sign in');

  // Carried across when the shared panel sends somebody to their business's
  // own panel domain (`USE_PANEL_DOMAIN` below), so they only retype the password.
  const carriedEmail = new URLSearchParams(window.location.search).get('email') ?? '';
  const form = useForm({ defaultValues: { email: carriedEmail, password: '', remember: true } });

  if (isLoading) return <RouteFallback />;
  // `canUseAdmin` rather than the role: a staff member with no role has no panel.
  if (canUseAdmin) return <Navigate to="/admin" replace />;

  async function attempt(values) {
    setError(null);
    try {
      const signedIn = await signIn(values);
      // Drawn inside `/admin/...`, the shell opens the requested screen by
      // itself once the session exists; navigating would throw that away.
      if (['admin', 'staff'].includes(signedIn.role) && !pathname.startsWith('/admin')) {
        navigate('/admin');
      }
    } catch (err) {
      // Their business signs its staff in on its own domain. A session cannot
      // follow them there (it belongs to this host), so they sign in there.
      if (err.code === 'USE_PANEL_DOMAIN' && err.fields?.url) {
        window.location.assign(`${err.fields.url}/?email=${encodeURIComponent(values.email)}`);
        return;
      }
      if (err.code === 'BUSINESS_CHOICE_REQUIRED' && err.fields?.choices?.length) {
        setChoice({ values, choices: err.fields.choices });
        return;
      }
      setError(err.message);
    }
  }

  async function pick(business) {
    setChoosing(business.id);
    try {
      await attempt({ ...choice.values, business: business.id });
    } finally {
      setChoosing(null);
    }
  }

  return (
    <div className="kelinto flex min-h-dvh items-center justify-center bg-plat-bg px-4 py-10">
      <div className="w-full max-w-sm">
        {/* A business's own ERP domain greets its staff by the business's
            name; the shared one is Kelinto's front door, so it wears the
            wordmark. Either way the second word is "ERP", what they sign in to. */}
        <div className="mb-8">
          {panelBusiness ? (
            <span className="inline-flex items-center gap-3">
              <span className="text-2xl font-bold leading-none tracking-tight text-plat-text">{panelBusiness}</span>
              <span className="border-l border-plat-line pl-3 text-xs font-semibold uppercase tracking-wider text-plat-dim">
                ERP
              </span>
            </span>
          ) : (
            <KelintoLogo size="md" subtitle="ERP" />
          )}
        </div>

        <div className="rounded-xl border border-plat-line bg-plat-surface p-6">
          {authError && !user ? (
            <SessionUnknown onRetry={() => retryAuth()} retrying={isRetryingAuth} />
          ) : user ? (
            <NotForThisPanel user={user} onSignOut={signOut} websiteUrl={websiteUrlFor(storefrontOrigin)} />
          ) : view === 'forgot' ? (
            <ForgotPassword onBack={() => setView('sign-in')} />
          ) : choice ? (
            <>
              <h1 className="text-xl font-semibold leading-tight text-plat-text">
                Which business?
              </h1>
              <p className="mt-1 text-sm leading-normal text-plat-muted">
                {choice.values.email} has an account at each of these.
              </p>

              {error && (
                <div className="mt-4">
                  <PlatformError>{error}</PlatformError>
                </div>
              )}

              <ul className="mt-4 space-y-2">
                {choice.choices.map((business) => (
                  <li key={business.id}>
                    <PlatformButton
                      icon={Building2}
                      className="w-full justify-start"
                      loading={choosing === business.id}
                      disabled={Boolean(choosing) && choosing !== business.id}
                      onClick={() => pick(business)}
                    >
                      {business.name}
                    </PlatformButton>
                  </li>
                ))}
              </ul>

              <BackLink
                onClick={() => {
                  setChoice(null);
                  setError(null);
                }}
              >
                Use a different email
              </BackLink>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold leading-tight text-plat-text">
                {panelBusiness ? 'Sign in' : 'Sign in to your business'}
              </h1>
              <p className="mt-1 text-sm leading-normal text-plat-muted">
                {panelBusiness
                  ? `For ${panelBusiness} owners and staff.`
                  : 'For owners and staff. Customers sign in on their store’s own website.'}
              </p>

              {error && (
                <div className="mt-4">
                  <PlatformError>
                    <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                    {error}
                  </PlatformError>
                </div>
              )}

              <form onSubmit={form.handleSubmit(attempt)} className="mt-4">
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
                    onClick={() => setView('forgot')}
                    className={cn(pressable, 'rounded text-sm font-medium text-plat-accent-soft')}
                  >
                    Forgot password?
                  </button>
                </div>

                <PlatformButton
                  variant="primary"
                  type="submit"
                  icon={LogIn}
                  className="mt-4 w-full"
                  loading={form.formState.isSubmitting}
                >
                  Sign in
                </PlatformButton>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BackLink({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        pressable,
        'mt-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-plat-accent-soft',
      )}
    >
      <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
      {children}
    </button>
  );
}

/**
 * Signed in, but not somebody the panel is for. Saying which is what lets them
 * act: staff with no role need an administrator, a customer needs a different
 * website. Sign-out here is the reason they came back, so it is not asked twice.
 *
 * A customer is given the website as well, first: it is where they meant to
 * be, and signing out of the account they are holding would only make them
 * sign in again once they got there.
 */
function NotForThisPanel({ user, onSignOut, websiteUrl }) {
  const isCustomer = user.role !== 'staff';
  const offerWebsite = isCustomer && websiteUrl;

  return (
    <>
      <h1 className="text-xl font-semibold leading-tight text-plat-text">No ERP access</h1>
      <p className="mt-2 text-sm leading-normal text-plat-muted">
        {isCustomer
          ? `${user.email} is a customer account. Customers sign in on their store's own website, not here.`
          : `${user.email} has no role yet. Ask an administrator of your business to give you one.`}
      </p>
      {offerWebsite && (
        <PlatformButton
          variant="primary"
          icon={ArrowUpRight}
          className="mt-4 w-full"
          onClick={() => window.location.assign(websiteUrl)}
        >
          Go to the website
        </PlatformButton>
      )}
      <PlatformButton
        variant={offerWebsite ? 'secondary' : 'primary'}
        icon={LogOut}
        className={cn('w-full', offerWebsite ? 'mt-2' : 'mt-4')}
        onClick={onSignOut}
      >
        Sign out and use another account
      </PlatformButton>
    </>
  );
}

/**
 * Where a customer who wandered in should go instead, or null.
 *
 * The business's own website when the server knows it. Failing that, `/` on
 * any host that serves a website at all; on the ERP host `/` is this page, and
 * a button that reloads the screen it sits on is not a way out.
 */
function websiteUrlFor(storefrontOrigin) {
  if (storefrontOrigin) return storefrontOrigin;
  return surface === 'panel' ? null : '/';
}

/**
 * `/auth/me` failed, so whether anybody is signed in is unknown.
 *
 * Not the sign-in form: an owner whose session is fine would be asked for a
 * password they do not need, and one that would fail for the same reason the
 * check did. Not a permission wall either, which is what an outage used to
 * read as. Retrying is the one thing that can change the answer.
 */
function SessionUnknown({ onRetry, retrying }) {
  return (
    <>
      <h1 className="text-xl font-semibold leading-tight text-plat-text">
        Could not check your sign-in
      </h1>
      <p className="mt-2 text-sm leading-normal text-plat-muted">
        The ERP did not answer when asked who is signed in. Your session and your data are
        unaffected; this is usually a dropped connection.
      </p>
      <PlatformButton
        variant="primary"
        icon={RefreshCw}
        className="mt-4 w-full"
        loading={retrying}
        onClick={onRetry}
      >
        Try again
      </PlatformButton>
    </>
  );
}

/**
 * The same request the storefront makes, and the same answer whatever the
 * address - the server does not say whether it knows it, so neither does this.
 */
function ForgotPassword({ onBack }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const form = useForm({ defaultValues: { email: '' } });

  async function send(values) {
    setError(null);
    try {
      await api.post('/auth/forgot-password', values);
      setSent(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold leading-tight text-plat-text">Reset your password</h1>
      {sent ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-plat-ok">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          If that address has an account, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={form.handleSubmit(send)} className="mt-4">
          {error && <PlatformError>{error}</PlatformError>}
          <PlatformInput
            label="Email"
            type="email"
            autoComplete="username"
            required
            {...form.register('email', { required: 'Enter your email.' })}
            error={form.formState.errors.email?.message}
          />
          <PlatformButton
            variant="primary"
            type="submit"
            className="mt-4 w-full"
            loading={form.formState.isSubmitting}
          >
            Email me a link
          </PlatformButton>
        </form>
      )}
      <BackLink onClick={onBack}>Back to sign in</BackLink>
    </>
  );
}

export default PanelSignInPage;
