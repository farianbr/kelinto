import { useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Lock, Plus, Trash2, UsersRound } from 'lucide-react';
import { staffUserSchema } from '@shared/schemas/admin';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import PhoneField from '@/components/ui/PhoneField';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import FilterStrip from '@/components/admin/FilterStrip';
import KpiRow from '@/components/admin/KpiRow';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminStaff, useAdminRoles, useAdminBusinesses, useAdminMutations } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { date as formatDate } from '@/lib/format';

/**
 * Staff accounts - who can sign in to the panel, and as what (§6.15/3, §7.6).
 *
 * **Cellvix people only.** Customers have their own screen under Clients, and
 * mixing the two populations in one table is how a staff member ends up handing a
 * buyer a staff role. The server filters to `admin` and `staff`; this screen
 * never asks for anyone else.
 *
 * Admin-only, deliberately: creating users is one of the things §7.6 keeps away
 * from the role system entirely, because a role that can mint accounts can mint
 * itself a better one.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/users'], icon: adminIcon('UsersRound') };

function StaffForm({ roles, businesses, onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(staffUserSchema),
    defaultValues: { name: '', email: '', password: '', phone: '', accountType: 'staff', staffRole: '', business: '' },
  });

  const accountType = watch('accountType');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" error={errors.name?.message} {...register('name')} />
        <Input label="Email" error={errors.email?.message} {...register('email')} />
        <Input
          label="Password"
          type="password"
          hint="At least 8 characters."
          error={errors.password?.message}
          {...register('password')}
        />
        <Controller
          name="phone"
          control={control}
          render={({ field }) => (
            <PhoneField
              label="Phone"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.phone?.message}
            />
          )}
        />

        <SelectField
          control={control}
          name="accountType"
          label="Account type"
          options={[
            { value: 'staff', label: 'Staff' },
            { value: 'admin', label: 'Administrator' },
          ]}
        />

        {/* An administrator holds no role: admin bypasses the permission map
            entirely, so offering one would imply a limit that does not exist. */}
        {accountType === 'staff' && (
          <SelectField
            control={control}
            name="staffRole"
            label="Role"
            error={errors.staffRole?.message}
            options={roles
              .filter((role) => !role.isSystem)
              .map((role) => ({ value: role.id, label: role.name }))}
          />
        )}

        <SelectField
          control={control}
          name="business"
          label="Business"
          options={[
            { value: '', label: 'Unassigned' },
            ...businesses.map((business) => ({ value: business.id, label: business.name })),
          ]}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Create account
        </Button>
      </div>
    </form>
  );
}

export function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(null);
  // Locking is reversible from the same menu entry, but it signs the person out
  // of the admin panel, so it no longer fires straight off the row menu.
  const [locking, setLocking] = useState(null);
  const [error, setError] = useState(null);

  const { user: me } = useAuth();
  const params = useMemo(() => {
    const next = {};
    if (search) next.search = search;
    if (roleFilter !== 'all') next.role = roleFilter;
    return Object.keys(next).length ? next : undefined;
  }, [search, roleFilter]);

  const { data, isLoading } = useAdminStaff(params);
  const { data: rolesData } = useAdminRoles();
  const { data: businessesData } = useAdminBusinesses();
  const { createStaff, updateStaff, deleteStaff } = useAdminMutations();

  const users = data?.users ?? [];

  // A page of rows for the table; counts and tiles still read the full set.
  const { pageRows: pageStaff, page, totalPages, from, setPage } = useTablePage(users);
  const summary = data?.summary ?? {};
  const roles = rolesData?.roles ?? [];
  const businesses = businessesData?.businesses ?? [];

  const tiles = [
    { label: 'Total', value: summary.total ?? 0, tone: 'brand', icon: UsersRound },
    { label: 'Active', value: summary.active ?? 0, tone: 'ok' },
    { label: 'Inactive', value: summary.inactive ?? 0, tone: 'neutral' },
    { label: 'Admins', value: summary.admins ?? 0, tone: 'info' },
    { label: 'Staff', value: summary.staff ?? 0, tone: 'info' },
    { label: 'Locked', value: summary.locked ?? 0, tone: 'danger' },
  ];

  // Static, like every other screen's: `onSelect` receives the row, so the
  // lock label is decided per row inside the handler rather than by rebuilding
  // the menu for each one.
  const rowMenu = [
    {
      key: 'lock',
      label: 'Lock / unlock account',
      icon: Lock,
      onSelect: (row) => setLocking(row),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      tone: 'danger',
      onSelect: (row) => setConfirming(row),
    },
  ];

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink-900">{row.name}</span>
          {/* The staff member needs to know which row is theirs before they act on
              it - the self-lock and self-delete rules refuse anyway, but a chip
              explains it before the error does. */}
          {String(row.id) === String(me?.id) && (
            <Badge tone="brand" size="sm">
              You
            </Badge>
          )}
        </div>
      ),
    },
    { key: 'email', header: 'Email', render: (row) => <span className="text-ink-500">{row.email}</span> },
    {
      key: 'role',
      header: 'Role',
      render: (row) =>
        row.accountType === 'admin' ? (
          <Badge tone="dark" size="sm">
            Administrator
          </Badge>
        ) : (
          <span>{row.role?.name ?? <span className="text-danger">No role</span>}</span>
        ),
    },
    { key: 'business', header: 'Business', render: (row) => row.business?.name ?? '-' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.locked ? 'danger' : 'ok'} size="sm">
          {row.locked ? 'Locked' : 'Active'}
        </Badge>
      ),
    },
    {
      key: 'lastLoginAt',
      header: 'Last login',
      render: (row) => (row.lastLoginAt ? formatDate(row.lastLoginAt) : 'Never'),
    },
  ];

  async function handleCreate(values) {
    setError(null);
    try {
      await createStaff.mutateAsync({ ...values, business: values.business || undefined });
      setAdding(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmDelete() {
    setError(null);
    try {
      await deleteStaff.mutateAsync(confirming.id);
      setConfirming(null);
    } catch (err) {
      // The last-admin and self-delete rules answer here. The server's sentence
      // names what to do first, so it is shown rather than replaced.
      setError(err.message);
    }
  }

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            Add user
          </Button>
        }
      />

      <KpiRow tiles={tiles} />

      <Panel flush>
        <FilterStrip
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search staff by name or email"
          pills={[
            { value: 'all', label: 'All roles' },
            { value: 'admin', label: 'Administrators' },
            ...roles.filter((r) => !r.isSystem).map((r) => ({ value: r.id, label: r.name })),
          ]}
          activePill={roleFilter}
          onPillChange={setRoleFilter}
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={users.length}
            shown={pageStaff.length}
            from={from}
            noun={users.length === 1 ? 'staff account' : 'staff accounts'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={pageStaff}
          loading={isLoading}
          empty={<PanelEmpty icon={UsersRound} title="No staff accounts" body="Add your first user." />}
          rowMenu={rowMenu}
        />

        <Pagination
          page={page}
          pages={totalPages}
          onChange={setPage}
          hideWhenSingle
          className="border-t border-line px-3 py-3 sm:px-4"
        />
      </Panel>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add staff account" size="lg">
        <StaffForm
          roles={roles}
          businesses={businesses}
          onSubmit={handleCreate}
          onCancel={() => setAdding(false)}
          isPending={createStaff.isPending}
          error={error}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => {
          setConfirming(null);
          setError(null);
        }}
        onConfirm={confirmDelete}
        title={`Delete ${confirming?.name ?? 'user'}?`}
        body="This permanently removes the staff account and the access that came with it."
        confirmPhrase={confirming?.name}
        confirmPhraseLabel="their name"
        confirmLabel="Delete account"
        loading={deleteStaff.isPending}
        error={error}
      />

      <ConfirmDialog
        open={Boolean(locking)}
        onClose={() => setLocking(null)}
        onConfirm={() =>
          updateStaff.mutate(
            { id: locking.id, locked: !locking.locked },
            { onSuccess: () => setLocking(null) },
          )
        }
        title={locking?.locked ? `Unlock ${locking.name}?` : `Lock ${locking?.name ?? 'this account'}?`}
        body={
          locking?.locked
            ? 'They get their admin access back with the same role and permissions they had before.'
            : 'They are signed out and cannot get back into the ERP until the account is unlocked. Nothing they have done is changed.'
        }
        tone={locking?.locked ? 'info' : 'danger'}
        confirmLabel={locking?.locked ? 'Unlock account' : 'Lock account'}
        loading={updateStaff.isPending}
        error={updateStaff.error?.message}
      />
    </>
  );
}

export default AdminUsersPage;
