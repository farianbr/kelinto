import { useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowUpRight, ChevronLeft, ChevronRight, PenLine } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Stars from '@/components/ui/Stars';
import useBusinessInfo from '@/hooks/useBusinessInfo';

/**
 * The business's Google reviews, at the foot of every website page.
 *
 * What it is opened for: "are these people any good?" So the FIGURE leads - the
 * rating and how many people it comes from - and the cards are the evidence
 * under it. The cards are a row that scrolls sideways rather than a grid,
 * because the list is the owner's to grow and a grid of twenty cards would push
 * the location and the contact form off the end of every page.
 *
 * Entered by hand in the ERP (SEO › Reviews › Google); nothing here is verified
 * by us, which is why the section says where the reviews came from and links
 * there rather than presenting them as its own.
 */

/** "3 days ago" · "2 weeks ago" · "7 months ago" · "2 years ago", as Google prints them. */
function ageOf(value) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} ago`;
  if (days < 1) return 'Today';
  if (days < 7) return unit(days, 'day');
  if (days < 30) return unit(Math.floor(days / 7), 'week');
  if (days < 365) return unit(Math.max(1, Math.floor(days / 30)), 'month');
  return unit(Math.floor(days / 365), 'year');
}

// Past this a card's text is clamped and "Read more" opens it in place. Roughly
// five lines at card width; shorter reviews never show a control that does nothing.
const CLAMP_AT = 220;

function ReviewCard({ review }) {
  const [open, setOpen] = useState(false);
  const long = review.text.length > CLAMP_AT;
  const initial = review.authorName.trim().charAt(0).toUpperCase();

  return (
    <li className="flex w-[85%] shrink-0 snap-start flex-col rounded-xl border border-line bg-surface p-5 sm:w-[calc(50%-6px)] lg:w-[calc(33.333%-8px)] xl:w-[calc(25%-9px)]">
      <div className="flex items-center gap-3">
        {review.photoUrl ? (
          <img
            src={review.photoUrl}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            className="size-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          // A small circle takes an orb ramp (Instructions §2.2); the panel one,
          // because a 16px initial is text and the plain orb gives white 4.17:1.
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-gradient-orb-panel font-display text-md font-bold text-white"
            aria-hidden="true"
          >
            {initial}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{review.authorName}</p>
          <p className="text-sm text-ink-400">
            <time dateTime={new Date(review.reviewedAt).toISOString()}>{ageOf(review.reviewedAt)}</time>
          </p>
        </div>
      </div>

      <Stars rating={review.rating} size="md" className="mt-4" />

      <p className={cn('mt-3 text-md leading-relaxed text-ink-700', long && !open && 'line-clamp-5')}>
        {review.text}
      </p>

      {long && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cn(pressable, 'mt-2 self-start text-sm font-semibold text-brand hover:text-brand-700')}
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </li>
  );
}

export function GoogleReviewsSection({ data, className }) {
  const info = useBusinessInfo();
  const track = useRef(null);
  const reduce = useReducedMotion();

  const reviews = data?.reviews ?? [];
  const summary = data?.summary ?? { rating: 0, count: 0, url: '' };
  const hasSummary = summary.rating > 0 && summary.count > 0;

  // Nothing typed in yet: no section, rather than a heading over nothing.
  if (!reviews.length && !hasSummary) return null;

  function page(direction) {
    const element = track.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * 0.9, behavior: reduce ? 'auto' : 'smooth' });
  }

  return (
    <section aria-labelledby="google-reviews" className={cn('min-w-0', className)}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div>
          <p className="eyebrow mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-ink-400">
            <span className="size-1 rounded-full bg-brand" aria-hidden="true" />
            Reviews on Google
          </p>
          <h2 id="google-reviews" className="text-2xl tracking-[-0.03em] sm:text-3xl">
            What customers say
          </h2>
        </div>

        {/* The figure is the answer to the question the section is opened
            for, so it is the largest thing in the header. */}
        {hasSummary && (
          <div className="flex items-center gap-4">
            <p className="tnum font-display text-d-sm font-bold leading-none text-ink-900">
              {summary.rating.toFixed(1)}
            </p>
            <div>
              <Stars rating={summary.rating} size="md" />
              <p className="mt-1 text-sm text-ink-500">
                From {summary.count.toLocaleString('en-CA')} {summary.count === 1 ? 'review' : 'reviews'} on Google
              </p>
            </div>
          </div>
        )}
      </div>

      {reviews.length > 0 && (
        <div className="relative">
          <ul
            ref={track}
            className="-mx-3 flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:scroll-px-4 sm:px-4 lg:mx-0 lg:scroll-px-0 lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Google reviews"
          >
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </ul>
        </div>
      )}

      {/* Links out, and the paging arrows on a pointer device, on one quiet row
          under the cards: reading comes first, acting on it second. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {summary.url && (
            <a
              href={summary.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(pressable, 'inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700')}
            >
              See every review on Google
              <ArrowUpRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            </a>
          )}
          {info.reviewUrl && (
            <a
              href={info.reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(pressable, 'inline-flex items-center gap-1.5 text-sm font-semibold text-ink-700 hover:text-ink-900')}
            >
              <PenLine className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              Write a review
            </a>
          )}
        </div>

        {reviews.length > 1 && (
          <div className="hidden items-center gap-2 lg:flex">
            {[
              { direction: -1, icon: ChevronLeft, label: 'Earlier reviews' },
              { direction: 1, icon: ChevronRight, label: 'More reviews' },
            ].map(({ direction, icon: Icon, label }) => (
              <button
                key={direction}
                type="button"
                onClick={() => page(direction)}
                aria-label={label}
                className={cn(
                  pressable,
                  'flex size-10 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-700 hover:border-ink-300 hover:bg-surface-2',
                )}
              >
                <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default GoogleReviewsSection;
