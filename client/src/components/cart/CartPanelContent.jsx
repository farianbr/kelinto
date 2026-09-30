import { useState } from 'react';
import { Link } from 'react-router';
import { Bookmark, Lock, ShoppingCart } from 'lucide-react';
import { money, date } from '@/lib/format';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CartLine from './CartLine';
import CartBundleLine from './CartBundleLine';
import CartPreownedLine from './CartPreownedLine';
import useUiStore from '@/store/uiStore';
import { useSavedCarts, useAccountMutations } from '@/hooks/useAccount';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * The mini-cart's title, body and footer. The dropdown is the only consumer
 * today, but they stay split out so the cart page and any future surface can
 * reuse the same gates rather than restating them.
 */

export function CartPanelTitle({ count }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="font-display text-lg font-bold">Your cart</h2>
      {count > 0 && (
        <span className="tnum rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold text-ink-500">
          {count}
        </span>
      )}
    </div>
  );
}

/**
 * Saved carts, surfaced where they are actually needed. They used to live only
 * on the quick order pad, which meant the one moment you want a parked build
 * standing in front of an empty cart - was the one place you could not reach
 * it. Restoring writes the cart cache directly, so the panel refills in place.
 */
function SavedCartsPicker({ onClose }) {
  const { data: savedCarts } = useSavedCarts();
  const { restoreSavedCart } = useAccountMutations();
  // Third entry point for the same restore. It asks like the other two, so the
  // action cannot behave differently depending on where it was clicked.
  const [restoring, setRestoring] = useState(null);

  if (!savedCarts || savedCarts.length === 0) return null;

  return (
    <section className="border-t border-line bg-surface-2">
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
        <h3 className="eyebrow flex items-center gap-1.5 text-ink-400">
          <Bookmark className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          Saved carts
        </h3>
        <Link
          to="/account/quick-order"
          onClick={onClose}
          className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          Manage
        </Link>
      </header>

      <ul className="px-2 pb-3">
        {savedCarts.slice(0, 3).map((cart) => (
          <li
            key={cart.id}
            className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-900">{cart.name}</p>
              <p className="tnum text-xs text-ink-400">
                {cart.lineCount} {cart.lineCount === 1 ? 'line' : 'lines'} · {cart.itemCount} items ·{' '}
                {date(cart.createdAt)}
              </p>
            </div>
            <Button
              size="xs"
              variant="outline"
              loading={restoreSavedCart.isPending}
              onClick={() => setRestoring(cart)}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(restoring)}
        onClose={() => setRestoring(null)}
        onConfirm={() =>
          restoreSavedCart.mutate(restoring.id, { onSuccess: () => setRestoring(null) })
        }
        title="Restore this saved cart?"
        body={
          restoring
            ? `The ${restoring.lineCount} ${restoring.lineCount === 1 ? 'line' : 'lines'} in “${restoring.name}” are added to your current cart. Quantities add on top of anything already there.`
            : ''
        }
        tone="info"
        confirmLabel="Restore to cart"
        loading={restoreSavedCart.isPending}
        error={restoreSavedCart.error?.message}
      />
    </section>
  );
}

export function CartPanelBody({ items, bundles = [], preowned = [], onQtyChange, onRemove, onRemoveBundle, onRemovePreowned, onClose, isApproved }) {
  if (items.length === 0 && bundles.length === 0 && preowned.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink-300">
            <ShoppingCart className="size-6" strokeWidth={1.5} />
          </span>
          <div>
            <h3 className="text-lg">Your cart is empty</h3>
            <p className="mt-1 text-sm text-ink-500">
              Add parts from the grid and they will appear here.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Keep browsing
            </Button>
            {isApproved && (
              <Link
                to="/account/quick-order"
                onClick={onClose}
                className={cn(pressable, 'inline-flex h-9 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3.5 font-display text-sm font-semibold text-ink-500 hover:bg-surface-3 hover:text-ink-900')}
              >
                <Bookmark className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                Saved carts
              </Link>
            )}
          </div>
        </div>

        {isApproved && <SavedCartsPicker onClose={onClose} />}
      </>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {bundles.map((bundle) => (
        <CartBundleLine key={bundle.offerId} bundle={bundle} onRemove={onRemoveBundle} compact />
      ))}
      {preowned.map((line) => (
        <CartPreownedLine key={line.deviceId} line={line} onRemove={onRemovePreowned} compact />
      ))}
      {items.map((item) => (
        <CartLine
          key={item.productId}
          item={item}
          onQtyChange={onQtyChange}
          onRemove={onRemove}
          compact
        />
      ))}
    </ul>
  );
}

export function CartPanelFooter({
  subtotal,
  payable,
  discount,
  promo,
  isApproved,
  isSaving,
  onSaveForLater,
  onClose,
}) {
  const openAccount = useUiStore((s) => s.openAccount);
  const saved = discount > 0;
  // Saving empties the cart, so it asks first, as the cart page does (§3.0.1).
  const [confirmingSave, setConfirmingSave] = useState(false);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-md text-ink-500">Subtotal</span>
        <span className="text-right">
          <span className="tnum block font-display text-xl font-bold text-ink-900">
            {subtotal === null ? 'Sign in to view' : money(saved ? payable : subtotal)}
          </span>
          {saved && (
            <span className="tnum block text-xs text-ok">
              <span className="text-ink-300 line-through">{money(subtotal)}</span> · saved{' '}
              {money(discount)}
            </span>
          )}
        </span>
      </div>

      {promo && (
        <p className="truncate text-xs text-ok">
          {promo.code ? <span className="font-mono">{promo.code}</span> : 'Offer'} applied ·{' '}
          {promo.label}
        </p>
      )}

      {!isApproved && (
        <p className="flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm text-warn">
          <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          Wholesale pricing and checkout unlock once your business account is approved.
        </p>
      )}

      {isApproved ? (
        <Link
          to="/checkout"
          onClick={onClose}
          className="inline-flex h-13 w-full items-center justify-center rounded-lg bg-brand-gradient font-display text-lg font-semibold text-white transition-[filter] duration-press hover:brightness-110"
        >
          Proceed to checkout
        </Link>
      ) : (
        <Button fullWidth size="lg" onClick={() => openAccount('signin')}>
          Sign in to check out
        </Button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Link
          to="/cart"
          onClick={onClose}
          className={cn(pressable, 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
        >
          <ShoppingCart className="size-4" strokeWidth={2} aria-hidden="true" />
          View cart
        </Link>
        <Button
          variant="ghost"
          size="sm"
          icon={Bookmark}
          disabled={!isApproved}
          loading={isSaving}
          onClick={() => setConfirmingSave(true)}
        >
          Save for later
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingSave}
        onClose={() => setConfirmingSave(false)}
        onConfirm={() => {
          onSaveForLater();
          setConfirmingSave(false);
        }}
        tone="info"
        title="Save this cart and empty it?"
        body="Everything in it moves to your saved carts, where you can restore it later. Your cart is left empty."
        confirmLabel="Save and empty cart"
        loading={isSaving}
      />

      {isApproved && (
        <Link
          to="/account/quick-order"
          onClick={onClose}
          className="block text-center text-sm text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline"
        >
          View saved carts
        </Link>
      )}
    </div>
  );
}
