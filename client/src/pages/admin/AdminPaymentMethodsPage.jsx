import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/admin/PageHeader';
import { SettingsFormActions } from '@/components/admin/settings/SettingsForm';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminSettings, useAdminMutations } from '@/hooks/useAdmin';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';

/**
 * Payment Methods (§6.15, category 2).
 *
 * **This is not the buyer's saved cards.** `User.paymentMethods` is what a
 * customer pays *with*; this is the vocabulary staff pick from when they record
 * money moving - an expense paid by cheque, an invoice settled by e-Transfer.
 * The two lists are unrelated, and the screen says so, because "payment
 * methods" is exactly the phrase that would make somebody merge them.
 *
 * **A code is generated once from the label and then frozen.** Expenses and
 * payments store the code, so letting an edit change it would orphan every row
 * already recorded against it - renaming *Cheque* to *Check* must move the
 * label and leave the key alone.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/payment-methods'], icon: adminIcon('CreditCard') };

/** A label to a stable key: lowercase, dashes, nothing else. */
function slugify(label) {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function AdminPaymentMethodsPage() {
  const { data, isLoading } = useAdminSettings();
  const { savePaymentMethods } = useAdminMutations();

  const [methods, setMethods] = useState([]);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!data?.financial?.paymentMethods || dirty) return;
    setMethods(data.financial.paymentMethods);
  }, [data, dirty]);

  /**
   * Adding stages the row; Save changes writes it.
   *
   * Briefly made an immediate write, because a row added and then lost to a
   * refresh is a real defect. Reverted: one Save button for the whole list is
   * the clearer model, and an add that writes while the renames beside it wait
   * means the same screen commits two ways. What actually fixes the lost row is
   * telling the staff member they have unsaved work before they leave - see
   * `useUnsavedGuard` below.
   */
  function add() {
    const label = draft.trim();
    if (!label) return;

    const code = slugify(label);
    if (!code) {
      setError('Give this method a name with at least one letter or number.');
      return;
    }
    if (methods.some((method) => method.code === code)) {
      setError(`There is already a method called “${label}”.`);
      return;
    }

    setMethods((current) => [...current, { code, label }]);
    setDraft('');
    setError(null);
    setDirty(true);
    setSaved(false);
  }

  function rename(code, label) {
    // The label moves, the code never does - see the note above.
    setMethods((current) =>
      current.map((method) => (method.code === code ? { ...method, label } : method)),
    );
    setDirty(true);
    setSaved(false);
  }

  function remove(code) {
    setMethods((current) => current.filter((method) => method.code !== code));
    setDirty(true);
    setSaved(false);
  }

  async function save(event) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (methods.some((method) => !method.label.trim())) {
      setError('Every method needs a name.');
      return;
    }

    try {
      const next = await savePaymentMethods.mutateAsync({
        methods: methods.map((method) => ({ code: method.code, label: method.label.trim() })),
      });
      setMethods(next.financial.paymentMethods);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  if (isLoading) return <p className="text-sm text-ink-500">Loading settings…</p>;

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <form onSubmit={save} className="max-w-form space-y-4">
        <Panel
          title="Methods"
          description="Used when recording an expense or a payment against an invoice."
        >
          <ul className="divide-y divide-line">
            {methods.map((method) => (
              <li key={method.code} className="flex items-center gap-3 py-2.5 first:pt-0">
                <Input
                  aria-label={`Name for ${method.label}`}
                  value={method.label}
                  onChange={(event) => rename(method.code, event.target.value)}
                  containerClassName="flex-1"
                />
                {/* A fixed-width column, not a chip sized by its own content.
                    `credit-card` is twice the width of `cash`, and because the
                    field beside it is `flex-1` every row's input ended at a
                    different point - eight text boxes down the page, each a
                    different length, with the codes forming a ragged edge
                    between them. Nothing about the data is ragged; the layout
                    was. A fixed column lines both edges up and lets the codes
                    read as the column they are.

                    Wide enough for the longest code the seed data ships,
                    `bank-transfer` at ~110px - the first attempt at 104px
                    truncated it to `bank-transf…`, which is worse than the
                    ragged edge it replaced: a code that cannot be read in full
                    is the one thing this column exists to show. */}
                <code className="hidden w-32 shrink-0 truncate rounded-sm bg-surface-2 px-2 py-1 text-center font-mono text-xs text-ink-500 sm:block">
                  {method.code}
                </code>
                <button
                  type="button"
                  onClick={() => remove(method.code)}
                  aria-label={`Remove ${method.label}`}
                  className={cn(pressable, 'flex size-9 shrink-0 items-center justify-center rounded-md border border-line text-ink-400 hover:border-danger hover:bg-danger-50 hover:text-danger')}
                >
                  <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          {methods.length === 0 && (
            <p className="py-4 text-center text-sm text-ink-500">
              No methods. Every expense and payment has to name one, so add at least one before
              saving.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-line pt-4">
            <Input
              aria-label="New payment method"
              placeholder="e.g. Wire transfer"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              // Enter inside this field means "add", not "submit the form"
              // submitting on the way to adding a row loses the row.
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                }
              }}
              containerClassName="min-w-0 flex-1 sm:max-w-[280px]"
            />
            <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              Add method
            </Button>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            Renaming a method keeps its code, so the expenses and payments already recorded against
            it stay attached. Removing one leaves those rows naming a method that no longer exists
            rename it instead if it is still in the books.
          </p>
        </Panel>

        <SettingsFormActions
          unsavedLabel="the payment methods"
          dirty={dirty}
          saving={savePaymentMethods.isPending}
          saved={saved}
          error={error}
          onReset={() => {
            setMethods(data?.financial?.paymentMethods ?? []);
            setDraft('');
            setDirty(false);
            setSaved(false);
            setError(null);
          }}
        />
      </form>
    </div>
  );
}

export default AdminPaymentMethodsPage;
