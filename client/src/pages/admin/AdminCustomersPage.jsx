import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Controller } from 'react-hook-form';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  Ban,
  Building2,
  Eye,
  MapPin,
  Pencil,
  Plus,
  ShieldCheck,
  UserCheck,
  UserRound,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { PROVINCES } from '@shared/schemas/checkout';
import { COUNTRY_OPTIONS, DEFAULT_COUNTRY } from '@shared/countries';
import { clientCreateFormSchema } from '@shared/schemas/admin';
import { money, date, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import PhoneField from '@/components/ui/PhoneField';
import FormSection from '@/components/ui/FormSection';
import ConsentChannels, { EMPTY_CONSENT } from '@/components/ui/ConsentChannels';
import SelectField from '@/components/ui/SelectField';
import SelectMenu from '@/components/ui/SelectMenu';
import Pagination from '@/components/ui/Pagination';
import PageHeader from '@/components/admin/PageHeader';
import BadgeExplainer from '@/components/admin/BadgeExplainer';
import BulkBar from '@/components/admin/BulkBar';
import { STATUS_TONES } from '@/components/admin/ClientDetail';
import { TERMS } from '@/components/admin/ApproveClientForm';
import KpiRow from '@/components/admin/KpiRow';
import FilterStrip from '@/components/admin/FilterStrip';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import { PER_PAGE_OPTIONS, DEFAULT_PER_PAGE } from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminUsers, useAdminMutations } from '@/hooks/useAdmin';
import useCreateParam from '@/hooks/useCreateParam';
import downloadExport from '@/lib/exportDownload';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/**
 * Header metadata read from the same table the breadcrumb uses, so a page
 * title can never drift from its crumb.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/clients'], icon: adminIcon('Users') };

/**
 * Status pills. `?status=pending` is the Approvals view - the dashboard links
 * straight here, and the old `/admin/approvals` URL redirects to it - so the
 * filter lives in the URL rather than in local state.
 */
const PILLS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
];

/** Tier badge tones. Mirrors the profile's `TierPanel` so one account reads the same on both. */
const TIER_TONE = { standard: 'neutral', silver: 'info', gold: 'warn', platinum: 'brand' };

/** Rows per page. Matches the Tickets list, so the control reads the same everywhere. */

const CREATE_STATUS = [
  { value: 'approved', label: 'Approved - can see prices and order' },
  { value: 'pending', label: 'Pending - awaiting approval' },
];

/**
 * Opening a client account from this side of the panel (§7.2).
 *
 * It defaults to **approved**, because the admin filling this in *is* the
 * approval - asking them to create a pending account and then approve it a
 * moment later is a step that decides nothing. Pending stays available for an
 * account entered ahead of its paperwork.
 *
 * Credit terms sit beside the status for the same reason `ApproveClientForm`
 * carries them: deciding to do business with a company and deciding what credit to
 * extend it is one decision.
 */
/**
 * Opening a client account by hand.
 *
 * The four fields that make an account - who they are, how to reach them - are
 * the whole form until an admin asks for more: address and business details sit
 * in collapsed sections, because they are genuinely optional and a wall of
 * skippable inputs is what stops a form being finished.
 *
 * There is no password field. The server generates one and emails it with the
 * sign-in link, so the admin no longer has to invent a password and then pass
 * it on down a phone line.
 */
/**
 * `seedName` is what somebody typed into a customer picker before pressing
 * "Add a customer" - the quote and invoice builders hand it over rather than
 * dropping it, so the name they had already typed is not typed twice. Split on
 * the first space, the same shape the form holds names in.
 */
function ClientForm({ onSubmit, onCancel, isPending, error, seedName = '' }) {
  const [seedFirst, ...seedRest] = seedName.trim().split(/\s+/).filter(Boolean);

  const {
    register,
    handleSubmit,
    watch,
    control,
    setValue,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(clientCreateFormSchema),
    defaultValues: {
      firstName: seedFirst ?? '',
      lastName: seedRest.join(' '),
      businessName: '',
      email: '',
      phone: '',
      businessType: '',
      taxId: '',
      status: 'approved',
      terms: 'prepaid',
      creditLimitDollars: '0.00',
      address: {
        line1: '',
        line2: '',
        city: '',
        region: 'ON',
        postal: '',
        country: DEFAULT_COUNTRY,
      },
      contactConsent: EMPTY_CONSENT,
    },
  });

  const terms = watch('terms');
  const status = watch('status');
  const consent = watch('contactConsent');

  return (
    <form
      onSubmit={handleSubmit((values) =>
        onSubmit({
          // Composed here, exactly as the storefront sign-up does it:
          // `firstName` and `lastName` are a form affordance and never leave
          // the client.
          contactName: `${values.firstName} ${values.lastName}`.trim(),
          businessName: values.businessName || undefined,
          email: values.email,
          phone: values.phone,
          businessType: values.businessType || undefined,
          taxId: values.taxId || undefined,
          status: values.status,
          terms: values.terms,
          creditLimit: Math.round(Number(values.creditLimitDollars || 0) * 100) || 0,
          // An address is optional on the schema, but a half-typed one is not:
          // sent at all, it has to be complete, so an empty street line means
          // no address rather than a partial one the server has to reject.
          address: values.address.line1 ? values.address : undefined,
          // Absent rather than four falses when nothing was ticked - see the
          // note in `createUser`. Ticking nothing means nobody asked, which is
          // not the same fact as the customer declining every channel.
          contactConsent: Object.values(values.contactConsent).some(Boolean)
            ? values.contactConsent
            : undefined,
        }),
      )}
      className="space-y-4"
    >
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      {/* The required fields in their own slab, matching the storefront
          sign-up. The two forms open the same kind of account, and both now
          ask for a **person** first: the company name moved down into the
          optional business block, because an account is identified by who it
          is (§0) and plenty of customers are not a company at all. */}
      <FormSection title="Personal information" icon={UserRound} collapsible={false}>
        <div className="space-y-3">
          {/* Two fields, one stored value - `contactName` is what the model,
              the welcome mail and the approvals queue read, so the halves are
              composed on submit rather than split in the model. The same call
              as `PhoneField` and its dial code. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="First name"
              required
              autoComplete="given-name"
              placeholder="John"
              error={errors.firstName?.message}
              data-autofocus
              {...register('firstName')}
            />
            <Input
              label="Last name"
              required
              autoComplete="family-name"
              placeholder="Doe"
              error={errors.lastName?.message}
              {...register('lastName')}
            />
          </div>

          <Input
            label="Email"
            type="email"
            required
            placeholder="john@example.com"
            hint="Their sign-in, and where the credentials go."
            error={errors.email?.message}
            {...register('email')}
          />

          {/* Controlled rather than `register`d: the value is one composed
              string built from two controls, so the field needs it back on
              every render to know which code is selected. */}
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <PhoneField
                label="Phone"
                required
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                hint="Country code (default +1) + number - needed for WhatsApp."
                error={errors.phone?.message}
              />
            )}
          />
        </div>
      </FormSection>

      <FormSection title="Address" hint="optional" icon={MapPin}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <Input label="Unit / suite" placeholder="101" {...register('address.line2')} />
            <Input
              label="Street"
              placeholder="123 Main Street"
              error={errors.address?.line1?.message}
              {...register('address.line1')}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="City"
              placeholder="Toronto"
              error={errors.address?.city?.message}
              {...register('address.city')}
            />
            <SelectField
              control={control}
              name="address.region"
              label="Province"
              options={PROVINCES}
            />
            <Input
              label="Postal code"
              placeholder="A1A 1A1"
              error={errors.address?.postal?.message}
              {...register('address.postal')}
            />
          </div>

          {/* Prefilled with Canada, which is the answer for almost every
              account. It is asked at all because the postal-code rule depends
              on it: `A1A 1A1` is Canadian and validating a UK address against
              it would reject a correct one. */}
          <SelectField
            control={control}
            name="address.country"
            label="Country"
            options={COUNTRY_OPTIONS}
          />
        </div>
      </FormSection>

      {/* The company name lives here rather than at the top of the form. A
          customer may be a business or a person, and asking for a company name
          first told every private customer they were filling in the wrong
          form. */}
      <FormSection title="Business details" hint="optional" icon={Building2}>
        <div className="space-y-3">
          <Input
            label="Business name"
            placeholder="Northline Device Repair"
            error={errors.businessName?.message}
            {...register('businessName')}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Business type" placeholder="Repair shop" {...register('businessType')} />
            <Input label="Tax ID" placeholder="RT0001-88213" {...register('taxId')} />
          </div>
        </div>
      </FormSection>

      {/* CASL: what the customer has told us they agreed to. Left blank records
          nothing, which is what an account opened without asking should say. */}
      <FormSection
        title="Communication consent"
        hint="tick what the customer agreed to (CASL)"
        icon={ShieldCheck}
        collapsible={false}
      >
        <ConsentChannels
          value={consent}
          onChange={(next) => setValue('contactConsent', next, { shouldDirty: true })}
        />
        <p className="mt-3 text-xs leading-snug text-ink-400">
          Only tick a channel the customer actually agreed to. Leave them all clear if nobody has
          asked yet - the profile shows that as unrecorded rather than as a refusal.
        </p>
      </FormSection>

      {/* Not collapsible: these three decide what the account can do the
          moment it exists, so they are never something to skip past. */}
      <FormSection title="Trading terms" icon={Wallet} collapsible={false}>
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField control={control} name="status" label="Status" options={CREATE_STATUS} />
          <SelectField control={control} name="terms" label="Payment terms" options={TERMS} />
          <Input
            label="Credit limit"
            inputMode="numeric"
            suffix="CAD"
            disabled={terms === 'prepaid'}
            {...register('creditLimitDollars')}
          />
        </div>
      </FormSection>

      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-ink-500">
        {status === 'approved'
          ? 'This account can sign in, see wholesale pricing and order straight away.'
          : 'This account can sign in and browse, but sees no prices and cannot order until it is approved.'}{' '}
        A password is generated on save and emailed to {watch('email') || 'the address above'} with
        the sign-in link, so there is nothing to pass on by hand.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Create customer
        </Button>
      </div>
    </form>
  );
}

export function AdminCustomersPage() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Opened directly by `+ Create` (§7.2), which arrives with `?new=1`.
  const [creating, setCreating, createSeed] = useCreateParam(true, false, ['name']);
  const [selected, setSelected] = useState([]);
  // Which bulk status change is waiting to be confirmed. Both write to every
  // selected account one after another, so the count is what the dialog leads
  // with.
  const [bulkConfirm, setBulkConfirm] = useState(null);
  // Set when the account was created but its credentials email did not send.
  // Holds the created user so the notice can name them and still go to the
  // profile afterwards.
  const [mailWarning, setMailWarning] = useState(null);
  const { createUser, setUserStatus } = useAdminMutations();

  const status = searchParams.get('status') ?? 'all';
  const perPage = searchParams.get('perPage') ?? String(DEFAULT_PER_PAGE);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));

  const { data, isLoading } = useAdminUsers({ q: query || undefined, status });
  const users = data?.users ?? [];
  const counts = data?.counts ?? {};

  /**
   * Paging is done here rather than on the server, because `listUsers` already
   * answers with the whole filtered set (capped at 200) and every figure on this
   * screen is summed from it. Asking the server for one page would mean the KPI
   * row silently described only the page in view - a "Total customers" tile that
   * changes when you turn the page is worse than no tile.
   *
   * If the account list ever outgrows that cap, this moves server-side and the
   * tiles have to get their own aggregate rather than summing rows.
   */
  const size = Number(perPage);
  const totalPages = Math.max(1, Math.ceil(users.length / size));
  // A filter change can strand the URL on page 4 of a 2-page set; clamping on
  // read shows the last page rather than an empty table.
  const currentPage = Math.min(page, totalPages);
  const pageUsers = users.slice((currentPage - 1) * size, currentPage * size);

  function setParam(key, value) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === 'all') params.delete(key);
    else params.set(key, value);
    // Any change but the page itself returns to page 1: staying on page 3 of a
    // set that now has one page shows nothing.
    if (key !== 'page') params.delete('page');
    setSearchParams(params, { replace: true });
  }

  function setStatus(next) {
    setSelected([]);
    setParam('status', next);
  }

  /**
   * Bulk suspend / reinstate.
   *
   * **A pending account is never swept into `approved` by this.** Approval sets
   * a credit limit and payment terms per business, and `setUserStatus` writes
   * neither - reinstating a batch that happened to include a pending
   * registration would put an unvetted account on the catalogue with a $0 limit
   * and no terms, which is the approval gate failing open. Those rows are left
   * alone and reported, rather than silently dropped.
   *
   * Sequential rather than `Promise.all`: these are audited writes, and firing
   * forty at once at a shared Atlas instance is how a bulk action becomes a
   * partial one for reasons nobody can reconstruct afterwards.
   */
  async function runBulkStatus(next) {
    const rows = users.filter((user) => selected.includes(user.id));
    const eligible =
      next === 'approved' ? rows.filter((user) => user.status !== 'pending') : rows;
    const skipped = rows.length - eligible.length;

    for (const user of eligible) {
      await setUserStatus.mutateAsync({ id: user.id, status: next }).catch(() => {});
    }

    setSelected([]);

    if (skipped > 0) {
      window.alert(
        `${eligible.length} updated. ${skipped} pending ${skipped === 1 ? 'account was' : 'accounts were'} left alone - ` +
          'approving sets a credit limit and terms, so it is done one account at a time from the approvals queue.',
      );
    }
  }

  const totalAccounts = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const outstanding = users.reduce((sum, user) => sum + user.balance, 0);
  // Late money, summed from the same per-account figure the Overdue column
  // shows - the tile and the column can never disagree about what is late.
  const overdue = users.reduce((sum, user) => sum + (user.overdue ?? 0), 0);
  const storeCredit = users.reduce((sum, user) => sum + (user.storeCredit ?? 0), 0);

  /**
   * The column set a staff member actually reads a customer list for.
   *
   * Ordered as the eye scans: **who** they are, **what they cost us** (terms and
   * what is owed), **what they are worth** (lifetime value and invoice count),
   * **when we last heard from them**, then the actions. Money columns are
   * right-aligned so the digits line up down the page - the one thing that makes
   * a column of figures comparable at a glance.
   *
   * `priority` folds the tail away rather than dropping it (DataTable §4): at
   * tablet the value columns collapse into the expandable row, at mobile
   * everything but the customer and the actions does.
   */
  const columns = [
    {
      key: 'businessName',
      header: 'Customer',
      priority: 1,
      // `displayName`, never `businessName` directly (§0): the company name is
      // optional now, and a private customer would have rendered as a blank
      // cell. The server falls back to the contact's name.
      sortValue: (user) => user.displayName ?? user.contactName ?? '',
      render: (user) => (
        <>
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-md font-semibold text-ink-900">
              {user.displayName}
            </span>
            <Badge tone={STATUS_TONES[user.status]} size="sm">
              {user.status}
            </Badge>
            {/* The tier badge moved here when the Tag column went. Standard is
                the default and every account has it, so showing it forty times
                would be a column of the same word - only a tier somebody
                deliberately set is worth the ink. */}
            {user.tier && user.tier !== 'standard' && (
              <Badge tone={TIER_TONE[user.tier] ?? 'neutral'} size="sm">
                {user.tier}
              </Badge>
            )}
          </span>
          {/* The contact's name only when it is not already the line above:
              for a private customer `displayName` IS the contact name, and
              printing it twice reads as a rendering fault. */}
          <span className="block truncate text-xs text-ink-500">
            {user.displayName === user.contactName
              ? user.email
              : `${user.contactName} · ${user.email}`}
          </span>
        </>
      ),
    },
    {
      key: 'terms',
      header: 'Terms',
      priority: 2,
      sortValue: (user) => user.terms ?? '',
      render: (user) => (
        <>
          <span className="whitespace-nowrap text-sm font-medium text-ink-900">
            {user.terms === 'prepaid' ? 'Prepaid' : user.terms.replace('net', 'Net ')}
          </span>
          {user.creditLimit > 0 && (
            <span className="tnum block whitespace-nowrap text-2xs text-ink-400">
              {money(user.creditLimit)} limit
            </span>
          )}
        </>
      ),
    },
    {
      /**
       * Renamed from "Outstanding" - and pointed at a different number.
       *
       * The old column showed `balance`, which is everything owed on the line
       * of credit; an invoice raised yesterday on Net 30 sits in it and is not
       * late. Calling that "Overdue" would have overstated arrears on every
       * account in good standing, so the column now shows the unpaid remainder
       * of invoices whose due date has passed, with what is merely owed as the
       * subtitle underneath.
       */
      key: 'overdue',
      header: 'Due amount',
      priority: 2,
      align: 'right',
      className: 'tnum',
      sortValue: (user) => user.overdue ?? 0,
      render: (user) =>
        user.overdue > 0 ? (
          <>
            <span className="text-sm font-semibold text-danger">{money(user.overdue)}</span>
            <span className="block whitespace-nowrap text-2xs text-ink-400">
              {formatCount(user.overdueCount)}{' '}
              {user.overdueCount === 1 ? 'invoice' : 'invoices'} late
            </span>
          </>
        ) : user.balance > 0 ? (
          <>
            <span className="text-sm font-medium text-ink-900">{money(user.balance)}</span>
            <span className="block whitespace-nowrap text-2xs text-ink-400">owed, on time</span>
          </>
        ) : (
          <span className="text-xs text-ink-300">-</span>
        ),
    },
    {
      key: 'invoiceCount',
      header: 'Invoices',
      priority: 3,
      align: 'right',
      className: 'tnum',
      sortValue: (user) => user.invoiceCount ?? 0,
      render: (user) =>
        user.invoiceCount > 0 ? (
          <span className="text-sm text-ink-900">{formatCount(user.invoiceCount)}</span>
        ) : (
          <span className="text-xs text-ink-300">-</span>
        ),
    },
    {
      // Invoiced, not ordered: an order can be cancelled or never invoiced, and
      // the invoice is the document the business is accountable for (§9.1).
      key: 'lifetimeValue',
      header: 'Lifetime value',
      priority: 2,
      align: 'right',
      className: 'tnum',
      sortValue: (user) => user.lifetimeValue ?? 0,
      render: (user) =>
        user.lifetimeValue > 0 ? (
          <span className="text-sm font-semibold text-ink-900">
            {money(user.lifetimeValue)}
          </span>
        ) : (
          <span className="text-xs text-ink-300">-</span>
        ),
    },
    {
      key: 'lastOrderedAt',
      header: 'Last ordered',
      priority: 3,
      align: 'right',
      // Sorted on the timestamp, displayed as a date: sorting the rendered
      // string would order "Apr" before "Jan".
      sortValue: (user) => (user.lastOrderedAt ? new Date(user.lastOrderedAt).getTime() : 0),
      render: (user) =>
        user.lastOrderedAt ? (
          <span className="tnum whitespace-nowrap text-sm text-ink-700">
            {date(user.lastOrderedAt)}
          </span>
        ) : (
          <span className="text-xs text-ink-300">Never</span>
        ),
    },
  ];

  /**
   * View and Edit behind the `···` menu, which is what `DataTable` already
   * renders in its own trailing column (§4).
   *
   * Two buttons sitting open in a cell cost a column of width on every row to
   * show the same two words forty times, and they are the widest thing in the
   * table on a screen where the figures matter more. The menu also puts these
   * actions where every other admin list already keeps them, so the gesture is
   * the same on Tickets, Orders and here.
   */
  const rowMenu = [
    {
      key: 'view',
      label: 'View',
      icon: Eye,
      onSelect: (user) => navigate(`/admin/clients/${user.id}`),
    },
    {
      key: 'edit',
      label: 'Edit',
      icon: Pencil,
      onSelect: (user) => navigate(`/admin/clients/${user.id}/edit`),
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <>
            {/* Review sits **beside** New customer rather than in the filter
                strip. It is the most time-sensitive thing on this screen
                accounts waiting on approval cannot see a price or place an
                order - and down in the toolbar it read as one more filter
                chip. Still absent when the queue is empty: a button that
                always says "Review 0" stops being read at all. */}
            {(counts.pending ?? 0) > 0 && (
              <Link
                to="/admin/approvals"
                className={cn(pressable, 'flex h-10 items-center gap-1.5 rounded-md border border-warn/30 bg-warn-50 px-3.5 text-md font-medium text-warn hover:border-warn/50')}
              >
                <UserCheck className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                Review {counts.pending}
              </Link>
            )}
            <Button onClick={() => setCreating(true)} icon={Plus}>
              New customer
            </Button>
          </>
        }
      />

      <BadgeExplainer />

      <KpiRow
        tiles={[
          {
            key: 'total',
            label: 'Total customers',
            value: formatCount(totalAccounts),
            hint: 'Business accounts registered',
            tone: 'brand',
            icon: Building2,
          },
          {
            key: 'pending',
            label: 'Pending',
            value: formatCount(counts.pending ?? 0),
            hint: 'Cannot see pricing or order',
            tone: (counts.pending ?? 0) > 0 ? 'warn' : 'ok',
            icon: UserCheck,
          },
          {
            key: 'balance',
            // Named to match the column, which shows the same figure - a tile
            // and a column that disagree about what to call one number read as
            // two different numbers.
            label: 'Due amount',
            value: money(overdue),
            // The tile shows what is late; the hint states what is merely owed,
            // so the two figures are never confused for each other.
            hint:
              overdue > 0
                ? `${money(outstanding)} owed in total`
                : `Nothing late · ${money(outstanding)} owed`,
            tone: overdue > 0 ? 'danger' : 'ok',
            icon: Wallet,
          },
          {
            key: 'credit',
            label: 'Store credit',
            value: money(storeCredit),
            hint: 'Refunds and allocations not yet spent',
            tone: 'info',
            icon: WalletCards,
          },
        ]}
      />

      <Panel flush>
        <FilterStrip
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Business name, contact or email…"
          pills={PILLS.map((pill) => ({
            ...pill,
            count: pill.value === 'all' ? totalAccounts : counts[pill.value],
          }))}
          activePill={status}
          onPillChange={setStatus}
          // Rows-per-page counts as an active filter only when it is off the
          // default, so the badge means "you have changed something" rather
          // than being permanently lit.
          activeFilterCount={perPage === String(DEFAULT_PER_PAGE) ? 0 : 1}
          onClearFilters={() => setParam('perPage', '')}
          filters={
            <div>
              <p className="eyebrow mb-1.5 text-ink-400">Rows</p>
              <SelectMenu
                srLabel="Rows per page"
                value={perPage}
                onChange={(next) => setParam('perPage', next)}
                options={PER_PAGE_OPTIONS}
                align="left"
                className="w-full"
              />
            </div>
          }
          onExport={(format) => downloadExport('clients', format, { q: query || undefined, status })}
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={users.length}
            shown={pageUsers.length}
            noun={users.length === 1 ? 'customer' : 'customers'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={pageUsers}
          rowKey={(user) => user.id}
          selectable
          selected={selected}
          onSelectionChange={setSelected}
          rowMenu={rowMenu}
          // One canonical URL per account (invariant 15): the row opens the
          // profile route rather than a drawer that shows the same record at a
          // different address.
          onRowClick={(user) => navigate(`/admin/clients/${user.id}`)}
          loading={isLoading}
          empty={
            <PanelEmpty
              icon={Building2}
              title="No customers match"
              body="Try a different filter or search."
            />
          }
        />

        {/* Shown even at one page, where it is a single disabled "1".
            Hidden entirely, the foot of the table changed shape depending on
            how many rows came back, and there was nothing to tell a staff member
            whether they were looking at all of them - a lone page 1 answers
            that. It still goes when there is nothing to page through at all. */}
        {users.length > 0 && (
          <div className="border-t border-line p-3">
            <Pagination
              page={currentPage}
              pages={totalPages}
              onChange={(next) => setParam('page', String(next))}
            />
          </div>
        )}
      </Panel>

      {/* Bulk status, and deliberately nothing else.
          `setUserStatus` is the one account-wide action that is real here,
          reversible and already audited. Approving in bulk is not offered: it
          sets a credit limit and terms per account, which is a decision made one
          business at a time - a batch approve would either invent one limit for
          everybody or quietly approve on none. */}
      <BulkBar count={selected.length} noun="selected" onClear={() => setSelected([])}>
        <Button
          size="xs"
          variant="outline"
          icon={Ban}
          loading={setUserStatus.isPending}
          onClick={() => setBulkConfirm('suspended')}
        >
          Suspend
        </Button>
        <Button
          size="xs"
          variant="outline"
          icon={UserCheck}
          loading={setUserStatus.isPending}
          onClick={() => setBulkConfirm('approved')}
        >
          Reinstate
        </Button>
      </BulkBar>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New customer"
        size="lg"
        align="top"
      >
        {creating && (
          <ClientForm
            // What was typed into a customer picker before "Add a customer"
            // was pressed, so the name survives the hop to this form.
            seedName={createSeed.name}
            isPending={createUser.isPending}
            error={createUser.error?.message}
            onCancel={() => setCreating(false)}
            onSubmit={(values) =>
              createUser.mutate(values, {
                onSuccess: (payload) => {
                  setCreating(false);
                  /**
                   * The credentials only exist in that email, so a send that
                   * did not happen has to be said out loud rather than left to
                   * be discovered when the customer cannot sign in. Nothing is
                   * held locally and nothing is retried, so this warning is the
                   * only notice the admin gets.
                   */
                  if (payload?.user?.welcomeEmail?.delivered === false) {
                    setMailWarning(payload.user);
                    return;
                  }
                  // Straight to the profile: the next thing a staff member does is
                  // set a store-credit balance or look at what they just typed.
                  if (payload?.user?.id) navigate(`/admin/clients/${payload.user.id}`);
                },
              })
            }
          />
        )}
      </Modal>

      {/* The account exists either way. What did not happen is the email that
          carries the only copy of its password.
          It deliberately does NOT tell the admin to send a password reset:
          `authController.forgotPassword` is still a 204 stub that mails
          nothing, so the only real remedy today is deleting the account and
          creating it again once mail is working. */}
      <ConfirmDialog
        open={Boolean(mailWarning)}
        onClose={() => {
          const id = mailWarning?.id;
          setMailWarning(null);
          if (id) navigate(`/admin/clients/${id}`);
        }}
        onConfirm={() => {
          const id = mailWarning?.id;
          setMailWarning(null);
          if (id) navigate(`/admin/clients/${id}`);
        }}
        title="Account created, but the email did not send"
        body={
          mailWarning
            ? `${mailWarning.displayName ?? mailWarning.email} exists and can be approved and dealt with as normal. What did not reach ${mailWarning.email} is the message carrying their password.`
            : ''
        }
        tone="danger"
        confirmLabel="Open their profile"
        cancelLabel="Stay here"
      />

      {/* Suspend stops every selected account trading; reinstate puts them back
          but leaves pending registrations alone, which the body says so the
          count in the dialog is not read as a promise. */}
      <ConfirmDialog
        open={Boolean(bulkConfirm)}
        onClose={() => setBulkConfirm(null)}
        onConfirm={async () => {
          await runBulkStatus(bulkConfirm);
          setBulkConfirm(null);
        }}
        title={
          bulkConfirm === 'suspended'
            ? `Suspend ${selected.length} ${selected.length === 1 ? 'account' : 'accounts'}?`
            : `Reinstate ${selected.length} ${selected.length === 1 ? 'account' : 'accounts'}?`
        }
        body={
          bulkConfirm === 'suspended'
            ? 'They keep their carts and their history, but none of them can place an order or see wholesale pricing until they are reinstated.'
            : 'Pending registrations in the selection are left alone: approving sets a credit limit and terms, and that is done one business at a time from the approvals queue.'
        }
        tone={bulkConfirm === 'suspended' ? 'danger' : 'info'}
        confirmLabel={bulkConfirm === 'suspended' ? 'Suspend accounts' : 'Reinstate accounts'}
        loading={setUserStatus.isPending}
      />
    </>
  );
}

export default AdminCustomersPage;
