import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { FileText, LayoutPanelTop, Package, Pencil, Search, Trash2 } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { date } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import PageHeader from '@/components/admin/PageHeader';
import Skeleton from '@/components/ui/Skeleton';
import TabRow from '@/components/ui/TabRow';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminPages, useAdminProductArticles, useAdminMutations } from '@/hooks/useAdmin';
import { PAGE_SECTION_LABELS } from '@shared/websitePages';

// The registry stores the icon as a NAME; `adminIcon` resolves it to the
// component `PageHeader` renders. Same line as every other admin page.
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/marketing/articles'], icon: adminIcon('FileText') };

/**
 * SEO, articles: one screen for every piece of long-form copy on the website
 * (client ruling 2026-09-30), in two tabs.
 *
 * **Pages** - each website page's article, its questions and which of the five
 * foot-of-page sections it shows (`shared/websitePages.js`). A fixed list, one
 * row per registry entry, because the pages are the site's, not the owner's to add.
 *
 * **Parts** - the per-product articles, as before:
 *
 * THE LIST IS OF PRODUCTS, NOT ARTICLES. The staff member opening this page is
 * asking "which parts still need one", and a list of articles that exist cannot
 * answer that: it shows the work already done and hides the work outstanding.
 * So every active product is a row, and the article is a column on it.
 *
 * That is also why there is no "new article" button. An article is always about
 * a specific part, so it is created by opening that part's row. The product is
 * the address and saving upserts, which is why the editor needs no create path
 * of its own.
 */

/** The three states a row can be in, as one vocabulary. */
const STATES = [
  { value: 'all', label: 'All parts' },
  { value: 'none', label: 'No article' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
];

const STATE_TONE = {
  published: 'ok',
  draft: 'warn',
  none: 'neutral',
};

const STATE_LABEL = {
  published: 'Published',
  draft: 'Draft',
  // An en dash rather than the word "none": the cell is saying there is no
  // value, which is what the dash means in this table and everywhere else.
  none: '–',
};

/**
 * The Pages tab. Every row is a page whether or not anything was written for
 * it, for the same reason the Parts tab lists parts: the question is "which
 * pages still need copy", and a list of what exists cannot answer it.
 */
function PagesPanel() {
  const navigate = useNavigate();
  const { data, isLoading } = useAdminPages();
  const rows = data?.rows ?? [];
  const open = (row) => navigate(`/admin/marketing/articles/pages/${row.key}`);

  const columns = [
    {
      key: 'label',
      header: 'Page',
      width: '34%',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{row.label}</p>
          <p className="truncate text-xs text-ink-400">
            {row.heading || <span className="font-mono">{row.path}</span>}
          </p>
        </div>
      ),
    },
    {
      key: 'articleStatus',
      header: 'Article',
      render: (row) =>
        row.takesArticle ? (
          <Badge tone={STATE_TONE[row.articleStatus] ?? 'neutral'}>
            {STATE_LABEL[row.articleStatus] ?? row.articleStatus}
          </Badge>
        ) : (
          // The page IS the article (a blog post) or draws its own (a part).
          <span className="text-sm text-ink-400">Own copy</span>
        ),
    },
    {
      key: 'faqCount',
      header: 'Questions',
      align: 'right',
      render: (row) =>
        row.takesFaq ? (
          <span className="tnum text-ink-700">{row.faqCount || '–'}</span>
        ) : (
          <span className="text-sm text-ink-400">Own list</span>
        ),
    },
    {
      key: 'hiddenSections',
      header: 'Hidden sections',
      priority: 2,
      sortValue: (row) => row.hiddenSections.length,
      render: (row) =>
        row.hiddenSections.length ? (
          <span className="text-sm text-ink-700">
            {row.hiddenSections.map((section) => PAGE_SECTION_LABELS[section]).join(' · ')}
          </span>
        ) : (
          <span className="text-ink-400">–</span>
        ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      priority: 2,
      render: (row) => <span className="text-ink-500">{row.updatedAt ? date(row.updatedAt) : '–'}</span>,
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      width: '56px',
      render: (row) => (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              open(row);
            }}
            className={cn(pressable, 'rounded-md p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900')}
            aria-label={`Edit the ${row.label} page`}
          >
            <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <Panel
      title="Website pages"
      description="The article, questions and sections at the foot of each page."
      icon={LayoutPanelTop}
      flush
    >
      {isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12" />
          ))}
        </div>
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.key} onRowClick={open} />
      )}
    </Panel>
  );
}

export function AdminProductArticlesPage() {
  const [params, setParams] = useSearchParams();
  // In the address so the editor's back link, and a reload, land on the tab
  // the staff member was on.
  const tab = params.get('tab') === 'parts' ? 'parts' : 'pages';

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <TabRow
        tabs={[
          { key: 'pages', label: 'Pages', icon: LayoutPanelTop },
          { key: 'parts', label: 'Parts', icon: Package },
        ]}
        value={tab}
        onChange={(next) => setParams(next === 'parts' ? { tab: 'parts' } : {}, { replace: true })}
      />

      {tab === 'pages' ? <PagesPanel /> : <PartsPanel />}
    </div>
  );
}

function PartsPanel() {
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading } = useAdminProductArticles({ q, status });
  const { deleteProductArticle } = useAdminMutations();

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? {};

  const { pageRows, page, totalPages, from, setPage } = useTablePage(rows);

  const columns = [
    {
      key: 'name',
      header: 'Part',
      width: '42%',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{row.name}</p>
          {/* The heading, where there is one, is the useful second line: it is
              what the article is actually about, which the part name is not.
              Without one the SKU is the next most useful thing. */}
          <p className="truncate text-xs text-ink-400">
            {row.heading || <span className="font-mono">{row.sku}</span>}
          </p>
        </div>
      ),
    },
    {
      key: 'partTypeLabel',
      header: 'Component',
      render: (row) => <span className="text-ink-500">{row.partTypeLabel}</span>,
    },
    {
      key: 'articleStatus',
      header: 'Article',
      render: (row) => (
        <Badge tone={STATE_TONE[row.articleStatus] ?? 'neutral'}>
          {STATE_LABEL[row.articleStatus] ?? row.articleStatus}
        </Badge>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      render: (row) => (
        <span className="text-ink-500">{row.updatedAt ? date(row.updatedAt) : '–'}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      width: '96px',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/admin/marketing/articles/${row.productId}`);
            }}
            className={cn(
              pressable,
              'rounded-md p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-900',
            )}
            aria-label={`Edit the article for ${row.name}`}
          >
            <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>

          {/* Only where there is something to delete. A disabled bin on every
              row of a catalogue is a column of dead controls. */}
          {row.articleStatus !== 'none' && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setDeleting(row);
              }}
              className={cn(
                pressable,
                'rounded-md p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger',
              )}
              aria-label={`Delete the article for ${row.name}`}
            >
              <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="Parts"
        description="Every active part, and the article shown on its product page."
        icon={FileText}
        flush
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search by name or SKU"
            icon={Search}
            className="w-full sm:w-64"
            aria-label="Search parts"
          />

          {/* Tabs rather than a select: there are four states, the counts are
              the point of the row, and a closed select hides both. */}
          <div className="flex flex-wrap items-center gap-1">
            {STATES.map((state) => {
              const count = state.value === 'all' ? (data?.total ?? 0) : (counts[state.value] ?? 0);
              const active = status === state.value;
              return (
                <button
                  key={state.value}
                  type="button"
                  onClick={() => setStatus(state.value)}
                  aria-pressed={active}
                  className={cn(
                    pressable,
                    'rounded-md px-2.5 py-1.5 text-sm font-medium',
                    active
                      ? 'bg-surface-2 text-ink-900'
                      : 'text-ink-500 hover:bg-surface-2 hover:text-ink-900',
                  )}
                >
                  {state.label}
                  <span className="tnum ml-1.5 text-xs text-ink-400">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <PanelEmpty
            icon={FileText}
            title="Nothing to show"
            body={
              q
                ? 'No part matches that search.'
                : 'No active parts in the catalogue to write about yet.'
            }
          />
        ) : (
          <>
            <CountLine
              total={rows.length}
              shown={pageRows.length}
              from={from}
              noun={rows.length === 1 ? 'part' : 'parts'}
            />

            <DataTable
              columns={columns}
              rows={pageRows}
              rowKey={(row) => row.productId}
              onRowClick={(row) => navigate(`/admin/marketing/articles/${row.productId}`)}
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

      {/* Names the record and states the consequence, per Instructions 3.0.1. A
          delete is destructive but not money-moving or outward-facing, so it is
          one confirm rather than a typed phrase. */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this article?"
        body={
          deleting
            ? `The article on ${deleting.name} will be removed from the product page and cannot be recovered. The part itself is not affected.`
            : ''
        }
        confirmLabel="Delete article"
        confirmPhrase={deleting ? 'delete' : undefined}
        confirmPhraseLabel="the word delete"
        tone="danger"
        loading={deleteProductArticle.isPending}
        onConfirm={async () => {
          await deleteProductArticle.mutateAsync(deleting.productId);
          setDeleting(null);
        }}
      />
    </>
  );
}

export default AdminProductArticlesPage;
