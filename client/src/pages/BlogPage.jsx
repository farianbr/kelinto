import useBusinessInfo from '@/hooks/useBusinessInfo';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, Clock, Newspaper, Search } from 'lucide-react';
import cn from '@/lib/cn';
import { date } from '@/lib/format';
import { BLOG_CATEGORIES } from '@shared/schemas/content';
import Input from '@/components/ui/Input';
import Chip from '@/components/ui/Chip';
import SelectMenu from '@/components/ui/SelectMenu';
import Skeleton from '@/components/ui/Skeleton';
import Pagination from '@/components/ui/Pagination';
import PostCover from '@/components/blog/PostCover';
import { useBlogPosts } from '@/hooks/useContent';
import useDebouncedValue from '@/hooks/useDebouncedValue';
import { pressable } from '@/lib/motion';

const LABELS = Object.fromEntries(BLOG_CATEGORIES.map((c) => [c.value, c.label]));

function PostMeta({ post, className }) {
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400', className)}>
      <span className="font-medium text-ink-500">{post.author.name}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={post.publishedAt ?? undefined}>{date(post.publishedAt)}</time>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        <Clock className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        {post.readMinutes} min read
      </span>
    </p>
  );
}

function CategoryTag({ value, className }) {
  return (
    <span
      className={cn(
        'eyebrow inline-flex h-6 items-center rounded-full border border-brand-100 bg-brand-50 px-2 text-brand-700',
        className,
      )}
    >
      {LABELS[value] ?? value}
    </span>
  );
}

function PostCard({ post }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-[border-color] duration-snap ease-entrance hover:border-ink-200">
      <PostCover post={post} className="shrink-0 border-b border-line" />

      <div className="flex flex-1 flex-col p-4">
        <CategoryTag value={post.category} className="mb-3 self-start" />

        <h2 className="text-lg leading-snug">
          {/* The whole card is not a link: the title is, so the accessible name
              is the title rather than the entire card's text. */}
          <Link to={`/blog/${post.slug}`} className={cn(pressable, ' hover:text-brand')}>
            {post.title}
          </Link>
        </h2>

        <p className="mt-2 line-clamp-3 flex-1 text-md leading-relaxed text-ink-500">
          {post.excerpt}
        </p>

        <PostMeta post={post} className="mt-4 border-t border-line pt-3" />
      </div>
    </article>
  );
}

function FeaturedPost({ post }) {
  return (
    <article className="group mb-8 overflow-hidden rounded-lg border border-line bg-surface transition-[border-color] duration-snap ease-entrance hover:border-ink-200 md:grid md:grid-cols-2 md:items-stretch">
      <PostCover post={post} ratio="aspect-16/10 md:aspect-auto md:h-full" className="md:min-h-[280px]" />

      <div className="flex flex-col justify-center p-5 lg:p-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="eyebrow inline-flex h-6 items-center rounded-full bg-brand-gradient-compact px-2.5 text-white">
            Latest
          </span>
          <CategoryTag value={post.category} />
        </div>

        <h2 className="text-2xl leading-tight lg:text-3xl">
          <Link to={`/blog/${post.slug}`} className={cn(pressable, ' hover:text-brand')}>
            {post.title}
          </Link>
        </h2>

        <p className="mt-3 text-md leading-relaxed text-ink-500">{post.excerpt}</p>

        <PostMeta post={post} className="mt-5" />

        <Link
          to={`/blog/${post.slug}`}
          className={cn(pressable, 'mt-5 inline-flex items-center gap-1.5 self-start text-md font-semibold text-brand hover:text-brand-700')}
        >
          Read the article
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

/**
 * The blog index.
 *
 * Category and search live in the URL, not in component state alone, so a
 * filtered index can be linked and survives the back button - the same rule the
 * shop's filters follow (PROJECT_INSTRUCTIONS.md §4.2).
 */
export function BlogPage() {
  const info = useBusinessInfo();
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  // Set by the tag links at the foot of an article.
  const tag = params.get('tag') ?? '';
  const page = Number(params.get('page')) || 1;

  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebouncedValue(search, 250);

  // Typing is local until it settles; only the settled value touches the URL,
  // so the history stack does not grow one entry per keystroke.
  //
  // The guard is load-bearing, not an optimisation: without it this fires once
  // on mount and clears `page`, so a shared link to /blog?page=2 would silently
  // land the reader on page 1.
  useEffect(() => {
    setParams(
      (previous) => {
        if ((previous.get('q') ?? '') === debounced) return previous;

        const next = new URLSearchParams(previous);
        if (debounced) next.set('q', debounced);
        else next.delete('q');
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [debounced, setParams]);

  const { data, isLoading, isFetching } = useBlogPosts({
    category: category || undefined,
    tag: tag || undefined,
    q: debounced || undefined,
    page: page > 1 ? page : undefined,
  });

  function setCategory(value) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set('category', value);
      else next.delete('category');
      next.delete('page');
      return next;
    });
  }

  function clearTag() {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('tag');
      next.delete('page');
      return next;
    });
  }

  function setPage(value) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value > 1) next.set('page', String(value));
      else next.delete('page');
      return next;
    });
  }

  const posts = data?.posts ?? [];
  const counts = Object.fromEntries((data?.categories ?? []).map((row) => [row.value, row.count]));

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-6 sm:px-4 lg:px-6 lg:py-10">
      <header className="mb-7 max-w-2xl">
        <p className="eyebrow mb-2 text-brand">{info.name} journal</p>
        <h1 className="text-3xl sm:text-d-sm">Workshop notes for repair businesses</h1>
        <p className="mt-3 text-md leading-relaxed text-ink-500">
          Grading standards, diagnostics, credit terms and what is moving in the catalogue
          written by the people who pick, test and ship the parts.
        </p>
      </header>

      {/* ---- filters -------------------------------------------------------
          Two presentations of one control. From `lg` the categories are a
          wrapping row of pills - wrapping, not scrolling, so a sixth category
          drops to a second line instead of off the edge. Below that they are a
          `SelectMenu`: on a 320px screen the pill row could only ever be a
          sideways scroll, which hides most of the categories behind a gesture
          nobody makes (§3.1). The menu is the one we draw ourselves rather than
          a native `<select>` - the platform sizes that popup itself and clips
          it against the viewport edge on a narrow screen, which is exactly what
          this control does not have room for. */}
      <div className="mb-7 flex flex-col gap-3 border-y border-line py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="lg:hidden">
          <SelectMenu
            size="md"
            align="left"
            srLabel="Filter by category"
            value={category}
            onChange={setCategory}
            options={[{ value: '', label: 'All posts' }, ...BLOG_CATEGORIES].map((option) => ({
              value: option.value,
              label: option.label,
              // A category with nothing published is absent from `counts`, and
              // a blank where every other row has a number reads as a loading
              // state rather than as "none".
              count: option.value ? (counts[option.value] ?? 0) : data?.total,
            }))}
          />
        </div>

        <div className="hidden gap-1.5 lg:flex lg:flex-wrap">
          {[{ value: '', label: 'All posts' }, ...BLOG_CATEGORIES].map((option) => {
            const isActive = category === option.value;
            const count = option.value ? counts[option.value] : data?.total;

            return (
              <button
                key={option.value || 'all'}
                type="button"
                onClick={() => setCategory(option.value)}
                aria-pressed={isActive}
                className={cn(
                  pressable,
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium',
                  isActive
                    ? 'border-brand bg-brand-50 text-brand-700'
                    : 'border-line bg-surface text-ink-500 hover:border-line-strong hover:text-ink-900',
                )}
              >
                {option.label}
                {count !== undefined && <span className="tnum text-xs text-ink-300">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2.5 lg:shrink-0">
          {tag && (
            <Chip label="Tag" value={tag} onRemove={clearTag} className="shrink-0" />
          )}
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search articles…"
            icon={Search}
            aria-label="Search articles"
            containerClassName="lg:w-[280px]"
          />
        </div>
      </div>

      {/* ---- results ------------------------------------------------------- */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-lg border border-line">
              <Skeleton className="aspect-16/10 rounded-none" />
              <div className="space-y-2.5 p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-3.5 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-line bg-surface py-16 text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-300">
            <Newspaper className="size-5" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h2 className="text-lg">Nothing published here yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-md text-ink-500">
            {debounced || category || tag
              ? 'No article matches that. Clear the filters to see everything.'
              : 'The first articles are being written. Check back shortly.'}
          </p>
          {(debounced || category || tag) && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                clearTag();
                setCategory('');
              }}
              className="mt-5 text-md font-semibold text-brand hover:text-brand-700"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className={cn('transition-opacity duration-200', isFetching && 'opacity-60')}>
          {data?.featured && <FeaturedPost post={data.featured} />}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts
              .filter((post) => post.id !== data?.featured?.id)
              .map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
          </div>

          {data?.pages > 1 && (
            <div className="mt-8">
              <Pagination page={data.page} pages={data.pages} onChange={setPage} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default BlogPage;
