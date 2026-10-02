import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Bookmark, Lock, ShieldCheck, ShoppingCart, Truck } from 'lucide-react';
import cn from '@/lib/cn';
import { money } from '@/lib/format';
import { TAX_RATE } from '@shared/schemas/checkout';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Skeleton from '@/components/ui/Skeleton';
import CartLine from '@/components/cart/CartLine';
import CartBundleLine from '@/components/cart/CartBundleLine';
import CartPreownedLine from '@/components/cart/CartPreownedLine';
import CartServiceLine from '@/components/cart/CartServiceLine';
import CartMembershipLine from '@/components/cart/CartMembershipLine';
import PromoCodeField from '@/components/cart/PromoCodeField';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import useUiStore from '@/store/uiStore';
import { pressable } from '@/lib/motion';


export function CartPage() {
  const {
    items,
    bundles,
    preowned,
    services,
    membership,
    count,
    subtotal,
    payable,
    discount,
    bundleDiscount,
    promoDiscount,
    promo,
    priceVisible,
    shippingPreview,
    isReady,
    hasStockIssue,
    setQty,
    removeItem,
    setBundleQty,
    removeBundle,
    removePreowned,
    setServiceQty,
    removeService,
    removeMembership,
    saveForLater,
    isSaving,
  } = useCart();
  const { isApproved, isAuthenticated } = useAuth();
  const openAccount = useUiStore((s) => s.openAccount);
  // "Save cart for later" EMPTIES the active cart and drops the promo code
  // the button label says none of that, so it is said here before it happens.
  const [savingConfirm, setSavingConfirm] = useState(false);

  // A preview of the checkout arithmetic, computed from what the server already
  // told us the cart is worth. The binding numbers come from /orders/quote
  // this is here so the cart does not have to round-trip on every keystroke.
  //
  // The rates come from the server with the cart, not from a constant here:
  // shipping is editable in Settings (§6.15), and "free over $500" is exactly
  // the kind of promise a page must not make out of a stale number.
  const freeOver = shippingPreview?.freeOver ?? null;
  const freeShipping = promo?.freeShipping || shippingPreview?.cost === 0;
  const shipping = payable === null ? null : freeShipping ? 0 : (shippingPreview?.cost ?? 0);
  const tax = payable === null ? null : Math.round((payable + shipping) * TAX_RATE);
  const total = payable === null ? null : payable + shipping + tax;
  // Only meaningful when a threshold actually exists - a band with no free-over
  // has no distance to advertise.
  const awayFromFreeShipping =
    payable === null || freeOver === null ? null : freeOver - payable;

  // Skeleton until we actually know what is in the cart - an empty-state flash
  // while the request is in flight reads as "we lost your cart".
  if (!isReady) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
        <Skeleton className="mb-6 h-8 w-40" />
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="mt-4 h-72 lg:mt-0" />
        </div>
      </div>
    );
  }

  if (items.length === 0 && bundles.length === 0 && preowned.length === 0 && services.length === 0 && membership.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
        <span className="mb-5 flex size-16 items-center justify-center rounded-full bg-surface-3 text-ink-300">
          <ShoppingCart className="size-8" strokeWidth={1.5} />
        </span>
        <h1 className="text-2xl">Your cart is empty</h1>
        <p className="mt-3 text-md text-ink-500">
          Browse the catalogue and add the parts you need - quantities and pricing carry through to
          checkout.
        </p>
        <Link
          to="/shop"
          className="mt-7 inline-flex h-12 items-center gap-2 rounded-lg bg-brand-gradient px-6 font-display text-md font-semibold text-white transition-[filter] hover:brightness-110"
        >
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          Back to the shop
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-6 sm:px-4 lg:px-6 lg:py-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl">
          Your cart
          <span className="tnum ml-2.5 text-md font-medium text-ink-400">
            {count} {count === 1 ? 'item' : 'items'}
          </span>
        </h1>
        <Link
          to="/shop"
          className={cn(pressable, 'inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700')}
        >
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          Continue shopping
        </Link>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        <section aria-label="Cart items" className="overflow-hidden rounded-lg border border-line bg-surface">
          <ul className="divide-y divide-line">
            {/* Bundles first: they are the one thing in here that is priced as a
                unit, and burying them under loose lines hides why the total is
                lower than the parts add up to. */}
            {membership.map((line) => (
              <CartMembershipLine key={line.tier} line={line} onRemove={removeMembership} />
            ))}
            {bundles.map((bundle) => (
              <CartBundleLine
                key={bundle.offerId}
                bundle={bundle}
                onQtyChange={setBundleQty}
                onRemove={removeBundle}
              />
            ))}
            {preowned.map((line) => (
              <CartPreownedLine key={line.deviceId} line={line} onRemove={removePreowned} />
            ))}
            {services.map((line) => (
              <CartServiceLine
                key={line.serviceId}
                line={line}
                onQtyChange={setServiceQty}
                onRemove={removeService}
              />
            ))}
            {items.map((item) => (
              <CartLine key={item.productId} item={item} onQtyChange={setQty} onRemove={removeItem} />
            ))}
          </ul>
        </section>

        {/* ---- summary ---------------------------------------------------- */}
        <aside className="mt-4 lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)] lg:mt-0">
          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="mb-4 font-display text-lg font-bold">Order summary</h2>

            {priceVisible ? (
              <dl className="space-y-2.5 text-md">
                <div className="flex justify-between">
                  <dt className="text-ink-500">Subtotal</dt>
                  <dd className="tnum font-medium text-ink-900">{money(subtotal)}</dd>
                </div>

                {/* Two discounts, never merged into one line: a buyer needs to
                    see what the bundle saved and what the code saved, because
                    only one of the two is theirs to change. */}
                {bundleDiscount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ok">Bundle pricing</dt>
                    <dd className="tnum font-medium text-ok">−{money(bundleDiscount)}</dd>
                  </div>
                )}
                {promoDiscount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ok">
                      {promo?.code ? (
                        <span className="font-mono text-sm">{promo.code}</span>
                      ) : (
                        'Offer'
                      )}{' '}
                      <span className="text-ink-400">({promo?.label})</span>
                    </dt>
                    <dd className="tnum font-medium text-ok">−{money(promoDiscount)}</dd>
                  </div>
                )}

                <div className="flex justify-between">
                  <dt className="text-ink-500">Shipping (ground)</dt>
                  <dd
                    className={cn(
                      'tnum font-medium',
                      shipping === 0 ? 'text-ok' : 'text-ink-900',
                    )}
                  >
                    {shipping === 0 ? 'Free' : money(shipping)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">HST (13%)</dt>
                  <dd className="tnum font-medium text-ink-900">{money(tax)}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-line pt-3">
                  <dt className="font-display text-md font-bold text-ink-900">Total</dt>
                  <dd className="tnum font-display text-2xl font-bold text-ink-900">
                    {money(total)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm text-warn">
                <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                {isAuthenticated
                  ? 'Wholesale pricing unlocks once your business account is approved.'
                  : 'Sign in with an approved business account to see wholesale pricing.'}
              </p>
            )}

            {/* One code at a time; bundles are sealed against it. Sits under
                the totals so its effect is visible the moment it applies. */}
            {priceVisible && <PromoCodeField className="mt-4 border-t border-line pt-4" />}

            {priceVisible && awayFromFreeShipping > 0 && !promo?.freeShipping && (
              <p className="mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-sm text-ink-500">
                <Truck className="mt-0.5 size-3.5 shrink-0 text-ink-400" strokeWidth={2.25} aria-hidden="true" />
                Add {money(awayFromFreeShipping)} more for free ground shipping.
              </p>
            )}

            {hasStockIssue && (
              <p className="mt-3 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
                A line or a bundle exceeds available stock. Adjust it to continue.
              </p>
            )}

            <div className="mt-4 space-y-2">
              {isApproved ? (
                <Link
                  to="/checkout"
                  aria-disabled={hasStockIssue}
                  onClick={(event) => hasStockIssue && event.preventDefault()}
                  className={`inline-flex h-13 w-full items-center justify-center rounded-lg font-display text-lg font-semibold text-white transition-[filter] ${
                    hasStockIssue
                      ? 'pointer-events-none bg-surface-3 text-ink-300'
                      : 'bg-brand-gradient hover:brightness-110'
                  }`}
                >
                  Proceed to checkout
                </Link>
              ) : (
                <Button fullWidth size="lg" onClick={() => openAccount('signin')}>
                  {isAuthenticated ? 'Awaiting approval' : 'Sign in to check out'}
                </Button>
              )}

              <Button
                variant="outline"
                fullWidth
                size="sm"
                icon={Bookmark}
                disabled={!isApproved}
                loading={isSaving}
                onClick={() => setSavingConfirm(true)}
              >
                Save cart for later
              </Button>
            </div>

            <p className="mt-4 flex items-start gap-2 text-xs text-ink-400">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              All parts are tested before dispatch. 90-day warranty on new and OEM stock.
            </p>
          </div>
        </aside>
      </div>

      {/* Saving parks the cart under Saved carts and leaves the active one
          empty. Restoring it later merges the lines back, but the promo code
          does not come with them, so both halves are stated here. */}
      <ConfirmDialog
        open={savingConfirm}
        onClose={() => setSavingConfirm(false)}
        onConfirm={() => {
          saveForLater();
          setSavingConfirm(false);
        }}
        title="Save this cart and empty it?"
        body={`All ${count} ${count === 1 ? 'item' : 'items'} move to your saved carts, ready to restore from the cart panel or the quick order pad.`}
        tone="info"
        confirmLabel="Save and empty cart"
        cancelLabel="Keep shopping"
        loading={isSaving}
      />
    </div>
  );
}

export default CartPage;
