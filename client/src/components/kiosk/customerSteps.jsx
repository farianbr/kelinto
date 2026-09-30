import { Pencil } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Input from '@/components/ui/Input';
import { composePhone, formatNational, splitPhone } from '@/components/ui/PhoneField';
import KioskButton from './KioskButton';

/**
 * "Let's find your details", shared by the repair and the sell doors.
 *
 * One implementation, because both doors ask the same question in the same
 * words and must answer it the same way: a masked "Is this you?" (the tablet is
 * in a public room), "Not me" carrying the refused account so a new customer
 * is never filed under it, and what was typed carried into the new-customer
 * questions it already answers.
 *
 * **A miss stays on the find screen.** It used to jump straight to "What's your
 * name?", so somebody who mistyped one digit was signed up a second time
 * without being told we had looked and failed. Now it says so under the box
 * and waits: they can fix the number, try their email instead, or tap
 * "I'm new here", which still carries what they typed.
 *
 * Both steps set `mode`: `found` while "Is this you?" is asked, then
 * `returning` or `new`. Everything after them branches on it.
 */

export const hasNumber = (value) => splitPhone(value).national.replace(/\D/g, '').length >= 7;
export const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
export const isNew = (answers) => answers.mode === 'new';
export const isKnown = (answers) => answers.mode === 'new' || answers.mode === 'returning';

/**
 * What the lookup box held, carried into the new-customer questions it answers.
 *
 * A number typed with its code goes through `splitPhone`, the same parser
 * `PhoneField` reads its value with, so `+44 20...` stays British. A bare one
 * is taken as `+1`, dropping a leading 1 only once the punctuation is gone:
 * the old test ran on the raw text, so `+1 780 123 4567` kept its 1 and
 * prefilled as `+1 178 012 3456`.
 */
export function prefillFrom(query) {
  const text = String(query ?? '').trim();
  if (text.includes('@')) return { email: text.toLowerCase() };
  if (text.startsWith('+')) {
    const { dial, national } = splitPhone(text);
    return national ? { phone: composePhone(dial, national) } : {};
  }
  const national = formatNational(text.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''), '+1');
  return national ? { phone: composePhone('+1', national) } : {};
}

/** The answers the two steps own, for a flow's blank state. */
export const FIND_BLANK = { mode: '', query: '', match: null, rejectedToken: '', missedQuery: '' };

/** True while the box still holds the text the last lookup found nobody for. */
const missed = (a) => Boolean(a.missedQuery) && a.missedQuery === a.query.trim();

export function findSteps(lookup) {
  return [
    {
      key: 'find',
      prompt: "Let's find your details",
      hint: 'Type the phone number or email you gave us before.',
      valid: (a) => a.query.trim().length >= 3,
      nextLabel: 'Find me',
      pending: lookup.isPending,
      // Clears itself as soon as the box is edited, so the message never sits
      // under a number it was not about.
      error: (a) =>
        lookup.error?.message ||
        (missed(a)
          ? `We couldn't find anyone with that. Check it and try again, or tap "I'm new here".`
          : ''),
      skip: {
        label: "I'm new here",
        // After a miss, what they typed is most likely their number or email.
        patch: (a) => ({ mode: 'new', ...(missed(a) ? prefillFrom(a.query) : {}) }),
      },
      onNext: ({ answers: a, next, patch }) =>
        lookup.mutate(
          { query: a.query },
          {
            onSuccess: ({ match }) =>
              match
                ? next({ match, mode: 'found', missedQuery: '' })
                : patch({ missedQuery: a.query.trim() }),
          },
        ),
      render: ({ answers: a, set }) => (
        <Input
          aria-label="Phone number or email"
          placeholder="780 123 4567 or you@example.com"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={a.query}
          onChange={(event) => set('query', event.target.value)}
          className="text-center"
          autoFocus
        />
      ),
    },
    {
      key: 'found',
      when: (a) => a.mode === 'found',
      prompt: 'Is this you?',
      footer: 'none',
      render: ({ answers: a, next }) => (
        <div>
          <div className="rounded-xl border border-line bg-surface px-6 py-7 text-center">
            <p className="font-display text-d-sm font-bold tracking-wide text-ink-900">{a.match?.name}</p>
            <p className="mt-2 text-lg text-ink-500">
              {[a.match?.phone && `Phone ${a.match.phone}`, a.match?.email].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <KioskButton onClick={() => next({ mode: 'returning' })}>Yes, that&apos;s me</KioskButton>
            <KioskButton
              tone="quiet"
              onClick={() =>
                next({
                  mode: 'new',
                  rejectedToken: a.match?.token ?? '',
                  match: null,
                  ...prefillFrom(a.query),
                })
              }
            >
              Not me
            </KioskButton>
          </div>
        </div>
      ),
    },
  ];
}

/** One answer on a confirmation screen, with its way back. */
export function SummaryRow({ label, value, onEdit }) {
  return (
    <div className="flex items-start gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <dt className="text-md text-ink-500">{label}</dt>
        <dd className="mt-0.5 break-words font-display text-lg font-semibold text-ink-900">{value}</dd>
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className={cn(
            pressable,
            'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-md font-medium text-ink-700',
          )}
        >
          <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
          Edit
          <span className="sr-only"> {label}</span>
        </button>
      )}
    </div>
  );
}
