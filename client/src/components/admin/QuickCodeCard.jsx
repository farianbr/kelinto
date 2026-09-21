import { useState } from 'react';
import { PlusCircle, Save, Wand2 } from 'lucide-react';

import cn from '@/lib/cn';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { pressable } from '@/lib/motion';
import { useAdminMutations } from '@/hooks/useAdmin';

/**
 * Mint a discount code in one pass, without opening the offer form.
 *
 * ## Why this exists beside a perfectly good form
 *
 * The full offer form is the right screen for a combo bundle, a targeted deal
 * or an exclusive with its own landing page: a dozen decisions, most of them
 * optional. It is the wrong screen for what a counter actually does, which is
 * "knock 10% off for this customer, right now, while they are standing there".
 * That is four fields, and making somebody walk a long form to reach them is
 * how a shop ends up not using codes at all.
 *
 * This is deliberately the small half. Anything it cannot express - a bundle,
 * a restriction, a target, scheduling - is the form's job, and the card says
 * so rather than growing toward it.
 *
 * ## What it fills in
 *
 * A code written here is a plain percentage or flat-amount deal, live from the
 * moment it saves, open to everyone. The title is generated from the code
 * because a discount code IS its own name at this size, and asking for both
 * would be a fifth field that says nothing new. Everything else takes the
 * schema's defaults, which are the permissive ones - `pricingService` is still
 * the only thing that decides what a code is worth.
 */
const EMPTY = { code: '', type: 'percent', value: '10', usageLimit: '', expiresAt: '', description: '' };

/** Unambiguous characters only: no O/0, no I/1/L. A code gets read aloud. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function QuickCodeCard({ className }) {
  const { createOffer } = useAdminMutations();
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  const set = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
    setSaved(null);
  };

  const isPercent = form.type === 'percent';

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setSaved(null);

    const code = form.code.trim().toUpperCase();
    if (!code) {
      setError('Enter a code, or generate one.');
      return;
    }

    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) {
      setError(isPercent ? 'Enter a percentage.' : 'Enter an amount.');
      return;
    }
    if (isPercent && value > 90) {
      setError('90% is the most a code can take off.');
      return;
    }

    try {
      await createOffer.mutateAsync({
        // The code is the name at this size - see the note above.
        title: `${code} - ${isPercent ? `${value}% off` : `$${value.toFixed(2)} off`}`,
        description: form.description.trim(),
        kind: 'deal',
        code,
        discountType: isPercent ? 'percent' : 'amount',
        discountPercent: isPercent ? Math.round(value) : 0,
        // Cents, like every other amount in this system.
        discountAmount: isPercent ? 0 : Math.round(value * 100),
        usageLimit: Number(form.usageLimit) || 0,
        // Blank runs until somebody pauses it, which is what the field says.
        endsAt: form.expiresAt || null,
        isActive: true,
      });

      setSaved(code);
      setForm({ ...EMPTY });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Panel
      className={className}
      title={
        <span className="flex items-center gap-1.5">
          <PlusCircle className="size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
          New code
        </span>
      }
      description="A percentage or flat amount off, live as soon as it saves."
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-end gap-2">
          <Input
            label="Code"
            placeholder="SUMMER10"
            required
            className="font-mono uppercase"
            containerClassName="flex-1"
            value={form.code}
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
          />
          <button
            type="button"
            onClick={() => set({ code: generateCode() })}
            className={cn(
              pressable,
              'mb-px inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2',
            )}
          >
            <Wand2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Generate
          </button>
        </div>

        {/* Two buttons rather than a select: there are exactly two answers, and
            a collapsed dropdown hides one of them behind a click. */}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-700">Type</span>
          <div className="flex gap-2">
            {[
              { value: 'percent', label: '% Percentage' },
              { value: 'amount', label: '$ Flat' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => set({ type: option.value })}
                aria-pressed={form.type === option.value}
                className={cn(
                  pressable,
                  'flex-1 rounded-md border px-3 py-2 text-sm font-semibold',
                  form.type === option.value
                    ? 'border-brand bg-brand-50 text-brand-700'
                    : 'border-line bg-surface text-ink-600 hover:border-line-strong hover:text-ink-900',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={isPercent ? 'Percentage (%)' : 'Amount (CAD)'}
            type="number"
            min="0"
            max={isPercent ? '90' : undefined}
            step={isPercent ? '1' : '0.01'}
            required
            placeholder={isPercent ? '10' : '25.00'}
            value={form.value}
            onChange={(event) => set({ value: event.target.value })}
          />
          <Input
            label="Usage limit"
            type="number"
            min="0"
            placeholder="Unlimited"
            hint="Blank or 0 is unlimited."
            value={form.usageLimit}
            onChange={(event) => set({ usageLimit: event.target.value })}
          />
        </div>

        <Input
          label="Expiry date"
          type="date"
          hint="Blank runs until you pause it."
          value={form.expiresAt}
          onChange={(event) => set({ expiresAt: event.target.value })}
        />

        <Input
          label="Description"
          placeholder="e.g. Summer promo"
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
        />

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        {saved && (
          <p className="text-sm text-ok">
            <span className="font-mono font-semibold">{saved}</span> is live.
          </p>
        )}

        <Button type="submit" icon={Save} loading={createOffer.isPending} className="w-full">
          Save code
        </Button>

        <p className="text-xs leading-relaxed text-ink-400">
          For a bundle, a targeted deal or a code limited to certain accounts, use{' '}
          <strong className="font-semibold text-ink-500">New offer</strong> above.
        </p>
      </form>
    </Panel>
  );
}

export default QuickCodeCard;
