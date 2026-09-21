import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Boxes, FileSpreadsheet, Plus, Tag, Trash2, X } from 'lucide-react';

import cn from '@/lib/cn';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DeleteWithPreview from '@/components/admin/DeleteWithPreview';
import Pagination from '@/components/ui/Pagination';
import PageHeader from '@/components/admin/PageHeader';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import FilterStrip from '@/components/admin/FilterStrip';
import KpiRow from '@/components/admin/KpiRow';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAdminTaxonomy, useAdminMutations } from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';
import SelectMenu from '@/components/ui/SelectMenu';

/**
 * The taxonomy editor (§6.15 - CellShoppe's *Device & Models*, phase 11d).
 *
 * **Aliases are what this screen is for.** A business buyer types `15 PM` or
 * `iphone15pm`, and a catalogue that only matches "iPhone 15 Pro Max" returns
 * nothing for the way its users actually type. Aliases live on the model, so
 * one entry covers every part that fits that phone.
 *
 * **Structure is not editable here** - no `kind`, no slug, no re-parenting.
 * Every product carries a denormalised `path` written against this tree, and
 * changing a slug from a form would detach products from a hierarchy that still
 * looks correct on screen. What is editable is what a staff member actually needs:
 * the label, the aliases, and whether it shows.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/taxonomy'], icon: adminIcon('Boxes') };

const KINDS = [
  { value: 'all', label: 'Everything' },
  { value: 'deviceType', label: 'Device types' },
  { value: 'brand', label: 'Brands' },
  { value: 'series', label: 'Series' },
  { value: 'model', label: 'Models' },
];

const KIND_LABEL = {
  deviceType: 'Device type',
  brand: 'Brand',
  series: 'Series',
  model: 'Model',
};

/**
 * The alias editor - chips plus a field, not a comma-separated text input.
 *
 * A raw text field makes it impossible to see at a glance how many aliases a
 * model has or to remove one without editing a string, which is exactly the
 * kind of friction that stops anybody maintaining them.
 */
function AliasField({ value, onChange }) {
  const [draft, setDraft] = useState('');

  function add() {
    const alias = draft.trim().toLowerCase();
    if (!alias) return;
    if (value.includes(alias)) {
      setDraft('');
      return;
    }
    onChange([...value, alias]);
    setDraft('');
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink-700">Aliases</span>

      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((alias) => (
            <li key={alias}>
              <span className="inline-flex items-center gap-1 rounded-sm bg-surface-3 py-1 pr-1 pl-2 font-mono text-xs text-ink-700">
                {alias}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((item) => item !== alias))}
                  aria-label={`Remove alias ${alias}`}
                  className={cn(pressable, 'flex size-4 items-center justify-center rounded-sm text-ink-400 hover:bg-danger-50 hover:text-danger')}
                >
                  <X className="size-3" strokeWidth={2.5} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          // Enter adds an alias rather than submitting the dialog - submitting
          // on the way to adding one loses it.
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder="15 pm"
          aria-label="New alias"
          containerClassName="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      <p className="mt-1.5 text-sm text-ink-400">
        Stored lowercase. Somebody searching this term gets every part for this model.
      </p>
    </div>
  );
}

/** The edit dialog. One node, the safe fields only. */
function EditDialog({ node, onClose }) {
  const [name, setName] = useState(node.name);
  const [aliases, setAliases] = useState(node.aliases ?? []);
  const [isActive, setIsActive] = useState(node.isActive);
  const [error, setError] = useState(null);
  // Delete sat inside the edit dialog and fired on the click. The service still
  // refuses a node that is in use, but an unused one went straight out.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { saveTaxonomyNode, deleteTaxonomyNode } = useAdminMutations();

  async function save(event) {
    event.preventDefault();
    setError(null);
    try {
      await saveTaxonomyNode.mutateAsync({ id: node.id, name, aliases, isActive });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    setError(null);
    try {
      await deleteTaxonomyNode.mutateAsync(node.id);
      onClose();
    } catch (err) {
      // The service refuses a node that is in use or has children, and its
      // message names the count. Shown here rather than swallowed, because
      // "deactivate it instead" is the actual next step.
      setError(err.message);
    }
  }

  return (
    <>
      <Modal open onClose={onClose} title={`Edit ${node.name}`}>
      <form onSubmit={save} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
          <Badge tone="neutral">{KIND_LABEL[node.kind] ?? node.kind}</Badge>
          <code className="font-mono text-xs">{node.slug}</code>
          <span>
            {node.productCount} {node.productCount === 1 ? 'product' : 'products'}
          </span>
        </div>

        <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} />

        <AliasField value={aliases} onChange={setAliases} />

        <label className="flex items-start gap-2.5 rounded-md bg-surface-2 px-3 py-2.5">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          <span className="text-sm leading-relaxed text-ink-700">
            <span className="font-medium">Active</span>
            <span className="mt-0.5 block text-sm text-ink-500">
              An inactive entry disappears from the storefront’s filters and pickers. Its products
              stay orderable - this hides the category, not the parts.
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button type="submit" loading={saveTaxonomyNode.isPending}>
            Save
          </Button>
          <button
            type="button"
            onClick={onClose}
            className={cn(pressable, 'inline-flex h-9 items-center rounded-md border border-line bg-surface px-3.5 text-sm font-medium text-ink-600 hover:border-line-strong hover:text-ink-900')}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={deleteTaxonomyNode.isPending}
            className={cn(pressable, 'ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink-500 hover:border-danger hover:bg-danger-50 hover:text-danger disabled:opacity-50')}
          >
            <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Delete
          </button>
        </div>
      </form>
      </Modal>

      {/* The service still refuses a node that has products or children, and its
          message names the count. This stops the unused ones going out on a
          single click from inside an edit dialog. */}
      {/* Counts the children and the products behind this node before asking -
          both of which the server refuses on, so a staff member now sees the
          refusal as a reason rather than as an error after the click. */}
      <DeleteWithPreview
        type="taxonomy"
        record={confirmingDelete ? node : null}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={async () => {
          setConfirmingDelete(false);
          await remove();
        }}
        confirmLabel="Delete"
        loading={deleteTaxonomyNode.isPending}
      />
    </>
  );
}

export function AdminTaxonomyPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);

  const debounced = useDebouncedValue(search, 300);

  const { data, isLoading } = useAdminTaxonomy({
    q: undefined,
    search: debounced || undefined,
    kind: kind === 'all' ? undefined : kind,
    includeInactive: includeInactive ? 'true' : undefined,
    page,
  });

  // The dialog holds a snapshot, so it has to be re-read after a save or it
  // would show stale aliases if reopened.
  useEffect(() => {
    if (!editing) return;
    const fresh = data?.nodes?.find((node) => node.id === editing.id);
    if (fresh && fresh !== editing) setEditing(fresh);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = [
    {
      key: 'kind',
      header: 'Type',
      width: '120px',
      sortable: false,
      render: (row) => (
        <Badge tone={row.kind === 'model' ? 'brand' : 'neutral'}>
          {KIND_LABEL[row.kind] ?? row.kind}
        </Badge>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      sortable: false,
      render: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink-900">{row.name}</span>
          <span className="block truncate font-mono text-xs text-ink-400">{row.slug}</span>
        </span>
      ),
    },
    {
      key: 'aliases',
      header: 'Aliases',
      priority: 2,
      sortable: false,
      render: (row) =>
        row.aliases?.length ? (
          <span className="flex flex-wrap gap-1">
            {row.aliases.slice(0, 4).map((alias) => (
              <span
                key={alias}
                className="rounded-sm bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-ink-600"
              >
                {alias}
              </span>
            ))}
            {row.aliases.length > 4 && (
              <span className="text-xs text-ink-400">+{row.aliases.length - 4}</span>
            )}
          </span>
        ) : (
          <span className="text-sm text-ink-400">-</span>
        ),
    },
    {
      key: 'productCount',
      header: 'Products',
      priority: 2,
      width: '100px',
      sortable: false,
      render: (row) => <span className="tnum text-ink-600">{row.productCount}</span>,
    },
    {
      key: 'isActive',
      header: 'Status',
      width: '110px',
      sortable: false,
      render: (row) =>
        row.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Inactive</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              icon={FileSpreadsheet}
              onClick={() => navigate('/admin/settings/taxonomy/import')}
            >
              Import CSV
            </Button>
            <Button icon={Plus} onClick={() => navigate('/admin/settings/taxonomy/add')}>
              Add model
            </Button>
          </div>
        }
      />

      <KpiRow
        tiles={[
          { label: 'Entries', value: data?.stats?.total ?? 0, icon: Boxes },
          { label: 'Active', value: data?.stats?.active ?? 0, tone: 'ok' },
          { label: 'Inactive', value: data?.stats?.inactive ?? 0 },
          { label: 'Brands', value: data?.stats?.brands ?? 0 },
          {
            label: 'With aliases',
            value: data?.stats?.withAliases ?? 0,
            icon: Tag,
            tone: 'brand',
            hint: 'Models findable by a short-form search term.',
          },
        ]}
      />

      <FilterStrip
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search by name, slug or alias…"
        exportFormats={[]}
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-600">
              <span className="shrink-0">Type</span>
              <SelectMenu
                srLabel="Filter by level"
                value={kind}
                onChange={(next) => {
                  setKind(next);
                  setPage(1);
                }}
                options={KINDS}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-ink-600">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => {
                  setIncludeInactive(event.target.checked);
                  setPage(1);
                }}
                className="size-4 accent-[var(--color-brand)]"
              />
              Show inactive
            </label>
          </div>
        }
        activeFilterCount={(kind === 'all' ? 0 : 1) + (includeInactive ? 1 : 0)}
        onClearFilters={() => {
          setKind('all');
          setIncludeInactive(false);
          setPage(1);
        }}
      />

      <div className="border-b border-line px-3 py-2 sm:px-4">
        <CountLine
          total={(data?.nodes ?? []).length}
          noun={(data?.nodes ?? []).length === 1 ? 'entry' : 'entries'}
        />
      </div>

      <DataTable
        columns={columns}
        rows={data?.nodes ?? []}
        loading={isLoading}
        sortable={false}
        onRowClick={(row) => setEditing(row)}
        empty={
          <PanelEmpty
            icon={Boxes}
            title="Nothing here"
            body={
              debounced || kind !== 'all'
                ? 'No entries match those filters.'
                : 'The taxonomy is seeded with the catalogue.'
            }
          />
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-500">
              {data?.total ?? 0} {data?.total === 1 ? 'entry' : 'entries'}
            </p>
            <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onChange={setPage} />
          </div>
        }
      />

      <p className="mt-4 text-sm leading-relaxed text-ink-500">
        Device types, brands, series and models come from the catalogue seed and their structure is
        fixed here - a slug or a parent cannot be changed from this screen, because every product
        stores the path it was filed under. Names, aliases and visibility are editable.
      </p>

      {editing && <EditDialog node={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export default AdminTaxonomyPage;
