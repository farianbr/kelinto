import { useEffect, useState } from 'react';
import { Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Pencil, Plus, Save, Star, Trash2 } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { date } from '@/lib/format';
import { googleReviewSchema, googleSummarySchema } from '@shared/schemas/content';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Stars from '@/components/ui/Stars';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Skeleton from '@/components/ui/Skeleton';
import AssetUpload from '@/components/admin/AssetUpload';
import useAdminForm from '@/hooks/useAdminForm';
import useUploadSession from '@/hooks/useUploadSession';
import { useAdminGoogleReviews, useAdminMutations } from '@/hooks/useAdmin';

/**
 * SEO › Reviews › Google: the business's Google reviews, copied in by hand, and
 * the rating line above them. What the website shows in the Reviews section at
 * the foot of every page (client ruling 2026-09-30: hand-entered first).
 *
 * The summary comes first and is three fields, because it is the one thing on
 * the website a visitor reads before any single review, and it goes stale
 * faster than the reviews do - every new review on Google moves the count.
 */

const RATING_OPTIONS = [5, 4, 3, 2, 1].map((value) => ({
  value,
  label: `${value} ${value === 1 ? 'star' : 'stars'}`,
}));

/** `yyyy-mm-dd` for a date input, from whatever the server sent. */
function dayOf(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function SummaryForm({ summary }) {
  const { saveGoogleSummary } = useAdminMutations();
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, reset, formState } = useAdminForm({
    resolver: zodResolver(googleSummarySchema),
    defaultValues: { rating: '', count: '', url: '' },
  });

  useEffect(() => {
    if (!summary || formState.isDirty) return;
    reset({ rating: summary.rating || '', count: summary.count || '', url: summary.url ?? '' });
  }, [summary, formState.isDirty, reset]);

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        setSaved(false);
        const { summary: next } = await saveGoogleSummary.mutateAsync(values);
        reset({ rating: next.rating || '', count: next.count || '', url: next.url ?? '' });
        setSaved(true);
      })}
    >
      <div className="grid gap-4 sm:grid-cols-[8rem_8rem_minmax(0,1fr)]">
        <Input
          label="Rating"
          inputMode="decimal"
          error={formState.errors.rating?.message}
          {...register('rating')}
        />
        <Input
          label="Reviews"
          inputMode="numeric"
          error={formState.errors.count?.message}
          {...register('count')}
        />
        <Input
          label="Link to your reviews on Google"
          placeholder="https://g.page/r/…"
          error={formState.errors.url?.message}
          {...register('url')}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button type="submit" icon={Save} size="sm" loading={saveGoogleSummary.isPending}>
          Save rating
        </Button>
        <p className="text-sm text-ink-400">
          {saveGoogleSummary.error?.message ??
            (saved ? 'Saved.' : 'Copy both figures from your Google profile. Zero hides the rating line.')}
        </p>
      </div>
    </form>
  );
}

function ReviewForm({ review, onSubmit, onCancel, isPending, error }) {
  const uploads = useUploadSession();
  const { register, handleSubmit, control, watch, formState } = useAdminForm({
    resolver: zodResolver(googleReviewSchema),
    defaultValues: {
      authorName: review?.authorName ?? '',
      photoUrl: review?.photoUrl ?? '',
      rating: review?.rating ?? 5,
      text: review?.text ?? '',
      reviewedAt: dayOf(review?.reviewedAt),
      isPublished: review?.isPublished ?? true,
      order: review?.order ?? 0,
    },
  });
  const text = watch('text');

  function cancel() {
    uploads.discardAll();
    onCancel();
  }

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(values, () => uploads.settle()))}
      className="space-y-4"
    >
      {error && (
        <p role="alert" className="flex items-start gap-2 border-l-2 border-danger px-3 py-1 text-sm text-ink-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Input
          label="Name on Google"
          error={formState.errors.authorName?.message}
          data-autofocus
          required
          {...register('authorName')}
        />
        <Input
          label="Posted on"
          type="date"
          error={formState.errors.reviewedAt?.message}
          required
          {...register('reviewedAt')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start">
        <SelectField control={control} name="rating" label="Stars" options={RATING_OPTIONS} />
        <Controller
          name="photoUrl"
          control={control}
          render={({ field }) => (
            <AssetUpload
              label="Photo"
              endpoint="marketing"
              kind="review-photo"
              shape="square"
              placeholder="Initial"
              hint="Optional. Without one the website shows their initial."
              value={field.value}
              onChange={(url) => field.onChange(url)}
              session={uploads}
            />
          )}
        />
      </div>

      <Textarea
        label="What they wrote"
        rows={6}
        value={text}
        counter={2000}
        error={formState.errors.text?.message}
        required
        {...register('text')}
      />

      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <Input label="Sort order" inputMode="numeric" hint="Lower numbers show first; ties show newest first." {...register('order')} />
        <Checkbox label="Show on the website" className="-ml-2 mb-2.5" {...register('isPublished')} />
      </div>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {review ? 'Save review' : 'Add review'}
        </Button>
      </div>
    </form>
  );
}

export function GoogleReviewsPanel() {
  const { data, isLoading } = useAdminGoogleReviews();
  const { createGoogleReview, updateGoogleReview, deleteGoogleReview } = useAdminMutations();
  const [editing, setEditing] = useState(null); // a review, or 'new'
  const [deleting, setDeleting] = useState(null);

  const reviews = data?.reviews ?? [];
  const shown = reviews.filter((review) => review.isPublished).length;

  return (
    <>
      <Panel
        title="Google rating"
        description="The line above the reviews: “4.7 from 137 reviews on Google”."
        icon={Star}
      >
        {isLoading ? <Skeleton className="h-20" /> : <SummaryForm summary={data?.summary} />}
      </Panel>

      <Panel
        title="Google reviews"
        description={`${shown} of ${reviews.length} shown on the website`}
        icon={Star}
        action={
          <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
            Add review
          </Button>
        }
        flush
      >
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <PanelEmpty
            icon={Star}
            title="No Google reviews yet"
            body="Copy your best reviews from your Google profile. The Reviews section stays off the website until there is one."
          />
        ) : (
          <ul className="divide-y divide-line">
            {reviews.map((review) => (
              <li key={review.id} className={cn('flex gap-3 p-4 sm:p-5', !review.isPublished && 'bg-surface-2')}>
                {review.photoUrl ? (
                  <img
                    src={review.photoUrl}
                    alt=""
                    width={36}
                    height={36}
                    loading="lazy"
                    className="size-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 font-display text-sm font-bold text-ink-700"
                    aria-hidden="true"
                  >
                    {review.authorName.charAt(0).toUpperCase()}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-display text-md font-bold text-ink-900">{review.authorName}</span>
                    <Stars rating={review.rating} />
                    <span className="text-sm text-ink-400">{date(review.reviewedAt)}</span>
                    {!review.isPublished && <Badge tone="warn">Not shown</Badge>}
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-md leading-relaxed text-ink-500">{review.text}</p>
                </div>

                <div className="flex shrink-0 items-start gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(review)}
                    className={cn(pressable, 'rounded-md p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900')}
                    aria-label={`Edit the review by ${review.authorName}`}
                  >
                    <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(review)}
                    className={cn(pressable, 'rounded-md p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger')}
                    aria-label={`Delete the review by ${review.authorName}`}
                  >
                    <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add a Google review' : 'Edit Google review'}
        size="lg"
        align="top"
      >
        {editing && (
          <ReviewForm
            review={editing === 'new' ? null : editing}
            isPending={createGoogleReview.isPending || updateGoogleReview.isPending}
            error={(createGoogleReview.error ?? updateGoogleReview.error)?.message}
            onCancel={() => setEditing(null)}
            onSubmit={(values, settle) => {
              const options = {
                onSuccess: () => {
                  settle();
                  setEditing(null);
                },
              };
              if (editing === 'new') createGoogleReview.mutate(values, options);
              else updateGoogleReview.mutate({ id: editing.id, ...values }, options);
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this Google review?"
        body={
          deleting
            ? `The review by ${deleting.authorName} comes off every page of the website and cannot be recovered here. It stays on Google.`
            : ''
        }
        confirmLabel="Delete review"
        confirmPhrase={deleting ? 'delete' : undefined}
        confirmPhraseLabel="the word delete"
        tone="danger"
        loading={deleteGoogleReview.isPending}
        error={deleteGoogleReview.error?.message}
        onConfirm={() => deleteGoogleReview.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </>
  );
}

export default GoogleReviewsPanel;
