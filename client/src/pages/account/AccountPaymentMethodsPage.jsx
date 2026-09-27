import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote, CreditCard, Info, Plus, Star, Trash2 } from 'lucide-react';
import cn from '@/lib/cn';
import { money } from '@/lib/format';
import { paymentMethodSchema } from '@shared/schemas/account';
import Panel, { CollapsiblePanel, PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { StoreCreditCard, RechargeForm } from '@/components/account/StoreCredit';
import { useAuth } from '@/hooks/useAuth';
import { useAccountMutations, useAccountSummary, useStoreCredit } from '@/hooks/useAccount';
import { pressable } from '@/lib/motion';

const BRANDS = [
  { value: 'Visa', label: 'Visa' },
  { value: 'Mastercard', label: 'Mastercard' },
  { value: 'Amex', label: 'American Express' },
];

export function AccountPaymentMethodsPage() {
  const { user } = useAuth();
  const { data: summary } = useAccountSummary();
  const { data: creditData } = useStoreCredit();
  const { addPaymentMethod, removePaymentMethod } = useAccountMutations();
  const [adding, setAdding] = useState(false);
  // The trash icon used to remove the card on the click itself.
  const [removing, setRemoving] = useState(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(paymentMethodSchema),
    defaultValues: { type: 'card', brand: 'Visa', isDefault: false },
  });

  const methods = user?.paymentMethods ?? [];
  const termsEnabled = user?.terms && user.terms !== 'prepaid';

  function onSubmit(values) {
    addPaymentMethod.mutate(values, {
      onSuccess: () => {
        setAdding(false);
        reset();
      },
    });
  }

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-md bg-surface-2 px-4 py-3 text-sm text-ink-500">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
        This build runs against a mock payment gateway. Cards stored here are records only - no card
        number is collected, transmitted or charged.
      </p>

      <Panel
        title="Cards on file"
        action={
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
            Add card
          </Button>
        }
        flush={methods.length > 0}
      >
        {methods.length === 0 ? (
          <PanelEmpty
            icon={CreditCard}
            title="No cards on file"
            body="Add a card so checkout has a payment method ready."
            action={
              <Button variant="outline" size="sm" icon={Plus} onClick={() => setAdding(true)}>
                Add a card
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {methods.map((method) => (
              <li key={method._id} className="flex items-center gap-3 px-4 py-4 sm:px-5">
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-lg',
                    method.isDefault ? 'bg-brand-gradient text-white' : 'bg-surface-2 text-ink-400',
                  )}
                  aria-hidden="true"
                >
                  <CreditCard className="size-4.5" strokeWidth={1.75} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-md font-bold text-ink-900">
                      {method.brand ?? 'Card'} ···· {method.last4}
                    </p>
                    {method.isDefault && (
                      <Badge tone="brand" size="sm" icon={Star}>
                        Default
                      </Badge>
                    )}
                  </div>
                  {method.expMonth && method.expYear && (
                    <p className="tnum mt-0.5 text-sm text-ink-500">
                      Expires {String(method.expMonth).padStart(2, '0')}/{method.expYear}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setRemoving(method)}
                  aria-label={`Remove card ending ${method.last4}`}
                  className={cn(pressable, 'flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-danger-50 hover:text-danger')}
                >
                  <Trash2 className="size-4" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ---- store credit ------------------------------------------------
          A payment method in every sense that matters here: it settles an order
          at checkout before a card is asked for anything. It belongs on the page
          a buyer opens to answer "what can this account pay with". The statement
          behind it stays on the credit page. */}
      <Panel
        title="Store credit"
        description="Applied automatically at checkout, before any card is charged."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:gap-6">
          <StoreCreditCard
            balance={creditData?.balance ?? summary?.storeCredit ?? 0}
            added={creditData?.added ?? 0}
            spent={creditData?.spent ?? 0}
          />
          <RechargeForm />
        </div>
      </Panel>

      {/* Collapsed by default: terms are a standing fact about the account, not
          something a buyer opens this page to change. The summary carries the
          only part of it that moves. */}
      {termsEnabled && (
        <CollapsiblePanel
          title="Credit terms"
          summary={
            summary?.credit ? (
              <span className="tnum">
                {money(summary.credit.available)} available on {user.terms.replace('net', 'Net ')}
              </span>
            ) : (
              <span>{user.terms.replace('net', 'Net ')}</span>
            )
          }
        >
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ok-50 text-ok" aria-hidden="true">
              <Banknote className="size-4.5" strokeWidth={1.75} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="font-display text-md font-bold text-ink-900">
                On account - {user.terms.replace('net', 'Net ')}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">
                Approved on this account. Orders placed on terms draw against your credit limit and
                are invoiced with a {user.terms.replace('net', '')}-day due date.
              </p>
              {summary?.credit && (
                <p className="tnum mt-2 text-sm text-ink-700">
                  <span className="font-semibold">{money(summary.credit.available)}</span> available
                  of {money(summary.credit.limit)}
                </p>
              )}
            </div>
          </div>
        </CollapsiblePanel>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a card" size="sm">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <SelectField control={control} name="brand" label="Card brand" options={BRANDS} />

          <Input
            label="Last four digits"
            inputMode="numeric"
            maxLength={4}
            placeholder="4242"
            error={errors.last4?.message}
            data-autofocus
            {...register('last4')}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Expiry month"
              inputMode="numeric"
              placeholder="11"
              error={errors.expMonth?.message}
              {...register('expMonth')}
            />
            <Input
              label="Expiry year"
              inputMode="numeric"
              placeholder="2029"
              error={errors.expYear?.message}
              {...register('expYear')}
            />
          </div>

          <Checkbox label="Make this the default" className="-ml-2" {...register('isDefault')} />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={addPaymentMethod.isPending}>
              Add card
            </Button>
          </div>
        </form>
      </Modal>

      {/* Removing the default card leaves the account with no card selected at
          checkout, so the dialog says which one is going and whether it is the
          default rather than just asking "are you sure". */}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removePaymentMethod.mutate(removing._id, { onSuccess: () => setRemoving(null) })
        }
        title="Remove this card?"
        body={
          removing
            ? `${removing.brand ?? 'Card'} ending ${removing.last4} will be taken off your account.`
            : ''
        }
        confirmLabel="Remove card"
        confirmPhrase={removing?.last4}
        confirmPhraseLabel="the last four digits"
        loading={removePaymentMethod.isPending}
        error={removePaymentMethod.error?.message}
      />
    </div>
  );
}

export default AccountPaymentMethodsPage;
