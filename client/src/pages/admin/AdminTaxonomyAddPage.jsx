import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Network, Save, Tags, Trash2 } from 'lucide-react';

import { taxonomyCreateSchema } from '@shared/schemas/admin';
import { FIRST_LEVEL_KEY, categoryLevels } from '@shared/catalog';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import SelectMenu from '@/components/ui/SelectMenu';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminCatalogCategories, useAdminMutations, useAdminTaxonomyRows, useAdminTaxonomyTree } from '@/hooks/useAdmin';

/**
 * One row of a type's category tree: add it, or edit it as a whole (client
 * rulings 2026-10-02: "adding an entry in the tree doesn't follow finder
 * levels"; "each row should be a single product tree following add row form,
 * also the rows should be editable").
 *
 * ## One name per level, the type's own levels
 *
 * The form asks for a name at every level the type has, its first level
 * included (Component Type › Device Type › Brand › Series › Model on Parts),
 * marked required exactly as the type says in Settings › Taxonomy. That is how
 * somebody adding "the new Pixel" thinks: they do not know whether a `Google`
 * entry exists, and making them find out first would be three screens to add
 * one phone. Each field suggests what is already there under the names above
 * it; the server matches each level by name or creates it.
 *
 * ## Editing a row
 *
 * The same form, filled in. A changed name renames that entry, and an entry is
 * shared: renaming Apple renames it in every row that has it, which the field
 * says when it is shared. The row's aliases and its on/off switch belong to
 * its deepest entry. A row cannot be moved under another brand from here,
 * because every item stores the path it was filed under; it can be removed
 * when nothing is filed on it.
 */
const PLACEHOLDER = {
  partType: 'Screen, Battery…',
  deviceType: 'Phone, Tablet, Laptop…',
  brand: 'Apple, Samsung, Google…',
  series: 'iPhone 17 Series, Galaxy S…',
  model: 'iPhone 17 Pro Max',
  level5: 'Pro Max',
  level6: '256 GB',
};

const BLANK = { partType: '', deviceType: '', brand: '', series: '', model: '', level5: '', level6: '', aliases: '' };

/** The entries already at one level, under the names typed above it. */
function existingAt(tree, values, keys, key) {
  let scope = tree ?? [];
  for (const above of keys.slice(0, keys.indexOf(key))) {
    const typed = String(values[above] ?? '').trim().toLowerCase();
    if (typed) {
      const node = scope.find((entry) => entry.kind === above && entry.name.toLowerCase() === typed);
      scope = node?.children ?? [];
    } else {
      scope = scope.flatMap((entry) => (entry.kind === above ? (entry.children ?? []) : [entry]));
    }
  }
  return scope.filter((entry) => entry.kind === key).map((entry) => entry.name);
}

export function AdminTaxonomyAddPage() {
  const navigate = useNavigate();
  const { createTaxonomyNode, updateTaxonomyRow, removeTaxonomyRow } = useAdminMutations();
  const [formError, setFormError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [params] = useSearchParams();
  const category = params.get('category') || 'parts';
  const rowId = params.get('row');
  const editing = Boolean(rowId);
  const route = ADMIN_ROUTES[editing ? '/admin/settings/taxonomy/row' : '/admin/settings/taxonomy/add'];

  const { data: categories = [] } = useAdminCatalogCategories();
  const current = categories.find((entry) => entry.slug === category);
  const { data: tree = [] } = useAdminTaxonomyTree(category);
  const { data: rowData } = useAdminTaxonomyRows(editing ? { category: category === 'parts' ? undefined : category } : undefined);
  const row = editing ? rowData?.rows?.find((entry) => entry.id === rowId) : null;
  const levels = current ? categoryLevels(current) : [];
  const treeKeys = levels.filter((level) => level.key !== FIRST_LEVEL_KEY).map((level) => level.key);
  const leafCell = row ? (levels.map((level) => row.cells[level.key]).filter(Boolean).at(-1) ?? null) : null;

  /** How many rows share each entry, so a rename can say how far it reaches. */
  const shared = useMemo(() => {
    const counts = new Map();
    for (const entry of rowData?.rows ?? []) {
      for (const cell of Object.values(entry.cells)) counts.set(cell.id, (counts.get(cell.id) ?? 0) + 1);
    }
    return counts;
  }, [rowData]);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useAdminForm({ resolver: zodResolver(taxonomyCreateSchema), defaultValues: BLANK });
  const values = watch();
  const [isActive, setIsActive] = useState(true);

  // The row's own names, once it has loaded.
  useEffect(() => {
    if (!row) return;
    reset({
      ...BLANK,
      ...Object.fromEntries(Object.entries(row.cells).map(([key, cell]) => [key, cell.name])),
      aliases: (leafCell?.aliases ?? []).join(', '),
    });
    setIsActive(leafCell?.isActive !== false);
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const treePage = category === 'parts' ? '/admin/settings/taxonomy/tree' : `/admin/settings/taxonomy/tree?category=${category}`;
  const back = () => navigate(treePage);

  async function onSubmit(form) {
    setFormError(null);
    try {
      if (editing) {
        const names = Object.fromEntries(levels.filter((level) => row.cells[level.key]).map((level) => [level.key, form[level.key]]));
        await updateTaxonomyRow.mutateAsync({ category, row: rowId, names, aliases: form.aliases, isActive });
      } else {
        // A required level left empty is named here, before the round trip.
        const missing = levels.find((level) => level.required !== false && !String(form[level.key] ?? '').trim());
        if (missing) {
          setFormError(`Name the ${missing.label.toLowerCase()}.`);
          return;
        }
        await createTaxonomyNode.mutateAsync({ ...form, category });
      }
      back();
    } catch (err) {
      // The server's messages name the record they collided with.
      setFormError(err.message);
    }
  }

  const rowName = row
    ? levels
        .map((level) => row.cells[level.key]?.name)
        .filter(Boolean)
        .join(' › ')
    : '';

  if (editing && rowData && !row) {
    return (
      <div className="form-page">
        <PageHeader icon={adminIcon(route.icon)} title="That row is not in the tree any more" description="It may have been removed or renamed." />
        <Button variant="outline" onClick={back}>
          Back to the category tree
        </Button>
      </div>
    );
  }

  return (
    <div className="form-page">
      <button
        type="button"
        onClick={back}
        className={cn(pressable, 'mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900')}
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        Back to the category tree
      </button>

      <PageHeader
        icon={adminIcon(route.icon)}
        title={editing ? (rowName || 'Edit row') : current ? `Add a row to ${current.name}` : 'Add a row'}
        description={
          editing
            ? 'Rename any level, set the aliases, or switch the row off. A shared entry is renamed in every row that has it.'
            : 'Every level of the type, top to bottom. Anything already there is matched by name; anything new is created.'
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Panel
          title={levels.map((level) => level.label).join(' › ') || 'Category levels'}
          description={
            editing
              ? 'A level shown as Any is one this row stops above, so it covers every entry there. A row cannot be narrowed here: add a new row for a specific device.'
              : 'Required levels are marked. An optional level may be left empty.'
          }
          icon={Network}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {levels.map((level) => {
              const cell = row?.cells[level.key];
              if (editing && !cell) {
                return (
                  <Input key={level.key} label={level.label} value="Any" disabled readOnly />
                );
              }
              const suggestions =
                level.key === FIRST_LEVEL_KEY
                  ? (current?.facetOptions ?? []).map((option) => option.label)
                  : existingAt(tree, values, treeKeys, level.key);
              const sharedBy = cell ? (shared.get(cell.id) ?? 1) : 0;
              if (editing) {
                return (
                  <Input
                    key={level.key}
                    label={level.label}
                    placeholder={PLACEHOLDER[level.key]}
                    autoComplete="off"
                    hint={sharedBy > 1 ? `Shared by ${sharedBy} rows: renaming it renames it in all of them.` : undefined}
                    error={errors[level.key]?.message}
                    {...register(level.key)}
                  />
                );
              }
              /**
               * Pick what is already there under the levels above, or type a
               * new name and add it: the same menu every picker in the ERP
               * uses, rather than the browser's own suggestion list.
               */
              const typed = String(values[level.key] ?? '');
              const options = [...new Set([...suggestions, ...(typed ? [typed] : [])])].map((name) => ({
                value: name,
                label: suggestions.includes(name) ? name : `${name} (new)`,
              }));
              const choose = (next) => {
                setValue(level.key, next, { shouldDirty: true });
                // A different entry above means the ones below were under another.
                // The first level cuts across the tree, so changing it clears nothing.
                if (treeKeys.includes(level.key)) {
                  for (const below of treeKeys.slice(treeKeys.indexOf(level.key) + 1)) setValue(below, '');
                }
              };
              return (
                <SelectMenu
                  key={level.key}
                  label={level.required !== false ? level.label : `${level.label} - optional`}
                  required={level.required !== false}
                  size="md"
                  align="left"
                  searchable
                  searchPlaceholder={`Find or type a ${level.label.toLowerCase()}…`}
                  placeholder={suggestions.length ? 'Select or add…' : `Add a ${level.label.toLowerCase()}…`}
                  options={[...(level.required !== false ? [] : [{ value: '', label: 'None' }]), ...options]}
                  value={typed}
                  onChange={choose}
                  onCreate={(name) => name && choose(name.trim())}
                  createLabel={`Add "{q}" as a new ${level.label.toLowerCase()}`}
                  createLabelEmpty={`Type a new ${level.label.toLowerCase()} in the search box`}
                  error={errors[level.key]?.message}
                />
              );
            })}
          </div>
        </Panel>

        <Panel title="Aliases" description="What staff or buyers might type that should find this row's deepest entry." icon={Tags}>
          <Textarea
            aria-label="Aliases"
            rows={3}
            placeholder="13 PM, 13 Pro Max, iphone13pm"
            hint="Comma-separated. Matching ignores case."
            error={errors.aliases?.message}
            {...register('aliases')}
          />
        </Panel>

        {editing && (
          <label className="flex items-start gap-2.5 rounded-md bg-surface-2 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            <span className="text-sm leading-relaxed text-ink-700">
              <span className="font-medium">Active</span>
              <span className="mt-0.5 block text-ink-500">
                Switched off, {leafCell?.name ?? 'its entry'} leaves the website filters and the pickers. Items already filed there stay on sale.
              </span>
            </span>
          </label>
        )}

        {formError && (
          <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button
            type="submit"
            icon={Save}
            loading={isSubmitting || createTaxonomyNode.isPending || updateTaxonomyRow.isPending}
          >
            {editing ? 'Save row' : 'Add row'}
          </Button>
          <Button type="button" variant="outline" onClick={back}>
            Cancel
          </Button>
          {editing && (
            <Button type="button" variant="ghost" icon={Trash2} className="ml-auto text-danger" onClick={() => setConfirmRemove(true)}>
              Remove row
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          try {
            await removeTaxonomyRow.mutateAsync({ category, row: rowId });
            setConfirmRemove(false);
            back();
          } catch (err) {
            setConfirmRemove(false);
            setFormError(err.message);
          }
        }}
        loading={removeTaxonomyRow.isPending}
        tone="danger"
        title={`Remove ${rowName}?`}
        body="It leaves the category tree and the pickers. Refused while anything is filed on it. Entries other rows still use are kept."
        confirmLabel="Remove row"
        confirmPhrase="remove"
      />
    </div>
  );
}

export default AdminTaxonomyAddPage;
