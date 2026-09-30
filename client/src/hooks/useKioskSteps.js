import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Walk a kiosk flow: a list of questions, some of which only apply to some
 * customers.
 *
 * ## Why steps carry `when`, not a hand-written route
 *
 * The repair flow branches three ways (returning customer, new customer, a new
 * customer without their phone) and the sell flow branches on whether an ID is
 * on file. Writing each route out by hand is how a question ends up asked on
 * one branch and forgotten on another. So a flow is one ordered list, each step
 * says when it applies, and "next" is simply the next step, in list order,
 * that applies to the answers as they stand now.
 *
 * ## Why "back" is a history and not `index - 1`
 *
 * With branches, the step above in the list is not necessarily the one the
 * customer came from. The history is what they actually saw.
 *
 * ## Editing from the confirmation screen
 *
 * `goTo(key, { returnTo: 'confirm' })` opens one question and sends the next
 * "Next" straight back. Unless the change opened a required question that is
 * still unanswered (saying "No" to "Do you have this phone with you?" opens
 * "What other number can we reach you on?"), in which case that question is
 * asked first. Returning past it would submit a check-in with a hole in it. An
 * optional question (one with a skip) never blocks the way back.
 */
export function useKioskSteps(steps, answers) {
  const applies = useCallback(
    (step, state) => !step.when || step.when(state),
    [],
  );

  const first = steps.find((step) => applies(step, answers))?.key;
  const [history, setHistory] = useState(first ? [first] : []);
  const [returnTo, setReturnTo] = useState(null);

  // The answers as of the last call, so `next` can be handed the patch it is
  // about to apply and decide the route from the state AFTER it.
  const latest = useRef(answers);
  latest.current = answers;

  const currentKey = history[history.length - 1];
  const current = steps.find((step) => step.key === currentKey) ?? null;

  const visible = useMemo(() => steps.filter((step) => applies(step, answers)), [steps, answers, applies]);
  const position = Math.max(0, visible.findIndex((step) => step.key === currentKey));
  const progress = visible.length > 1 ? position / (visible.length - 1) : 0;

  /** The next step after `key`, in list order, that applies to `state`. */
  const following = useCallback(
    (key, state) => {
      const from = steps.findIndex((step) => step.key === key);
      return steps.slice(from + 1).find((step) => applies(step, state)) ?? null;
    },
    [steps, applies],
  );

  const next = useCallback(
    (state = latest.current) => {
      const upcoming = following(currentKey, state);

      if (returnTo) {
        // A question the edit just opened, still unanswered, comes first.
        const needed =
          upcoming &&
          upcoming.key !== returnTo &&
          !upcoming.skip &&
          upcoming.valid &&
          !upcoming.valid(state);
        if (needed) {
          setHistory((list) => [...list, upcoming.key]);
          return;
        }
        setReturnTo(null);
        setHistory((list) => [...list, returnTo]);
        return;
      }

      if (upcoming) setHistory((list) => [...list, upcoming.key]);
    },
    [currentKey, following, returnTo],
  );

  const back = useCallback(() => {
    setReturnTo(null);
    setHistory((list) => (list.length > 1 ? list.slice(0, -1) : list));
  }, []);

  const goTo = useCallback((key, options = {}) => {
    setReturnTo(options.returnTo ?? null);
    setHistory((list) => [...list, key]);
  }, []);

  const reset = useCallback(() => {
    setReturnTo(null);
    setHistory(first ? [first] : []);
  }, [first]);

  return {
    current,
    progress,
    canGoBack: history.length > 1,
    editing: Boolean(returnTo),
    next,
    back,
    goTo,
    reset,
  };
}

export default useKioskSteps;
