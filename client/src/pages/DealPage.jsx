import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Clock,
  Lock,
  Play,
  ShieldCheck,
  Star,
} from 'lucide-react';
import api from '@/lib/api';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { money, date } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import Skeleton from '@/components/ui/Skeleton';
import Accordion from '@/components/ui/Accordion';
import CountdownTimer from '@/components/ui/CountdownTimer';
import Stars from '@/components/ui/Stars';
import RichText from '@/lib/richText';
import { PartVisual } from '@/components/product/PartFrame';
import GradeBadge from '@/components/product/GradeBadge';

/**
 * One exclusive deal, on a page of its own.
 *
 * An offer card in a list has to fit beside eleven others, so it gets a title,
 * a price and a button. A deal worth a page is one that needs ARGUING for - the
 * video, the pitch, what is actually in the box, what customers made of it -
 * and that is the whole difference between this and /offers.
 *
 * Every section renders only when it has content. An offer promoted to
 * exclusive before anybody wrote the FAQ is still a valid page rather than a
 * scaffold of empty headings, which is what makes this safe for an admin to
 * turn on.
 *
 * The offer is stored as a `combo` carrying a SINGLE item. That is what gives
 * it a real `bundlePrice` the pricing service already knows how to charge, and
 * it checks out through `/cart/bundles` like every other offer - a second way
 * to buy one product would be a second place for a price to be decided, and
 * there is exactly one of those.
 *
 * **The button is Checkout, not Add to cart** (client ruling, 2026-10-01). A
 * deal page argues for ONE purchase; dropping the buyer back into a basket
 * once they are convinced asks them to decide twice. It still goes through the
 * cart, the only road to an order, and adds the deal only when the cart does
 * not already hold it, so coming back from checkout and pressing it again does
 * not buy two.
 */
export function DealPage() {
  const { slug } = useParams();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  const isApproved = user?.status === 'approved';
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['offer', slug],
    queryFn: () => api.get(`/offers/${slug}`),
    select: (payload) => payload.offer ?? payload,
    retry: false,
  });

  useDocumentTitle(data?.title);

  const checkout = useMutation({
    mutationFn: async () => {
      const { cart } = await api.get('/cart');
      const held = (cart?.bundles ?? []).some((bundle) => bundle.slug === slug);
      if (!held) await api.post('/cart/bundles', { offer: slug, qty: 1 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      navigate('/checkout');
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-8">
        <Skeleton className="mb-4 h-10 w-2/3" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Skeleton className="aspect-video rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl">That deal is not running</h1>
        <p className="mt-3 text-md text-ink-500">
          It may have ended, or the link may be wrong.
        </p>
        <Link
          to="/offers"
          className="mt-6 inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700"
        >
          See what is running now
          <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const endsAt = data.endsAt ? new Date(data.endsAt) : null;
  const expired = endsAt ? endsAt.getTime() <= Date.now() : false;
  // An exclusive deal is ONE product. The offer is still stored as a combo
  // carrying a single item, because that is what gives it a bundle price the
  // pricing service already knows how to charge - so the product arrives in the
  // same `products` array every combo uses, and this page reads the first of it.
  const product = data.products?.[0] ?? null;
  const reviews = data.reviews ?? [];
  const faqs = data.faqs ?? [];
  const highlights = data.highlights ?? [];

  const averageRating = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : 0;

  const unavailable = data.available === false;
  const canBuy = isApproved && !expired && !unavailable;

  return (
    <div className="mx-auto max-w-[1200px] px-3 py-6 sm:px-4 lg:px-6 lg:py-8">
      {/* ---- title and timer --------------------------------------------
          The clock is the reason this page exists rather than a catalogue
          entry, so it sits WITH the title rather than down beside the button:
          the deadline is part of the claim, not a detail of the transaction. */}
      <header className="overflow-hidden rounded-xl border border-line bg-surface px-5 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 max-w-2xl">
            <p className="eyebrow text-brand">{data.badge || 'Exclusive deal'}</p>
            <h1 className="mt-2.5 font-display text-2xl font-bold leading-tight text-ink-900 sm:text-d-sm">
              {data.title}
            </h1>
            {(data.subtitle || data.description) && (
              <p className="mt-3 text-md leading-relaxed text-ink-500">
                {data.subtitle || data.description}
              </p>
            )}

            {reviews.length > 0 && (
              <p className="mt-4 flex items-center gap-2 text-sm text-ink-500">
                <Stars rating={averageRating} />
                <span className="tnum">
                  {averageRating.toFixed(1)} from {reviews.length}{' '}
                  {reviews.length === 1 ? 'review' : 'reviews'}
                </span>
              </p>
            )}
          </div>

          {endsAt && !expired && (
            <div className="shrink-0">
              <p className="eyebrow mb-2 flex items-center gap-1.5 text-ink-400">
                <Clock className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                Offer ends in
              </p>
              <CountdownTimer endsAt={endsAt} />
            </div>
          )}

          {expired && (
            <p className="shrink-0 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-md font-semibold text-ink-700">
              This deal ended {date(endsAt)}
            </p>
          )}
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* ---- left: video, pitch, contents, reviews, FAQ ---------------- */}
        <div className="min-w-0 space-y-10">
          <section aria-label="Deal video">
            {data.videoUrl ? (
              /* `controls` and nothing else: no autoplay, no loop, no muted
                 auto-start. A video that begins on its own is the single most
                 complained-about thing on a page like this, and a buyer who
                 wants it presses the button. */
              <div className="overflow-hidden rounded-xl border border-line bg-ink-900">
                <video
                  className="aspect-video w-full"
                  controls
                  preload="metadata"
                  poster={data.videoPoster || undefined}
                  src={data.videoUrl}
                >
                  Your browser cannot play this video.
                </video>
              </div>
            ) : (
              /* The frame, with no file behind it yet. Deliberately NOT a
                 `<video>` pointed at nothing: a dead `src` paints a black box
                 with a scrubber stuck at 0:00, which reads as a broken player
                 rather than as a slot waiting to be filled.

                 So it says what it is. The part's own visual sits behind it at
                 low contrast so the frame is about THIS deal rather than a grey
                 rectangle, and the label names the state plainly - an admin
                 seeing this knows the page is finished and the file is not. */
              <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-ink-900">
                {/* No product ghost behind this. `PartVisual` paints its own
                    plate, so dropped to 7% opacity it did not read as a
                    watermark - it read as a grey rectangle sitting in the
                    middle of the frame, which is the exact "panel built from
                    defaults" defect the design rule names. The empty surface
                    with a dashed edge says "nothing here yet" on its own. */}
                {/* A soft brand wash off one corner, so the panel has depth
                    rather than being a flat black rectangle. Low enough that
                    the white text over it stays well clear of the contrast
                    floor - this is a tint on a dark ground, not a gradient
                    surface carrying small text (§2.2). */}
                <span
                  className="pointer-events-none absolute -left-1/4 -top-1/2 size-[150%] rounded-full bg-brand/20 blur-3xl"
                  aria-hidden="true"
                />

                <span className="relative flex flex-col items-center gap-3 px-6 text-center">
                  <span className="flex size-14 items-center justify-center rounded-full bg-brand-gradient-orb shadow-lg">
                    <Play
                      className="size-6 translate-x-0.5 text-white"
                      strokeWidth={2.25}
                      fill="currentColor"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="font-display text-lg font-bold text-white">
                    Product walkthrough
                  </span>
                  <span className="max-w-[34ch] text-sm leading-relaxed text-white/60">
                    A short video of this part being fitted and tested is being cut for this
                    listing.
                  </span>
                </span>
              </div>
            )}
          </section>

          {data.pitch && (
            <section aria-labelledby="deal-pitch">
              <h2 id="deal-pitch" className="font-display text-xl font-bold text-ink-900">
                What this is
              </h2>
              {/* Admin-authored copy always goes through RichText. There is no
                  dangerouslySetInnerHTML anywhere in this project. */}
              <div className="mt-3">
                <RichText>{data.pitch}</RichText>
              </div>
            </section>
          )}

          {/* ---- the product --------------------------------------------
              One product, shown at the size where a buyer can check the grade
              and the SKU against what they already stock - which is the whole
              question on a page like this, since the part is not new to them
              and only the price is. A list would be the wrong shape for a
              single row, so this is a panel. */}
          {product && (
            <section aria-labelledby="deal-product">
              <h2 id="deal-product" className="font-display text-xl font-bold text-ink-900">
                What you are buying
              </h2>

              <div className="mt-4 flex flex-wrap items-center gap-5 rounded-xl border border-line bg-surface p-5">
                <span className="flex size-28 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 p-3">
                  <PartVisual product={product} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="eyebrow text-ink-300">{product.partTypeLabel}</p>
                  <h3 className="mt-1 font-display text-lg font-bold text-ink-900">
                    <Link
                      to={`/product/${product.slug}`}
                      className={cn(pressable, 'hover:text-brand')}
                    >
                      {product.name}
                    </Link>
                  </h3>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <GradeBadge grade={product.grade} />
                    <span className="tnum font-mono text-2xs text-ink-300">{product.sku}</span>
                  </div>

                  <Link
                    to={`/product/${product.slug}`}
                    className={cn(pressable, 'mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-700')}
                  >
                    Full specification
                    <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </section>
          )}

          {/* ---- reviews ------------------------------------------------- */}
          {reviews.length > 0 && (
            <section aria-labelledby="deal-reviews">
              <h2 id="deal-reviews" className="font-display text-xl font-bold text-ink-900">
                What customers said
              </h2>
              <ul className="mt-4 space-y-3">
                {reviews.map((review, index) => (
                  <li
                    key={`${review.author}-${index}`}
                    className="rounded-xl border border-line bg-surface p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-display text-md font-bold text-ink-900">
                          {review.author}
                        </p>
                        {review.business && (
                          <p className="text-sm text-ink-400">{review.business}</p>
                        )}
                      </div>
                      <Stars rating={review.rating} />
                    </div>

                    <p className="mt-3 text-md leading-relaxed text-ink-500">{review.body}</p>

                    {review.verified && (
                      <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-ok">
                        <BadgeCheck className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                        Verified purchase
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ---- FAQ ----------------------------------------------------- */}
          {faqs.length > 0 && (
            <section aria-labelledby="deal-faq">
              <h2 id="deal-faq" className="font-display text-xl font-bold text-ink-900">
                Questions about this deal
              </h2>
              <div className="mt-4">
                {/* `Accordion` reads {question, answer} and renders the answer
                    through RichText itself, so the FAQ shape goes straight in. */}
                <Accordion
                  items={faqs.map((faq, index) => ({ ...faq, id: `deal-faq-${index}` }))}
                  reveal={false}
                />
              </div>
            </section>
          )}
        </div>

        {/* ---- right: the price and the button -------------------------
            Sticky, because on a page this long the decision has to stay
            reachable from wherever the reader got convinced. */}
        <aside className="lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)]" aria-labelledby="deal-buy">
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="border-b border-line p-5">
              <h2 id="deal-buy" className="eyebrow text-ink-400">
                Offer price
              </h2>

              {data.priceVisible ? (
                <>
                  <p className="mt-2 flex flex-wrap items-baseline gap-2.5">
                    <span className="tnum font-display text-d-sm font-bold text-ink-900">
                      {money(data.bundlePrice)}
                    </span>
                    {data.regularTotal > data.bundlePrice && (
                      <span className="tnum text-lg text-ink-400 line-through">
                        {money(data.regularTotal)}
                      </span>
                    )}
                  </p>

                  {data.savings > 0 && (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-1 text-sm font-semibold text-ok">
                      Save {money(data.savings)}
                      {data.savingsPercent > 0 && ` · ${data.savingsPercent}%`}
                    </p>
                  )}
                </>
              ) : (
                /* The gate, stated rather than blurred. A blurred number tells
                   a reader there IS a number and dares them to find it; this
                   says what to do instead. */
                <div className="mt-3 rounded-lg border border-line bg-surface-2 p-4">
                  <p className="flex items-center gap-2 font-display text-md font-bold text-ink-700">
                    <Lock className="size-4 shrink-0 text-ink-300" strokeWidth={2} aria-hidden="true" />
                    Pricing is for approved accounts
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                    {isAuthenticated
                      ? 'Your account is still under review. Pricing appears here as soon as it is approved.'
                      : 'Open a wholesale account to see offer pricing, usually within one business day.'}
                  </p>
                  {!isAuthenticated && (
                    <Link
                      to="/contact"
                      className={cn(pressable, 'mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-700')}
                    >
                      Open an account
                      <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* ---- the action ------------------------------------------ */}
            <div className="p-5">
              <button
                type="button"
                disabled={!canBuy || checkout.isPending}
                onClick={() => checkout.mutate()}
                className={cn(
                  pressable,
                  'flex h-12 w-full items-center justify-center gap-2 rounded-lg font-display text-md font-semibold transition-[filter]',
                  canBuy
                    ? 'bg-brand-gradient text-white hover:brightness-110'
                    : 'cursor-not-allowed border border-line bg-surface-2 text-ink-300',
                )}
              >
                {expired ? (
                  'This deal has ended'
                ) : unavailable ? (
                  'Temporarily unavailable'
                ) : !isAuthenticated ? (
                  'Sign in to order'
                ) : !isApproved ? (
                  'Pending approval'
                ) : checkout.isPending ? (
                  'Opening checkout…'
                ) : (
                  <>
                    Checkout
                    <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
                  </>
                )}
              </button>

              {checkout.isError && (
                <p role="alert" className="mt-3 text-sm leading-relaxed text-danger">
                  {checkout.error?.message || 'The deal could not be added to your cart.'}
                </p>
              )}

              {unavailable && !expired && (
                <p className="mt-3 text-sm leading-relaxed text-warn">
                  This part is out of stock, so the offer is off sale until it is
                  back. We do not take orders against stock we cannot ship.
                </p>
              )}

              {/* ---- highlights ---------------------------------------- */}
              {highlights.length > 0 && (
                <ul className="mt-5 space-y-2.5 border-t border-line pt-5">
                  {highlights.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm text-ink-500">
                      <Check
                        className="mt-0.5 size-4 shrink-0 text-ok"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {data.terms && (
              <p className="border-t border-line bg-surface-2 px-5 py-4 text-xs leading-relaxed text-ink-400">
                <ShieldCheck
                  className="mr-1.5 inline size-3.5 align-[-2px] text-ink-300"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                {data.terms}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** A rating, as five glyphs plus the number for anybody not counting stars. */
export default DealPage;
