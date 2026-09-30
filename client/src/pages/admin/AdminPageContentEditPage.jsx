import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  ExternalLink,
  FileText,
  HelpCircle,
  LayoutPanelTop,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import RichText from '@/lib/richText';
import { pageFaqSchema } from '@shared/schemas/content';
import { PAGE_SECTIONS, PAGE_SECTION_LABELS } from '@shared/websitePages';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import AuthorFields from '@/components/admin/AuthorFields';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import useAdminForm from '@/hooks/useAdminForm';
import { useAdminPage, useAdminMutations } from '@/hooks/useAdmin';
import { useStorefrontUrl } from '@/hooks/useStorefrontUrl';

/**
 * One website page's foot-of-page sections: which it shows, its article and
 * its questions (`shared/websitePages.js`). Reached from SEO › Articles › Pages.
 *
 * What it is opened for, in order: write or fix the article (the most work, so
 * the widest block, with the live preview beside it as on the part editor), then
 * the questions, then a switch or two. The switches sit FIRST anyway, as one
 * short row, because they decide whether the rest shows at all - an owner who
 * writes an article on a page whose article section is off would otherwise find
 * out only on the website.
 *
 * TWO KINDS OF SAVE, deliberately. The switches and the article are one record
 * and save together from one button row, the way the part editor saves. Each
 * question is its own record and saves from its own dialog, like the FAQ screen:
 * a question is written, checked and published on its own, and holding ten of
 * them hostage to one save button is how an edit gets lost.
 */

const PAGE_ICON = adminIcon('LayoutPanelTop');

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

/** The byline as the server sends it, flattened into the form's field names. */
function authorToForm(saved) {
  return {
    ...EMPTY_AUTHOR,
    authorName: saved?.name ?? '',
    authorRole: saved?.role ?? '',
    authorBio: saved?.bio ?? '',
    authorPhoto: saved?.photo ?? '',
    authorLinkedin: saved?.links?.linkedin ?? '',
    authorX: saved?.links?.x ?? '',
    authorFacebook: saved?.links?.facebook ?? '',
    authorWebsite: saved?.links?.website ?? '',
  };
}

/** Why a section is not offered on this page, in the owner's terms. */
const MISSING_REASON = {
  article: 'this page is its own article',
  faq: 'this page is the FAQ',
  contact: 'this page is the contact form',
};

function FaqForm({ faq, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, watch, formState } = useAdminForm({
    resolver: zodResolver(pageFaqSchema),
    defaultValues: {
      question: faq?.question ?? '',
      answer: faq?.answer ?? '',
      order: faq?.order ?? 0,
      isPublished: faq?.isPublished ?? true,
    },
  });
  const answer = watch('answer');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <p role="alert" className="flex items-start gap-2 border-l-2 border-danger px-3 py-1 text-sm text-ink-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Input
        label="Question"
        error={formState.errors.question?.message}
        data-autofocus
        required
        {...register('question')}
      />

      <Textarea
        label="Answer"
        rows={5}
        value={answer}
        counter={4000}
        hint="Bullets (- ), bold (**text**) and blank-line paragraphs. No HTML."
        error={formState.errors.answer?.message}
        required
        {...register('answer')}
      />

      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <Input label="Sort order" inputMode="numeric" hint="Lower numbers appear first." {...register('order')} />
        <Checkbox label="Published" className="-ml-2 mb-2.5" {...register('isPublished')} />
      </div>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {faq ? 'Save question' : 'Add question'}
        </Button>
      </div>
    </form>
  );
}

export function AdminPageContentEditPage() {
  const { page: pageKey } = useParams();
  const storefrontUrl = useStorefrontUrl();
  const { data, isLoading, error: loadError } = useAdminPage(pageKey);
  const { savePage, createPageFaq, updatePageFaq, deletePageFaq } = useAdminMutations();

  const [heading, setHeading] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('draft');
  const [hidden, setHidden] = useState([]);
  const [author, setAuthor] = useState(EMPTY_AUTHOR);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [savingAs, setSavingAs] = useState(null);

  const [editingFaq, setEditingFaq] = useState(null); // a question, or 'new'
  const [deletingFaq, setDeletingFaq] = useState(null);

  // Seeded once per page from the server. Keyed on the page so moving between
  // two pages refills the form instead of carrying one page's words onto another.
  useEffect(() => {
    if (!data) return;
    setHeading(data.article?.heading ?? '');
    setBody(data.article?.body ?? '');
    setStatus(data.status ?? 'draft');
    setHidden(data.hiddenSections ?? []);
    setAuthor(authorToForm(data.article?.author));
    setError('');
    setSaved('');
  }, [data?.page?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <Panel title="Page not found" icon={LayoutPanelTop}>
        <p className="text-sm text-ink-500">There is no website page called “{pageKey}”.</p>
        <Link to="/admin/marketing/articles" className="mt-3 inline-block text-sm font-semibold text-brand">
          Back to all pages
        </Link>
      </Panel>
    );
  }

  const page = data.page;
  const takes = (section) => page.sections.includes(section);
  const missing = PAGE_SECTIONS.filter((section) => !takes(section));
  const faqs = data.faqs ?? [];
  // A page address with a parameter in it (every blog post, every deal) has no
  // one page to open.
  const livePath = page.path.includes(':') ? null : page.path;

  const toggle = (section) =>
    setHidden((current) =>
      current.includes(section) ? current.filter((value) => value !== section) : [...current, section],
    );

  async function save(nextStatus) {
    setError('');
    setSaved('');
    setSavingAs(nextStatus);
    try {
      await savePage.mutateAsync({
        page: page.key,
        heading: heading.trim(),
        body,
        ...author,
        status: nextStatus,
        hiddenSections: hidden,
      });
      setStatus(heading.trim() || body.trim() ? nextStatus : 'draft');
      setSaved(nextStatus === 'published' ? 'Saved and live on the website.' : 'Saved.');
    } catch (err) {
      setError(err.message || 'The page could not be saved.');
    } finally {
      setSavingAs(null);
    }
  }

  const hasArticle = Boolean(heading.trim() || body.trim());

  const saveRow = (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
      {takes('article') ? (
        <>
          {/* Two buttons, as on the part editor: a draft and a publish are
              different decisions, and the second puts words on the site. */}
          <Button icon={Save} variant="outline" loading={savingAs === 'draft'} onClick={() => save('draft')}>
            Save draft
          </Button>
          <Button
            icon={Eye}
            loading={savingAs === 'published'}
            disabled={!hasArticle}
            onClick={() => save('published')}
          >
            {status === 'published' ? 'Save and keep published' : 'Publish'}
          </Button>
        </>
      ) : (
        <Button icon={Save} loading={savingAs !== null} onClick={() => save('draft')}>
          Save sections
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-ink-500">
          {saved}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={PAGE_ICON}
        title={page.label}
        description={page.note || `The sections at the foot of ${page.path}.`}
        badge={
          takes('article') && hasArticle ? (
            <Badge tone={status === 'published' ? 'ok' : 'warn'}>
              {status === 'published' ? 'Published' : 'Draft'}
            </Badge>
          ) : null
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/marketing/articles"
              className={cn(
                pressable,
                'inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-semibold text-ink-700 hover:bg-surface-2',
              )}
            >
              <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
              All pages
            </Link>
            {livePath && (
              <a
                href={storefrontUrl(livePath)}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  pressable,
                  'inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-semibold text-ink-700 hover:bg-surface-2',
                )}
              >
                View page
                <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
              </a>
            )}
          </div>
        }
      />

      {/* ---- which sections show ------------------------------------------ */}
      <Panel
        title="Sections on this page"
        description="Always in this order. Untick one to hide it here; the others are unaffected."
        icon={LayoutPanelTop}
      >
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {page.sections.map((section) => (
            <Checkbox
              key={section}
              label={PAGE_SECTION_LABELS[section]}
              checked={!hidden.includes(section)}
              onChange={() => toggle(section)}
              className="-ml-2 sm:ml-0"
            />
          ))}
        </div>
        {missing.length > 0 && (
          <p className="mt-2 text-xs text-ink-400">
            {missing
              .map((section) =>
                MISSING_REASON[section]
                  ? `No ${PAGE_SECTION_LABELS[section].toLowerCase()}: ${MISSING_REASON[section]}.`
                  : `No ${PAGE_SECTION_LABELS[section].toLowerCase()} here.`,
              )
              .join(' ')}
            {page.key === 'product' && ' Each part’s article and questions are written under Parts and on the FAQ screen.'}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-400">
          Reviews are edited under SEO › Reviews; the address, hours and map under Settings › Business info.
        </p>
        {!takes('article') && <div className="mt-4">{saveRow}</div>}
      </Panel>

      {/* ---- the article, with its preview -------------------------------- */}
      {takes('article') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Article" icon={FileText}>
            <div className="space-y-4">
              <Input
                label="Heading"
                value={heading}
                onChange={(event) => setHeading(event.target.value)}
                maxLength={140}
                hint="What the reader learns. Leave heading and body empty for no article."
              />
              <Textarea
                label="Body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={16}
                maxLength={20000}
                counter={20000}
                hint="Plain text. Blank line for a paragraph, ## for a subheading, - for a list item, **bold**."
              />
              <AuthorFields
                value={author}
                onChange={(field, value) => setAuthor((prev) => ({ ...prev, [field]: value }))}
                nameRequired={false}
              />
              {saveRow}
            </div>
          </Panel>

          <Panel title="Preview" description="Drawn the way the website draws it." icon={Eye}>
            {hasArticle ? (
              <div>
                {heading && <h2 className="text-xl sm:text-2xl">{heading}</h2>}
                {body && <RichText className="mt-4 max-w-[68ch]">{body}</RichText>}
              </div>
            ) : (
              <p className="text-sm text-ink-400">
                No article yet. What you write appears here as it will on the page.
              </p>
            )}
          </Panel>
        </div>
      )}

      {/* ---- the questions ------------------------------------------------- */}
      {takes('faq') && (
        <Panel
          title="Questions"
          description={`${faqs.length} on this page`}
          icon={HelpCircle}
          action={
            <Button size="sm" icon={Plus} onClick={() => setEditingFaq('new')}>
              Add question
            </Button>
          }
          flush
        >
          {faqs.length === 0 ? (
            <PanelEmpty
              icon={HelpCircle}
              title="No questions yet"
              body="The FAQ section stays off this page until it has a published question."
            />
          ) : (
            <ul className="divide-y divide-line">
              {faqs.map((faq) => (
                <li key={faq.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="tnum w-6 shrink-0 text-right text-xs text-ink-300">{faq.order}</span>
                  <button
                    type="button"
                    onClick={() => setEditingFaq(faq)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate font-medium text-ink-900">{faq.question}</span>
                    <span className="block truncate text-xs text-ink-400">{faq.answer}</span>
                  </button>
                  {!faq.isPublished && <Badge tone="warn">Draft</Badge>}
                  <button
                    type="button"
                    onClick={() => setEditingFaq(faq)}
                    className={cn(pressable, 'rounded-md p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900')}
                    aria-label={`Edit “${faq.question}”`}
                  >
                    <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingFaq(faq)}
                    className={cn(pressable, 'rounded-md p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger')}
                    aria-label={`Delete “${faq.question}”`}
                  >
                    <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Modal
        open={Boolean(editingFaq)}
        onClose={() => setEditingFaq(null)}
        title={editingFaq === 'new' ? `New question on ${page.label}` : 'Edit question'}
        size="lg"
        align="top"
      >
        {editingFaq && (
          <FaqForm
            faq={editingFaq === 'new' ? null : editingFaq}
            isPending={createPageFaq.isPending || updatePageFaq.isPending}
            error={(createPageFaq.error ?? updatePageFaq.error)?.message}
            onCancel={() => setEditingFaq(null)}
            onSubmit={(values) => {
              const options = { onSuccess: () => setEditingFaq(null) };
              if (editingFaq === 'new') createPageFaq.mutate({ page: page.key, ...values }, options);
              else updatePageFaq.mutate({ page: page.key, id: editingFaq.id, ...values }, options);
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingFaq)}
        onClose={() => setDeletingFaq(null)}
        title="Delete this question?"
        body={
          deletingFaq
            ? `“${deletingFaq.question}” comes off the ${page.label} page at once and cannot be recovered.`
            : ''
        }
        confirmLabel="Delete question"
        confirmPhrase={deletingFaq ? 'delete' : undefined}
        confirmPhraseLabel="the word delete"
        tone="danger"
        loading={deletePageFaq.isPending}
        error={deletePageFaq.error?.message}
        onConfirm={() =>
          deletePageFaq.mutate({ page: page.key, id: deletingFaq.id }, { onSuccess: () => setDeletingFaq(null) })
        }
      />
    </div>
  );
}

export default AdminPageContentEditPage;
