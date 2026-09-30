import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import useKioskSteps from '@/hooks/useKioskSteps';
import KioskChrome from './KioskChrome';
import KioskButton from './KioskButton';

/** Resolve a step property that may depend on the answers so far. */
const read = (value, answers) => (typeof value === 'function' ? value(answers) : value);

/**
 * One kiosk flow, one question per screen.
 *
 * ## Why one question per screen
 *
 * A customer is standing at a tablet, often holding a broken phone, sometimes
 * with somebody waiting behind them. A screen with one question on it can be
 * **read out in one breath**, which is what makes read-aloud work at all, needs
 * no scrolling, and never leaves anybody wondering which field is wrong.
 *
 * ## A step
 *
 * `{ key, prompt, hint, when, valid, render, footer, nextLabel, skip, confirm, onNext }`.
 * `render(ctx)` draws the answer area; the prompt, the hint and the Back / Next
 * row are drawn here, so every question in every flow shares them. `footer:
 * 'none'` is for tap-to-answer questions, which advance on the tap. `skip.patch`
 * may be a function of the answers, like `hint` and `error`. `confirm`
 * returns a line shown (and said) for a moment after the answer, so the
 * customer sees they were understood before the next thing is asked.
 *
 * The flow's own component holds the answers and the submit; this holds where
 * the customer is.
 */
export function KioskStepper({ steps, answers, setAnswers, speak, chrome, error }) {
  const nav = useKioskSteps(steps, answers);
  const { current } = nav;
  const [confirmation, setConfirmation] = useState(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const prompt = read(current?.prompt, answers);

  // The question is spoken when it appears. A confirmation is spoken by
  // `advance`, which waits for it: speaking it here as well would be the same
  // line reaching `speak` twice, and the duplicate guard would resolve the
  // second instantly and cut the first off.
  useEffect(() => {
    if (!confirmation && prompt) speak(prompt);
  }, [current?.key, confirmation, prompt, speak]);

  const patch = useCallback(
    (values) => {
      const merged = { ...answersRef.current, ...values };
      answersRef.current = merged;
      setAnswers(merged);
      return merged;
    },
    [setAnswers],
  );

  /**
   * Answer, and move on.
   *
   * The pause after a confirmation is however long it takes to SAY, with a
   * floor for reading: a fixed pause cut long names off mid-word as the next
   * screen replaced the voice. With read-aloud off, `speak` resolves at once
   * and the floor is the whole wait.
   */
  const advance = useCallback(
    async (values = {}) => {
      const state = patch(values);
      const message = current?.confirm?.(state);
      if (message && !nav.editing) {
        setConfirmation(message);
        await Promise.all([speak(message), new Promise((done) => setTimeout(done, 1400))]);
        setConfirmation(null);
      }
      nav.next(state);
    },
    [current, nav, patch, speak],
  );

  const ctx = {
    answers,
    set: (field, value) => patch({ [field]: value }),
    patch,
    next: advance,
    back: nav.back,
    goTo: nav.goTo,
    reset: nav.reset,
  };

  if (!current) return null;

  if (confirmation) {
    return (
      <KioskChrome {...chrome} progress={nav.progress}>
        <p
          className="text-center font-display text-d-sm font-bold text-ink-900"
          aria-live="polite"
        >
          {confirmation}
        </p>
      </KioskChrome>
    );
  }

  const hint = read(current.hint, answers);
  const valid = current.valid ? current.valid(answers) : true;
  const footer = read(current.footer, answers) ?? 'next';
  const stepError = error || read(current.error, answers);

  function submit(event) {
    event.preventDefault();
    if (!valid) return;
    if (current.onNext) current.onNext(ctx);
    else advance();
  }

  return (
    <KioskChrome {...chrome} progress={nav.progress}>
      <form onSubmit={submit} noValidate>
        <h1 className="text-balance text-center font-display text-3xl font-bold text-ink-900 sm:text-d-sm">
          {prompt}
        </h1>
        {hint && <p className="mt-3 text-center text-lg text-ink-500">{hint}</p>}

        <div key={current.key} className="mt-8">
          {current.render(ctx)}
        </div>

        {stepError && (
          <p role="alert" className="mt-5 border-l-2 border-danger pl-3 text-lg text-danger">
            {stepError}
          </p>
        )}

        <div className="mt-8 flex items-center gap-3">
          {nav.canGoBack && (
            <button
              type="button"
              onClick={nav.back}
              aria-label="Back"
              className={cn(
                pressable,
                'inline-flex min-h-16 shrink-0 items-center justify-center rounded-xl border border-line bg-surface px-6 text-ink-700',
                footer === 'none' && 'mx-auto',
              )}
            >
              <ArrowLeft className="size-6" strokeWidth={2} aria-hidden="true" />
            </button>
          )}

          {footer === 'next' && (
            <KioskButton type="submit" className="flex-1" disabled={!valid || current.pending}>
              {read(current.nextLabel, answers) ?? (nav.editing ? 'Save' : 'Next')}
              <ArrowRight className="size-6" strokeWidth={2.25} aria-hidden="true" />
            </KioskButton>
          )}
        </div>

        {current.skip && !nav.editing && (
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => advance(read(current.skip.patch, answers) ?? {})}
              className="min-h-11 px-4 text-lg text-ink-500 underline underline-offset-4"
            >
              {current.skip.label}
            </button>
          </div>
        )}
      </form>
    </KioskChrome>
  );
}

export default KioskStepper;
