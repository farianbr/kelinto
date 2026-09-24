import { useState } from 'react';
import { Eye, EyeOff, ExternalLink, Search, Star } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { date } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import Stars from '@/components/ui/Stars';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Pagination from '@/components/ui/Pagination';
import PageHeader from '@/components/admin/PageHeader';
import Skeleton from '@/components/ui/Skeleton';
import useTablePage from '@/hooks/useTablePage';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminReviews, useAdminMutations } from '@/hooks/useAdmin';
import { useStorefrontUrl } from '@/hooks/useStorefrontUrl';

const PAGE_ICON = adminIcon('Star');

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
];

/**
 * SEO, product reviews.
 *
 * Reviews publish the moment a buyer writes one: these are approved wholesale
 * accounts who bought the part on a delivered order, not anonymous visitors, and
 * a moderation queue standing between them and the site is a queue somebody has
 * to work every day or reviews go stale in it.
 *
 * So this screen is the lever for the case that goes wrong rather than a gate
 * on the normal one. HIDE, not delete: the desk can see what it acted on, put
 * it back if it was a mistake, and answer a buyer who asks where their review
 * went.
 *
 * NOT A DATA TABLE. Everything else in the admin panel is rows of fields, but a
 * review is a paragraph of prose - the thing being judged is the writing, and a
 * table cell truncates exactly what has to be read to make the judgement. Cards
 * let the text be the row.
 */
export function AdminReviewsPage() {
  const storefrontUrl = useStorefrontUrl();
  const [q, setQ] = useState('');
  const [hidden, setHidden] = useState('');
  const [acting, setActing] = useState(null);

  const { data, isLoading } = useAdminReviews({ q, hidden });
  const { setReviewHidden } = useAdminMutations();

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? { visible: 0, hidden: 0 };

  const { pageRows, page, totalPages, setPage } = useTablePage(rows);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={PAGE_ICON}
        title="Product reviews"
        description="What buyers said, and the lever to hide one."
      />

      <Panel
        title="Reviews"
        description="Published on submission by accounts that bought the part."
        icon={Star}
        flush
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search part, author or words"
            icon={Search}
            className="w-full sm:w-72"
            aria-label="Search reviews"
          />

          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((filter) => {
              const count =
                filter.value === ''
                  ? counts.visible + counts.hidden
                  : (counts[filter.value] ?? 0);
              const active = hidden === filter.value;
              return (
                <button
                  key={filter.value || 'all'}
                  type="button"
                  onClick={() => setHidden(filter.value)}
                  aria-pressed={active}
                  className={cn(
                    pressable,
                    'rounded-md px-2.5 py-1.5 text-sm font-medium',
                    active
                      ? 'bg-surface-2 text-ink-900'
                      : 'text-ink-500 hover:bg-surface-2 hover:text-ink-900',
                  )}
                >
                  {filter.label}
                  <span className="tnum ml-1.5 text-xs text-ink-400">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <PanelEmpty
            icon={Star}
            title="No reviews yet"
            body={
              q
                ? 'Nothing matches that search.'
                : 'Reviews appear here as buyers write them, once an order has been delivered.'
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {pageRows.map((review) => (
                <li
                  key={review.id}
                  className={cn('p-4 sm:p-5', review.isHidden && 'bg-surface-2')}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Stars rating={review.rating} />
                        <span className="font-display text-md font-bold text-ink-900">
                          {review.authorName}
                        </span>
                        {review.authorBusiness && (
                          <span className="text-sm text-ink-400">{review.authorBusiness}</span>
                        )}
                        {review.isHidden && <Badge tone="danger">Hidden</Badge>}
                      </div>

                      <p className="mt-1 text-sm text-ink-400">
                        {review.productSlug ? (
                          <a
                            href={storefrontUrl(`/product/${review.productSlug}`)}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(pressable, 'inline-flex items-center gap-1 hover:text-brand')}
                          >
                            {review.productName}
                            <ExternalLink className="size-3" strokeWidth={2} aria-hidden="true" />
                          </a>
                        ) : (
                          review.productName
                        )}
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono text-xs">{review.productSku}</span>
                        <span aria-hidden="true"> · </span>
                        {date(review.createdAt)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setActing(review)}
                      className={cn(
                        pressable,
                        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink-700 hover:bg-surface-2',
                      )}
                    >
                      {review.isHidden ? (
                        <>
                          <Eye className="size-3.5" strokeWidth={2} aria-hidden="true" />
                          Restore
                        </>
                      ) : (
                        <>
                          <EyeOff className="size-3.5" strokeWidth={2} aria-hidden="true" />
                          Hide
                        </>
                      )}
                    </button>
                  </div>

                  {review.title && (
                    <p className="mt-3 font-display text-md font-bold text-ink-900">
                      {review.title}
                    </p>
                  )}
                  <p className="mt-1.5 text-md leading-relaxed text-ink-500">{review.body}</p>

                  {review.isHidden && review.hiddenReason && (
                    <p className="mt-2 text-xs text-ink-400">
                      Hidden: {review.hiddenReason}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            <Pagination
              page={page}
              pages={totalPages}
              onChange={setPage}
              hideWhenSingle
              className="border-t border-line px-3 py-3 sm:px-4"
            />
          </>
        )}
      </Panel>

      {/* Names the record and states the consequence, per Instructions 3.0.1.
          Hiding is reversible and does not move money or reach a third party,
          so it is one confirm rather than a typed phrase. */}
      <ConfirmDialog
        open={Boolean(acting)}
        onClose={() => setActing(null)}
        title={acting?.isHidden ? 'Put this review back on the site?' : 'Hide this review?'}
        body={
          acting
            ? acting.isHidden
              ? `The review by ${acting.authorName} will be visible again on ${acting.productName}, and will count toward its rating.`
              : `The review by ${acting.authorName} will be removed from ${acting.productName} and will stop counting toward its rating. It is kept here and can be restored.`
            : ''
        }
        confirmLabel={acting?.isHidden ? 'Restore review' : 'Hide review'}
        tone={acting?.isHidden ? 'brand' : 'danger'}
        loading={setReviewHidden.isPending}
        onConfirm={async () => {
          await setReviewHidden.mutateAsync({ id: acting.id, isHidden: !acting.isHidden });
          setActing(null);
        }}
      />
    </div>
  );
}

export default AdminReviewsPage;
