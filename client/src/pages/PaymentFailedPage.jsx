import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowLeft, Headphones, Mail, RefreshCw, ShieldCheck, ShoppingCart } from 'lucide-react';
import { money } from '@/lib/format';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import Button from '@/components/ui/Button';
import BrandScene from '@/components/ui/BrandScene';
import { useCart } from '@/hooks/useCart';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * Payment failed.
 *
 * Reached from checkout when order creation throws - the charge happens BEFORE
 * anything is written or any stock moves (orderService.createOrder), so this page
 * can say the two things a buyer actually wants to know: no money left your
 * account, and your cart is exactly as you left it. Both are true, not
 * reassurance copy.
 *
 * The failure details arrive in router state rather than the query string: a
 * decline reason is not something to leave in a shareable URL or a browser
 * history entry. Landing here directly still renders - with generic copy
 * because a refresh must not produce a blank page.
 */
const REASONS = {
  PAYMENT_DECLINED: {
    title: 'The payment was declined',
    body: 'Your card issuer refused the charge. Nothing was taken, and your cart is untouched. A different card, or buying on your account terms, usually clears it on the next attempt.',
  },
  INSUFFICIENT_STOCK: {
    title: 'Some quantities are no longer available',
    body: 'Stock moved between adding to the cart and checking out. No payment was taken. Adjust the quantities in your cart and place the order again.',
    primary: { label: 'Review the cart', to: '/cart' },
  },
  NETWORK_ERROR: {
    title: 'We could not reach the payment service',
    body: 'The request never got through, so nothing was charged and no order was created. Your cart is intact - try again in a moment.',
  },
  DEFAULT: {
    title: 'The order did not go through',
    body: 'Something failed while placing the order. No payment was taken and your cart is exactly as you left it.',
  },
};

const REASSURANCES = [
  { icon: ShieldCheck, text: 'No charge was made. The order was never created.' },
  { icon: ShoppingCart, text: 'Your cart, addresses and delivery choice are all still saved.' },
  { icon: RefreshCw, text: 'Retrying picks up exactly where you left off - nothing to re-enter.' },
];

export function PaymentFailedPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { count, subtotal, priceVisible } = useCart();
  const info = useBusinessInfo();

  const code = state?.code ?? null;
  const reason = REASONS[code] ?? REASONS.DEFAULT;
  // The server's own message is more specific than any of the copy above (which
  // SKU ran short, which limit was hit), so it is shown as well, not instead.
  const detail = state?.message ?? null;

  return (
    <div className="mx-auto max-w-[1000px] px-3 py-8 sm:px-4 lg:px-6 lg:py-14">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <div className="min-w-0">
          <p className="eyebrow mb-2 text-danger">Payment not completed</p>
          <h1 className="text-3xl leading-tight sm:text-d-sm">{reason.title}</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-500">{reason.body}</p>

          {detail && (
            <p className="mt-4 rounded-md border border-danger/20 bg-danger-50 px-3.5 py-3 text-md leading-relaxed text-danger">
              {detail}
            </p>
          )}

          <ul className="mt-7 space-y-3">
            {REASSURANCES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-md text-ink-500">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ok-50 text-ok">
                  <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
                </span>
                {text}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              size="lg"
              icon={RefreshCw}
              onClick={() => navigate(reason.primary?.to ?? '/checkout')}
            >
              {reason.primary?.label ?? 'Try the payment again'}
            </Button>
            <Link
              to="/cart"
              className={cn(pressable, 'inline-flex h-13 items-center gap-2 rounded-lg border border-line-strong bg-surface px-6 font-display text-lg font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
            >
              <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
              Back to cart
            </Link>
          </div>

          {count > 0 && (
            <p className="mt-4 text-sm text-ink-400">
              {count} {count === 1 ? 'item' : 'items'} still in your cart
              {priceVisible && subtotal !== null ? ` · ${money(subtotal)}` : ''}
            </p>
          )}
        </div>

        {/* ---- aside: what to do next --------------------------------------- */}
        <aside className="lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)]">
          <BrandScene variant="payment-failed" className="mb-6" />

          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="rule-brand-gradient h-0.5" aria-hidden="true" />
            <div className="p-4 sm:p-5">
              <h2 className="text-lg">Other ways to place this order</h2>

              <ul className="mt-3 space-y-3 text-sm leading-relaxed text-ink-500">
                <li>
                  <span className="font-medium text-ink-900">Buy on your account terms.</span> Go
                  back to checkout and choose “On account” at the payment step - no card involved.
                </li>
                <li>
                  <span className="font-medium text-ink-900">Use a different card.</span> Add or
                  select another card under{' '}
                  <Link to="/account/payment-methods" className="font-semibold text-brand hover:text-brand-700">
                    payment methods
                  </Link>
                  .
                </li>
                {/* Says "over the phone" only where there is a number to call.
                    A business reachable by the contact form alone still offers
                    the route, just not one the customer cannot take. */}
                <li>
                  <span className="font-medium text-ink-900">Let the sales desk place it.</span>{' '}
                  {info.phone
                    ? 'Quote your cart over the phone and they will raise the order against your account.'
                    : 'Get in touch with your cart and they will raise the order against your account.'}
                </li>
              </ul>

              <div className="mt-5 flex flex-col gap-2">
                {info.phone && (
                  <a
                    href={`tel:${info.phone.replace(/[^\d+]/g, '')}`}
                    className={cn(pressable, 'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
                  >
                    <Headphones className="size-4" strokeWidth={2} aria-hidden="true" />
                    {info.phone}
                  </a>
                )}
                <Link
                  to="/contact"
                  className={cn(pressable, 'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line bg-surface-2 font-display text-md font-semibold text-ink-700 hover:bg-surface-3')}
                >
                  <Mail className="size-4" strokeWidth={2} aria-hidden="true" />
                  Message the sales desk
                </Link>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default PaymentFailedPage;
