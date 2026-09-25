import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supplierSchema } from '@shared/schemas/admin';
import { DEFAULT_COUNTRY } from '@shared/countries';
import useCreateParam from '@/hooks/useCreateParam';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Globe,
  Mail,
  Pencil,
  Phone,
  Plus,
  Power,
  Truck,
  Wallet,
} from 'lucide-react';
import { money, count as formatCount, date } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectField from '@/components/ui/SelectField';
import SelectMenu from '@/components/ui/SelectMenu';
import ComponentTypePicker from '@/components/admin/ComponentTypePicker';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Badge from '@/components/ui/Badge';
import ConsentChannels, { EMPTY_CONSENT } from '@/components/ui/ConsentChannels';
import PhoneField from '@/components/ui/PhoneField';
import PageHeader from '@/components/admin/PageHeader';
import AddressFields from '@/components/admin/AddressFields';
import FilterStrip from '@/components/admin/FilterStrip';
import KpiRow from '@/components/admin/KpiRow';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import ProcessStrip from '@/components/admin/ProcessStrip';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminSuppliers, useAdminMutations, useAdminAgreements } from '@/hooks/useAdmin';
import { useComponentTypes } from '@/hooks/useCatalog';
import { pressable } from '@/lib/motion';
import { toast } from '@/store/toastStore';
import cn from '@/lib/cn';

/**
 * Suppliers - the businesses Cellvix buys stock from (ERP rework §6.7).
 *
 * A **table**, matched to CellShoppe. This was a card grid, and §6.7 specified
 * one on the reasoning that suppliers are read as contacts rather than as rows.
 * That held while a supplier was only a name and a phone number. It stopped
 * holding once each one carried orders, spend and a last-order date: those are
 * columns, and fifteen cards is fifteen scattered pairs of figures that cannot
 * be compared or sorted. The contact detail survives inside the name cell as
 * live `mailto:`/`tel:` links, so nothing the card did for a staff member is lost.
 *
 * The `ProcessStrip` at the foot is the same one the Purchase Orders list
 * carries - a supplier is stage one of the purchase automation cycle, and both
 * screens showing the same seven stations is what makes it one pipeline rather
 * than two similar-looking rows.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/suppliers'], icon: adminIcon('Truck') };

const PILLS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const TERMS = [
  { value: 'prepaid', label: 'Prepaid' },
  { value: 'net15', label: 'Net 15' },
  { value: 'net30', label: 'Net 30' },
  { value: 'net60', label: 'Net 60' },
];

function termsLabel(value) {
  return TERMS.find((term) => term.value === value)?.label ?? value;
}

/**
 * Add or edit a supplier.
 *
 * `paymentTerms` reads the same vocabulary as a client's line of credit, the
 * other way round: what Cellvix owes this supplier, not what it is owed.
 */
function SupplierForm({ supplier, onSubmit, onCancel, isPending, error }) {
  // Fetched here rather than threaded through both call sites: the form is the
  // only thing that needs the list, and the query is cached.
  const { data: agreementData } = useAdminAgreements();
  const agreements = agreementData?.templates?.filter((row) => row.isActive) ?? [];
  /**
   * Consent is held outside the form, the way `CustomerForm` holds it.
   *
   * `undefined` until touched, and only sent when it is: an edit that never
   * went near the ticks must not restamp the consent date, and a create that
   * was not asked must not record four declines as though somebody had been.
   */
  const [consent, setConsent] = useState(
    supplier ? (supplier.contactConsent ?? EMPTY_CONSENT) : EMPTY_CONSENT,
  );
  const [consentDirty, setConsentDirty] = useState(false);

  /**
   * What this supplier sells, as component-type slugs.
   *
   * Held outside `useForm` because it is a set of toggles rather than a field
   * the same reason consent is. Unlike consent it is always sent: an empty list
   * is a real answer here ("we have not tagged them yet"), and it is the fact
   * that keeps them out of the request-for-quote picker.
   */
  const [componentTypes, setComponentTypes] = useState(supplier?.componentTypes ?? []);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useAdminForm({
    /*
      The shared schema, minus the two fields this form does not hold.

      `componentTypes` and `contactConsent` are attached in `submit` from
      state kept outside the form, so validating them here would fail on
      values the form has no control over. Everything else is exactly the
      payload the route receives.
    */
    resolver: zodResolver(supplierSchema.omit({ componentTypes: true, contactConsent: true })),
    defaultValues: {
      name: supplier?.name ?? '',
      code: supplier?.code ?? '',
      contactName: supplier?.contactName ?? '',
      email: supplier?.email ?? '',
      phone: supplier?.phone ?? '',
      website: supplier?.website ?? '',
      paymentTerms: supplier?.paymentTerms ?? 'net30',
      agreementTemplates: supplier?.agreementTemplates ?? [],
      address: {
        line1: supplier?.address?.line1 ?? '',
        line2: supplier?.address?.line2 ?? '',
        city: supplier?.address?.city ?? '',
        // Blank, not `ON`. Defaulting the region to Ontario meant every
        // supplier saved without touching that field was recorded as being in
        // Ontario - including the ones in Shenzhen.
        region: supplier?.address?.region ?? '',
        postal: supplier?.address?.postal ?? '',
        country: supplier?.address?.country ?? DEFAULT_COUNTRY,
      },
      notes: supplier?.notes ?? '',
      isActive: supplier?.isActive ?? true,
    },
  });

  /** Consent is attached only if somebody actually answered it. */
  function submit(values) {
    onSubmit({
      ...values,
      componentTypes,
      contactConsent: consentDirty ? consent : undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
        <Input
          label="Supplier name"
          required
          placeholder="e.g. MobileSentrix Canada"
          error={errors.name?.message}
          {...register('name')}
        />
        {/* A code is 3–4 characters. 100px holds that with room to spare. */}
        <Input label="Code" placeholder="SKC" {...register('code')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Contact person" placeholder="John Smith" {...register('contactName')} />
        <SelectField control={control} name="paymentTerms" label="Payment terms" options={TERMS} />
      </div>

      {/* Which documents they sign before they may quote.

          **Several, not one.** A supplier commonly signs a master supply
          agreement plus an NDA plus a quality annex; forcing a single choice
          meant pasting the second document into the first as extra clauses.

          Offered here rather than on a later screen because it is a commercial
          decision about this supplier - an overseas manufacturer and a local
          courier do not sign the same thing - and because a supplier created
          without one can trade immediately, which is a choice somebody should
          make deliberately rather than discover.

          Adding one to an existing supplier is the normal case, not an
          exception: they go back behind the gate and are warned on their
          dashboard until the new one is signed. */}
      <Controller
        control={control}
        name="agreementTemplates"
        render={({ field }) => (
          <div>
            <p className="mb-1.5 font-display text-sm font-semibold text-ink-900">
              Agreements to sign
            </p>
            {!agreements.length ? (
              <p className="text-sm text-ink-400">
                No agreements have been written yet.{' '}
                <Link
                  to="/admin/settings/agreements"
                  className="font-semibold text-brand hover:underline"
                >
                  Write one
                </Link>
                .
              </p>
            ) : (
              <>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {agreements.map((template) => {
                    const on = (field.value ?? []).includes(template.id);
                    return (
                      <button
                        key={template.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          field.onChange(
                            on
                              ? (field.value ?? []).filter((id) => id !== template.id)
                              : [...(field.value ?? []), template.id],
                          )
                        }
                        className={cn(
                          pressable,
                          'flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left',
                          on
                            ? 'border-ok/40 bg-ok-50'
                            : 'border-line bg-surface hover:border-line-strong',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                            on ? 'border-ok bg-ok text-white' : 'border-line-strong',
                          )}
                        >
                          {on && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-900">
                            {template.name}
                          </span>
                          <span className="block truncate text-xs text-ink-400">
                            v{template.version} · {template.clauses.length} clauses
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-ink-400">
                  They cannot send a price or a proforma invoice until every one of these is
                  signed. Leave all unticked if no agreement is required.
                </p>
              </>
            )}
          </div>
        )}
      />

      {/* Email keeps a full row - an address is genuinely long, and truncating
          one mid-domain while a 6-character postal box sits at the same width
          is what made this form feel oversized. Phone and website pair up
          because neither fills half of it. */}
      <Input
        label="Email"
        type="email"
        placeholder="orders@supplier.com"
        error={errors.email?.message}
        {...register('email')}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Controller
          name="phone"
          control={control}
          render={({ field }) => (
            <PhoneField
              label="Phone"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              // Short enough to sit under a half-width field on one line. The
              // country code is the part that matters and the picker already
              // shows it, so the hint only has to say why it is not optional.
              hint="Needed for WhatsApp."
            />
          )}
        />
        <Input
          label="Website"
          placeholder="https://…"
          error={errors.website?.message}
          {...register('website')}
        />
      </div>

      {/* Unit first, then street - the order they are said and written on an
          envelope. `line2` holds the unit, as it does everywhere else. */}
      <div className="grid gap-3 sm:grid-cols-[90px_1fr]">
        <Input label="Unit / apt" placeholder="101" {...register('address.line2')} />
        <Input label="Street address" placeholder="123 Main Street" {...register('address.line1')} />
      </div>

      {/* City, region, postal and country, all keyed off the country. A parts
          supplier is as likely to be in Shenzhen as in Edmonton, and this form
          asked every one of them for a Canadian province and an `A1A 1A1`
          postal code - it even kept its own array of thirteen bare province
          codes, so the select showed `ON` with no label saying Ontario. */}
      <AddressFields control={control} register={register} setValue={setValue} />

      <Textarea
        label="Notes"
        rows={3}
        placeholder="Payment terms, shipping info…"
        {...register('notes')}
      />

      {/* What they sell. This is the field a request for quote picks suppliers
          by, so an untagged supplier is one nobody can ask - which is why the
          hint says so rather than describing the control. */}
      <div>
        <p className="mb-1.5 font-display text-sm font-semibold text-ink-900">Component types</p>
        <p className="mb-2.5 text-sm text-ink-400">
          What this supplier sells. A request for quote finds suppliers by these
          tags - one with none set will never appear in the picker.
        </p>
        <ComponentTypePicker value={componentTypes} onChange={setComponentTypes} />
      </div>

      <div>
        <p className="mb-1.5 font-display text-sm font-semibold text-ink-900">
          Communication consent
        </p>
        <p className="mb-2.5 text-sm text-ink-400">
          Tick what the supplier agreed to. Recorded with today's date.
        </p>
        <ConsentChannels
          value={consent}
          onChange={(next) => {
            setConsent(next);
            setConsentDirty(true);
          }}
        />
        {supplier?.contactConsent?.at && !consentDirty && (
          // Ticks with no date behind them are just ticks. Saying when the
          // answer was taken is what makes the record defensible.
          <p className="mt-2 text-sm text-ink-400">
            Last recorded {date(supplier.contactConsent.at)}.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {supplier ? 'Save supplier' : 'Add supplier'}
        </Button>
      </div>
    </form>
  );
}

/**
 * The supplier's identity cell - name over the two ways to reach them.
 *
 * Email and phone are real `mailto:`/`tel:` links rather than plain text. This
 * is a contact list before it is a ledger: the staff member who opens it is usually
 * about to chase an order, and making them select-and-copy an address that was
 * already on screen is the kind of friction a table is supposed to remove.
 * They stop the row click so following one does not also open the profile.
 */
function SupplierIdentity({ supplier }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <span className="truncate font-display text-md font-semibold text-ink-900">
          {supplier.name}
        </span>
        {supplier.code && <span className="font-mono text-2xs text-ink-400">{supplier.code}</span>}
        {/* Terms lost their own line when the card became a row. They stay
            visible because they are what decides whether this supplier can be
            ordered from today or has to be paid up front. */}
        <span className="eyebrow text-ink-400">{termsLabel(supplier.paymentTerms)}</span>
      </span>

      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
        {supplier.email && (
          <a
            href={`mailto:${supplier.email}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1.5 hover:text-brand hover:underline"
          >
            <Mail className="size-3 shrink-0 text-ink-300" strokeWidth={2.5} aria-hidden="true" />
            <span className="truncate">{supplier.email}</span>
          </a>
        )}
        {supplier.email && supplier.phone && <span className="text-ink-300">·</span>}
        {supplier.phone && (
          <a
            href={`tel:${supplier.phone.replace(/[^\d+]/g, '')}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1.5 hover:text-brand hover:underline"
          >
            <Phone className="size-3 shrink-0 text-ink-300" strokeWidth={2.5} aria-hidden="true" />
            <span className="truncate">{supplier.phone}</span>
          </a>
        )}
      </span>
    </>
  );
}

/**
 * The component types a supplier is tagged with (§6.8a).
 *
 * **Three chips, then a count.** The tag list is what decides who can be asked
 * to price a part, so it belongs in the table rather than only in the edit
 * form - but a supplier carrying nine tags would otherwise set the height of
 * every row on the page. Three is enough to recognise a supplier by; the
 * overflow chip carries the rest in its `title` so the full list is one hover
 * away without a second request.
 *
 * Labels come from the catalogue-derived taxonomy, never from a constant here,
 * for the reason `ComponentTypePicker` gives - a slug with no matching type
 * falls back to showing the slug rather than rendering an empty chip.
 */
function SupplierTags({ slugs = [], labels }) {
  if (!slugs.length) return <span className="text-ink-300">-</span>;

  const shown = slugs.slice(0, 3);
  const rest = slugs.slice(3);

  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((slug) => (
        <Badge key={slug} tone="neutral" size="sm">
          {labels.get(slug) ?? slug}
        </Badge>
      ))}
      {rest.length > 0 && (
        <span
          className="tnum text-xs font-medium text-ink-400"
          title={rest.map((slug) => labels.get(slug) ?? slug).join(', ')}
        >
          +{rest.length}
        </span>
      )}
    </span>
  );
}

export function AdminSuppliersPage() {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  // Opened directly by `+ Create` (§7.2), which arrives with `?new=1`.
  const navigate = useNavigate();
  const [creating, setCreating] = useCreateParam();
  const [searchParams, setSearchParams] = useSearchParams();

  const status = searchParams.get('status') ?? 'all';
  const componentType = searchParams.get('componentType') ?? '';

  const { data, isLoading } = useAdminSuppliers({ status, q: query || undefined });

  // Slug → display name, from the same catalogue-derived list the tag picker
  // offers. `taxonomyService` aggregates it from live products, so a tag can
  // never name a component nothing is sold under.
  const { data: componentTypes = [] } = useComponentTypes();
  const typeLabels = new Map(componentTypes.map((type) => [type.slug, type.name]));
  const { createSupplier, updateSupplier, toggleSupplier, inviteSupplierPortal } =
    useAdminMutations();

  /**
   * Email the supplier a link to set a password for this business's portal,
   * and say honestly whether the email left. No password changes here: the
   * link does that, once, when the supplier uses it.
   */
  // Mail to a third party from one click: confirmed twice (Instructions §3.0.1).
  const [inviteFor, setInviteFor] = useState(null);

  function sendPortalInvite(row) {
    inviteSupplierPortal.mutate(row.id, {
      onSuccess: (result) => {
        setInviteFor(null);
        if (result.delivered) {
          toast.ok('Portal link sent', `${row.name} can set a password from the email. The link lasts 7 days.`);
        } else {
          // Nothing about their access changed: the email only carries a link.
          toast.error('The email did not send', `Nothing changed for ${row.name}. Check the mail settings and send it again.`);
        }
      },
      onError: (error) => {
        setInviteFor(null);
        toast.error('Nothing was sent', error.message);
      },
    });
  }

  /**
   * The tag filter is applied here rather than on the server.
   *
   * `listSuppliers` already caps at 300 rows and this table pages client-side,
   * so the whole set is in hand and a round-trip would buy nothing. The KPI
   * tiles keep reading the server's unfiltered counts, which is the rule the
   * status pills follow too - a tile that moved with the filter would stop
   * being the total it is labelled as.
   */
  const allSuppliers = data?.suppliers ?? [];
  const suppliers = componentType
    ? allSuppliers.filter((supplier) => (supplier.componentTypes ?? []).includes(componentType))
    : allSuppliers;

  // The KPI tiles are summed from the whole filtered set; the table gets a
  // page of it. See `useTablePage` for why paging is client-side.
  const { pageRows: pageSuppliers, page, totalPages, from, setPage } = useTablePage(suppliers);
  const counts = data?.counts ?? {};
  const totals = data?.totals ?? {};

  /**
   * `?edit=<id>` opens the edit form on arrival.
   *
   * The supplier profile's Edit button links here rather than carrying its own
   * copy of this modal - one form, one place it can drift. The row has to be
   * loaded before it can be edited, so this resolves against the fetched list
   * and clears the parameter once it has, which stops a back-navigation from
   * reopening a form the staff member already closed.
   *
   * Resolves against the UNFILTERED list: arriving with both `?edit=` and an
   * active tag filter must still open the form, and a supplier the filter
   * happens to exclude is still a supplier somebody asked to edit.
   */
  const editId = searchParams.get('edit');
  useEffect(() => {
    if (!editId || !allSuppliers.length) return;
    const match = allSuppliers.find((row) => row.id === editId);
    if (match) setEditing(match);

    const params = new URLSearchParams(searchParams);
    params.delete('edit');
    setSearchParams(params, { replace: true });
  }, [editId, allSuppliers, searchParams, setSearchParams]);

  function setStatus(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  }

  // In the URL rather than in local state, like `status` above: a purchasing
  // clerk who has narrowed the list to battery suppliers can send that link.
  function setComponentType(next) {
    const params = new URLSearchParams(searchParams);
    if (!next) params.delete('componentType');
    else params.set('componentType', next);
    setSearchParams(params, { replace: true });
  }

  const columns = [
    {
      key: 'name',
      header: 'Supplier',
      priority: 1,
      width: '30%',
      sortValue: (row) => row.name,
      render: (row) => <SupplierIdentity supplier={row} />,
    },
    {
      /**
       * What this supplier sells. The column that makes the tag system visible
       * - tags decide who appears in the picker when a purchase order goes out,
       * and a tag nobody can see on the list is a tag nobody maintains.
       *
       * Sorts on the count rather than the names: "who covers the most" is the
       * question the ordering answers, and sorting alphabetically by first tag
       * would rank on whichever one happened to be added first.
       */
      key: 'componentTypes',
      header: 'Tags',
      priority: 2,
      width: '20%',
      sortValue: (row) => (row.componentTypes ?? []).length,
      render: (row) => <SupplierTags slugs={row.componentTypes} labels={typeLabels} />,
    },
    {
      key: 'ordersCount',
      header: 'Orders',
      priority: 2,
      width: '10%',
      align: 'right',
      sortValue: (row) => row.ordersCount,
      render: (row) => <span className="tnum">{formatCount(row.ordersCount)}</span>,
    },
    {
      key: 'totalSpent',
      header: 'Total spent',
      priority: 1,
      width: '14%',
      align: 'right',
      sortValue: (row) => row.totalSpent,
      render: (row) => (
        <span className="tnum font-semibold text-ink-900">{money(row.totalSpent)}</span>
      ),
    },
    {
      key: 'lastOrderAt',
      header: 'Last order',
      priority: 3,
      width: '12%',
      // A supplier with no orders sorts as the oldest possible date rather than
      // as `null`, so "never ordered from" collects at one end of the sort
      // instead of scattering through it.
      sortValue: (row) => (row.lastOrderAt ? new Date(row.lastOrderAt).getTime() : 0),
      render: (row) =>
        row.lastOrderAt ? (
          <span className="tnum text-ink-700">{date(row.lastOrderAt)}</span>
        ) : (
          <span className="text-ink-400">Never</span>
        ),
    },
    {
      key: 'isActive',
      header: 'Status',
      priority: 2,
      width: '12%',
      sortValue: (row) => (row.isActive ? 'active' : 'inactive'),
      render: (row) => (
        <Badge tone={row.isActive ? 'ok' : 'neutral'} size="sm">
          {row.isActive ? 'active' : 'inactive'}
        </Badge>
      ),
    },
  ];

  /**
   * What the card's icon buttons used to do, moved into the row menu.
   *
   * The card carried an edit pencil, a website link and a power toggle as three
   * separate targets; a table row cannot afford three, and `View profile` is
   * the row click. `Visit website` hides itself when the supplier has no
   * website rather than rendering a dead item.
   */
  const rowMenu = [
    {
      key: 'profile',
      label: 'View profile',
      icon: ExternalLink,
      onSelect: (row) => navigate(`/admin/suppliers/${row.id}`),
    },
    {
      key: 'edit',
      label: 'Edit supplier',
      icon: Pencil,
      onSelect: (row) => setEditing(row),
    },
    {
      key: 'website',
      label: 'Visit website',
      icon: Globe,
      hidden: (row) => !row.website,
      onSelect: (row) => window.open(row.website, '_blank', 'noopener,noreferrer'),
    },
    /**
     * Email this supplier their portal link and a fresh password (§6.8a).
     *
     * Two entries for the same call, so the label tells the truth about which
     * of the two things is happening - a supplier who has never been invited
     * needs a different sentence from one whose contact changed. Hidden
     * entirely when there is no address: there would be nowhere to send it, and
     * an action that can only fail should not be offered.
     *
     * **The toast reports what actually happened**, so a clerk never waits for
     * an answer from a supplier who never got the message. Each opens a
     * confirmation first: it is mail to a third party.
     */
    {
      key: 'portal-invite',
      label: 'Send portal link',
      icon: Mail,
      hidden: (row) => !row.email || !row.isActive || Boolean(row.portalInviteAt),
      onSelect: (row) => setInviteFor(row),
    },
    {
      key: 'portal-resend',
      label: 'Resend portal link',
      icon: Mail,
      hidden: (row) => !row.email || !row.isActive || !row.portalInviteAt,
      onSelect: (row) => setInviteFor(row),
    },
    // Two entries rather than one with a computed tone: `ActionMenu` resolves
    // `hidden` per row but takes `tone` as a fixed value, and deactivating is
    // destructive where reactivating is not.
    {
      key: 'deactivate',
      label: 'Deactivate',
      icon: Power,
      tone: 'danger',
      hidden: (row) => !row.isActive,
      onSelect: (row) => toggleSupplier.mutate(row.id),
    },
    {
      key: 'reactivate',
      label: 'Reactivate',
      icon: Power,
      hidden: (row) => row.isActive,
      onSelect: (row) => toggleSupplier.mutate(row.id),
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
            <Link
              to="/admin/purchase-orders"
              className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
            >
              <ClipboardList className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              Purchase orders
            </Link>
            <Button onClick={() => setCreating(true)} icon={Plus}>
              Add supplier
            </Button>
          </>
        }
      />

      <KpiRow
        tiles={[
          {
            key: 'total',
            label: 'Total suppliers',
            value: formatCount(counts.all ?? 0),
            hint: 'Everyone on the books',
            icon: Truck,
          },
          {
            key: 'active',
            label: 'Active suppliers',
            value: formatCount(counts.active ?? 0),
            hint: 'Available to raise an order against',
            tone: 'ok',
            icon: CheckCircle2,
          },
          {
            key: 'orders',
            label: 'Total orders',
            value: formatCount(totals.orders ?? 0),
            // Says what is counted, because the figure excludes drafts and so
            // will not match the Purchase Orders list's own row count.
            hint: 'Raised and not cancelled',
            tone: 'info',
            icon: ClipboardList,
          },
          {
            key: 'spent',
            label: 'Total spent',
            value: money(totals.spent ?? 0),
            hint: 'Across every supplier, all time',
            tone: 'brand',
            icon: Wallet,
          },
        ]}
      />

      <Panel flush className="mb-3">
        <FilterStrip
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder="Name, code, contact or email…"
          pills={PILLS.map((pill) => ({ ...pill, count: counts[pill.value] }))}
          activePill={status}
          onPillChange={setStatus}
          activeFilterCount={componentType ? 1 : 0}
          onClearFilters={() => setComponentType('')}
          filters={
            <div>
              <p className="eyebrow mb-1.5 text-ink-400">Component type</p>
              <SelectMenu
                srLabel="Filter by component type"
                value={componentType}
                onChange={setComponentType}
                options={[
                  { value: '', label: 'All component types' },
                  ...componentTypes.map((type) => ({ value: type.slug, label: type.name })),
                ]}
                containerClassName="w-full"
              />
            </div>
          }
        />

        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine
            total={suppliers.length}
            shown={pageSuppliers.length}
            from={from}
            noun={suppliers.length === 1 ? 'supplier' : 'suppliers'}
          />
        </div>

        <DataTable
          columns={columns}
          rows={pageSuppliers}
          rowKey={(supplier) => supplier.id}
          rowMenu={rowMenu}
          onRowClick={(supplier) => navigate(`/admin/suppliers/${supplier.id}`)}
          loading={isLoading}
          defaultSort={{ key: 'name', direction: 'asc' }}
          empty={
            <PanelEmpty
              icon={Truck}
              title="No suppliers match"
              body="Try a different filter, or add the business you buy from."
              action={
                <Button onClick={() => setCreating(true)} icon={Plus} size="sm">
                  Add supplier
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

      {/* The same strip the Purchase Orders list carries. A supplier is stage
          one of that cycle, so the page that creates them shows where they sit
          in it - and both screens then describe one pipeline rather than two. */}
      <ProcessStrip title="Purchase automation cycle" current="supplier" />

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add a supplier"
        size="md"
        align="top"
      >
        <SupplierForm
          isPending={createSupplier.isPending}
          error={createSupplier.error?.message}
          onCancel={() => setCreating(false)}
          onSubmit={(values) =>
            createSupplier.mutate(values, {
              onSuccess: (payload) => {
                setCreating(false);
                // Straight to the supplier that was just added - the next thing
                // a staff member does is raise a purchase order against it.
                if (payload?.supplier?.id) navigate(`/admin/suppliers/${payload.supplier.id}`);
              },
            })
          }
        />
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit supplier"
        size="md"
        align="top"
      >
        {editing && (
          <SupplierForm
            supplier={editing}
            isPending={updateSupplier.isPending}
            error={updateSupplier.error?.message}
            onCancel={() => setEditing(null)}
            onSubmit={(values) =>
              updateSupplier.mutate(
                { id: editing.id, ...values },
                { onSuccess: () => setEditing(null) },
              )
            }
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(inviteFor)}
        onClose={() => setInviteFor(null)}
        onConfirm={() => inviteFor && sendPortalInvite(inviteFor)}
        tone="warn"
        title={`Email the portal link to ${inviteFor?.email ?? ''}?`}
        body={`${inviteFor?.name ?? 'The supplier'} gets a link to set a password for your supplier portal, valid for 7 days. Any earlier link stops working.`}
        confirmLabel="Send link"
        confirmPhrase={inviteFor?.email}
        loading={inviteSupplierPortal.isPending}
      />
    </>
  );
}

export default AdminSuppliersPage;
