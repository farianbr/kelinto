import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { CartPanelBody, CartPanelFooter, CartPanelTitle } from './CartPanelContent';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import useUiStore from '@/store/uiStore';
import { ease, pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * The mini-cart (brief §6). Opens on every Add to Cart and from the cart button
 * in either header.
 *
 * A dropdown at every width, not a side drawer: the page behind it never moves,
 * and on a phone the panel still reads as attached to the cart button that
 * opened it. Rendered inside <header>, so it stays anchored while the header is
 * sticky. Like the mega menu it is anchored rather than portalled, which means
 * it carries its own Escape handler.
 */
export function CartDropdown() {
  const open = useUiStore((s) => s.cartFlyoutOpen);
  const close = useUiStore((s) => s.closeCart);

  const { items, bundles, preowned, count, subtotal, payable, discount, promo, setQty, removeItem, removeBundle, removePreowned, saveForLater, isSaving } =
    useCart();
  const { isApproved } = useAuth();

  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape') close();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim starts at the header's real height (--header-h, measured in
              Header) so the cart button stays lit and can toggle the panel
              shut - and so the gap above the panel reads as deliberate. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="fixed inset-0 top-[var(--header-h,116px)] z-30 bg-ink-900/40 backdrop-blur-[1px]"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.24, ease: ease.entrance }}
            className="pointer-events-none absolute left-0 right-0 top-full z-40 origin-top pt-2.5"
          >
            <div className="mx-auto flex max-w-[1400px] justify-end px-3 lg:px-6">
              <div
                role="dialog"
                aria-labelledby={titleId}
                className="pointer-events-auto flex max-h-[min(72vh,620px)] w-full max-w-[420px] flex-col overflow-hidden rounded-lg bg-surface shadow-flyout"
              >
                <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3.5">
                  <div id={titleId} className="min-w-0 flex-1">
                    <CartPanelTitle count={count} />
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close cart"
                    className={cn(pressable, '-mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-400 hover:bg-surface-3 hover:text-ink-900')}
                  >
                    <X className="size-[18px]" strokeWidth={1.75} />
                  </button>
                </header>

                <div className="scroll-slim flex-1 overflow-y-auto overscroll-contain">
                  <CartPanelBody
                    items={items}
                    bundles={bundles}
                    preowned={preowned}
                    onRemovePreowned={removePreowned}
                    onQtyChange={setQty}
                    onRemove={removeItem}
                    onRemoveBundle={removeBundle}
                    onClose={close}
                    isApproved={isApproved}
                  />
                </div>

                {(items.length > 0 || bundles.length > 0 || preowned.length > 0) && (
                  <footer className="shrink-0 border-t border-line">
                    <CartPanelFooter
                      subtotal={subtotal}
                      payable={payable}
                      discount={discount}
                      promo={promo}
                      isApproved={isApproved}
                      isSaving={isSaving}
                      onSaveForLater={saveForLater}
                      onClose={close}
                    />
                  </footer>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default CartDropdown;
