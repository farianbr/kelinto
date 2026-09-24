import { useEffect, useState } from 'react';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';
import { ExternalLink, KeyRound, Volume2 } from 'lucide-react';

import { kioskSettingsSchema } from '@shared/schemas/admin';
import cn from '@/lib/cn';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/admin/PageHeader';
import { SettingsFormActions } from '@/components/admin/settings/SettingsForm';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { pressable } from '@/lib/motion';
import { useAdminSettings, useAdminMutations } from '@/hooks/useAdmin';
import { useStorefrontUrl } from '@/hooks/useStorefrontUrl';

/**
 * Kiosk settings (Sales § Kiosk) - the screen that gets a tablet onto a counter.
 *
 * **The kiosk itself is not in this panel.** It runs at `/kiosk`, outside
 * `AdminShell`, on its own cookie and with no staff account behind it: it owns
 * the whole viewport on a device a customer holds, and the admin sidebar is a
 * door out of a screen that is supposed to have none. So this screen is the
 * only place in the panel that knows the kiosk exists, which is why it carries
 * the link to open it rather than leaving a staff member to type a URL they
 * have never been told.
 *
 * ## What the screen is opened for
 *
 * Almost always one of two errands: *turn it on for the first time*, or *change
 * the PIN because somebody left*. Both are at the top, in one status panel that
 * states plainly whether a customer can use the tablet right now - because the
 * answer is two settings ANDed together (live, and a PIN set) and a staff
 * member reading two separate switches has to do that join themselves. The
 * wording customers read is below, which is the errand nobody arrives in a
 * hurry for.
 *
 * ## Why the PIN is not part of the form
 *
 * It is a credential. It has its own audited route that stores a hash and never
 * returns or logs the digits, and folding it into the section save would mean
 * re-sending it every time somebody reworded a thank-you message. So it is
 * written from its own small form, which submits on its own.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/kiosk'], icon: adminIcon('Tablet') };

/**
 * A switch with its consequence beside it.
 *
 * Local rather than shared: the email settings screen has the same control, but
 * its version carries a "not wired yet" badge and copy about what the toggle
 * sends, which is that screen's problem and not this one's. Two small honest
 * components beat one with a prop that only one caller passes.
 */
function Toggle({ label, detail, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 border-b border-line py-3.5 last:border-b-0">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-ok' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>

      <span className="min-w-0 flex-1">
        <span className="block font-display text-md font-semibold text-ink-900">{label}</span>
        <span className="mt-1 block text-sm leading-relaxed text-ink-500">{detail}</span>
      </span>
    </label>
  );
}

/**
 * Set or change the PIN.
 *
 * Its own form element, so pressing Enter in the PIN field never submits the
 * settings form beside it - and so the two saves can never be mistaken for one.
 * Nothing here ever displays a stored PIN: the server holds a hash, and the
 * only fact this screen knows is whether there is one.
 */
function PinForm({ hasPin, onSave, saving }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setDone(false);

    if (!/^\d{4,8}$/.test(pin)) {
      setError('A kiosk PIN is 4 to 8 digits.');
      return;
    }
    // Typed twice, because nobody can read it back afterwards. A mistyped PIN
    // that is stored is a tablet that cannot be unlocked and an admin with no
    // way to see what went in.
    if (pin !== confirmPin) {
      setError('The two PINs do not match.');
      return;
    }

    try {
      await onSave({ pin });
      setPin('');
      setConfirmPin('');
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          label={hasPin ? 'New PIN' : 'PIN'}
          hint="4 to 8 digits."
          value={pin}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, ''));
            setDone(false);
          }}
        />
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          label="Type it again"
          hint="Nobody can read it back once it is saved."
          value={confirmPin}
          onChange={(event) => {
            setConfirmPin(event.target.value.replace(/\D/g, ''));
            setDone(false);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" loading={saving} disabled={!pin && !confirmPin}>
          {hasPin ? 'Change PIN' : 'Set PIN'}
        </Button>

        <p aria-live="polite" className="min-w-0 text-sm">
          {done && <span className="text-ok">Saved. Staff unlock with the new PIN from now on.</span>}
          {error && (
            <span role="alert" className="text-danger">
              {error}
            </span>
          )}
        </p>
      </div>
    </form>
  );
}

export function AdminKioskSettingsPage() {
  const storefrontUrl = useStorefrontUrl();
  const { data, isLoading } = useAdminSettings();
  const { saveKioskSettings, setKioskPin } = useAdminMutations();
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useAdminForm({
    resolver: zodResolver(kioskSettingsSchema),
    defaultValues: {
      isEnabled: false,
      welcomeMessage: '',
      thankYouMessage: '',
      readAloud: true,
      requireTerms: true,
      termsText: '',
    },
  });

  useEffect(() => {
    if (!data?.kiosk || isDirty) return;
    // `hasPin` is a fact about the server, not a field of this form. Passing it
    // to `reset` would make it a value the form believes it owns and posts back.
    const { hasPin, ...fields } = data.kiosk;
    reset(fields);
  }, [data, isDirty, reset]);

  const values = watch();
  const hasPin = Boolean(data?.kiosk?.hasPin);
  // Two conditions, stated once. A tablet that is switched on with no PIN set
  // refuses every unlock, which looks like a broken tablet rather than an
  // unfinished setup - so the screen says which half is missing.
  const live = Boolean(values.isEnabled) && hasPin;

  async function onSubmit(payload) {
    setSaved(false);
    try {
      const next = await saveKioskSettings.mutateAsync(payload);
      const { hasPin: _ignored, ...fields } = next.kiosk;
      reset(fields);
      setSaved(true);
    } catch (err) {
      setError('root', { message: err.message });
    }
  }

  if (isLoading) return <p className="text-sm text-ink-500">Loading settings…</p>;

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        // The kiosk is a route this panel cannot reach any other way, and a new
        // tab rather than a navigation: opening it in place would leave a staff
        // member inside a full-screen customer flow with no way back to Settings.
        //
        // `storefrontUrl` because a new tab inherits no `sessionStorage`, so a
        // bare `/kiosk` resolved to the DEFAULT business - this screen would
        // report the kiosk live and the tab it opened would say it was off,
        // because they were two different businesses' kiosks.
        action={
          <a href={storefrontUrl('/kiosk')} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" icon={ExternalLink}>
              Open the kiosk
            </Button>
          </a>
        }
      />

      <div className="max-w-form space-y-4">
        <Panel
          title="Status"
          description="Whether a customer standing at the counter can check a device in right now."
        >
          {/* The one line somebody opens this screen to read. It leads because
              the answer is two settings joined, and the join is the part that
              is easy to get wrong. */}
          <p
            className={cn(
              'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm leading-relaxed',
              live
                ? 'border-ok/25 bg-ok-50 text-ink-700'
                : 'border-warn/30 bg-warn-50 text-ink-700',
            )}
          >
            <span
              aria-hidden="true"
              className={cn('mt-1.5 size-2 shrink-0 rounded-full', live ? 'bg-ok' : 'bg-warn')}
            />
            <span>
              {live && (
                <>
                  <strong className="font-semibold">The kiosk is live.</strong> Staff unlock the
                  tablet once with the PIN and it stays unlocked for the day.
                </>
              )}
              {!live && values.isEnabled && !hasPin && (
                <>
                  <strong className="font-semibold">Switched on, but there is no PIN.</strong>{' '}
                  Nobody can unlock the tablet until one is set below.
                </>
              )}
              {!live && !values.isEnabled && (
                <>
                  <strong className="font-semibold">The kiosk is off.</strong> The tablet shows its
                  lock screen and refuses every PIN.
                  {!hasPin && ' No PIN has been set yet either.'}
                </>
              )}
            </span>
          </p>

          <div className="mt-2">
            <Toggle
              label="Take check-ins from the tablet"
              detail="Turning this off locks every tablet at its next unlock. A customer already part-way through a check-in is not interrupted."
              checked={Boolean(values.isEnabled)}
              onChange={(next) => {
                setValue('isEnabled', next, { shouldDirty: true });
                setSaved(false);
              }}
            />
          </div>
        </Panel>

        <Panel
          title={hasPin ? 'Staff PIN' : 'Staff PIN - not set yet'}
          description="One PIN for the shop, not one per person. It unlocks the tablet for the day; it is not a sign-in, and a kiosk ticket records no staff member."
        >
          {/* Saved separately from everything else on the screen, and said so
              rather than left to be discovered by a staff member who typed a
              PIN, pressed Save changes below, and believed it had been set. */}
          <p className="mb-4 flex items-start gap-2.5 text-sm leading-relaxed text-ink-500">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
            <span>
              {hasPin
                ? 'A PIN is set. It is stored hashed, so it cannot be shown here - changing it replaces the old one immediately.'
                : 'No PIN yet. The tablet cannot be unlocked until one is set.'}{' '}
              This has its own button and saves on its own.
            </span>
          </p>

          <PinForm
            hasPin={hasPin}
            saving={setKioskPin.isPending}
            onSave={(body) => setKioskPin.mutateAsync(body)}
          />
        </Panel>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Panel
            title="What the customer reads"
            description="Your own words on the two screens that are not questions."
          >
            <div className="space-y-4">
              <Textarea
                rows={2}
                counter={200}
                label="Welcome screen"
                hint="Under the shop name, before they start."
                error={errors.welcomeMessage?.message}
                value={values.welcomeMessage ?? ''}
                {...register('welcomeMessage')}
              />
              <Textarea
                rows={2}
                counter={200}
                label="Thank-you screen"
                hint="Above the ticket number, once they are finished."
                error={errors.thankYouMessage?.message}
                value={values.thankYouMessage ?? ''}
                {...register('thankYouMessage')}
              />
            </div>
          </Panel>

          <Panel
            title="How it behaves"
            description="Reading aloud, and the terms a customer leaves their device under."
          >
            <div>
              <Toggle
                label="Read each question aloud"
                detail="The customer can still turn it off on the tablet. It is why the flow is one question per screen - a screen with one question on it can be read out in one breath."
                checked={Boolean(values.readAloud)}
                onChange={(next) => {
                  setValue('readAloud', next, { shouldDirty: true });
                  setSaved(false);
                }}
              />
              <Toggle
                label="Require the customer to agree to the terms"
                detail="The tick and the time it was made are stored on the ticket. It is what answers a customer who later says they never agreed to leave the device."
                checked={Boolean(values.requireTerms)}
                onChange={(next) => {
                  setValue('requireTerms', next, { shouldDirty: true });
                  setSaved(false);
                }}
              />
            </div>

            <div className="mt-4">
              <Textarea
                rows={3}
                counter={1000}
                label="The terms they tick"
                hint="Shown in full on the tablet. Write what the shop actually relies on, not a summary."
                error={errors.termsText?.message}
                value={values.termsText ?? ''}
                disabled={!values.requireTerms}
                {...register('termsText')}
              />
              {values.readAloud && (
                <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-ink-500">
                  <Volume2 className="mt-0.5 size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
                  Long terms are read aloud in full. Keep them to what the customer has to hear.
                </p>
              )}
            </div>
          </Panel>

          <SettingsFormActions
          unsavedLabel="the kiosk settings"
            dirty={isDirty}
            saving={isSubmitting || saveKioskSettings.isPending}
            saved={saved}
            error={errors.root?.message}
            onReset={() => {
              reset();
              setSaved(false);
            }}
          />
        </form>
      </div>
    </div>
  );
}

export default AdminKioskSettingsPage;
