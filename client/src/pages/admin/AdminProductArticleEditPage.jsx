import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Eye, ExternalLink, FileText, Save } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import RichText from '@/lib/richText';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import AuthorFields from '@/components/admin/AuthorFields';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminProductArticle, useAdminMutations } from '@/hooks/useAdmin';
import { useStorefrontUrl } from '@/hooks/useStorefrontUrl';

/**
 * The article editor for ONE product.
 *
 * Addressed by product id rather than article id, because an article may not
 * exist yet: the staff member opens a PART and writes about it, and the save is an
 * upsert. There is no separate create screen for the same reason.
 *
 * SPLIT, NOT TABBED. The body is written in the small markup vocabulary
 * `lib/richText.jsx` reads, which is not WYSIWYG, so the writer needs to see
 * what the markup produces while typing it. A preview behind a tab is a preview
 * nobody opens until they are finished, which is the point at which finding out
 * is least useful. It stacks below the form under lg, where there is no room
 * for two columns.
 */

// The registry stores the icon as a NAME; `adminIcon` resolves it to the
// component `PageHeader` renders. The title and description are set per-record
// below rather than taken from the registry, because both name the part.
const PAGE_ICON = adminIcon('FileText');

/**
 * The byline fields, empty. Flat keys matching what the blog form posts, so
 * `authorFromForm` on the server reads both the same way.
 *
 * Spelled out rather than derived from `AUTHOR_LINKS` so every controlled input
 * has a defined starting value: an input that begins `undefined` and is later
 * given a string is the React controlled/uncontrolled warning.
 */
const EMPTY_AUTHOR = {
  authorName: '',
  authorRole: '',
  authorBio: '',
  authorPhoto: '',
  authorLinkedin: '',
  authorX: '',
  authorFacebook: '',
  authorWebsite: '',
};

/** What the storefront will render, drawn the way the storefront draws it. */
function Preview({ heading, body }) {
  if (!heading && !body) {
    return (
      <p className="text-sm text-ink-400">
        Nothing to preview yet. What you write appears here, formatted the way the product page
        will draw it.
      </p>
    );
  }

  return (
    <div>
      {heading && <h2 className="text-xl sm:text-2xl">{heading}</h2>}
      {/* The same renderer the product page uses, so this cannot drift from
          what ships. Capped at the same reading measure for the same reason. */}
      {body && <RichText className="mt-4 max-w-[68ch]">{body}</RichText>}
    </div>
  );
}

export function AdminProductArticleEditPage() {
  const storefrontUrl = useStorefrontUrl();
  const { productId } = useParams();
  const navigate = useNavigate();

  const { data, isLoading } = useAdminProductArticle(productId);
  const { saveProductArticle } = useAdminMutations();

  const [heading, setHeading] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('draft');
  const [error, setError] = useState('');

  /**
   * The byline, held flat under the same field names the blog editor's form
   * produces (`authorName`, `authorLinkedin`, …) so one server-side mapper
   * turns either into the stored shape. `AuthorFields` renders it either way.
   */
  const [author, setAuthor] = useState(EMPTY_AUTHOR);
  const setAuthorField = (field, value) => setAuthor((prev) => ({ ...prev, [field]: value }));

  // Seeded from the server once the payload lands. Keyed on the article id so
  // that navigating from one part to another refills the form rather than
  // leaving the previous part's words in it.
  useEffect(() => {
    if (!data) return;
    setHeading(data.article?.heading ?? '');
    setBody(data.article?.body ?? '');
    setStatus(data.article?.status ?? 'draft');

    // Nested on the way in, flat on the way back out - the inverse of what the
    // server does on write.
    const saved = data.article?.author;
    setAuthor({
      ...EMPTY_AUTHOR,
      authorName: saved?.name ?? '',
      authorRole: saved?.role ?? '',
      authorBio: saved?.bio ?? '',
      authorPhoto: saved?.photo ?? '',
      authorLinkedin: saved?.links?.linkedin ?? '',
      authorX: saved?.links?.x ?? '',
      authorFacebook: saved?.links?.facebook ?? '',
      authorWebsite: saved?.links?.website ?? '',
    });
  }, [data?.article?.id, data]);

  const product = data?.product;
  const isNew = !data?.article;

  async function save(nextStatus) {
    setError('');
    try {
      await saveProductArticle.mutateAsync({
        productId,
        heading: heading.trim(),
        body,
        ...author,
        status: nextStatus,
      });
      setStatus(nextStatus);
      navigate('/admin/marketing/articles');
    } catch (err) {
      setError(err.message || 'The article could not be saved.');
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={PAGE_ICON}
        title={isNew ? 'Write an article' : 'Edit article'}
        description={
          product
            ? `Shown on the ${product.name} product page.`
            : 'The article shown on this product page.'
        }
        badge={
          <Badge tone={status === 'published' ? 'ok' : 'warn'}>
            {status === 'published' ? 'Published' : 'Draft'}
          </Badge>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/marketing/articles"
              className={cn(
                pressable,
                'inline-flex h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink-700 hover:bg-surface-2',
              )}
            >
              <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
              All parts
            </Link>

            {/* Straight to the live page. The writer's next question after
                saving is always "how does it actually look", and a published
                article is one click from here rather than a search away. */}
            {product && (
              <a
                href={storefrontUrl(`/product/${product.slug}`)}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  pressable,
                  'inline-flex h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink-700 hover:bg-surface-2',
                )}
              >
                View part
                <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
              </a>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- the form ---------------------------------------------------- */}
        <Panel title="Article" icon={FileText}>
          {product && (
            <p className="mb-4 text-sm text-ink-500">
              <span className="font-medium text-ink-900">{product.name}</span>
              <span aria-hidden="true"> · </span>
              <span className="font-mono text-xs">{product.sku}</span>
            </p>
          )}

          <div className="space-y-4">
            <Input
              label="Heading"
              value={heading}
              onChange={(event) => setHeading(event.target.value)}
              placeholder="How to tell an OEM screen from a copy"
              maxLength={140}
              required
              hint="What the reader learns. Not the part name, which is already on the page."
            />

            {/* `counter` is the MAX length - the component renders "used / max"
                from it. 20000 is the schema's own ceiling, so the count cannot
                disagree with what the server will accept. */}
            <Textarea
              label="Body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={18}
              required
              maxLength={20000}
              counter={20000}
              hint="Plain text. Blank line for a paragraph, ## for a subheading, - for a list item, **bold**."
            />

            {/* The same fieldset the blog editor uses. `nameRequired` is off:
                an article may ship with no byline, and 773 seeded ones do. */}
            <AuthorFields value={author} onChange={setAuthorField} nameRequired={false} />

            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}

            {/* TWO buttons, not a status dropdown and one save. "Save draft"
                and "Publish" are different decisions with different
                consequences, and a select that has to be set before a button is
                pressed hides that the second one puts words on the public site.
                A form the staff member deliberately filled in is its own
                confirmation (Instructions 3.0.1), so neither needs a dialog. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button
                icon={Save}
                variant="secondary"
                loading={saveProductArticle.isPending && status !== 'published'}
                onClick={() => save('draft')}
              >
                Save draft
              </Button>
              <Button
                icon={Eye}
                loading={saveProductArticle.isPending && status === 'published'}
                onClick={() => save('published')}
              >
                {status === 'published' ? 'Save and keep published' : 'Publish'}
              </Button>
            </div>
          </div>
        </Panel>

        {/* ---- the preview ------------------------------------------------- */}
        <Panel
          title="Preview"
          description="Exactly what the product page will render."
          icon={Eye}
        >
          <Preview heading={heading} body={body} />
        </Panel>
      </div>
    </div>
  );
}

export default AdminProductArticleEditPage;
