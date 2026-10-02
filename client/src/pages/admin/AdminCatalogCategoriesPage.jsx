import { useNavigate } from 'react-router';
import { ExternalLink, Layers, Network, Pencil, Plus, Power } from 'lucide-react';

import { count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import DataTable from '@/components/admin/DataTable';
import { useAdminCatalogCategories, useAdminMutations } from '@/hooks/useAdmin';
import { useStorefrontUrl } from '@/hooks/useStorefrontUrl';

/**
 * The list of catalogue types on Settings › Taxonomy (Parts, Phones, Services
 * and any a business adds).
 *
 * ## What the screen is opened for
 *
 * Getting to a type's settings or to its category tree, which are two
 * different errands, so each has its own way in: clicking a row opens the
 * type (its name, address, levels, grades and features, on its own page since
 * 2026-10-02), and the Category tree button opens its rows. The menu holds the
 * rest in short words: Edit, Open tree, View page, and Activate or Deactivate.
 * Every type gets the same treatment (2026-10-02): Parts, Phones and Services
 * are no longer built in and switch off like any other.
 *
 * Its own titled panel with the action in its head, rather than a page
 * header: it sits under the Taxonomy header, and a second page header inside
 * a page is two pages stacked.
 */
export function CatalogCategoriesSection({ kinds, title, description, addLabel = null }) {
  const navigate = useNavigate();
  const storefrontUrl = useStorefrontUrl();
  const { data: all = [], isLoading } = useAdminCatalogCategories();
  const { saveCatalogCategory } = useAdminMutations();
  const categories = all.filter((category) => kinds.includes(category.kind));

  const treeOf = (category) =>
    category.slug === 'parts' ? '/admin/settings/taxonomy/tree' : `/admin/settings/taxonomy/tree?category=${category.slug}`;
  const editOf = (category) => navigate(`/admin/settings/taxonomy/types/${category.slug}`);

  /** Switching a type on or off sends the type as it is, with only that changed. */
  const toggle = (category) =>
    saveCatalogCategory.mutateAsync({
      slug: category.slug,
      name: category.name,
      description: category.description,
      facetLabel: category.facetLabel,
      facetRequired: category.facetRequired,
      levels: category.levels,
      grades: category.grades,
      attributes: category.attributes,
      order: category.order,
      isActive: !category.isActive,
    });

  const columns = [
    {
      key: 'name',
      header: 'Type',
      sortable: false,
      render: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink-900">{row.name}</span>
          <span className="block truncate font-mono text-xs text-ink-400">{row.path}</span>
        </span>
      ),
    },
    {
      key: 'levels',
      header: 'Category levels',
      priority: 3,
      sortable: false,
      render: (row) => (
        <span className="text-sm text-ink-500">
          {[row.facetLabel, ...row.levels.map((level) => level.label)].filter(Boolean).join(' › ')}
        </span>
      ),
    },
    {
      key: 'features',
      header: 'Features',
      priority: 2,
      sortable: false,
      render: (row) =>
        row.kind === 'service' ? (
          <span className="text-sm text-ink-400">–</span>
        ) : row.attributes?.length ? (
          <span className="text-sm text-ink-600">{row.attributes.map((feature) => feature.label).join(' · ')}</span>
        ) : (
          <span className="text-sm text-ink-400">None yet</span>
        ),
    },
    {
      key: 'itemCount',
      header: 'Items',
      width: '90px',
      align: 'right',
      sortable: false,
      render: (row) => <span className="tnum text-ink-700">{formatCount(row.itemCount ?? 0)}</span>,
    },
    {
      key: 'nodeCount',
      header: 'Category tree',
      width: '150px',
      sortable: false,
      // A visible way in, not only the row menu.
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          icon={Network}
          onClick={(event) => {
            event.stopPropagation();
            navigate(treeOf(row));
          }}
        >
          {row.nodeCount ? `Open · ${formatCount(row.nodeCount)}` : 'Set up'}
        </Button>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      width: '110px',
      sortable: false,
      render: (row) =>
        row.isActive ? <Badge tone="ok">On</Badge> : <Badge tone="neutral">Off</Badge>,
    },
  ];

  const rowMenu = [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: editOf },
    { key: 'tree', label: 'Open tree', icon: Network, onSelect: (row) => navigate(treeOf(row)) },
    {
      key: 'open',
      label: 'View page',
      icon: ExternalLink,
      onSelect: (row) => window.open(storefrontUrl(row.path), '_blank', 'noreferrer'),
    },
    {
      key: 'toggle',
      label: (row) => (row.isActive ? 'Deactivate' : 'Activate'),
      icon: Power,
      confirm: (row) => ({
        title: row.isActive ? `Deactivate ${row.name}?` : `Activate ${row.name}?`,
        body: row.isActive
          ? `Its page (${row.path}) and its Shop menu entry go. Its products and category tree stay.`
          : `Its page (${row.path}) and its Shop menu entry come back.`,
        confirmLabel: row.isActive ? 'Deactivate' : 'Activate',
      }),
      onSelect: toggle,
    },
  ];

  return (
    <Panel
      flush
      title={title}
      description={description}
      action={
        addLabel ? (
          <Button size="sm" icon={Plus} onClick={() => navigate('/admin/settings/taxonomy/types/new')}>
            {addLabel}
          </Button>
        ) : null
      }
    >
      <DataTable
        columns={columns}
        rows={categories}
        rowKey={(row) => row.slug}
        rowMenu={rowMenu}
        onRowClick={editOf}
        loading={isLoading}
        empty={<PanelEmpty icon={Layers} title="Nothing here yet" body="The built-in types appear here once loaded." />}
      />
    </Panel>
  );
}

export default CatalogCategoriesSection;
