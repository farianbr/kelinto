import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Wallet, WalletCards } from 'lucide-react';
import cn from '@/lib/cn';
import { money, date } from '@/lib/format';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAdminMutations, useAdminStoreCredit } from '@/hooks/useAdmin';
import { toast } from '@/store/toastStore';

/** How money arrived at the counter. Matches the invoice screen's list. */
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'e-transfer', label: 'E-transfer' },
  { value: 'cheque', label: 'Cheque' },
];

/**
 * The pieces that make up one client account: the credit-and-terms form and the
 * store-credit panel.
 *
 * They live here rather than inside the profile page so the two money surfaces
 * stay together and stay apart - the form edits what Cellvix will **lend**, the
 * panel posts what the business already **holds**, and the Instructions require
 * those never be merged into one card.
 */

const TERMS = [
  { value: 'prepaid', label: 'Prepaid' },
  { value: 'net15', label: 'Net 15' },
  { value: 'net30', label: 'Net 30' },
  { value: 'net60', label: 'Net 60' },
];

const STATUS_TONES = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
  suspended: 'neutral',
};

/**
 * Store credit on one account: allocate, correct, and read the ledger.
 *
 * Deliberately a separate panel from "Credit & terms" above it, because they are
 * different instruments - that form edits what Cellvix will LEND this business,
 * this one posts money the business HOLDS. Mixing them into one card is what
 * makes staff grant a $2,000 limit when they meant a $200 refund.
 */
export function StoreCreditPanel({ id, balance }) {
  const { allocateStoreCredit } = useAdminMutations();
  const { data } = useAdminStoreCredit(id);
  const { register, handleSubmit, reset } = useForm({
    defaultValues: { amountDollars: '', note: '' },
  });

  /**
   * **A filled-in form still confirms when it moves money.**
   *
   * §3.0.1 exempts a form the user deliberately opened and filled - the rule is
   * about writes fired from one click. This is the exception that outranks it:
   * the amount lands in the `CreditTransaction` ledger, which is append-only,
   * so a mistyped figure is corrected by posting a second, opposite movement
   * rather than by fixing the first. Nothing here can be edited afterwards.
   *
   * The dialog restates the amount because a slipped decimal is the actual
   * failure - $500 for $50 - and that is only catchable by reading the number
   * back before it is written.
   */
  const [pending, setPending] = useState(null);

  const movements = data?.transactions ?? [];

  return (
    <div className="rounded-md border border-line p-4">
      <div className="mb-3 flex items-center gap-2">
        <WalletCards className="size-4 text-ink-400" strokeWidth={2} aria-hidden="true" />
        <h3 className="font-display text-md font-bold">Store credit</h3>
        <span className="tnum ml-auto font-display text-lg font-bold text-ink-900">
          {money(data?.balance ?? balance ?? 0)}
        </span>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-ink-400">
        Money this account holds with this business. It comes off their next order automatically. A
        negative amount is a correction.
      </p>

      <form onSubmit={handleSubmit((values) => setPending(values))}>
        <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
          <Input
            label="Amount"
            inputMode="decimal"
            suffix="CAD"
            placeholder="50"
            {...register('amountDollars')}
          />
          <Input label="Reason" placeholder="Goodwill - late dispatch" {...register('note')} />
        </div>

        <Button type="submit" size="sm" className="mt-3" loading={allocateStoreCredit.isPending}>
          Post to account
        </Button>

        {allocateStoreCredit.isError && (
          <p className="mt-2 text-xs text-danger">{allocateStoreCredit.error.message}</p>
        )}
      </form>

      {movements.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line pt-1">
          {movements.slice(0, 6).map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink-900">{row.note}</span>
                <span className="block text-xs text-ink-400">
                  {row.type} · {date(row.createdAt)}
                  {row.orderNumber ? ` · ${row.orderNumber}` : ''}
                </span>
              </span>
              <span
                className={cn(
                  'tnum shrink-0 text-sm font-medium',
                  row.amount > 0 ? 'text-ok' : 'text-ink-700',
                )}
              >
                {row.amount > 0 ? '+' : '−'}
                {money(Math.abs(row.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={() => {
          allocateStoreCredit.mutate(
            { id, amountDollars: Number(pending.amountDollars), note: pending.note },
            { onSuccess: () => reset({ amountDollars: '', note: '' }) },
          );
          setPending(null);
        }}
        loading={allocateStoreCredit.isPending}
        title={
          Number(pending?.amountDollars) < 0
            ? `Take ${money(Math.abs(Number(pending?.amountDollars ?? 0)) * 100)} off this account?`
            : `Post ${money(Number(pending?.amountDollars ?? 0) * 100)} to this account?`
        }
        body={pending?.note || undefined}
        confirmLabel="Post to account"
        tone="warn"
      />
    </div>
  );
}

/**
 * Credit and terms: what Cellvix will **lend** this business.
 *
 * Deliberately separate from the store-credit panel - that one posts money the
 * business already **holds**. Mixing them into one card is what makes staff
 * grant a $2,000 limit when they meant a $200 refund.
 */
export function CreditForm({ id, user }) {
  const { setCredit, setUserStatus } = useAdminMutations();
  // Suspend and reinstate both fired from a single click with nothing in
  // between. Suspending stops a business ordering and hides wholesale pricing
  // from them; reinstating hands both back. Neither is a thing to do by
  // accident from a form somebody opened to edit a credit limit.
  const [statusChange, setStatusChange] = useState(null);

  // `values` (not `defaultValues`) because the account arrives after first
  // render - defaults would snapshot an empty user and the form would show
  // a zero credit limit for an account that has one.
  const { register, handleSubmit, control } = useForm({
    values: {
      creditLimitDollars: user ? (user.creditLimit / 100).toFixed(0) : '',
      terms: user?.terms ?? 'prepaid',
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) =>
        setCredit.mutate({
          id,
          creditLimit: Math.round(Number(values.creditLimitDollars) * 100) || 0,
          terms: values.terms,
        }),
      )}
      className="rounded-md border border-line p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <Wallet className="size-4 text-ink-400" strokeWidth={2} aria-hidden="true" />
        <h3 className="font-display text-md font-bold">Credit &amp; terms</h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Credit limit"
          inputMode="numeric"
          suffix="CAD"
          {...register('creditLimitDollars')}
        />
        <SelectField control={control} name="terms" label="Terms" options={TERMS} />
      </div>

      <p className="tnum mt-2.5 text-sm text-ink-500">
        Currently drawn: <span className="font-medium text-ink-900">{money(user.balance)}</span> of{' '}
        {money(user.creditLimit)}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={setCredit.isPending}>
          Save credit
        </Button>

        {user.status === 'approved' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={setUserStatus.isPending}
            onClick={() => setStatusChange('suspended')}
          >
            Suspend account
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={setUserStatus.isPending}
            onClick={() => setStatusChange('approved')}
          >
            Reinstate account
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(statusChange)}
        onClose={() => setStatusChange(null)}
        onConfirm={() => {
          setUserStatus.mutate({ id, status: statusChange });
          setStatusChange(null);
        }}
        loading={setUserStatus.isPending}
        title={
          statusChange === 'suspended'
            ? `Suspend ${user.displayName}?`
            : `Reinstate ${user.displayName}?`
        }
        body={
          statusChange === 'suspended'
            ? 'They keep their cart and history, but cannot order or see wholesale pricing.'
            : 'They can order and see wholesale pricing again.'
        }
        confirmLabel={statusChange === 'suspended' ? 'Suspend account' : 'Reinstate account'}
        tone={statusChange === 'suspended' ? 'danger' : 'info'}
      />
    </form>
  );
}

/**
 * Recording money a customer handed over against their line of credit.
 *
 * **A separate panel from `CreditForm`, on purpose.** That form sets what
 * Cellvix is willing to *lend* - a policy decision an owner makes. This records
 * what a customer *paid* - an event at the counter. Putting a "save" that
 * changes a credit limit next to a "record" that moves money invites the wrong
 * one being pressed.
 *
 * The amount defaults to the full balance, because paying the account off is
 * the common case; it is editable because a customer paying $200 of $850 is the
 * reason this exists at all.
 */
export function CreditRepaymentForm({ id, user }) {
  const { recordCreditPayment } = useAdminMutations();
  const owing = user?.balance ?? 0;

  /**
   * Confirms for the same reason the store-credit panel does: this settles real
   * invoices, oldest first, and reversing it means finding each invoice the
   * payment touched and reversing them one at a time. The form exemption in
   * §3.0.1 does not cover a write that moves money.
   */
  const [pending, setPending] = useState(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm({
    values: {
      amountDollars: (owing / 100).toFixed(2),
      method: 'cash',
      reference: '',
    },
  });

  if (owing <= 0) {
    return (
      <div className="rounded-md border border-line p-4">
        <div className="mb-2 flex items-center gap-2">
          <Wallet className="size-4 text-ok" strokeWidth={2} aria-hidden="true" />
          <h3 className="font-display text-md font-bold">Record a payment</h3>
        </div>
        <p className="text-sm leading-relaxed text-ink-500">
          Nothing is drawn on this line of credit. A payment beyond what is owed is a
          store-credit allocation, which is the panel beside this one.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit((values) => setPending(values))}
      className="rounded-md border border-line p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <Wallet className="size-4 text-brand" strokeWidth={2} aria-hidden="true" />
        <h3 className="font-display text-md font-bold">Record a payment</h3>
      </div>

      <p className="mb-3 text-sm leading-relaxed text-ink-500">
        Money the customer has already handed over - cash at the counter, a transfer, a cheque.
        It settles their unpaid invoices oldest first, so the account and the invoices behind it
        cannot disagree about what is left.
      </p>

      {recordCreditPayment.error && (
        <p className="mb-3 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          {recordCreditPayment.error.message}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Amount"
          inputMode="decimal"
          suffix="CAD"
          hint={`${money(owing)} outstanding`}
          error={errors.amountDollars?.message}
          {...register('amountDollars', { required: 'Enter an amount.' })}
        />
        <SelectField control={control} name="method" label="Method" options={PAYMENT_METHODS} />
      </div>

      <Input
        label="Reference"
        placeholder="Receipt number, transfer id…"
        hint="Optional. Shown on each invoice's payment history."
        containerClassName="mt-3"
        {...register('reference')}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={recordCreditPayment.isPending}>
          Record payment
        </Button>
        <span className="text-xs text-ink-400">
          Overpayment is refused - that is a store-credit allocation.
        </span>
      </div>

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={() => {
          recordCreditPayment.mutate(
            { id, ...pending, reference: pending.reference || undefined },
            {
              onSuccess: (result) => {
                const names = (result?.applied ?? []).map((row) => row.number).join(', ');
                toast.ok(
                  'Payment recorded',
                  names ? `Settled against ${names}.` : 'The balance has been updated.',
                );
                reset();
              },
              onError: (error) => toast.error('Nothing was recorded', error.message),
            },
          );
          setPending(null);
        }}
        loading={recordCreditPayment.isPending}
        title={`Record ${money(Number(pending?.amountDollars ?? 0) * 100)} from ${user.displayName}?`}
        body="Settles their unpaid invoices, oldest first."
        confirmLabel="Record payment"
        tone="warn"
      />
    </form>
  );
}

export { TERMS, STATUS_TONES };
