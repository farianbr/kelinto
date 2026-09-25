import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Building2,
  LayoutGrid,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Rows3,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react';
import { paletteFor } from '@shared/businessPalette.js';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminBusinesses, useAdminMutations } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { canEdit } from '@/lib/permissions';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';

/**
 * Businesses - the businesses this tenant operates (SAAS_PLATFORM §1.1).
 *
 * **This screen was Outlets.** An outlet was a physical shop inside one
 * business; a business is the thing that owns records and carries a **type**,
 * and the type is what decides which sections the panel renders. Cellvix is the
 * `product` business, CellShoppe the `service` one.
 *
 * **Each business carries a colour identity** so the staff member builds muscle
 * memory across the list and the switcher - drawn from the design system's
 * tokens, never arbitrary hex (§2b).
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/businesses'], icon: adminIcon('Store') };

/**
 * `Button` renders a real `<button>`, so anything that navigates is a styled
 * `<Link>` - the same shape `AdminClientProfilePage` uses. A button that
 * navigates is not reachable by middle-click or "open in new tab".
 */
const LINK_BTN =
  pressable +
  ' inline-flex h-8 items-center rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink-600 hover:border-line-strong hover:text-ink-900';
const LINK_ICON_BTN =
  pressable +
  ' inline-flex size-8 items-center justify-center rounded-md text-ink-500 hover:bg-surface-2 hover:text-ink-900';
const PRIMARY_LINK_BTN =
  pressable +
  ' inline-flex h-9 items-center gap-1.5 rounded-md bg-ink-900 px-3.5 text-sm font-medium text-white hover:bg-ink-800';

const STATUS_TONE = { active: 'ok', inactive: 'neutral', maintenance: 'warn' };
const STATUS_LABEL = { active: 'Active', inactive: 'Inactive', maintenance: 'Maintenance' };

/**
 * The card border, the icon wash and the row dot, painted from the palette.
 *
 * These were maps of Tailwind class names, which only worked while the
 * identity tokens WERE the semantic ones. The identity colours have no utility
 * classes and should not gain any - six extra ramps in the stylesheet to draw
 * a 10px dot is not a trade worth making, and the ramp is already in hand.
 */

function addressLine(address = {}) {
  return [address.street, address.city, address.region, address.postal]
    .filter(Boolean)
    .join(', ');
}

function BusinessCard({ business, editable, onDelete, onMakeDefault }) {
  const ramp = paletteFor(business.colorToken);

  return (
    <article
      className="flex flex-col rounded-lg border border-line border-t-[3px] bg-surface p-4"
      style={{ borderTopColor: ramp.base }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: ramp.c50, color: ramp.base }}
        >
          <Building2 className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-medium text-ink-900">{business.name}</h3>
            {/* The spec's YOU'RE HERE chip. With one business it always shows;
                with several it is the one an unattributed movement lands in. */}
            {business.isDefault && (
              <Badge tone="brand" size="sm">
                You&rsquo;re here
              </Badge>
            )}
          </div>
          <p className="mt-0.5 font-mono text-xs text-ink-400">{business.code}</p>
        </div>

        <Badge tone={STATUS_TONE[business.status] ?? 'neutral'} size="sm">
          {STATUS_LABEL[business.status] ?? business.status}
        </Badge>
      </div>

      <dl className="mt-4 flex flex-col gap-1.5 text-sm text-ink-500">
        {addressLine(business.address) && (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            <dd className="min-w-0">{addressLine(business.address)}</dd>
          </div>
        )}
        {business.phone && (
          <div className="flex items-center gap-2">
            <Phone className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            <dd>{business.phone}</dd>
          </div>
        )}
        {business.email && (
          <div className="flex items-center gap-2">
            <Mail className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            <dd className="truncate">{business.email}</dd>
          </div>
        )}
        <div className="flex items-center gap-2">
          <UserRound className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          <dd>
            {business.manager || 'No manager set'}
            <span className="text-ink-400">
              {' · '}
              {business.staffCount} {business.staffCount === 1 ? 'staff member' : 'staff'}
            </span>
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Link to={`/admin/businesses/${business.id}`} className={LINK_BTN}>
          View details
        </Link>
        {editable && (
          <>
            <Link
              to={`/admin/businesses/${business.id}/edit`}
              className={LINK_ICON_BTN}
              aria-label={`Edit ${business.name}`}
            >
              <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
            </Link>
            {!business.isDefault && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onMakeDefault(business)}
                  aria-label={`Make ${business.name} the default business`}
                >
                  <Star className="size-4" strokeWidth={2} aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => onDelete(business)}
                  aria-label={`Delete ${business.name}`}
                >
                  <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </article>
  );
}

export function AdminBusinessesPage() {
  const [search, setSearch] = useState('');
  const [view, setView] = useState('cards');
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState(null);

  const navigate = useNavigate();
  const { permissions } = useAuth();
  const editable = canEdit(permissions, 'business');

  const { data, isLoading } = useAdminBusinesses(search ? { search } : undefined);
  const { deleteBusiness, setDefaultBusiness } = useAdminMutations();

  const businesses = data?.businesses ?? [];

  // A page of rows for the table; counts and tiles still read the full set.
  const { pageRows: pageBusinesses, page, totalPages, from, setPage } = useTablePage(businesses);
  const summary = data?.summary ?? {};

  const tiles = useMemo(
    () => [
      { label: 'Total', value: summary.total ?? 0, tone: 'brand', icon: Building2 },
      { label: 'Active', value: summary.active ?? 0, tone: 'ok' },
      { label: 'Inactive', value: summary.inactive ?? 0, tone: 'neutral' },
      { label: 'Maintenance', value: summary.maintenance ?? 0, tone: 'warn' },
    ],
    [summary],
  );

  const columns = [
    {
      key: 'name',
      header: 'Business',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: paletteFor(row.colorToken).base }}
            aria-hidden="true"
          />
          <span className="font-medium text-ink-900">{row.name}</span>
          {row.isDefault && (
            <Badge tone="brand" size="sm">
              Default
            </Badge>
          )}
        </div>
      ),
    },
    { key: 'code', header: 'Code', render: (row) => <span className="font-mono text-xs">{row.code}</span> },
    { key: 'city', header: 'City', render: (row) => row.address?.city ?? '-' },
    { key: 'manager', header: 'Manager', render: (row) => row.manager || '-' },
    { key: 'staffCount', header: 'Staff', align: 'right', render: (row) => row.staffCount },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} size="sm">
          {STATUS_LABEL[row.status] ?? row.status}
        </Badge>
      ),
    },
  ];

  async function confirmDelete() {
    setError(null);
    try {
      await deleteBusiness.mutateAsync(confirming.id);
      setConfirming(null);
    } catch (err) {
      // The server refuses a default business or one with staff still on it.
      // Surfacing the real sentence beats a generic failure - it names the
      // thing the staff member has to do first.
      setError(err.message);
    }
  }

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description="Each business has its own colour, and the ERP wears it while you are working in that business."
        badge={
          <Badge tone="ok" size="sm">
            Live
          </Badge>
        }
        action={
          editable && (
            <Link to="/admin/businesses/add" className={PRIMARY_LINK_BTN}>
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              Add business
            </Link>
          )
        }
      />

      <KpiRow tiles={tiles} />

      <Panel
        flush
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search businesses"
              className="w-full sm:w-56"
              aria-label="Search businesses"
            />
            {/* Cards read better for one or two businesses; the table wins the
                moment there are enough to scan down a column. */}
            <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="View">
              {[
                { key: 'cards', label: 'Cards', icon: LayoutGrid },
                { key: 'table', label: 'Table', icon: Rows3 },
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setView(option.key)}
                  aria-pressed={view === option.key}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
                    view === option.key
                      ? 'bg-ink-900 text-white'
                      : 'text-ink-500 hover:bg-surface-2',
                  )}
                >
                  <option.icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {view === 'table' ? (
          <>
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <CountLine
                total={businesses.length}
                shown={pageBusinesses.length}
                from={from}
                noun={businesses.length === 1 ? 'business' : 'businesses'}
              />
            </div>

            <DataTable
              columns={columns}
              rows={pageBusinesses}
              loading={isLoading}
              onRowClick={(row) => navigate(`/admin/businesses/${row.id}`)}
              empty={<PanelEmpty icon={Building2} title="No businesses" body="Add your first business." />}
            />

            <Pagination
              page={page}
              pages={totalPages}
              onChange={setPage}
              hideWhenSingle
              className="border-t border-line px-3 py-3 sm:px-4"
            />
          </>
        ) : isLoading ? (
          <div className="p-4 text-sm text-ink-500">Loading businesses…</div>
        ) : businesses.length === 0 ? (
          <PanelEmpty
            icon={Building2}
            title="No businesses"
            body="Add your first business to start assigning staff."
            action={
              editable && (
                <Link to="/admin/businesses/add" className={PRIMARY_LINK_BTN}>
                  Add business
                </Link>
              )
            }
          />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {businesses.map((business) => (
              <BusinessCard
                key={business.id}
                business={business}
                editable={editable}
                onDelete={setConfirming}
                onMakeDefault={(row) => setDefaultBusiness.mutate(row.id)}
              />
            ))}
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => {
          setConfirming(null);
          setError(null);
        }}
        onConfirm={confirmDelete}
        title={`Delete ${confirming?.name ?? 'business'}?`}
        body="This removes the business permanently. Staff assigned to it must be moved first."
        confirmLabel="Delete business"
        loading={deleteBusiness.isPending}
        error={error}
      />
    </>
  );
}

export default AdminBusinessesPage;
