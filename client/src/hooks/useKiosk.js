import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import api from '@/lib/api';

/**
 * The kiosk's own data layer.
 *
 * Separate from `useAdmin` because a kiosk is **not an admin session**. Nothing
 * here reads `useAuth` or gates on `canUseAdmin`: nobody is signed in at a
 * tablet, and the cookie says only that staff entered the shop PIN today.
 */

/** The lock and welcome screens. Public, so a locked tablet can draw itself. */
export function useKioskConfig() {
  return useQuery({
    queryKey: ['kiosk', 'config'],
    queryFn: () => api.get('/kiosk/config'),
    // A tablet runs for a whole day without a reload; the shop's own copy does
    // not change under it, and refetching on every focus is noise.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The device tree, behind the session.
 *
 * `enabled` is explicit because the questions cannot ask for it before the
 * tablet is unlocked - a 401 on the lock screen would flash an error at a
 * customer who has done nothing wrong.
 */
export function useKioskDevices(enabled) {
  return useQuery({
    queryKey: ['kiosk', 'devices'],
    queryFn: () => api.get('/kiosk/devices'),
    enabled: Boolean(enabled),
    staleTime: 60 * 60 * 1000,
  });
}

export function useKioskMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['kiosk'] });

  return {
    unlock: useMutation({
      mutationFn: (body) => api.post('/kiosk/unlock', body),
      onSuccess: invalidate,
    }),
    lock: useMutation({
      mutationFn: () => api.post('/kiosk/lock', {}),
      onSuccess: invalidate,
    }),
    checkIn: useMutation({
      mutationFn: (body) => api.post('/kiosk/check-in', body),
    }),
  };
}

/**
 * Read a line out loud.
 *
 * ## Why `SpeechSynthesis` and not a provider
 *
 * It is free, offline, and needs no credential on a tablet that may be running
 * on shop wifi. The voice is the device's own, which is the trade: it sounds
 * less natural than a paid service, and it costs nothing per check-in and
 * cannot fail because an API key expired.
 *
 * ## Why every call is defensive
 *
 * `speechSynthesis` is absent in some browsers, throws in others, and on iOS it
 * stays silent until a user gesture has unlocked audio. **None of that may
 * break a check-in.** Reading a question aloud is an aid, not the interface -
 * the question is on screen either way - so every failure here is swallowed and
 * the flow carries on.
 */
export function useSpeech(enabled) {
  const [supported, setSupported] = useState(false);
  const lastSpoken = useRef(null);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);

  // Never leave a voice talking to an empty room.
  useEffect(() => {
    if (!enabled && supported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Nothing to recover: the flow does not depend on this.
      }
    }
  }, [enabled, supported]);

  useEffect(
    () => () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // Unmounting; there is nobody left to tell.
      }
    },
    [],
  );

  /**
   * Speak a line, and resolve when it has actually finished.
   *
   * **The promise is what stops the kiosk cutting itself off.** A screen that
   * advances on a fixed timer talks over its own confirmation the moment the
   * line is longer than the timer guessed - which is every long device name, and
   * every sentence on a slower voice. The caller awaits this instead of
   * guessing.
   *
   * It resolves rather than rejects on every failure path - unsupported, muted,
   * throwing, or never firing an event - because the flow must carry on either
   * way. A customer is never blocked by a voice that did not work.
   */
  const speak = useCallback(
    (text) =>
      new Promise((resolve) => {
        if (!enabled || !supported || !text) {
          resolve();
          return;
        }
        /**
         * The same screen re-rendering must not restart the sentence.
         *
         * Guarded on "still speaking this line", not "ever spoke this line".
         * Remembering it forever means a customer who goes BACK a step hears
         * nothing, because the prompt they are returning to was already said
         * once - and several prompts legitimately repeat across a check-in.
         *
         * Resolved rather than left hanging: the line is already in flight, and
         * a caller awaiting a duplicate would wait for an utterance that will
         * never fire a second `end`.
         */
        const speaking = (() => {
          try {
            return window.speechSynthesis.speaking || window.speechSynthesis.pending;
          } catch {
            return false;
          }
        })();

        if (lastSpoken.current === text && speaking) {
          resolve();
          return;
        }
        lastSpoken.current = text;

        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          // Slightly under default: a customer hearing a question for the first
          // time is not skimming it.
          utterance.rate = 0.95;
          utterance.pitch = 1;

          /**
           * Resolved once, whichever of the three arrives first.
           *
           * `end` is the normal path and `error` covers a voice that refuses to
           * start. The timeout is the one that matters in practice: several
           * browsers simply never fire either event if the utterance is cancelled
           * mid-flight or the tab loses focus, and without it the kiosk would
           * sit on one question forever waiting for a promise nobody will settle.
           *
           * Budgeted from the text rather than fixed, because the whole bug being
           * fixed here was a fixed number guessing wrong: ~12 characters a second
           * at rate 0.95, doubled for headroom, with a floor for short lines.
           */
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          };

          const budget = Math.max(2500, Math.round((text.length / 12) * 1000 * 2));
          const timer = setTimeout(finish, budget);

          utterance.onend = finish;
          utterance.onerror = finish;
          window.speechSynthesis.speak(utterance);
        } catch {
          // Swallowed on purpose - see the note above.
          resolve();
        }
      }),
    [enabled, supported],
  );

  return { speak, supported };
}

export default useKioskConfig;
