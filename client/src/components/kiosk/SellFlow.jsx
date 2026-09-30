import { useMemo, useState } from 'react';

import { ID_TYPES } from '@shared/schemas/admin';
import Input from '@/components/ui/Input';
import PhoneField from '@/components/ui/PhoneField';
import { useKioskMutations } from '@/hooks/useKiosk';
import KioskStepper from './KioskStepper';
import KioskOption from './KioskOption';
import KioskCamera from './KioskCamera';
import KioskConditionPicker, { conditionSummary } from './KioskConditionPicker';
import { deviceSteps } from './deviceSteps';
import { FIND_BLANK, SummaryRow, findSteps, hasNumber, isKnown, isNew, looksLikeEmail } from './customerSteps';

/**
 * "Sell your phone" (Sales § Sell your phone): a customer offers us a phone.
 *
 * ## The route, as the client drew it
 *
 * Find your details (or set up as new: name, phone, email), then the photo ID
 * if we have none on file, then a photo of the seller, then the phone itself:
 * the model, its storage and colour, its IMEI, the passcode and its condition.
 * A confirmation screen closes it, with the seller declaring the phone is
 * theirs to sell. The phone is handed to staff, who price it in the ERP
 * (Inventory › Pre-owned); the customer sees it under "Phones you sold us".
 *
 * ## What it asks and why
 *
 * - **The ID once.** A returning seller with one on file (`hasId`) skips it.
 * - **The photo every time**, returning or not: it is the record of who stood
 *   at the tablet today, and the only one a stolen-phone enquiry can use.
 * - **The IMEI always**: it is what a stolen-phone check is run against, and
 *   dialling *#06# shows it on any phone.
 *
 * No price is shown here, and none is asked for: the staff member agrees it
 * with the customer at the counter (client ruling, 2026-09-29).
 */

const STORAGE_SIZES = ['64 GB', '128 GB', '256 GB', '512 GB', '1 TB'];

const BLANK = {
  ...FIND_BLANK,
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  idType: '',
  idNumber: '',
  photo: '',
  category: '',
  brand: '',
  series: '',
  model: '',
  storage: '',
  colour: '',
  imei: '',
  passcode: '',
  condition: {},
  declaredOwner: false,
};

/** An ID is needed unless a returning seller already has one on file. */
const needsId = (a) => isNew(a) || (a.mode === 'returning' && !a.match?.hasId);

export function SellFlow({ tree, speak, chrome, onDone }) {
  const [answers, setAnswers] = useState(BLANK);
  const { lookup, sell } = useKioskMutations();

  function submit() {
    const a = answers;
    const returning = a.mode === 'returning';
    sell.mutate(
      {
        customerToken: returning ? a.match?.token : undefined,
        rejectedToken: !returning ? a.rejectedToken || undefined : undefined,
        firstName: returning ? undefined : a.firstName,
        lastName: returning ? undefined : a.lastName,
        phone: returning ? undefined : a.phone,
        email: returning ? undefined : a.email,
        idType: needsId(a) ? a.idType : undefined,
        idNumber: needsId(a) ? a.idNumber : undefined,
        photo: a.photo,
        category: a.category,
        brand: a.brand,
        series: a.series,
        model: a.model,
        storage: a.storage,
        colour: a.colour,
        imei: a.imei,
        passcode: a.passcode,
        condition: a.condition,
        declaredOwner: a.declaredOwner,
      },
      { onSuccess: onDone },
    );
  }

  const steps = useMemo(
    () => [
      ...findSteps(lookup),

      // ---- a new seller -----------------------------------------------------
      {
        key: 'name',
        when: isNew,
        prompt: "What's your name?",
        hint: 'As it appears on your photo ID.',
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
        hint: "So we can reach you about your phone.",
        valid: (a) => hasNumber(a.phone),
        render: ({ answers: a, set }) => (
          <PhoneField label="Phone number" value={a.phone} onChange={(value) => set('phone', value)} />
        ),
      },
      {
        key: 'email',
        when: isNew,
        prompt: "What's your email?",
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

      // ---- the seller's ID, once -------------------------------------------
      {
        key: 'idType',
        when: needsId,
        prompt: 'Which photo ID do you have with you?',
        hint: 'We keep this on file because we are buying from you. It is kept private.',
        footer: 'none',
        valid: (a) => Boolean(a.idType),
        render: ({ next }) => (
          <div className="grid gap-3 sm:grid-cols-2">
            {ID_TYPES.map((type) => (
              <KioskOption key={type.value} label={type.label} onClick={() => next({ idType: type.value })} />
            ))}
          </div>
        ),
      },
      {
        key: 'idNumber',
        when: needsId,
        prompt: "What's the number on it?",
        hint: 'Type it exactly as printed. Only our staff can see it.',
        valid: (a) => a.idNumber.replace(/\s+/g, '').length >= 4,
        render: ({ answers: a, set }) => (
          <Input
            aria-label="ID number"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={a.idNumber}
            onChange={(event) => set('idNumber', event.target.value.toUpperCase())}
            className="text-center font-mono tracking-wider"
            autoFocus
          />
        ),
      },

      // ---- everybody --------------------------------------------------------
      {
        key: 'photo',
        when: isKnown,
        prompt: "Now a quick photo of you",
        hint: 'Look at the camera at the top of the tablet. Only our staff see it.',
        valid: (a) => Boolean(a.photo),
        render: ({ answers: a, set }) => (
          <KioskCamera value={a.photo} onChange={(value) => set('photo', value)} />
        ),
      },

      ...deviceSteps(tree).map((step) => ({ ...step, when: isKnown })),

      {
        key: 'storage',
        prompt: 'How much storage does it have?',
        hint: 'Settings › General › About shows it.',
        footer: 'none',
        valid: (a) => Boolean(a.storage),
        render: ({ next }) => (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {STORAGE_SIZES.map((size) => (
              <KioskOption key={size} label={size} onClick={() => next({ storage: size })} />
            ))}
            <KioskOption label="Not sure" onClick={() => next({ storage: 'Not sure' })} />
          </div>
        ),
      },
      {
        key: 'colour',
        prompt: 'What colour is it?',
        valid: (a) => a.colour.trim().length > 0,
        skip: { label: 'Skip this', patch: { colour: '' } },
        render: ({ answers: a, set }) => (
          <Input
            aria-label="Colour"
            placeholder="Midnight, blue, white…"
            value={a.colour}
            onChange={(event) => set('colour', event.target.value)}
            className="text-center"
            autoFocus
          />
        ),
      },
      {
        key: 'imei',
        prompt: "What's its IMEI?",
        hint: 'Dial *#06# on the phone and it appears on screen. It is 15 digits.',
        valid: (a) => /^\d{15}$/.test(a.imei),
        render: ({ answers: a, set }) => (
          <Input
            aria-label="IMEI"
            inputMode="numeric"
            autoComplete="off"
            maxLength={15}
            placeholder="356938035643809"
            value={a.imei}
            onChange={(event) => set('imei', event.target.value.replace(/\D/g, '').slice(0, 15))}
            className="tnum text-center font-mono tracking-wider"
            autoFocus
          />
        ),
      },
      {
        key: 'passcode',
        prompt: "What's the passcode?",
        hint: 'So our team can test it before making you an offer.',
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
        hint: 'Be honest: our team checks it before making you an offer.',
        render: ({ answers: a, set }) => (
          <KioskConditionPicker value={a.condition} onChange={(value) => set('condition', value)} />
        ),
      },
      {
        key: 'confirm',
        prompt: 'Is everything right?',
        hint: 'Tap Edit to change anything.',
        nextLabel: 'Sell my phone',
        valid: (a) => a.declaredOwner,
        pending: sell.isPending,
        error: sell.error?.message,
        onNext: submit,
        render: ({ answers: a, set, goTo }) => {
          const edit = (key) => () => {
            sell.reset();
            goTo(key, { returnTo: 'confirm' });
          };
          return (
            <div>
              <dl className="divide-y divide-line rounded-xl border border-line bg-surface">
                {a.mode === 'returning' ? (
                  <SummaryRow label="Selling as" value={a.match?.name} />
                ) : (
                  <>
                    <SummaryRow
                      label="Name"
                      value={`${a.firstName} ${a.lastName}`.trim()}
                      onEdit={edit('name')}
                    />
                    <SummaryRow label="Phone" value={a.phone} onEdit={edit('phone')} />
                    <SummaryRow label="Email" value={a.email || 'None'} onEdit={edit('email')} />
                  </>
                )}
                {needsId(a) && (
                  <SummaryRow
                    label="Photo ID"
                    value={`${ID_TYPES.find((type) => type.value === a.idType)?.label ?? ''} ending ${a.idNumber.slice(-4)}`}
                    onEdit={edit('idType')}
                  />
                )}
                <SummaryRow
                  label="Phone you're selling"
                  value={[a.brand, a.model, a.storage !== 'Not sure' && a.storage, a.colour]
                    .filter(Boolean)
                    .join(' · ')}
                  onEdit={edit('category')}
                />
                <SummaryRow label="IMEI" value={a.imei} onEdit={edit('imei')} />
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

              <label className="mt-5 flex cursor-pointer items-start gap-4 rounded-xl border border-line bg-surface p-5">
                <input
                  type="checkbox"
                  className="mt-0.5 size-7 shrink-0 accent-brand"
                  checked={a.declaredOwner}
                  onChange={(event) => set('declaredOwner', event.target.checked)}
                />
                <span className="text-lg leading-snug text-ink-900">
                  This phone is mine to sell. It is not stolen, lost, borrowed or still being
                  paid off, and I have signed out of my accounts on it.
                </span>
              </label>
            </div>
          );
        },
      },
    ],
    // `submit` reads `answers` through the closure, so the list is rebuilt with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, answers, lookup.isPending, lookup.error, sell.isPending, sell.error],
  );

  return <KioskStepper steps={steps} answers={answers} setAnswers={setAnswers} speak={speak} chrome={chrome} />;
}

export default SellFlow;
