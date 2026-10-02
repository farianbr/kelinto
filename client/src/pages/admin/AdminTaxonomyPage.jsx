import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Boxes, FileSpreadsheet, Pencil, Plus, Power, Tag, Trash2 } from 'lucide-react';

import cn from '@/lib/cn';
import { PanelEmpty } from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Pagination from '@/components/ui/Pagination';
import PageHeader from '@/components/admin/PageHeader';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import FilterStrip from '@/components/admin/FilterStrip';
import KpiRow from '@/components/admin/KpiRow';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAdminCatalogCategories, useAdminTaxonomyRows, useAdminMutations } from '@/hooks/useAdmin';
import TabRow from '@/components/ui/TabRow';

/**
 * A type's category tree, as a table of rows (client rulings 2026-10-02: "the
 * tree should show all the levels as columns so that each row is one
 * product/service"; "the rows are a single entry as a whole").
 *
 * ## What it is opened for
 *
 * "Is the iPhone 17 screen in, and what is it called?" One column per level of
 * the type, its first level included, so a row reads left to right as one
 * product line: Screen › Smartphone › Apple › iPhone 17 Series › iPhone 17.
 * A row is one thing: clicking it opens it in the same form that adds one,
 * where its names, aliases and on/off switch are edited together. A blank cell
 * is a level the row skips, which only an optional level may.
 *
 * **Aliases are the valuable part** (§6.15): a buyer types `15 pm`, and the
 * row's aliases are what find it. They show under the deepest name.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/taxonomy/tree'], icon: adminIcon('Network') };

const PAGE_SIZE = 50;

/** What a type's items are called, for the count column. */
const itemNoun = (category) => (category?.kind === 'service' ? 'Services' : 'Products');

/** The row's deepest entry: the one its aliases and switch belong to. */
const leafOf = (row, levels) => levels.map((level) => row.cells[level.key]).filter(Boolean).at(-1);

/** The row as words, for a dialog that has to name it. */
const nameOf = (row, levels) =>
  levels
    .map((level) => row.cells[level.key]?.name)
    .filter(Boolean)
    .join(' › ');

export function AdminTaxonomyPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: categories = [] } = useAdminCatalogCategories();
  const category = params.get('category') || 'parts';
  const current = categories.find((entry) => entry.slug === category);
  const withCategory = (path, extra = {}) => {
    const query = new URLSearchParams({ ...(category === 'parts' ? {} : { category }), ...extra }).toString();
    return query ? `${path}?${query}` : path;
  };
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const { updateTaxonomyRow, removeTaxonomyRow } = useAdminMutations();

  const debounced = useDebouncedValue(search, 300);
  const { data, isLoading } = useAdminTaxonomyRows({
    category: category === 'parts' ? undefined : category,
    search: debounced || undefined,
    includeInactive: includeInactive ? 'true' : undefined,
  });

  const levels = data?.levels ?? [];
  const rows = data?.rows ?? [];
  const pages = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const openRow = (row) => navigate(withCategory('/admin/settings/taxonomy/row', { row: row.id }));

  const columns = [
    ...levels.map((level, index) => {
      const last = index === levels.length - 1;
      return {
        key: level.key,
        header: level.label,
        sortable: false,
        priority: index === 0 || last ? 1 : 3,
        render: (row) => {
          const cell = row.cells[level.key];
          if (!cell) {
            // An empty cell says what it means: no first-level entry yet, a row
            // that stops above this level (so it covers every one under it), or
            // an optional level the row skips.
            const deeper = levels.slice(index + 1).some((next) => row.cells[next.key]);
            const text = level.key === 'partType' ? 'Not set' : deeper ? '–' : 'Any';
            return <span className="text-sm italic text-ink-300">{text}</span>;
          }
          return (
            <span className="block min-w-0">
              <span className={cn('block truncate text-sm', last ? 'font-medium text-ink-900' : 'text-ink-600')}>{cell.name}</span>
              {last && cell.aliases.length > 0 && (
                <span className="block truncate font-mono text-xs text-ink-400">{cell.aliases.slice(0, 3).join(' · ')}</span>
              )}
            </span>
          );
        },
      };
    }),
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      sortable: false,
      priority: 2,
      render: (row) =>
        leafOf(row, levels)?.isActive === false ? <Badge tone="neutral">Off</Badge> : <Badge tone="ok">Active</Badge>,
    },
    {
      key: 'count',
      header: itemNoun(current),
      width: '100px',
      align: 'right',
      sortable: false,
      render: (row) => <span className="tnum text-ink-600">{row.count}</span>,
    },
  ];

  const rowMenu = [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: openRow },
    {
      key: 'toggle',
      label: (row) => (leafOf(row, levels)?.isActive === false ? 'Activate' : 'Deactivate'),
      icon: Power,
      confirm: (row) => {
        const off = leafOf(row, levels)?.isActive === false;
        return {
          title: off ? `Activate ${nameOf(row, levels)}?` : `Deactivate ${nameOf(row, levels)}?`,
          body: off
            ? 'It comes back to the website filters and the pickers.'
            : 'It leaves the website filters and the pickers. Items already filed there stay on sale.',
          confirmLabel: off ? 'Activate' : 'Deactivate',
        };
      },
      onSelect: (row) =>
        updateTaxonomyRow.mutateAsync({ category, row: row.id, isActive: leafOf(row, levels)?.isActive === false }),
    },
    {
      key: 'remove',
      label: 'Remove',
      icon: Trash2,
      tone: 'danger',
      confirm: (row) => ({
        title: `Remove ${nameOf(row, levels)}?`,
        body: 'It leaves the category tree and the pickers. Refused while anything is filed on it. Entries other rows still use are kept.',
        confirmLabel: 'Remove row',
        tone: 'danger',
        confirmPhrase: 'remove',
      }),
      onSelect: (row) => removeTaxonomyRow.mutateAsync({ category, row: row.id }),
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        // Named for the type it belongs to: Taxonomy opens one tree per type.
        title={current ? `${current.name}: category tree` : ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" icon={FileSpreadsheet} onClick={() => navigate(withCategory('/admin/settings/taxonomy/import'))}>
              Import CSV
            </Button>
            <Button icon={Plus} onClick={() => navigate(withCategory('/admin/settings/taxonomy/add'))}>
              Add row
            </Button>
          </div>
        }
      />

      {categories.length > 1 && (
        <TabRow
          label="Type"
          value={category}
          onChange={(next) => {
            setParams(next === 'parts' ? {} : { category: next }, { replace: true });
            setPage(1);
          }}
          tabs={categories.map((entry) => ({ key: entry.slug, label: entry.name, count: entry.nodeCount }))}
        />
      )}

      <KpiRow
        tiles={[
          { label: 'Rows', value: data?.stats?.rows ?? 0, icon: Boxes },
          { label: 'Entries', value: data?.stats?.entries ?? 0 },
          { label: 'Inactive', value: data?.stats?.inactive ?? 0 },
          {
            label: 'With aliases',
            value: data?.stats?.withAliases ?? 0,
            icon: Tag,
            tone: 'brand',
            hint: 'Entries findable by a short-form search term.',
          },
        ]}
      />

      <FilterStrip
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search any level by name or alias…"
        exportFormats={[]}
        filters={
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                setPage(1);
              }}
              className="size-4 accent-brand"
            />
            Show inactive
          </label>
        }
        activeFilterCount={includeInactive ? 1 : 0}
        onClearFilters={() => {
          setIncludeInactive(false);
          setPage(1);
        }}
      />

      <div className="border-b border-line px-3 py-2 sm:px-4">
        <CountLine total={rows.length} noun={rows.length === 1 ? 'row' : 'rows'} />
      </div>

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(row) => row.id}
        rowMenu={rowMenu}
        onRowClick={openRow}
        loading={isLoading}
        sortable={false}
        empty={
          <PanelEmpty
            icon={Boxes}
            title={debounced ? 'No rows match that search' : 'Nothing in this tree yet'}
            body={debounced ? 'Try a shorter name or an alias.' : 'Add the first row: every level of the type, top to bottom.'}
          />
        }
        footer={
          pages > 1 ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Pagination page={page} pages={pages} onChange={setPage} />
            </div>
          ) : null
        }
      />
    </>
  );
}

export default AdminTaxonomyPage;
