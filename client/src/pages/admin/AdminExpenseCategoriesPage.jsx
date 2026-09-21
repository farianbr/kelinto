import { useState } from 'react';
import { Link } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import { expenseCategorySchema } from '@shared/schemas/admin';
import { AlertCircle, Pencil, Plus, Power, Receipt, Tags, Trash2 } from 'lucide-react';
import { count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DeleteWithPreview from '@/components/admin/DeleteWithPreview';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import Checkbox from '@/components/ui/Checkbox';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminExpenseCategories, useAdminMutations } from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * Expense categories - how money out is grouped in the P&L (§6.9, §0.8).
 *
 * Admin-managed rather than an enum, and **a category in use is deactivated,
 * never deleted**: removing one would silently re-bucket every historical
 * expense that pointed at it, and the P&L would change shape for a reason
 * nobody could find later. The list carries each category's usage count so the
 * screen can say that *before* the staff member clicks, not after.
 */
const ADMIN_PAGE = {
  ...ADMIN_ROUTES['/admin/settings/expense-categories'],
  icon: adminIcon('Receipt'),
};

/**
 * The palette is the semantic vocabulary the rest of the panel uses (§2b) - a
 * category picks a meaning, not an arbitrary colour.
 */
const COLOR_TOKENS = [
  { value: 'ink', label: 'Neutral' },
  { value: 'brand', label: 'Brand' },
  { value: 'info', label: 'Info' },
  { value: 'ok', label: 'Positive' },
  { value: 'warn', label: 'Warning' },
  { value: 'danger', label: 'Critical' },
];

const SWATCH = {
  ink: 'bg-ink-300',
  brand: 'bg-brand',
  info: 'bg-info',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

function CategoryForm({ category, onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useAdminForm({
    // The same schema the route validates against, so a name the server would
    // refuse is caught here - on the field - rather than coming back as a
    // banner that names nothing.
    resolver: zodResolver(expenseCategorySchema),
    defaultValues: {
      name: category?.name ?? '',
      colorToken: category?.colorToken ?? 'ink',
      gstApplicable: category?.gstApplicable ?? true,
      isActive: category?.isActive ?? true,
      order: category?.order ?? 0,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Input
        label="Name"
        placeholder="Shop supplies"
        required
        error={errors.name?.message}
        {...register('name')}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField control={control} name="colorToken" label="Colour" options={COLOR_TOKENS} />
        <Input
          label="Sort order"
          type="number"
          min="0"
          placeholder="0"
          hint="Lower numbers come first on the expense form."
          error={errors.order?.message}
          {...register('order')}
        />
      </div>

      <Checkbox
        label="GST/HST is normally claimable on this category"
        {...register('gstApplicable')}
      />
      <Checkbox label="Active - offered on the expense form" {...register('isActive')} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {category ? 'Save category' : 'Add category'}
        </Button>
      </div>
    </form>
  );
}

export function AdminExpenseCategoriesPage() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [notice, setNotice] = useState(null);

  const { data, isLoading } = useAdminExpenseCategories();
  const { createExpenseCategory, updateExpenseCategory, deleteExpenseCategory } =
    useAdminMutations();

  const categories = data?.categories ?? [];

  // A page of rows for the table; counts and tiles still read the full set.
  const { pageRows: pageCategories, page, totalPages, from, setPage } = useTablePage(categories);

  function toPayload(values) {
    return {
      name: values.name,
      colorToken: values.colorToken,
      gstApplicable: Boolean(values.gstApplicable),
      isActive: Boolean(values.isActive),
      order: Number(values.order) || 0,
    };
  }

  const columns = [
    {
      key: 'name',
      header: 'Category',
      priority: 1,
      render: (category) => (
        <span className="flex items-center gap-2">
          <span
            className={`size-2.5 shrink-0 rounded-full ${SWATCH[category.colorToken] ?? SWATCH.ink}`}
            aria-hidden="true"
          />
          <span className="truncate text-sm text-ink-900">{category.name}</span>
        </span>
      ),
    },
    {
      key: 'slug',
      header: 'Slug',
      priority: 3,
      render: (category) => (
        <span className="font-mono text-xs text-ink-400">{category.slug}</span>
      ),
    },
    {
      key: 'gstApplicable',
      header: 'GST/HST',
      priority: 2,
      render: (category) => (
        <Badge tone={category.gstApplicable ? 'info' : 'neutral'} size="sm">
          {category.gstApplicable ? 'claimable' : 'not claimable'}
        </Badge>
      ),
    },
    {
      key: 'usage',
      header: 'Expenses',
      priority: 2,
      align: 'right',
      className: 'tnum',
      render: (category) => (
        <>
          <span className="text-sm text-ink-900">{formatCount(category.usage)}</span>
          {category.usage > 0 && (
            <span className="block text-2xs text-ink-400">cannot delete</span>
          )}
        </>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      priority: 1,
      render: (category) => (
        <Badge tone={category.isActive ? 'ok' : 'neutral'} size="sm">
          {category.isActive ? 'active' : 'inactive'}
        </Badge>
      ),
    },
  ];

  const rowMenu = [
    { key: 'edit', label: 'Edit category', icon: Pencil, onSelect: setEditing },
    {
      key: 'toggle',
      label: (category) => (category.isActive ? 'Deactivate' : 'Reactivate'),
      icon: Power,
      onSelect: (category) =>
        updateExpenseCategory.mutate({
          id: category.id,
          name: category.name,
          colorToken: category.colorToken,
          gstApplicable: category.gstApplicable,
          order: category.order,
          isActive: !category.isActive,
        }),
    },
    {
      /*
        Delete, and only delete.

        This read "Deactivate (in use)" for a category with expenses against
        it, because the server deactivates rather than deletes one - honest,
        but it put a SECOND Deactivate in a menu whose row above already said
        Deactivate, so the menu offered what looked like the same action twice
        and neither said which one differed. The rule has not changed; where it
        is stated has. Delete is offered when it can happen and disabled with
        the count when it cannot, which says why rather than renaming itself
        into the row above.
      */
      key: 'delete',
      label: 'Delete category',
      icon: Trash2,
      tone: 'danger',
      disabled: (category) => category.usage > 0,
      hint: (category) =>
        category.usage > 0
          ? `Used by ${category.usage} ${category.usage === 1 ? 'expense' : 'expenses'}`
          : null,
      onSelect: setDeleting,
    },
  ];

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <>
            <Link
              to="/admin/expenses"
              className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
            >
              <Receipt className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              Expenses
            </Link>
            <Button onClick={() => setCreating(true)} icon={Plus}>
              Add category
            </Button>
          </>
        }
      />

      {notice && (
        <p className="mb-3 rounded-md bg-warn-50 px-3 py-2.5 text-sm text-warn">{notice}</p>
      )}

      <Panel flush>
        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={categories.length}
            shown={pageCategories.length}
            from={from}
            noun={categories.length === 1 ? 'category' : 'categories'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={pageCategories}
          rowKey={(category) => category.id}
          rowMenu={rowMenu}
          loading={isLoading}
          defaultSort={{ key: 'order', direction: 'asc' }}
          empty={
            <PanelEmpty
              icon={Tags}
              title="No categories yet"
              body="Every expense is filed under a category - add the first one."
              action={
                <Button onClick={() => setCreating(true)} icon={Plus} size="sm">
                  Add category
                </Button>
              }
            />
          }
        />

        <Pagination
          page={page}
          pages={totalPages}
          onChange={setPage}
          hideWhenSingle
          className="border-t border-line px-3 py-3 sm:px-4"
        />
      </Panel>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add a category"
        size="md"
        align="top"
      >
        {creating && (
          <CategoryForm
            isPending={createExpenseCategory.isPending}
            error={createExpenseCategory.error?.message}
            onCancel={() => setCreating(false)}
            onSubmit={(values) =>
              createExpenseCategory.mutate(toPayload(values), {
                onSuccess: () => setCreating(false),
              })
            }
          />
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit category"
        size="md"
        align="top"
      >
        {editing && (
          <CategoryForm
            category={editing}
            isPending={updateExpenseCategory.isPending}
            error={updateExpenseCategory.error?.message}
            onCancel={() => setEditing(null)}
            onSubmit={(values) =>
              updateExpenseCategory.mutate(
                { id: editing.id, ...toPayload(values) },
                { onSuccess: () => setEditing(null) },
              )
            }
          />
        )}
      </Modal>

      {/* The count comes from the server rather than the row in hand: the list
          is cached, and "used by 0 expenses" from a stale row is exactly the
          number somebody would act on. The title still swings on the local
          `usage` so it reads correctly before the preview lands. */}
      <DeleteWithPreview
        type="expense-category"
        record={deleting}
        onClose={() => setDeleting(null)}
        title={
          deleting
            ? `${deleting.usage > 0 ? 'Deactivate' : 'Delete'} ${deleting.name}?`
            : undefined
        }
        confirmLabel={deleting?.usage > 0 ? 'Deactivate' : 'Delete category'}
        loading={deleteExpenseCategory.isPending}
        error={deleteExpenseCategory.error?.message}
        onConfirm={() =>
          deleteExpenseCategory.mutate(deleting.id, {
            onSuccess: (payload) => {
              // The response says which of the two actually happened; reporting
              // "deleted" for a deactivation would be a lie the staff member acts on.
              setNotice(payload?.deactivated ? payload.message : null);
              setDeleting(null);
            },
          })
        }
      />
    </div>
  );
}

export default AdminExpenseCategoriesPage;
