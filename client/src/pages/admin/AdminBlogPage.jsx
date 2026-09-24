import { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  ExternalLink,
  Eye,
  Newspaper,
  Pencil,
  Pen,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { date } from '@/lib/format';
import { BLOG_CATEGORIES, blogPostSchema } from '@shared/schemas/content';
import RichText from '@/lib/richText';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import AuthorFields from '@/components/admin/AuthorFields';
import SelectMenu from '@/components/ui/SelectMenu';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import Skeleton from '@/components/ui/Skeleton';
import PostCover from '@/components/blog/PostCover';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminBlog, useAdminBlogPost, useAdminMutations } from '@/hooks/useAdmin';
import { useStorefrontUrl } from '@/hooks/useStorefrontUrl';

const STATUS_FILTERS = [
  { value: 'all', label: 'All posts' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
];

const CATEGORY_OPTIONS = BLOG_CATEGORIES.map((category) => ({
  value: category.value,
  label: category.label,
}));

const CATEGORY_LABELS = Object.fromEntries(BLOG_CATEGORIES.map((c) => [c.value, c.label]));

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft - not on the site' },
  { value: 'published', label: 'Published - live on /blog' },
];

const BODY_HELP = `## Heading      ### Subheading      - bullet      1. numbered      > note      **bold**      \`code\``;

/** `2026-08-23` for a date input, from whatever the API sent. */
function toDateInput(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

/**
 * Post editor.
 *
 * The body is a plain textarea with a preview tab rather than a rich-text
 * widget: what is stored is the small markup vocabulary in `lib/richText.jsx`,
 * which renders to React nodes and never to HTML. A WYSIWYG here would produce
 * markup the renderer cannot represent - and an author who has no idea their
 * formatting was dropped on save.
 */
function PostForm({ post, onSubmit, onCancel, isPending, error }) {
  const [tab, setTab] = useState('write');

  const { register, handleSubmit, watch, formState, control } = useAdminForm({
    /*
      The shared schema, with the one field the form shapes differently.

      Tags are typed as a comma-separated string and split on submit, so the
      array `blogPostSchema` describes is swapped for the string this form
      holds. The inline `required` rules these fields used to carry only
      checked for emptiness; the schema also enforces the lengths the server
      enforces, so a title the API would refuse is now caught here instead of
      coming back as a banner.
    */
    resolver: zodResolver(
      blogPostSchema.omit({ tags: true }).extend({
        tagList: z.string().trim().max(300).optional().or(z.literal('')),
      }),
    ),
    defaultValues: {
      title: post?.title ?? '',
      excerpt: post?.excerpt ?? '',
      body: post?.body ?? '',
      category: post?.category ?? BLOG_CATEGORIES[0].value,
      tagList: (post?.tags ?? []).join(', '),
      coverImage: post?.coverImage ?? '',
      authorName: post?.author?.name ?? 'Cellvix',
      authorRole: post?.author?.role ?? '',
      authorBio: post?.author?.bio ?? '',
      authorPhoto: post?.author?.photo ?? '',
      authorLinkedin: post?.author?.links?.linkedin ?? '',
      authorX: post?.author?.links?.x ?? '',
      authorFacebook: post?.author?.links?.facebook ?? '',
      authorWebsite: post?.author?.links?.website ?? '',
      status: post?.status ?? 'draft',
      publishedAt: toDateInput(post?.publishedAt),
      isFeatured: post?.isFeatured ?? false,
    },
  });

  const body = watch('body');
  const status = watch('status');

  return (
    <form
      onSubmit={handleSubmit((values) => {
        const { tagList, ...rest } = values;
        onSubmit({
          ...rest,
          tags: tagList
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 8),
        });
      })}
      className="space-y-4"
    >
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Input
        label="Title"
        placeholder="How to grade a pull screen before you fit it"
        error={formState.errors.title?.message}
        data-autofocus
        required
        {...register('title')}
      />

      <Textarea
        label="Excerpt"
        rows={2}
        value={watch('excerpt')}
        counter={320}
        hint="One or two sentences. Shown on the index and under the headline."
        error={formState.errors.excerpt?.message}
        required
        {...register('excerpt')}
      />

      {/* ---- body: write / preview ---------------------------------------- */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink-700">Body</span>
          <div className="flex rounded-md border border-line p-0.5">
            {[
              { key: 'write', label: 'Write', icon: Pen },
              { key: 'preview', label: 'Preview', icon: Eye },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={cn(
                  pressable,
                  'inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium',
                  tab === key
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-400 hover:bg-surface-2 hover:text-ink-900',
                )}
              >
                <Icon className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Both panes stay mounted; the inactive one is hidden rather than
            unmounted, so switching to Preview and back cannot lose the caret
            position or an in-flight undo stack in the textarea. */}
        <div className={tab === 'write' ? '' : 'hidden'}>
          <Textarea
            rows={16}
            className="font-mono text-sm"
            value={body}
            hint={BODY_HELP}
            error={formState.errors.body?.message}
            {...register('body')}
          />
        </div>

        {tab === 'preview' && (
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-line bg-surface-2 px-4 py-3">
            {body?.trim() ? (
              <RichText>{body}</RichText>
            ) : (
              <p className="py-8 text-center text-sm text-ink-300">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="category"
          label="Category"
          options={CATEGORY_OPTIONS}
        />
        <Input
          label="Tags"
          placeholder="grading, screens, quality"
          hint="Comma separated, up to eight."
          {...register('tagList')}
        />
      </div>

      <AuthorFields register={register} formState={formState} />

      <Input
        label="Cover image URL"
        placeholder="Leave blank for the drawn category cover"
        hint="Optional. Without one, the index draws a technical cover for this category."
        {...register('coverImage')}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField control={control} name="status" label="Status" options={STATUS_OPTIONS} />
        <Input
          label="Publish date"
          type="date"
          hint={
            status === 'published'
              ? 'Blank publishes with today’s date.'
              : 'Only used once the post is published.'
          }
          {...register('publishedAt')}
        />
      </div>

      <Checkbox
        label="Feature this post at the top of the blog"
        className="-ml-2"
        {...register('isFeatured')}
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {post ? 'Save changes' : 'Create post'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Loads the full post before rendering the form.
 *
 * The list payload deliberately omits `body` - nine articles of prose to render
 * nine cards - so editing an existing post needs one more request. Creating a
 * new one needs none.
 */
function PostEditor({ editingId, onSubmit, onCancel, isPending, error }) {
  const isNew = editingId === 'new';
  const { data: post, isLoading } = useAdminBlogPost(isNew ? null : editingId);

  if (!isNew && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11" />
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <PostForm
      post={isNew ? null : post}
      onSubmit={onSubmit}
      onCancel={onCancel}
      isPending={isPending}
      error={error}
    />
  );
}

/**
 * Header metadata read from the same table the breadcrumb uses, so a page
 * title can never drift from its crumb.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/marketing/blog'], icon: adminIcon('Newspaper') };

export function AdminBlogPage() {
  const storefrontUrl = useStorefrontUrl();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editingId, setEditingId] = useState(null); // post id, or 'new'
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading } = useAdminBlog({
    status: status === 'all' ? undefined : status,
    q: query || undefined,
  });
  const { createPost, updatePost, deletePost } = useAdminMutations();

  const posts = data?.posts ?? [];

  // A page of rows for the table; counts and tiles still read the full set.
  const { pageRows: pagePosts, page, totalPages, from, setPage } = useTablePage(posts);

  /**
   * The columns.
   *
   * The list put the cover, three badges, the title, the excerpt and a
   * four-part metadata line into every row, which made a row 100px tall and
   * meant six posts filled the screen. Worse, the four metadata facts
   * author, read time, publish date, updated date - were run together into one
   * sentence separated by middots, so comparing when two posts were published
   * meant reading two sentences and finding the third clause in each.
   *
   * The cover stays: for a blog the image IS part of what identifies a post,
   * unlike the answer text on an FAQ entry. Everything else becomes a column
   * that can be sorted and compared down the page.
   */
  const columns = [
    {
      key: 'cover',
      header: '',
      width: '76px',
      sortable: false,
      render: (post) => (
        <PostCover post={post} ratio="aspect-4/3" className="w-14 rounded-md border border-line" />
      ),
    },
    {
      key: 'title',
      header: 'Post',
      width: '40%',
      render: (post) => (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate font-medium text-ink-900">{post.title}</p>
            {post.isFeatured && (
              <Star
                className="size-3.5 shrink-0 text-brand"
                strokeWidth={2.25}
                aria-label="Featured"
              />
            )}
          </div>
          <p className="truncate text-xs text-ink-400">{post.excerpt}</p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      width: '15%',
      priority: 2,
      sortValue: (post) => CATEGORY_LABELS[post.category] ?? post.category,
      render: (post) => (
        <span className="text-sm text-ink-700">
          {CATEGORY_LABELS[post.category] ?? post.category}
        </span>
      ),
    },
    {
      key: 'author',
      header: 'Author',
      width: '14%',
      priority: 3,
      sortValue: (post) => post.author.name,
      render: (post) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-700">{post.author.name}</p>
          <p className="tnum text-xs text-ink-400">{post.readMinutes} min read</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '14%',
      sortValue: (post) => post.status,
      render: (post) => (
        <div className="min-w-0">
          <Badge tone={post.status === 'published' ? 'ok' : 'warn'} size="sm">
            {post.status === 'published' ? 'Live' : 'Draft'}
          </Badge>
          <p className="tnum truncate text-xs text-ink-400">
            {post.publishedAt ? date(post.publishedAt) : 'No publish date'}
          </p>
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: '11%',
      priority: 2,
      sortValue: (post) => new Date(post.updatedAt).getTime(),
      render: (post) => <span className="tnum text-sm text-ink-500">{date(post.updatedAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '112px',
      align: 'right',
      sortable: false,
      render: (post) => (
        <div className="flex justify-end gap-1">
          {post.status === 'published' && (
            <a
              href={storefrontUrl(`/blog/${post.slug}`)}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              aria-label={`View “${post.title}” on the site`}
              className={cn(
              pressable,
              'flex size-8 items-center justify-center rounded-md text-ink-400 hover:bg-surface-2 hover:text-ink-900',
              )}
            >
              <ExternalLink className="size-4" strokeWidth={2} />
            </a>
          )}
          <button
            type="button"
            onClick={(event) => {
              // The row opens the editor, so a click landing on this button
              // must not fire the row's handler behind it as well.
              event.stopPropagation();
              setEditingId(post.id);
            }}
            aria-label={`Edit “${post.title}”`}
            className={cn(
            pressable,
            'flex size-8 items-center justify-center rounded-md text-ink-400 hover:bg-surface-2 hover:text-ink-900',
            )}
          >
            <Pencil className="size-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setDeleting(post);
            }}
            aria-label={`Delete “${post.title}”`}
            className={cn(
            pressable,
            'flex size-8 items-center justify-center rounded-md text-ink-400 hover:bg-danger-50 hover:text-danger',
            )}
          >
            <Trash2 className="size-4" strokeWidth={2} />
          </button>
        </div>
      ),
    },
  ];
  const isPending = createPost.isPending || updatePost.isPending;
  const error = (createPost.error ?? updatePost.error)?.message;

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <Panel
        title="Posts"
        description={
          data
            ? `${data.counts?.published ?? 0} published · ${data.counts?.draft ?? 0} in draft`
            : ''
        }
        action={
          <Button size="sm" icon={Plus} onClick={() => setEditingId('new')}>
            New post
          </Button>
        }
        flush
      >
        <div className="flex flex-wrap gap-2.5 border-b border-line p-4 sm:px-5">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, excerpt or tag…"
            icon={Search}
            containerClassName="min-w-[200px] flex-1"
          />
          <SelectMenu
            options={STATUS_FILTERS}
            value={status}
            onChange={setStatus}
            srLabel="Filter by status"
            size="md"
            className="w-[160px]"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4 sm:p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <PanelEmpty
            icon={Newspaper}
            title="No posts yet"
            body="Articles written here appear on /blog and in the site search."
            action={
              <Button size="sm" icon={Plus} onClick={() => setEditingId('new')}>
                Write the first post
              </Button>
            }
          />
        ) : (
          <>
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <CountLine total={posts.length} shown={pagePosts.length} from={from} noun={posts.length === 1 ? 'post' : 'posts'} />
            </div>

            <DataTable
              columns={columns}
              rows={pagePosts}
              rowKey={(post) => post.id}
              onRowClick={(post) => setEditingId(post.id)}
              defaultSort={{ key: 'updatedAt', direction: 'desc' }}
            />

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

      <Modal
        open={Boolean(editingId)}
        onClose={() => setEditingId(null)}
        title={editingId === 'new' ? 'New post' : 'Edit post'}
        size="xl"
        align="top"
      >
        {editingId && (
          <PostEditor
            editingId={editingId}
            isPending={isPending}
            error={error}
            onCancel={() => setEditingId(null)}
            onSubmit={(values) => {
              const options = { onSuccess: () => setEditingId(null) };
              if (editingId === 'new') createPost.mutate(values, options);
              else updatePost.mutate({ id: editingId, ...values }, options);
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this post?"
        confirmLabel="Delete post"
        body={
          deleting
            ? `“${deleting.title}” will be removed permanently. ${
                deleting.status === 'published'
                  ? 'It is live, so any link to it will start returning a 404.'
                  : 'It has never been published.'
              }`
            : ''
        }
        loading={deletePost.isPending}
        error={deletePost.error?.message}
        onConfirm={() => deletePost.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </>
  );
}

export default AdminBlogPage;
