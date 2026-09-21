import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Delete,
  Lock,
  MessageCircle,
  Volume2,
  VolumeX,
} from 'lucide-react';

import cn from '@/lib/cn';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import useBusinessTheme from '@/hooks/useBusinessTheme';
import { pressable } from '@/lib/motion';
import { useKioskConfig, useKioskDevices, useKioskMutations, useSpeech } from '@/hooks/useKiosk';
import { getBusiness, setBusiness } from '@/store/businessStore';

/**
 * Self-service check-in (Sales § Kiosk).
 *
 * ## One question per screen, and why
 *
 * Not a form. A customer is standing at a tablet in a shop, often holding a
 * broken phone, sometimes with somebody waiting behind them - and a screen with
 * one question on it is a screen that can be **read out in one breath**, which
 * is what makes the read-aloud option work at all. A twenty-field form cannot
 * be spoken, cannot be answered without scrolling, and gives no sense of how
 * much is left.
 *
 * Every answered question gets its own confirmation screen ("Nice to meet you,
 * Ada!") so the customer sees they were understood before the next thing is
 * asked. That is the one piece a form genuinely cannot do.
 *
 * ## What it is allowed to collect
 *
 * Name, number, email, roughly what device, what is wrong, and consent. It
 * **never** prices, never grades the device's condition and never picks a
 * technician: a customer cannot answer those, and asking them to guess would
 * produce a record that looks like evidence and is not. The counter completes
 * the ticket afterwards under `intake.awaitingReview`.
 */

/**
 * Take the business out of the kiosk's own URL, once, before anything fetches.
 *
 * **A kiosk tab starts with no business.** The selected business lives in
 * `sessionStorage`, which a new tab does not inherit, and the kiosk is opened
 * in one - from the panel, or from a shortcut on the tablet itself. With
 * nothing stored the request names no business, and on localhost, where there
 * is no host to read, the server falls back to the default business: a staff
 * member at CellShoppe pressed Open kiosk and was shown Cellvix's kiosk, which
 * is switched off, so the tablet said "Kiosk is switched off" about a kiosk
 * that was on.
 *
 * `?business=` is already rule 3 of `resolveBusiness`, and `lib/api.js` already
 * puts it on every call - it just had nothing to send. So the link carries the
 * id and this adopts it, which is the same trick `apiUrl` plays for a document
 * opened in a new tab.
 *
 * **In a `useState` initialiser rather than an effect**: an effect runs after
 * the first render, and the first render is where `useKioskConfig` fires. The
 * config would go out unscoped, resolve to the default business, and the
 * corrected one would only arrive on a refetch.
 *
 * In production the host names the business and the parameter is redundant.
 */
function useAdoptBusinessFromUrl() {
  useState(() => {
    try {
      const wanted = new URLSearchParams(window.location.search).get('business');
      // Written only when it actually differs, so a tablet that has been
      // running all day is not storing the same id on every remount.
      if (wanted && wanted !== getBusiness()) setBusiness(wanted);
    } catch {
      // A malformed URL is not a reason to refuse a customer a check-in: with
      // nothing adopted the kiosk falls back to whatever the host resolves.
    }
  });
}

/** The lock screen's keypad, in phone order. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** The quick-pick faults. They FILL the box, they do not replace it. */
const PROBLEM_CHIPS = [
  'Cracked screen',
  'Battery drains',
  "Won't turn on",
  'Water damage',
  'Charging port',
  'Slow / software',
];

/** A big, tappable option card. Every choice on this flow is one of these. */
function OptionCard({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        pressable,
        'min-h-16 rounded-xl border border-line bg-surface px-6 py-4 text-center font-display text-lg font-semibold text-ink-900 shadow-sm',
        // Hover gated behind a real pointer: on the tablet this runs on, a
        // hover style is a style that sticks after a tap.
        'hover:border-brand',
      )}
    >
      {label}
    </button>
  );
}

/** The primary action. Deliberately large: this is a touch target, not a button. */
function BigButton({ children, onClick, type = 'button', disabled, tone = 'brand' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        pressable,
        'inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-xl px-8 font-display text-xl font-bold shadow-md disabled:opacity-40',
        tone === 'brand' ? 'bg-brand text-white' : 'border border-line bg-surface text-ink-700',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The lock screen.
 *
 * Staff enter the PIN once when the shop opens and the tablet stays unlocked
 * for the day - the lock is there so the device cannot be walked off with and
 * used, not so each customer has to be let in.
 */
function LockScreen({ onUnlock, isPending, error }) {
  const [pin, setPin] = useState('');

  const press = (digit) => setPin((value) => (value.length >= 8 ? value : value + digit));
  const back = () => setPin((value) => value.slice(0, -1));
  const submit = () => {
    if (pin.length >= 4) onUnlock(pin, () => setPin(''));
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-2 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-lg">
        <div className="mb-6 text-center">
          <span className="bg-brand-gradient-orb mx-auto mb-4 inline-flex size-16 items-center justify-center rounded-full">
            <Lock className="size-7 text-white" strokeWidth={2} aria-hidden="true" />
          </span>
          <h1 className="font-display text-2xl font-bold text-ink-900">Kiosk locked</h1>
          <p className="mt-1.5 text-sm text-ink-500">
            Staff: enter the kiosk PIN to start check-in.
          </p>
        </div>

        {/* Dots rather than the digits: somebody is standing at a counter. */}
        <div className="mb-6 flex justify-center gap-3" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={cn(
                'size-2.5 rounded-full transition-colors',
                index < pin.length ? 'bg-brand' : 'bg-line-strong',
              )}
            />
          ))}
        </div>

        {error && (
          <p className="mb-4 rounded-md bg-danger-50 px-3 py-2.5 text-center text-sm text-danger">
            {error}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              className={cn(
                pressable,
                'min-h-14 rounded-lg bg-surface-2 font-display text-xl font-bold text-ink-900',
              )}
            >
              {key}
            </button>
          ))}
          <button
            type="button"
            onClick={back}
            aria-label="Delete"
            className={cn(pressable, 'min-h-14 rounded-lg bg-brand text-white')}
          >
            <Delete className="mx-auto size-5" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => press('0')}
            className={cn(
              pressable,
              'min-h-14 rounded-lg bg-surface-2 font-display text-xl font-bold text-ink-900',
            )}
          >
            0
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pin.length < 4 || isPending}
            aria-label="Unlock"
            className={cn(pressable, 'min-h-14 rounded-lg bg-brand text-white disabled:opacity-40')}
          >
            <ArrowRight className="mx-auto size-5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-6 text-center text-xs leading-snug text-ink-400">
          On the iPad, run this under <strong>Guided Access</strong> (Settings, Accessibility) so it
          cannot be closed.
        </p>
      </div>
    </div>
  );
}

/** The chrome every question shares: name, progress, and the speaker toggle. */
function KioskChrome({ businessName, step, total, readAloud, onToggleAloud, speechSupported, children }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-2">
      <header className="flex items-center gap-4 px-4 py-3 sm:px-6">
        <p className="shrink-0 font-display text-sm font-bold text-ink-900 sm:text-base">
          {businessName}
        </p>

        {step != null && (
          <>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
              <div
                className="bg-brand-gradient-compact h-full rounded-full transition-[width] duration-300"
                style={{ width: `${Math.round(((step + 1) / total) * 100)}%` }}
              />
            </div>
            <p className="shrink-0 text-xs text-ink-500">
              Question {step + 1} of {total}
            </p>
          </>
        )}

        {!step && step !== 0 && <span className="flex-1" />}

        {speechSupported && (
          <button
            type="button"
            onClick={onToggleAloud}
            aria-label={readAloud ? 'Turn off read aloud' : 'Read questions aloud'}
            aria-pressed={readAloud}
            className={cn(
              pressable,
              'inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface shadow-sm',
              readAloud ? 'text-brand' : 'text-ink-400',
            )}
          >
            {readAloud ? (
              <Volume2 className="size-5" strokeWidth={2} aria-hidden="true" />
            ) : (
              <VolumeX className="size-5" strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        )}
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-xl text-center">{children}</div>
      </main>
    </div>
  );
}

/** The speech-bubble glyph every question and confirmation opens with. */
function Bubble() {
  return (
    <span className="bg-brand-gradient-orb mx-auto mb-5 inline-flex size-14 items-center justify-center rounded-full">
      <MessageCircle className="size-6 text-white" strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

/**
 * The shop's colour, wrapped around every branch of the flow.
 *
 * **Split from the flow below so the theme survives the early returns.** The
 * kiosk renders one of five quite different screens - loading, disabled, locked,
 * a question, done - and painting each one separately is how four of them end up
 * correct and the fifth ships in the house colour.
 *
 * `portals: false` because nothing here opens a dialog: a kiosk has no modals,
 * and emitting a `body`-level rule from a public tablet would be reaching
 * further than this page needs to.
 */
export function KioskPage() {
  useAdoptBusinessFromUrl();

  const { data: config } = useKioskConfig();
  const theme = useBusinessTheme(config?.colorToken, { portals: false });

  return (
    /**
     * A real box, not `display: contents`.
     *
     * Custom properties inherit down the DOM tree, and `contents` removes the
     * element's box but keeps it in the tree - so the variables would still
     * reach the children. The reason it is a real box anyway is the background:
     * every screen below paints `bg-surface-2` on its own root, and a wrapper
     * with no box leaves the area outside a short screen showing whatever the
     * document body is, which on a tablet is a white band under the content.
     */
    <div style={theme} className="min-h-dvh bg-surface-2">
      <KioskFlow />
    </div>
  );
}

function KioskFlow() {
  useDocumentTitle('Check in');

  const { data: config, isLoading } = useKioskConfig();
  const { unlock, checkIn } = useKioskMutations();

  const [unlocked, setUnlocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  /** The confirmation shown between questions, or null while asking. */
  const [confirmation, setConfirmation] = useState(null);
  const [done, setDone] = useState(null);
  const [readAloud, setReadAloud] = useState(true);

  const [answers, setAnswers] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    category: '',
    brand: '',
    series: '',
    model: '',
    problem: '',
    passcode: '',
    serial: '',
    termsAccepted: false,
    updatesConsent: true,
  });

  const { data: deviceData } = useKioskDevices(unlocked);
  const { speak, supported: speechSupported } = useSpeech(readAloud);

  useEffect(() => {
    if (config?.readAloud === false) setReadAloud(false);
  }, [config?.readAloud]);

  const set = useCallback((field, value) => {
    setAnswers((current) => ({ ...current, [field]: value }));
  }, []);

  /**
   * The device tree, walked by the three device questions.
   *
   * Each level's options are the children of what was chosen above it, so the
   * kiosk can never offer a combination the shop does not take in.
   */
  const tree = deviceData?.devices ?? [];
  const categoryNode = useMemo(
    () => tree.find((node) => node.name === answers.category),
    [tree, answers.category],
  );
  const brandNode = useMemo(
    () => categoryNode?.children.find((node) => node.name === answers.brand),
    [categoryNode, answers.brand],
  );
  /**
   * Models are read from the series **flattened one level**.
   *
   * The tree has four levels and the kiosk asks three questions: a customer
   * does not know whether their handset is in the "iPhone 15" series, and being
   * asked would be a question about our filing rather than their device. So
   * every model under every series of the chosen brand is offered at once.
   */
  const models = useMemo(
    () => (brandNode?.children ?? []).flatMap((series) => series.children ?? []),
    [brandNode],
  );

  /**
   * The ten questions.
   *
   * Declared as data rather than as ten branches of JSX so the progress bar,
   * the back button and the spoken prompt all read from one list and cannot
   * disagree about where the customer is.
   */
  const steps = useMemo(
    () => [
      {
        key: 'firstName',
        prompt: "Hi! What's your first name?",
        hint: "We'll use it to look after your device.",
        kind: 'text',
        placeholder: 'Type here...',
        required: true,
        confirm: (value) => `Nice to meet you, ${value}!`,
      },
      {
        key: 'lastName',
        prompt: "And your last name?",
        hint: 'So we can tell two repairs apart.',
        kind: 'text',
        placeholder: 'Type here...',
        confirm: () => `Thanks, ${answers.firstName || 'and welcome'}.`,
      },
      {
        key: 'phone',
        prompt: "What's your phone number?",
        hint: 'So we can reach you about your repair.',
        kind: 'tel',
        placeholder: '(555) 123-4567',
        required: true,
        confirm: () => "Got it - we'll text you updates.",
      },
      {
        key: 'email',
        prompt: "What's your email?",
        hint: "We'll email your invoice and updates here.",
        kind: 'email',
        placeholder: 'you@example.com',
        skippable: "I don't have one - skip",
        confirm: () => 'Perfect, thank you.',
      },
      {
        key: 'category',
        prompt: 'What kind of device is it?',
        kind: 'options',
        options: tree.map((node) => node.name),
      },
      {
        key: 'brand',
        prompt: 'Which brand?',
        kind: 'options',
        options: (categoryNode?.children ?? []).map((node) => node.name),
      },
      {
        key: 'model',
        prompt: 'Which model?',
        hint: 'Pick the closest - our staff will confirm.',
        kind: 'options',
        options: models.map((node) => node.name),
      },
      {
        key: 'problem',
        prompt: 'What seems to be wrong with it?',
        hint: 'A quick note helps us diagnose faster.',
        kind: 'textarea',
        placeholder: "e.g. Cracked screen, won't charge...",
        chips: PROBLEM_CHIPS,
        confirm: () => 'Thanks for the details.',
      },
      {
        key: 'testing',
        prompt: 'Anything to help us test it?',
        hint: 'Passcode and serial are optional.',
        kind: 'testing',
      },
      {
        key: 'consent',
        prompt: 'Is it OK to contact you about this repair?',
        hint: "We'll only message you about your device.",
        kind: 'consent',
      },
    ],
    [tree, categoryNode, models, answers.firstName],
  );

  const current = steps[step];
  const total = steps.length;

  /**
   * The prompt is spoken when it appears.
   *
   * **Confirmations are NOT spoken here.** `advance` says them itself and waits
   * for the voice to finish before moving on, which is the whole reason it can
   * stop cutting them off. Speaking one here too would be the same line reaching
   * `speak` twice: the duplicate guard would swallow the second call and resolve
   * it instantly, so `advance` would think the voice had finished before it had
   * started - reintroducing the truncation from the other side.
   */
  useEffect(() => {
    if (!started || done || confirmation) return;
    speak(current?.prompt);
  }, [started, done, confirmation, current?.prompt, speak]);

  useEffect(() => {
    if (done) speak(config?.thankYouMessage ?? "You're all set.");
  }, [done, config?.thankYouMessage, speak]);

  /**
   * Move on, showing the confirmation first where the step has one.
   *
   * **The pause is however long the confirmation takes to SAY**, not a fixed
   * 1400ms. It was fixed, and a line any longer than the guess got cut off
   * mid-word as the next screen replaced it and cancelled the voice: "Thanks,
   * Mohamm-". Long first names and long device names did it every time.
   *
   * With read-aloud off, `speak` resolves immediately and the minimum below is
   * the whole wait - which is the original behaviour, and right: a reader does
   * not need four words held on screen for as long as a voice needs to say them.
   */
  async function advance() {
    const message = current?.confirm?.(answers[current.key]);
    if (message) {
      setConfirmation(message);

      // Both, not either: the voice must finish AND the words must be on screen
      // long enough to read. Whichever is longer wins, so a silent kiosk still
      // pauses and a slow voice is never talked over.
      await Promise.all([speak(message), new Promise((done) => setTimeout(done, 1400))]);

      setConfirmation(null);
      setStep((value) => Math.min(value + 1, total - 1));
      return;
    }
    setStep((value) => Math.min(value + 1, total - 1));
  }

  function choose(field, value) {
    // Picking a category or brand clears what was chosen below it: a model from
    // the previous brand is not a model of this one.
    setAnswers((currentAnswers) => {
      const next = { ...currentAnswers, [field]: value };
      if (field === 'category') Object.assign(next, { brand: '', series: '', model: '' });
      if (field === 'brand') Object.assign(next, { series: '', model: '' });
      if (field === 'model') {
        // The series is not asked for, so it is inferred from the model chosen.
        const series = (brandNode?.children ?? []).find((node) =>
          (node.children ?? []).some((child) => child.name === value),
        );
        next.series = series?.name ?? '';
      }
      return next;
    });
    advance();
  }

  function submit() {
    checkIn.mutate(
      {
        firstName: answers.firstName,
        lastName: answers.lastName || undefined,
        phone: answers.phone,
        email: answers.email || undefined,
        category: answers.category || undefined,
        brand: answers.brand || undefined,
        series: answers.series || undefined,
        model: answers.model || undefined,
        problem: answers.problem || undefined,
        passcode: answers.passcode || undefined,
        serial: answers.serial || undefined,
        termsAccepted: answers.termsAccepted,
        updatesConsent: answers.updatesConsent,
      },
      { onSuccess: (result) => setDone(result) },
    );
  }

  /** Back to a blank flow for the next customer. Never back to the lock screen. */
  function reset() {
    setAnswers({
      firstName: '', lastName: '', phone: '', email: '',
      category: '', brand: '', series: '', model: '',
      problem: '', passcode: '', serial: '',
      termsAccepted: false, updatesConsent: true,
    });
    setStep(0);
    setConfirmation(null);
    setDone(null);
    setStarted(false);
  }

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-2">
        <p className="text-sm text-ink-400">Loading…</p>
      </div>
    );
  }

  if (config && !config.isEnabled) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-2 px-4">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-xl font-bold text-ink-900">Kiosk is switched off</h1>
          <p className="mt-2 text-sm text-ink-500">
            Turn it on in Settings, and set a PIN, before putting this tablet out.
          </p>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <LockScreen
        isPending={unlock.isPending}
        error={unlock.error?.message}
        onUnlock={(pin, clear) =>
          unlock.mutate(
            { pin },
            {
              onSuccess: () => setUnlocked(true),
              onError: () => clear(),
            },
          )
        }
      />
    );
  }

  const businessName = config?.businessName ?? 'Check in';

  // ---- done ---------------------------------------------------------------
  if (done) {
    return (
      <KioskChrome
        businessName={businessName}
        readAloud={readAloud}
        onToggleAloud={() => setReadAloud((value) => !value)}
        speechSupported={speechSupported}
      >
        <span className="mx-auto mb-6 inline-flex size-20 items-center justify-center rounded-full bg-brand">
          <Check className="size-10 text-white" strokeWidth={2.5} aria-hidden="true" />
        </span>
        <h1 className="font-display text-3xl font-bold text-ink-900">
          You&apos;re all set{done.firstName ? `, ${done.firstName}` : ''}!
        </h1>
        <p className="mt-2 text-lg text-ink-500">{config?.thankYouMessage}</p>

        <p className="mt-8 text-sm text-ink-500">Your check-in number</p>
        {/* The one thing on this screen that matters after they walk away. */}
        <p className="tnum mt-1 font-display text-4xl font-bold text-brand">{done.ticketNumber}</p>

        <div className="mx-auto mt-10 max-w-xs">
          <BigButton tone="ghost" onClick={reset}>
            Done
          </BigButton>
        </div>
      </KioskChrome>
    );
  }

  // ---- welcome ------------------------------------------------------------
  if (!started) {
    return (
      <KioskChrome
        businessName={businessName}
        readAloud={readAloud}
        onToggleAloud={() => setReadAloud((value) => !value)}
        speechSupported={speechSupported}
      >
        <h1 className="font-display text-5xl font-bold text-ink-900">Welcome</h1>
        <p className="mt-3 text-lg text-ink-500">{config?.welcomeMessage}</p>
        <div className="mx-auto mt-10 max-w-sm">
          <BigButton onClick={() => setStarted(true)}>Start check-in</BigButton>
        </div>
      </KioskChrome>
    );
  }

  // ---- a confirmation between questions -----------------------------------
  if (confirmation) {
    return (
      <KioskChrome
        businessName={businessName}
        step={step}
        total={total}
        readAloud={readAloud}
        onToggleAloud={() => setReadAloud((value) => !value)}
        speechSupported={speechSupported}
      >
        <Bubble />
        <p className="font-display text-3xl font-bold text-brand-700">{confirmation}</p>
      </KioskChrome>
    );
  }

  // ---- a question ---------------------------------------------------------
  const value = answers[current.key] ?? '';
  const canContinue = !current.required || String(value).trim().length > 0;

  return (
    <KioskChrome
      businessName={businessName}
      step={step}
      total={total}
      readAloud={readAloud}
      onToggleAloud={() => setReadAloud((value2) => !value2)}
      speechSupported={speechSupported}
    >
      <Bubble />
      <h1 className="font-display text-3xl font-bold text-ink-900">{current.prompt}</h1>
      {current.hint && <p className="mt-2 text-base text-ink-500">{current.hint}</p>}

      <div className="mt-8 space-y-4">
        {current.kind === 'options' && (
          <>
            {current.options.length === 0 ? (
              // The shop has not built this level of its list. Rather than a
              // dead end, the customer types it and the counter sorts it out.
              <input
                className="min-h-16 w-full rounded-xl border border-line bg-surface px-5 text-center font-display text-xl text-ink-900"
                placeholder="Type it here..."
                value={value}
                onChange={(event) => set(current.key, event.target.value)}
              />
            ) : (
              <div className="flex flex-wrap justify-center gap-3">
                {current.options.map((option) => (
                  <OptionCard
                    key={option}
                    label={option}
                    onClick={() => choose(current.key, option)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {['text', 'tel', 'email'].includes(current.kind) && (
          <input
            type={current.kind === 'text' ? 'text' : current.kind}
            inputMode={current.kind === 'tel' ? 'tel' : undefined}
            className="min-h-16 w-full rounded-xl border border-line bg-surface px-5 text-center font-display text-xl text-ink-900"
            placeholder={current.placeholder}
            value={value}
            onChange={(event) => set(current.key, event.target.value)}
            autoFocus
          />
        )}

        {current.kind === 'textarea' && (
          <>
            <textarea
              rows={3}
              className="w-full rounded-xl border border-line bg-surface p-5 text-center font-display text-lg text-ink-900"
              placeholder={current.placeholder}
              value={value}
              onChange={(event) => set(current.key, event.target.value)}
            />
            {/* Chips APPEND rather than replace: somebody with two faults picks
                both, and somebody who has typed a sentence does not lose it. */}
            <div className="flex flex-wrap justify-center gap-2">
              {current.chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() =>
                    set(current.key, value ? `${value.replace(/[.\s]+$/, '')}. ${chip}` : chip)
                  }
                  className={cn(
                    pressable,
                    'rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-700',
                  )}
                >
                  {chip}
                </button>
              ))}
            </div>
          </>
        )}

        {current.kind === 'testing' && (
          <div className="space-y-4 text-left">
            <label className="block">
              <span className="eyebrow mb-1.5 block text-ink-400">Passcode / PIN (optional)</span>
              <input
                className="min-h-14 w-full rounded-xl border border-line bg-surface px-5 text-lg text-ink-900"
                placeholder="e.g. 1234"
                value={answers.passcode}
                onChange={(event) => set('passcode', event.target.value)}
              />
            </label>
            <label className="block">
              <span className="eyebrow mb-1.5 block text-ink-400">Serial / IMEI (optional)</span>
              <input
                className="min-h-14 w-full rounded-xl border border-line bg-surface px-5 text-lg text-ink-900"
                placeholder="Serial or IMEI"
                value={answers.serial}
                onChange={(event) => set('serial', event.target.value)}
              />
            </label>
          </div>
        )}

        {current.kind === 'consent' && (
          <div className="space-y-3 rounded-xl border border-line bg-surface p-5 text-left">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0 accent-brand"
                checked={answers.termsAccepted}
                onChange={(event) => set('termsAccepted', event.target.checked)}
              />
              <span className="text-base leading-snug text-ink-900">{config?.termsText}</span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0 accent-brand"
                checked={answers.updatesConsent}
                onChange={(event) => set('updatesConsent', event.target.checked)}
              />
              <span className="text-base leading-snug text-ink-900">
                Yes, send me updates about my repair by text or email.
              </span>
            </label>
          </div>
        )}

        {checkIn.error && (
          <p className="rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            {checkIn.error.message}
          </p>
        )}

        {/* Options advance on tap, so they need no Next. Everything else does. */}
        {current.kind !== 'options' && (
          <div className="flex items-center gap-3">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((current2) => current2 - 1)}
                aria-label="Back"
                className={cn(
                  pressable,
                  'inline-flex min-h-16 shrink-0 items-center justify-center rounded-xl border border-line bg-surface px-5 text-ink-600',
                )}
              >
                <ArrowLeft className="size-5" strokeWidth={2} aria-hidden="true" />
              </button>
            )}

            {current.kind === 'consent' ? (
              <BigButton
                onClick={submit}
                disabled={
                  checkIn.isPending || (config?.requireTerms !== false && !answers.termsAccepted)
                }
              >
                Check in
                <ArrowRight className="size-5" strokeWidth={2.5} aria-hidden="true" />
              </BigButton>
            ) : (
              <BigButton onClick={advance} disabled={!canContinue}>
                Next
                <ArrowRight className="size-5" strokeWidth={2.5} aria-hidden="true" />
              </BigButton>
            )}
          </div>
        )}

        {current.skippable && (
          <button
            type="button"
            onClick={advance}
            className="text-sm text-ink-500 underline underline-offset-4"
          >
            {current.skippable}
          </button>
        )}

        {/* Options have no Next, so their back control lives here. */}
        {current.kind === 'options' && step > 0 && (
          <button
            type="button"
            onClick={() => setStep((current2) => current2 - 1)}
            aria-label="Back"
            className={cn(
              pressable,
              'mx-auto inline-flex min-h-14 items-center justify-center rounded-xl border border-line bg-surface px-6 text-ink-600',
            )}
          >
            <ArrowLeft className="size-5" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </KioskChrome>
  );
}

export default KioskPage;
