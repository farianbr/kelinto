import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import { AlertCircle, HelpCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { date } from '@/lib/format';
import { FAQ_CATEGORIES, FAQ_SCOPES, faqSchema } from '@shared/schemas/content';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectMenu from '@/components/ui/SelectMenu';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { usePartTypes, useTaxonomy } from '@/hooks/useCatalog';
import { useAdminFaqs, useAdminMutations } from '@/hooks/useAdmin';

const SCOPE_FILTERS = [
  { value: 'all', label: 'All entries' },
  { value: 'general', label: 'FAQ page' },
  { value: 'product', label: 'Product pages' },
];

const CATEGORY_OPTIONS = FAQ_CATEGORIES.map((category) => ({
  value: category.value,
  label: category.label,
}));

const SCOPE_OPTIONS = FAQ_SCOPES.map((scope) => ({ value: scope.value, label: scope.label }));

const CATEGORY_LABELS = Object.fromEntries(FAQ_CATEGORIES.map((c) => [c.value, c.label]));

/**
 * FAQ entry form.
 *
 * The targeting fields only appear for product scope, because a general entry
 * has nothing to target - showing them greyed out would imply the FAQ page can
 * be filtered by part type, which it cannot.
 */
function FaqForm({ faq, deviceTypes, partTypes, onSubmit, onCancel, isPending, error }) {
  const { register, handleSubmit, watch, formState, control } = useAdminForm({
    // The form holds exactly the payload, so the shared schema attaches as-is
    // and the length rules the server applies are now applied here too.
    resolver: zodResolver(faqSchema),
    defaultValues: {
      question: faq?.question ?? '',
      answer: faq?.answer ?? '',
      category: faq?.category ?? 'ordering',
      scope: faq?.scope ?? 'general',
      partType: faq?.partType ?? '',
      deviceTypeSlug: faq?.deviceTypeSlug ?? '',
      order: faq?.order ?? 0,
      isPublished: faq?.isPublished ?? true,
    },
  });

  const scope = watch('scope');
  const answer = watch('answer');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Input
        label="Question"
        placeholder="How long does account approval take?"
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
        hint="Bullets (- ), bold (**text**) and blank-line paragraphs are supported. No HTML."
        error={formState.errors.answer?.message}
        required
        {...register('answer')}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField control={control} name="scope" label="Shows on" options={SCOPE_OPTIONS} />
        <SelectField
          control={control}
          name="category"
          label="Category"
          options={CATEGORY_OPTIONS}
        />
      </div>

      {scope === 'product' && (
        <fieldset className="rounded-md border border-line p-3.5">
          <legend className="eyebrow px-1 text-ink-400">Which products</legend>
          <p className="mb-3 px-1 text-sm text-ink-400">
            Leave both blank and this shows on every product page. Filling either narrows it, and
            the narrower entries sort above the general ones.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              control={control}
              name="deviceTypeSlug"
              label="Device type"
              options={[{ value: '', label: 'Every device type' }, ...deviceTypes]}
            />
            <SelectField
              control={control}
              name="partType"
              label="Component type"
              options={[{ value: '', label: 'Every component type' }, ...partTypes]}
            />
          </div>
          <p className="mt-3 px-1 text-xs text-ink-300">
            Placeholders you can use in the question and answer: {'{product}'}, {'{model}'},{' '}
            {'{brand}'}, {'{partType}'}, {'{grade}'}.
          </p>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <Input
          label="Sort order"
          inputMode="numeric"
          hint="Lower numbers appear first within a category."
          {...register('order')}
        />
        <Checkbox label="Published" className="-ml-2 mb-2.5" {...register('isPublished')} />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {faq ? 'Save changes' : 'Create entry'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Header metadata read from the same table the breadcrumb uses, so a page
 * title can never drift from its crumb.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/marketing/faq'], icon: adminIcon('HelpCircle') };

export function AdminFaqPage() {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [editing, setEditing] = useState(null); // faq object, or 'new'
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading } = useAdminFaqs({
    scope: scope === 'all' ? undefined : scope,
    q: query || undefined,
  });
  const { createFaq, updateFaq, deleteFaq } = useAdminMutations();
  const { data: tree } = useTaxonomy();
  const { data: partTypeFacets } = usePartTypes();

  const faqs = data?.faqs ?? [];

  // A page of rows for the table; counts and tiles still read the full set.
  const { pageRows: pageFaqs, page, totalPages, from, setPage } = useTablePage(faqs);
  const isPending = createFaq.isPending || updateFaq.isPending;
  const error = (createFaq.error ?? updateFaq.error)?.message;

  const deviceTypes = useMemo(
    () => (tree ?? []).map((node) => ({ value: node.slug, label: node.name })),
    [tree],
  );

  // Part types come from the live facet counts, so an entry can never be filed
  // against a part type the catalogue does not carry.
  const partTypes = useMemo(
    () => (partTypeFacets ?? []).map((facet) => ({ value: facet.value, label: facet.label })),
    [partTypeFacets],
  );

  /**
   * The columns.
   *
   * This was a list where every entry printed its full answer, so a row ran to
   * two or three lines and six entries filled the screen - an editor looking
   * for one question had to read every answer on the way to it. The answer is
   * what the entry says; the QUESTION is what identifies it, and identifying an
   * entry is the whole job of a list.
   *
   * The "FAQ page" badge is gone from the scope column's common case for the
   * same reason. It appeared on every row because almost every entry is a
   * FAQ-page entry, and a badge that is always present carries no information
   * only the exception, a product-page entry, is worth marking.
   */
  const columns = [
    {
      key: 'order',
      header: '#',
      width: '52px',
      align: 'right',
      sortValue: (faq) => faq.order ?? 0,
      render: (faq) => <span className="tnum text-xs text-ink-300">{faq.order}</span>,
    },
    {
      key: 'question',
      header: 'Question',
      width: '46%',
      render: (faq) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{faq.question}</p>
          {/* One line of the answer, as a reminder of which entry this is
              not the entry itself. The editor opens to read it. */}
          <p className="truncate text-xs text-ink-400">{faq.answer}</p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      width: '16%',
      priority: 2,
      sortValue: (faq) => CATEGORY_LABELS[faq.category] ?? faq.category,
      render: (faq) => (
        <span className="text-sm text-ink-700">
          {CATEGORY_LABELS[faq.category] ?? faq.category}
        </span>
      ),
    },
    {
      key: 'scope',
      header: 'Shown on',
      width: '16%',
      priority: 3,
      render: (faq) => (
        <div className="flex flex-wrap items-center gap-1">
          {faq.scope === 'product' ? (
            <Badge tone="info" size="sm">
              Product
            </Badge>
          ) : (
            <span className="text-sm text-ink-400">FAQ page</span>
          )}
          {(faq.partType || faq.deviceTypeSlug) && (
            <span className="truncate text-xs text-ink-400">
              {[faq.deviceTypeSlug, faq.partType].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: '13%',
      priority: 2,
      sortValue: (faq) => new Date(faq.updatedAt).getTime(),
      render: (faq) => (
        <div className="min-w-0">
          <span className="tnum text-sm text-ink-500">{date(faq.updatedAt)}</span>
          {!faq.isPublished && (
            <p>
              <Badge tone="warn" size="sm">
                Hidden
              </Badge>
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '84px',
      align: 'right',
      sortable: false,
      render: (faq) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={(event) => {
              // The row itself opens the editor, so a click that lands on this
              // button must not also fire the row's handler behind it.
              event.stopPropagation();
              setEditing(faq);
            }}
            aria-label={`Edit “${faq.question}”`}
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
              setDeleting(faq);
            }}
            aria-label={`Delete “${faq.question}”`}
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

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <Panel
        title="Questions"
        description={
          data
            ? `${data.counts?.general ?? 0} on the FAQ page · ${data.counts?.product ?? 0} on product pages`
            : ''
        }
        action={
          <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
            New entry
          </Button>
        }
        flush
      >
        <div className="flex flex-wrap gap-2.5 border-b border-line p-4 sm:px-5">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search questions and answers…"
            icon={Search}
            containerClassName="min-w-[200px] flex-1"
          />
          <SelectMenu
            options={SCOPE_FILTERS}
            value={scope}
            onChange={setScope}
            srLabel="Filter by where the entry shows"
            size="md"
            className="w-[170px]"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4 sm:p-5">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-16" />
            ))}
          </div>
        ) : faqs.length === 0 ? (
          <PanelEmpty
            icon={HelpCircle}
            title="No FAQ entries"
            body="Answers written here appear on the FAQ page and on product detail pages."
            action={
              <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
                Write the first one
              </Button>
            }
          />
        ) : (
          <>
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <CountLine total={faqs.length} shown={pageFaqs.length} from={from} noun={faqs.length === 1 ? 'entry' : 'entries'} />
            </div>

            <DataTable
              columns={columns}
              rows={pageFaqs}
              rowKey={(faq) => faq.id}
              onRowClick={(faq) => setEditing(faq)}
              defaultSort={{ key: 'order', direction: 'asc' }}
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
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New FAQ entry' : 'Edit FAQ entry'}
        size="lg"
        align="top"
      >
        {editing && (
          <FaqForm
            faq={editing === 'new' ? null : editing}
            deviceTypes={deviceTypes}
            partTypes={partTypes}
            isPending={isPending}
            error={error}
            onCancel={() => setEditing(null)}
            onSubmit={(values) => {
              const options = { onSuccess: () => setEditing(null) };
              if (editing === 'new') createFaq.mutate(values, options);
              else updateFaq.mutate({ id: editing.id, ...values }, options);
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this FAQ entry?"
        confirmLabel="Delete entry"
        body={deleting ? `“${deleting.question}” will be removed from the site immediately.` : ''}
        loading={deleteFaq.isPending}
        error={deleteFaq.error?.message}
        onConfirm={() =>
          deleteFaq.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      />
    </>
  );
}

export default AdminFaqPage;
