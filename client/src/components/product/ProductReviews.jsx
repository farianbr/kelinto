import { BadgeCheck, MessageSquare } from 'lucide-react';
import cn from '@/lib/cn';
import { date } from '@/lib/format';
import Stars from '@/components/ui/Stars';

/**
 * What customers said about this part.
 *
 * Every review here was written by an account that BOUGHT the part on a
 * delivered order - the service will not write one otherwise - which is why the
 * verified mark is unconditional rather than a per-review flag. There is no
 * unverified review to distinguish it from.
 *
 * ## The summary is the section, not the list
 *
 * A buyer scanning this wants one number and a sense of the spread, and only
 * then the sentences. So the average and the distribution sit in their own
 * panel on the left at desktop width, and the reviews run beside them. At a
 * glance that answers "is this part any good"; the list answers "why".
 *
 * Renders nothing with no reviews. An empty "Reviews (0)" heading advertises
 * the gap on every page of a catalogue that is mostly new.
 */

/** One bar of the distribution: how many gave this many stars. */
function DistributionRow({ stars, count, total }) {
  const percent = total ? Math.round((count / total) * 100) : 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="tnum w-3 shrink-0 text-right text-ink-500">{stars}</span>
      {/* The track is the full width and the fill is the share, so five rows
          read as one chart rather than five unrelated bars. */}
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span
          className="block h-full rounded-full bg-brand-gradient-compact"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="tnum w-6 shrink-0 text-right text-ink-400">{count}</span>
    </div>
  );
}

export function ProductReviews({ reviews = [], average = 0, count = 0, noun = 'part', className }) {
  if (!count) return null;

  // How many gave each rating, for the distribution. Counted from what the
  // server sent, which is capped at 20: on a page with more than that the bars
  // describe the reviews shown rather than every one ever written, and the
  // heading below says so.
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: reviews.filter((review) => review.rating === stars).length,
  }));

  return (
    <section aria-labelledby="product-reviews" className={cn('min-w-0', className)}>
      <div className="mb-6">
        <p className="eyebrow mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-ink-400">
          <span className="size-1 rounded-full bg-brand" aria-hidden="true" />
          From buyers
        </p>
        <h2 id="product-reviews" className="text-2xl tracking-[-0.03em] sm:text-3xl">
          What customers said
        </h2>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6">
        {/* ---- the summary ------------------------------------------------ */}
        <aside className="lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)] lg:self-start">
          <div className="rounded-xl border border-line bg-surface-2 p-5">
            <p className="tnum font-display text-d-sm font-bold leading-none text-ink-900">
              {average.toFixed(1)}
            </p>
            <Stars rating={average} size="md" className="mt-2" />
            <p className="mt-2 text-sm text-ink-500">
              {count} {count === 1 ? 'review' : 'reviews'}
            </p>

            {reviews.length > 1 && (
              <div className="mt-4 space-y-1.5 border-t border-line pt-4">
                {distribution.map((row) => (
                  <DistributionRow
                    key={row.stars}
                    stars={row.stars}
                    count={row.count}
                    total={reviews.length}
                  />
                ))}
              </div>
            )}

            <p className="mt-4 flex items-start gap-1.5 border-t border-line pt-4 text-xs leading-relaxed text-ink-400">
              <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2.25} aria-hidden="true" />
              Every review here was written by an account that bought this {noun} and had it
              delivered.
            </p>
          </div>
        </aside>

        {/* ---- the reviews ------------------------------------------------- */}
        <ul className="min-w-0 space-y-3">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="font-display text-md font-bold text-ink-900">
                    {review.authorName}
                  </p>
                  {review.authorBusiness && (
                    <p className="truncate text-sm text-ink-400">{review.authorBusiness}</p>
                  )}
                </div>
                <Stars rating={review.rating} />
              </div>

              {review.title && (
                <p className="mt-3 font-display text-md font-bold text-ink-900">{review.title}</p>
              )}

              <p className="mt-2 text-md leading-relaxed text-ink-500">{review.body}</p>

              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
                <span className="inline-flex items-center gap-1 font-medium text-ok">
                  <BadgeCheck className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  Verified purchase
                </span>
                <span aria-hidden="true">·</span>
                {date(review.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {count > reviews.length && (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-ink-400">
          <MessageSquare className="size-3.5" strokeWidth={2} aria-hidden="true" />
          Showing the {reviews.length} most recent of {count}.
        </p>
      )}
    </section>
  );
}

export default ProductReviews;
