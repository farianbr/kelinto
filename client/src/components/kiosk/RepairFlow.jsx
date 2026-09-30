import { useMemo, useState } from 'react';

import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import PhoneField from '@/components/ui/PhoneField';
import { useKioskMutations } from '@/hooks/useKiosk';
import KioskStepper from './KioskStepper';
import KioskOption from './KioskOption';
import KioskConditionPicker, { conditionSummary } from './KioskConditionPicker';
import { deviceSteps } from './deviceSteps';
import {
  FIND_BLANK,
  SummaryRow,
  findSteps,
  hasNumber,
  isKnown,
  isNew,
  looksLikeEmail,
} from './customerSteps';

/**
 * Repair check-in (Sales § Kiosk): the customer books their own device in.
 *
 * ## The route, as the client drew it
 *
 * "Let's find your details" first. A returning customer types their phone or
 * email, sees a masked "Is this you?", and goes straight to their device. A new
 * customer (or one who said "Not me") gives a name, a phone, whether they have
 * that phone with them, an email and how they want to hear about the repair.
 * Then everybody: the device, what is wrong, notes, the passcode, the
 * condition, and a confirmation screen where any answer can be edited before
 * the ticket is written.
 *
 * ## What it is allowed to collect
 *
 * It never prices, never picks a technician and never grades the device as
 * the shop's record: the condition the customer gives is stored as their
 * account of it, beside the grid the counter fills in. The counter finishes
 * the ticket under `intake.awaitingReview`.
 */

/** The quick-pick faults. More than one can be true of a dropped phone. */
const PROBLEMS = [
  'Cracked screen',
  'Battery drains fast',
  "Won't turn on",
  "Won't charge",
  'Water damage',
  'Camera problem',
  'Speaker or microphone',
  'Slow or freezing',
  'Something else',
];

/** How updates can reach them, in the order a repair customer usually reads them. */
const CHANNELS = [
  { key: 'sms', label: 'Text message' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'call', label: 'Phone call' },
];

const BLANK = {
  ...FIND_BLANK,
  firstName: '',
  lastName: '',
  phone: '',
  hasPhone: '',
  alternatePhone: '',
  email: '',
  contactChannels: [],
  category: '',
  brand: '',
  series: '',
  model: '',
  problems: [],
  notes: '',
  passcode: '',
  condition: {},
  termsAccepted: false,
};

export function RepairFlow({ config, tree, speak, chrome, onDone }) {
  const [answers, setAnswers] = useState(BLANK);
  const { lookup, checkIn } = useKioskMutations();
  const requireTerms = config?.requireTerms !== false;

  function submit() {
    const a = answers;
    const returning = a.mode === 'returning';
    checkIn.mutate(
      {
        customerToken: returning ? a.match?.token : undefined,
        rejectedToken: !returning ? a.rejectedToken || undefined : undefined,
        firstName: returning ? undefined : a.firstName,
        lastName: returning ? undefined : a.lastName,
        phone: returning ? undefined : a.phone,
        email: returning ? undefined : a.email,
        alternatePhone: !returning && a.hasPhone === 'no' ? a.alternatePhone : undefined,
        contactChannels: returning ? [] : a.contactChannels,
        category: a.category,
        brand: a.brand,
        series: a.series,
        model: a.model,
        problems: a.problems,
        notes: a.notes,
        passcode: a.passcode,
        condition: a.condition,
        termsAccepted: a.termsAccepted,
      },
      { onSuccess: onDone },
    );
  }

  const steps = useMemo(
    () => [
      ...findSteps(lookup),
      {
        key: 'name',
        when: isNew,
        prompt: "What's your name?",
        hint: 'So we know whose device this is.',
        valid: (a) => a.firstName.trim().length > 0 && a.lastName.trim().length > 0,
        confirm: (a) => `Nice to meet you, ${a.firstName.trim()}.`,
        render: ({ answers: a, set }) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              required
              autoComplete="given-name"
              value={a.firstName}
              onChange={(event) => set('firstName', event.target.value)}
              autoFocus
            />
            <Input
              label="Last name"
              required
              autoComplete="family-name"
              value={a.lastName}
              onChange={(event) => set('lastName', event.target.value)}
            />
          </div>
        ),
      },
      {
        key: 'phone',
        when: isNew,
        prompt: "What's your phone number?",
        valid: (a) => hasNumber(a.phone),
        render: ({ answers: a, set }) => (
          <PhoneField
            label="Phone number"
            value={a.phone}
            onChange={(value) => set('phone', value)}
          />
        ),
      },
      {
        key: 'hasPhone',
        when: isNew,
        prompt: 'Do you have this phone with you?',
        hint: "We'll use it to contact you after the repair.",
        footer: 'none',
        valid: (a) => Boolean(a.hasPhone),
        render: ({ next }) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <KioskOption label="Yes" onClick={() => next({ hasPhone: 'yes', alternatePhone: '' })} />
            <KioskOption
              label="No"
              detail="It's the one being repaired, or it's not with me"
              onClick={() => next({ hasPhone: 'no' })}
            />
          </div>
        ),
      },
      {
        key: 'alternatePhone',
        when: (a) => isNew(a) && a.hasPhone === 'no',
        prompt: 'What other number can we reach you on?',
        hint: 'Used for this repair only.',
        valid: (a) => hasNumber(a.alternatePhone),
        render: ({ answers: a, set }) => (
          <PhoneField
            label="Another phone number"
            value={a.alternatePhone}
            onChange={(value) => set('alternatePhone', value)}
          />
        ),
      },
      {
        key: 'email',
        when: isNew,
        prompt: "What's your email?",
        hint: "We'll send your invoice and updates here.",
        valid: (a) => looksLikeEmail(a.email),
        skip: { label: "I don't have one", patch: { email: '' } },
        render: ({ answers: a, set }) => (
          <Input
            type="email"
            aria-label="Email"
            autoComplete="email"
            autoCapitalize="off"
            placeholder="you@example.com"
            value={a.email}
            onChange={(event) => set('email', event.target.value)}
            className="text-center"
            autoFocus
          />
        ),
      },
      {
        key: 'consent',
        when: isNew,
        prompt: 'How should we send you repair updates?',
        hint: 'Pick any. We only message you about this repair.',
        valid: (a) => a.contactChannels.length > 0,
        skip: { label: 'No updates, thanks', patch: { contactChannels: [] } },
        render: ({ answers: a, set }) => (
          <div className="grid gap-3 sm:grid-cols-2">
            {CHANNELS.filter((channel) => channel.key !== 'email' || looksLikeEmail(a.email)).map(
              (channel) => {
                const on = a.contactChannels.includes(channel.key);
                return (
                  <KioskOption
                    key={channel.key}
                    label={channel.label}
                    selected={on}
                    onClick={() =>
                      set(
                        'contactChannels',
                        on
                          ? a.contactChannels.filter((key) => key !== channel.key)
                          : [...a.contactChannels, channel.key],
                      )
                    }
                  />
                );
              },
            )}
          </div>
        ),
      },

      ...deviceSteps(tree).map((step) => ({
        ...step,
        when: isKnown,
      })),

      {
        key: 'problem',
        prompt: "What's wrong with it?",
        hint: 'Pick everything that applies.',
        valid: (a) => a.problems.length > 0,
        render: ({ answers: a, set }) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PROBLEMS.map((problem) => {
              const on = a.problems.includes(problem);
              return (
                <KioskOption
                  key={problem}
                  label={problem}
                  selected={on}
                  onClick={() =>
                    set(
                      'problems',
                      on ? a.problems.filter((item) => item !== problem) : [...a.problems, problem],
                    )
                  }
                />
              );
            })}
          </div>
        ),
      },
      {
        key: 'notes',
        prompt: 'Anything else we should know?',
        hint: "When it started, what you've tried, anything that helps.",
        valid: (a) => a.notes.trim().length > 0,
        skip: { label: 'Nothing to add', patch: { notes: '' } },
        render: ({ answers: a, set }) => (
          <Textarea
            aria-label="Notes"
            rows={4}
            maxLength={500}
            placeholder="It fell in the sink yesterday and the screen went dark."
            value={a.notes}
            onChange={(event) => set('notes', event.target.value)}
          />
        ),
      },
      {
        key: 'passcode',
        prompt: "What's the passcode?",
        hint: 'So our technician can test it. Only the repair team sees it.',
        valid: (a) => a.passcode.trim().length > 0,
        skip: { label: 'It has no passcode', patch: { passcode: '' } },
        render: ({ answers: a, set }) => (
          <Input
            aria-label="Passcode"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="PIN, password or pattern"
            value={a.passcode}
            onChange={(event) => set('passcode', event.target.value)}
            className="text-center"
            autoFocus
          />
        ),
      },
      {
        key: 'condition',
        prompt: 'What state is it in?',
        hint: 'Your best guess is fine. Our team checks it too.',
        render: ({ answers: a, set }) => (
          <KioskConditionPicker value={a.condition} onChange={(value) => set('condition', value)} />
        ),
      },
      {
        key: 'confirm',
        prompt: 'Is everything right?',
        hint: 'Tap Edit to change anything.',
        nextLabel: 'Check in',
        valid: (a) => !requireTerms || a.termsAccepted,
        pending: checkIn.isPending,
        error: checkIn.error?.message,
        onNext: submit,
        render: ({ answers: a, set, goTo }) => {
          const edit = (key) => () => {
            checkIn.reset();
            goTo(key, { returnTo: 'confirm' });
          };
          const device = [a.brand, a.model].filter(Boolean).join(' ') || a.category || 'Not given';

          return (
            <div>
              <dl className="divide-y divide-line rounded-xl border border-line bg-surface">
                {a.mode === 'returning' ? (
                  <SummaryRow label="Checking in as" value={a.match?.name} />
                ) : (
                  <>
                    <SummaryRow
                      label="Name"
                      value={[a.firstName, a.lastName].filter(Boolean).join(' ')}
                      onEdit={edit('name')}
                    />
                    <SummaryRow label="Phone" value={a.phone} onEdit={edit('phone')} />
                    {a.hasPhone === 'no' && (
                      <SummaryRow
                        label="Reach me for this repair on"
                        value={a.alternatePhone}
                        onEdit={edit('hasPhone')}
                      />
                    )}
                    <SummaryRow label="Email" value={a.email || 'None'} onEdit={edit('email')} />
                    <SummaryRow
                      label="Repair updates"
                      value={
                        a.contactChannels.length
                          ? CHANNELS.filter((channel) => a.contactChannels.includes(channel.key))
                              .map((channel) => channel.label)
                              .join(' · ')
                          : 'No updates'
                      }
                      onEdit={edit('consent')}
                    />
                  </>
                )}
                <SummaryRow label="Device" value={device} onEdit={edit('category')} />
                <SummaryRow label="Problem" value={a.problems.join(' · ')} onEdit={edit('problem')} />
                <SummaryRow label="Notes" value={a.notes || 'None'} onEdit={edit('notes')} />
                <SummaryRow
                  label="Passcode"
                  value={a.passcode ? '•'.repeat(Math.min(8, a.passcode.length)) : 'None'}
                  onEdit={edit('passcode')}
                />
                <SummaryRow
                  label="Condition"
                  value={conditionSummary(a.condition)}
                  onEdit={edit('condition')}
                />
              </dl>

              {requireTerms && (
                <label className="mt-5 flex cursor-pointer items-start gap-4 rounded-xl border border-line bg-surface p-5">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-7 shrink-0 accent-brand"
                    checked={a.termsAccepted}
                    onChange={(event) => set('termsAccepted', event.target.checked)}
                  />
                  <span className="text-lg leading-snug text-ink-900">{config?.termsText}</span>
                </label>
              )}
            </div>
          );
        },
      },
    ],
    // `submit` reads `answers` through the closure, so the list is rebuilt when
    // they change; it is a few objects, and a stale submit would send old ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, answers, lookup.isPending, lookup.error, checkIn.isPending, checkIn.error, requireTerms, config?.termsText],
  );

  return <KioskStepper steps={steps} answers={answers} setAnswers={setAnswers} speak={speak} chrome={chrome} />;
}

export default RepairFlow;
