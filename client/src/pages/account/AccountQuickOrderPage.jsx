import { useState } from 'react';
import { AlertCircle, Check, Bookmark, Plus, Trash2, Upload, Zap } from 'lucide-react';
import cn from '@/lib/cn';
import { date } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ProductPicker from '@/components/account/ProductPicker';
import { useAccountMutations, useSavedCarts } from '@/hooks/useAccount';
import useUiStore from '@/store/uiStore';
import { pressable } from '@/lib/motion';

const EMPTY_ROW = () => ({ id: crypto.randomUUID(), product: null, qty: 1 });

/**
 * Quick order pad / bulk reorder (brief §8.3).
 *
 * Two ways in, because business buyers work both ways: a grid of parts picked from
 * the catalogue, and a paste box for a column of SKUs copied out of a
 * spreadsheet.
 */
export function AccountQuickOrderPage() {
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, EMPTY_ROW));
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState(null);
  // Deleting a saved cart is permanent, and restoring one CONSUMES it: the
  // lines merge into the active cart and the saved copy is removed either way.
  const [deletingCart, setDeletingCart] = useState(null);
  const [restoringCart, setRestoringCart] = useState(null);

  const { bulkAdd, restoreSavedCart, deleteSavedCart } = useAccountMutations();
  const { data: savedCarts } = useSavedCarts();
  const openCart = useUiStore((s) => s.openCart);

  function updateRow(id, patch) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function submit(lines) {
    if (lines.length === 0) return;
    setResult(null);
    bulkAdd.mutate(lines, {
      onSuccess: (payload) => {
        setResult(payload);
        if (payload.added.length > 0) openCart();
      },
    });
  }

  function submitGrid() {
    submit(
      rows
        .filter((row) => row.product)
        .map((row) => ({ sku: row.product.sku, qty: Number(row.qty) || 1 })),
    );
  }

  /**
   * Parses a pasted block. Accepts `SKU,QTY`, `SKU<tab>QTY` or `SKU QTY`,
   * one per line - which covers a column copied from Excel, Sheets or a CSV.
   */
  function submitPasted() {
    const lines = pasted
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sku, qty] = line.split(/[,\t;]|\s{2,}|\s+(?=\d+$)/).map((part) => part?.trim());
        return { sku, qty: Number(qty) > 0 ? Number(qty) : 1 };
      })
      .filter((line) => line.sku);

    submit(lines);
  }

  return (
    <div className="space-y-4">
      {result && (
        <div className="space-y-2">
          {result.added.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-ok-50 px-4 py-3 text-sm text-ok">
              <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              Added {result.added.length}{' '}
              {result.added.length === 1 ? 'line' : 'lines'} to your cart.
            </p>
          )}

          {result.notFound.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-danger-50 px-4 py-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>
                <span className="font-semibold">
                  {result.notFound.length} SKU{result.notFound.length === 1 ? '' : 's'} not found:
                </span>{' '}
                <span className="font-mono">{result.notFound.join(', ')}</span>
              </span>
            </p>
          )}

          {result.outOfStock.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-warn-50 px-4 py-3 text-sm text-warn">
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>
                <span className="font-semibold">Out of stock, skipped:</span>{' '}
                <span className="font-mono">
                  {result.outOfStock.map((item) => item.sku).join(', ')}
                </span>
              </span>
            </p>
          )}
        </div>
      )}

      {/* ---- typed grid --------------------------------------------------- */}
      <Panel
        title="Quick order pad"
        description="Search the catalogue for each part, set a quantity, and add the lot to your cart in one go."
      >
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.id} className="flex items-start gap-2">
              <span className="tnum mt-3.5 w-5 shrink-0 text-right text-xs text-ink-300">
                {index + 1}
              </span>

              <ProductPicker
                className="min-w-0 flex-1"
                label={`Part for line ${index + 1}`}
                value={row.product}
                onChange={(product) => updateRow(row.id, { product })}
              />

              <Input
                type="text"
                inputMode="numeric"
                value={row.qty}
                onChange={(event) =>
                  updateRow(row.id, { qty: event.target.value.replace(/D/g, '') })
                }
                aria-label={`Quantity for line ${index + 1}`}
                containerClassName="w-16 shrink-0 sm:w-20"
                className="tnum text-center"
              />

              <button
                type="button"
                onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}
                disabled={rows.length === 1}
                aria-label={`Remove line ${index + 1}`}
                className={cn(pressable, 'mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-danger-50 hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-300')}
              >
                <Trash2 className="size-4" strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={Plus}
            onClick={() => setRows((current) => [...current, EMPTY_ROW()])}
          >
            Add line
          </Button>

          <Button
            icon={Zap}
            loading={bulkAdd.isPending}
            disabled={!rows.some((row) => row.product)}
            onClick={submitGrid}
            className="ml-auto"
          >
            Add to cart
          </Button>
        </div>
      </Panel>

      {/* ---- paste box ---------------------------------------------------- */}
      <Panel
        title="Paste a list"
        description="One SKU per line. Quantity after a comma, tab or space - otherwise 1."
      >
        <textarea
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          rows={6}
          placeholder={'CVX-SAM-SA-1224, 10\nCVX-APP-B-1051\tsomething\nCVX-ONE-E-1543 4'}
          className={cn(
            'w-full rounded-md border border-line bg-surface px-3.5 py-3 font-mono text-sm text-ink-900',
            'placeholder:text-ink-300',
            'focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900/15',
          )}
        />

        <Button
          className="mt-3"
          variant="outline"
          icon={Upload}
          loading={bulkAdd.isPending}
          disabled={!pasted.trim()}
          onClick={submitPasted}
        >
          Parse and add
        </Button>
      </Panel>

      {/* ---- saved carts -------------------------------------------------- */}
      <Panel title="Saved carts" description="Carts you parked from the cart dropdown." flush>
        {!savedCarts || savedCarts.length === 0 ? (
          <PanelEmpty
            icon={Bookmark}
            title="No saved carts"
            body='Use "Save cart for later" in the cart to park a build for reuse.'
          />
        ) : (
          <ul className="divide-y divide-line">
            {savedCarts.map((cart) => (
              <li key={cart.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Bookmark className="size-4 shrink-0 text-ink-300" strokeWidth={2} aria-hidden="true" />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-md font-medium text-ink-900">{cart.name}</p>
                  <p className="tnum text-xs text-ink-400">
                    {cart.lineCount} {cart.lineCount === 1 ? 'line' : 'lines'} · {cart.itemCount}{' '}
                    items · saved {date(cart.createdAt)}
                  </p>
                </div>

                <Button
                  size="xs"
                  variant="outline"
                  loading={restoreSavedCart.isPending}
                  onClick={() => setRestoringCart(cart)}
                >
                  Restore
                </Button>

                <button
                  type="button"
                  onClick={() => setDeletingCart(cart)}
                  aria-label={`Delete saved cart ${cart.name}`}
                  className={cn(pressable, 'flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-danger-50 hover:text-danger')}
                >
                  <Trash2 className="size-4" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ConfirmDialog
        open={Boolean(deletingCart)}
        onClose={() => setDeletingCart(null)}
        onConfirm={() =>
          deleteSavedCart.mutate(deletingCart.id, { onSuccess: () => setDeletingCart(null) })
        }
        title="Delete this saved cart?"
        body={
          deletingCart
            ? `“${deletingCart.name}” and its ${deletingCart.lineCount} ${deletingCart.lineCount === 1 ? 'line' : 'lines'} will be removed. Your active cart is not affected.`
            : ''
        }
        confirmLabel="Delete saved cart"
        confirmPhrase={deletingCart?.name}
        confirmPhraseLabel="the cart name"
        loading={deleteSavedCart.isPending}
        error={deleteSavedCart.error?.message}
      />

      {/* Restoring merges the saved lines into the active cart and CONSUMES the
          saved copy - quantities add on top of anything already in the cart, so
          the saved list is not left behind to restore a second time. */}
      <ConfirmDialog
        open={Boolean(restoringCart)}
        onClose={() => setRestoringCart(null)}
        onConfirm={() =>
          restoreSavedCart.mutate(restoringCart.id, {
            onSuccess: () => {
              setRestoringCart(null);
              openCart();
            },
          })
        }
        title="Restore this saved cart?"
        body={
          restoringCart
            ? `The ${restoringCart.lineCount} ${restoringCart.lineCount === 1 ? 'line' : 'lines'} in “${restoringCart.name}” are added to your current cart. Quantities add on top of anything already there.`
            : ''
        }
        tone="info"
        confirmLabel="Restore to cart"
        loading={restoreSavedCart.isPending}
        error={restoreSavedCart.error?.message}
      />
    </div>
  );
}

export default AccountQuickOrderPage;
