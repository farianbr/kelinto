import { useState } from 'react';
import { Link } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import { rejectUserSchema } from '@shared/schemas/admin';
import { ArrowUpRight, Check, UserCheck, X } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { money, date } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import TabRow from '@/components/ui/TabRow';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import ApproveClientForm from '@/components/admin/ApproveClientForm';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminUsers, useAdminMutations } from '@/hooks/useAdmin';

const TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
];

/**
 * The reason a rejection carries.
 *
 * Exported because the customer profile rejects from its own pending banner
 * and must ask the same question the same way - the reason goes into the
 * notification email either way, and two prompts would eventually disagree
 * about what is required.
 */
export function RejectForm({ user, onSubmit, onCancel, isPending }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useAdminForm({
    // The inline rules here only checked for emptiness and a length of 3.
    // `rejectUserSchema` is what the route applies, so the two now agree.
    resolver: zodResolver(rejectUserSchema),
  });

  return (
    <form onSubmit={handleSubmit((values) => onSubmit(values.reason))} className="space-y-4">
      <p className="text-md text-ink-500">
        Rejecting <span className="font-medium text-ink-900">{user.displayName ?? user.email}</span>. The reason
        is stored on the account and goes into the notification email.
      </p>

      <Input
        label="Reason"
        placeholder="Could not verify the business registration."
        error={errors.reason?.message}
        data-autofocus
        required
        {...register('reason')}
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" loading={isPending}>
          Reject account
        </Button>
      </div>
    </form>
  );
}

const STATUS_TONES = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
  suspended: 'neutral',
};

/**
 * Header metadata read from the same table the breadcrumb uses, so a page
 * title can never drift from its crumb.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/approvals'], icon: adminIcon('ShieldCheck') };

export function AdminApprovalsPage() {
  const [status, setStatus] = useState('pending');
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  // Approve and reject each have a form the admin fills in deliberately.
  // Suspend was the one account-status change that fired on a single click.
  const [suspending, setSuspending] = useState(null);

  const { data, isLoading } = useAdminUsers({ status });
  const { approveUser, rejectUser, setUserStatus } = useAdminMutations();

  const users = data?.users ?? [];

  // A page of rows for the table; counts and tiles still read the full set.
  const { pageRows: pageUsers, page, totalPages, from, setPage } = useTablePage(users);
  const counts = data?.counts ?? {};

  /**
   * The columns.
   *
   * This screen was a list of cards, and the card was fighting itself. Every
   * row printed the account name in the heading and then the contact name again
   * underneath it, because for a sole trader they are the same person; four
   * pieces of metadata sat on one wrapped line behind four different icons, so
   * a staff member comparing two applications had to read prose rather than scan a
   * column; and each card carried its own Approve button in the brand gradient,
   * which put three gradients on a screen with three pending accounts.
   *
   * As a table each fact has a column and comparison is free. The actions
   * collapse into one column, and Approve is a plain solid button - a table row
   * is not the place for the page's signature treatment, and the staff member is
   * choosing between two adjacent actions rather than being pointed at one.
   */
  const columns = [
    {
      key: 'displayName',
      header: 'Business',
      width: '22%',
      sortValue: (user) => user.displayName ?? user.email,
      render: (user) => (
        <div className="min-w-0">
          {/* The name is the link, not the row: the row carries Approve and
              Reject, and a clickable container wrapping its own buttons is a
              nested click target that has to fight itself to work. */}
          <Link
            to={`/admin/clients/${user.id}`}
            className={cn(pressable, 'group inline-flex max-w-full items-center gap-1.5 font-display text-sm font-bold text-ink-900 hover:text-brand')}
          >
            <span className="truncate">{user.displayName ?? user.email}</span>
            <ArrowUpRight
              className="size-3.5 shrink-0 text-ink-300 opacity-0 transition-opacity group-hover:opacity-100"
              strokeWidth={2.25}
              aria-hidden="true"
            />
          </Link>
          {/* Only when it says something the line above does not. For a sole
              trader the business IS the person, and printing the same name
              twice is the card's old habit, not information. */}
          {user.contactName && user.contactName !== user.displayName && (
            <p className="truncate text-xs text-ink-400">{user.contactName}</p>
          )}
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Contact',
      width: '20%',
      priority: 2,
      render: (user) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-700">{user.email}</p>
          {user.phone && <p className="tnum truncate text-xs text-ink-400">{user.phone}</p>}
        </div>
      ),
    },
    {
      key: 'businessType',
      header: 'Industry',
      width: '12%',
      priority: 3,
      render: (user) => user.businessType || <span className="text-ink-300">-</span>,
    },
    {
      key: 'createdAt',
      header: 'Registered',
      width: '12%',
      priority: 2,
      sortValue: (user) => new Date(user.createdAt).getTime(),
      render: (user) => <span className="tnum text-sm">{date(user.createdAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '13%',
      render: (user) => (
        <div className="min-w-0">
          <Badge tone={STATUS_TONES[user.status]} size="sm">
            {user.status}
          </Badge>
          {/* An approved account's terms belong beside its status, which is the
              column a staff member reads to find out where the account stands. */}
          {user.status === 'approved' && user.terms && (
            <p className="tnum mt-1 truncate text-xs text-ink-400">
              {money(user.creditLimit)} · {user.terms.replace('net', 'Net ')}
            </p>
          )}
          {user.rejectionReason && (
            <p className="mt-1 truncate text-xs text-danger" title={user.rejectionReason}>
              {user.rejectionReason}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Decision',
      width: '21%',
      align: 'right',
      sortable: false,
      render: (user) => (
        <div className="flex justify-end gap-1.5">
          {user.status === 'pending' && (
            <>
              {/* `solid`, not the default gradient. One decision button per row
                  across a full screen of applications would put the treatment
                  reserved for a page's single most important action onto every
                  row of a list. */}
              <Button size="xs" variant="solid" icon={Check} onClick={() => setApproving(user)}>
                Approve
              </Button>
              <Button size="xs" variant="outline" icon={X} onClick={() => setRejecting(user)}>
                Reject
              </Button>
            </>
          )}

          {user.status === 'approved' && (
            <Button
              size="xs"
              variant="outline"
              loading={setUserStatus.isPending}
              onClick={() => setSuspending(user)}
            >
              Suspend
            </Button>
          )}

          {(user.status === 'rejected' || user.status === 'suspended') && (
            <Button size="xs" variant="outline" onClick={() => setApproving(user)}>
              Reinstate
            </Button>
          )}
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
        title="Registrations"
        description="Approve a business to unlock wholesale pricing and ordering."
        flush
      >
        {/* A real filter over one list, so the PILL variant: it is doing the
            same job as `FilterStrip` on every other list screen and has to
            look like it. Record-section tabs use the underline default. */}
        <TabRow
          tabs={TABS.map((item) => ({
            key: item.value,
            label: item.label,
            count: counts[item.value] > 0 ? counts[item.value] : undefined,
          }))}
          value={status}
          onChange={setStatus}
          label="Account status"
          variant="pills"
          className="border-b border-line p-3 sm:px-5"
        />

        {isLoading ? (
          <div className="space-y-2 p-4 sm:p-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <PanelEmpty
            icon={UserCheck}
            title={`No ${status} accounts`}
            body={
              status === 'pending'
                ? 'Every registered business has been reviewed.'
                : 'Nothing in this view.'
            }
          />
        ) : (
          <>
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <CountLine
                total={users.length}
                shown={pageUsers.length}
                from={from}
                noun={users.length === 1 ? 'business' : 'businesses'}
              />
            </div>

            <DataTable
              columns={columns}
              rows={pageUsers}
              rowKey={(user) => user.id}
              defaultSort={{ key: 'createdAt', direction: 'desc' }}
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
        open={Boolean(approving)}
        onClose={() => setApproving(null)}
        title="Approve business account"
        size="md"
        align="top"
      >
        {approving && (
          <ApproveClientForm
            user={approving}
            isPending={approveUser.isPending}
            error={approveUser.error?.message}
            onCancel={() => setApproving(null)}
            onSubmit={(body) =>
              approveUser.mutate(
                { id: approving.id, ...body },
                { onSuccess: () => setApproving(null) },
              )
            }
          />
        )}
      </Modal>

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Reject business account"
        size="sm"
      >
        {rejecting && (
          <RejectForm
            user={rejecting}
            isPending={rejectUser.isPending}
            onCancel={() => setRejecting(null)}
            onSubmit={(reason) =>
              rejectUser.mutate({ id: rejecting.id, reason }, { onSuccess: () => setRejecting(null) })
            }
          />
        )}
      </Modal>

      {/* Suspending stops the account trading immediately. It is reversible from
          this same screen with Reinstate, so it asks once rather than asking for
          the business name to be typed. */}
      <ConfirmDialog
        open={Boolean(suspending)}
        onClose={() => setSuspending(null)}
        onConfirm={() =>
          setUserStatus.mutate(
            { id: suspending.id, status: 'suspended' },
            { onSuccess: () => setSuspending(null) },
          )
        }
        title={`Suspend ${suspending?.displayName ?? 'this account'}?`}
        body="They keep their cart and history, but cannot order or see wholesale pricing until reinstated."
        tone="danger"
        confirmLabel="Suspend account"
        loading={setUserStatus.isPending}
        error={setUserStatus.error?.message}
      />
    </>
  );
}

export default AdminApprovalsPage;
