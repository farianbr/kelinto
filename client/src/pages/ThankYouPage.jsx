import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from '@/lib/motionReact';
import {
  ArrowRight,
  Check,
  FileText,
  HelpCircle,
  Newspaper,
  Package,
  Star,
  Tag,
  Truck,
} from 'lucide-react';
import api from '@/lib/api';
import { money, date } from '@/lib/format';
import Skeleton from '@/components/ui/Skeleton';
import ReviewPrompt from '@/components/product/ReviewPrompt';
import { PartVisual } from '@/components/product/PartFrame';
import BrandScene from '@/components/ui/BrandScene';
import { ease, pressable } from '@/lib/motion';
import cn from '@/lib/cn';
import { useKioskShopping } from '@/lib/kioskShopping';
import { kioskPath } from '@/hooks/useAuth';

/**
 * Post-checkout confirmation (brief §9).
 *
 * The success animation is the one place in the app allowed to run past 600ms:
 * a ring drawing itself, then the check stroking in. It plays once, and collapses
 * to a static mark under `prefers-reduced-motion`.
 */
function SuccessMark() {
  const reduce = useReducedMotion();

  if (reduce) {
    return (
      <span className="flex size-20 items-center justify-center rounded-full bg-ok text-white">
        <Check className="size-10" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="relative flex size-20 items-center justify-center">
      <svg viewBox="0 0 80 80" className="absolute inset-0 size-full" aria-hidden="true">
        <motion.circle
          cx="40"
          cy="40"
          r="37"
          fill="none"
          stroke="var(--color-ok)"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0, rotate: -90 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: ease.entrance }}
          style={{ transformOrigin: '50% 50%', rotate: -90 }}
        />
        <motion.path
          d="M25 41.5 L35.5 52 L56 31"
          fill="none"
          stroke="var(--color-ok)"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.35, delay: 0.5, ease: ease.entrance }}
        />
      </svg>
    </span>
  );
}

const ELSEWHERE = [
  {
    icon: Tag,
    to: '/offers',
    title: 'Combo deals',
    body: 'Bundle pricing on the parts that come through the door together.',
  },
  {
    icon: HelpCircle,
    to: '/faq',
    title: 'Shipping & warranty FAQ',
    body: 'Cut-offs, tracking, claims and what each grade means.',
  },
  {
    icon: Newspaper,
    to: '/blog',
    title: 'Workshop notes',
    body: 'Grading, diagnostics and catalogue changes from the warehouse.',
  },
];

const NEXT_STEPS = [
  {
    icon: Package,
    title: 'We pick and test',
    body: 'Every part is quality-checked at the Toronto warehouse before it is boxed.',
  },
  {
    icon: Truck,
    title: 'You get tracking',
    body: 'A carrier and tracking number land in your inbox as soon as the order ships.',
  },
  {
    icon: FileText,
    title: 'Invoice follows',
    body: 'Your invoice is in Account → Invoices, with the due date for your terms.',
  },
  {
    icon: Star,
    title: 'Then tell us how it went',
    // A review needs the part in hand, so the option opens on delivery rather
    // than now. Saying so here is what stops a buyer looking for a button that
    // cannot exist yet.
    body: 'Once it is delivered you can review it from your order history.',
  },
];

/** How long the kiosk shopper sees this page before the tablet takes over. */
const KIOSK_HANDBACK_MS = 5000;

export function ThankYouPage() {
  const { orderNumber } = useParams();
  const kiosk = useKioskShopping();
  const navigate = useNavigate();

  /**
   * On the in-store kiosk, this page hands back to the tablet.
   *
   * A few seconds here so the order visibly went through, then `/kiosk` asks
   * "Order again?" with the number restated for the counter. Left here, the
   * page would sit on a signed-in account with nobody in front of it until the
   * idle clock noticed.
   */
  useEffect(() => {
    if (!kiosk) return undefined;
    const timer = setTimeout(() => {
      const base = kioskPath();
      navigate(`${base}${base.includes('?') ? '&' : '?'}ordered=${encodeURIComponent(orderNumber)}`, {
        replace: true,
      });
    }, KIOSK_HANDBACK_MS);
    return () => clearTimeout(timer);
  }, [kiosk, orderNumber, navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', orderNumber],
    queryFn: () => api.get(`/orders/${orderNumber}`),
    select: (payload) => payload.order,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-12 lg:py-16">
        <div>
          <Skeleton className="mb-6 size-20" rounded="full" />
          <Skeleton className="mb-3 h-8 w-72" />
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="mt-8 h-12 w-64" />
          <Skeleton className="mt-10 h-52" />
        </div>
        <Skeleton className="h-[420px]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl">We could not find that order</h1>
        <p className="mt-3 text-md text-ink-500">{error.message}</p>
        <Link
          to="/account/orders"
          className="mt-6 inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700"
        >
          View your order history
          <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const eta = new Date(
    Date.now() + (data.deliveryMethod?.etaDays ?? 3) * 86_400_000,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 lg:py-16">
      {/* Two columns from lg. A confirmation is read in two passes - "did it go
          through" and "what exactly did I buy" - and stacking them put the
          second pass a scroll away while the first sat in a 768px column of
          mostly nothing. The left rail answers the first question and holds
          everything about what happens NEXT; the receipt stays pinned on the
          right where it can be checked against without losing the actions.
          Below lg the order is unchanged, the receipt following the
          confirmation. */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-12">
        {/* ---- left rail: the confirmation and what follows ---------------- */}
        <div className="min-w-0">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: ease.entrance }}
            className="flex flex-col items-center text-center lg:items-start lg:text-left"
          >
            <SuccessMark />

            <h1 className="mt-6 text-3xl sm:text-d-sm">Order confirmed</h1>
            <p className="mt-3 max-w-md text-md leading-relaxed text-ink-500">
              Thanks - we have your order and the warehouse is on it. A confirmation is on its way to
              your inbox.
            </p>

            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2">
              <span className="eyebrow text-ink-400">Order</span>
              <span className="font-mono text-md font-medium text-ink-900">
                {data.orderNumber}
              </span>
            </p>
          </motion.div>

          {/* The actions sit directly under the confirmation now rather than
              below the receipt: with the receipt in its own column there is no
              reason to make a buyer scroll past it to reach them. */}
          <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <Link
              to="/shop"
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-brand-gradient px-6 font-display text-md font-semibold text-white transition-[filter] hover:brightness-110"
            >
              Keep shopping
              <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
            </Link>
            <Link
              to={`/account/orders/${data.orderNumber}`}
              className={cn(pressable, 'inline-flex h-12 items-center rounded-lg border border-line-strong bg-surface px-6 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
            >
              Track this order
            </Link>
          </div>

          {/* ---- what happens next --------------------------------------
              A numbered sequence rather than three tiles: these three things
              happen in an order, and as equal squares that reading was lost.
              The rule down the left is the thread between them. */}
          <div className="mt-10">
            <h2 className="eyebrow mb-4 text-ink-400">What happens next</h2>
            <ol className="space-y-5 border-l border-line pl-6">
              {NEXT_STEPS.map(({ icon: Icon, title, body }, index) => (
                <motion.li
                  key={title}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.15 + index * 0.08, ease: ease.entrance }}
                  className="relative"
                >
                  {/* The marker straddles the rule: -left-6 puts it back at the
                      rule's x, then half its own width centres it on it. */}
                  <span className="absolute -left-6 top-0.5 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink-500">
                    <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <h3 className="font-display text-md font-bold text-ink-900">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500">{body}</p>
                </motion.li>
              ))}
            </ol>
          </div>

          {/* ---- reviews outstanding ------------------------------------
              NOT about the order just placed: a review needs the part in hand,
              so the gate is delivery and this order is minutes old. What can
              be true here is that an EARLIER order has arrived unreviewed, and
              somebody who has just finished a checkout is the likeliest person
              to spend a minute on it. Renders nothing when there is nothing
              outstanding, which is the common case for a new account. */}
          <ReviewPrompt
            className="mt-10 border-t border-line pt-8"
            title="While you are here, two minutes on a part you already have?"
          />

          {/* ---- while the warehouse picks it --------------------------- */}
          <div className="mt-10 border-t border-line pt-8">
            <h2 className="eyebrow mb-4 text-ink-400">While you are here</h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {ELSEWHERE.map(({ icon: Icon, to, title, body }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="group flex h-full flex-col rounded-lg border border-line bg-surface p-4 transition-[border-color] duration-snap ease-entrance hover:border-ink-200"
                  >
                    <span className="mb-2.5 flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="font-display text-md font-bold text-ink-900 group-hover:text-brand">
                      {title}
                    </span>
                    <span className="mt-1 text-xs leading-relaxed text-ink-500">{body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---- right column: the receipt ---------------------------------
            Sticky from lg so it stays beside the rail while the left column
            scrolls - it is the one thing a buyer comes back up the page to
            re-check. The drawn scene caps it and arrives after the check has
            finished stroking in, so the eye lands on the confirmation first
            and the illustration second. */}
        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2, ease: ease.entrance }}
          className="lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)]"
          aria-labelledby="order-summary-heading"
        >
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="border-b border-line bg-surface-2 px-5 py-5">
              <BrandScene variant="success" className="mx-auto max-w-[240px]" />
            </div>

            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
              <h2 id="order-summary-heading" className="font-display text-lg font-bold">
                Summary
              </h2>
              <p className="text-sm text-ink-500">
                Est. delivery <span className="font-medium text-ink-900">{date(eta)}</span>
              </p>
            </header>

            <ul className="divide-y divide-line">
              {data.items.map((item) => (
                <li key={item.sku} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 p-1.5">
                    <PartVisual product={item} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-md font-medium text-ink-900">
                      {item.name}
                    </span>
                    <span className="tnum block font-mono text-2xs text-ink-300">
                      {item.sku} · ×{item.qty}
                    </span>
                  </span>
                  <span className="tnum shrink-0 font-display text-md font-bold">
                    {money(item.lineTotal)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="space-y-2 border-t border-line bg-surface-2 px-5 py-4 text-md">
              <div className="flex justify-between">
                <dt className="text-ink-500">Subtotal</dt>
                <dd className="tnum font-medium text-ink-900">{money(data.subtotal)}</dd>
              </div>

              {data.bundleDiscount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ok">Bundle pricing</dt>
                  <dd className="tnum font-medium text-ok">−{money(data.bundleDiscount)}</dd>
                </div>
              )}
              {data.promoDiscount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ok">
                    {data.promo?.code ? (
                      <span className="font-mono text-sm">{data.promo.code}</span>
                    ) : (
                      'Offer applied'
                    )}
                  </dt>
                  <dd className="tnum font-medium text-ok">−{money(data.promoDiscount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-500">{data.deliveryMethod?.label ?? 'Shipping'}</dt>
                <dd className="tnum font-medium text-ink-900">
                  {data.shipping === 0 ? 'Free' : money(data.shipping)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">HST</dt>
                <dd className="tnum font-medium text-ink-900">{money(data.tax)}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-line pt-2.5">
                <dt className="font-display text-md font-bold text-ink-900">Total</dt>
                <dd className="tnum font-display text-xl font-bold text-ink-900">
                  {money(data.total)}
                </dd>
              </div>
            </dl>
          </div>
        </motion.aside>
      </div>
    </div>
  );
}

export default ThankYouPage;
