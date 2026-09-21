import { useEffect, useState } from 'react';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';

import { saleSettingsSchema } from '@shared/schemas/admin';
import { PROVINCES } from '@shared/schemas/checkout';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import PageHeader from '@/components/admin/PageHeader';
import { useTableClasses, CountLine } from '@/components/admin/DataTable';
import { SettingsFormActions, PlaceholderNotice } from '@/components/admin/settings/SettingsForm';
import cn from '@/lib/cn';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { GRADES, GRADE_ORDER } from '@/lib/constants';
import { MEMBERSHIP_TIERS } from '@shared/schemas/admin';
import { useAdminSettings, useAdminMutations } from '@/hooks/useAdmin';
import useActiveBusinessName from '@/hooks/useActiveBusinessName';
import SelectMenu from '@/components/ui/SelectMenu';

/**
 * Sale Settings (§6.15, category 2) - the regional and invoicing defaults every
 * later screen reads.
 *
 * **Three deliberate divergences from CellShoppe**, each recorded in §6.15:
 *
 * 1. The flat "Default GST Rate" is a **per-province GST/HST table**. One rate
 *    is wrong the moment Cellvix ships outside Ontario, and a wholesaler ships
 *    across provinces by definition.
 * 2. "Warranty by membership tier" is **warranty by product grade**. Wholesale
 *    warranties on what the part is, not on who bought it - a new OEM screen
 *    carries a different promise from a Pull-B one regardless of the buyer.
 * 3. Currency is fixed CAD and is shown, not edited. Every amount in this system
 *    is CAD cents; a currency select would imply a conversion layer that does
 *    not exist.
 *
 * **Rates are entered as percentages and stored as fractions.** The model and
 * `Settings.rateFor` both work in fractions - 0.13, never 13 - and the schema
 * refuses anything above 0.35 for exactly the reason this conversion exists: a
 * percentage typed into a fraction field overcharges by two orders of magnitude
 * without throwing anything.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/sale'], icon: adminIcon('Coins') };

const TAX_KINDS = [
  { value: 'GST', label: 'GST only' },
  { value: 'HST', label: 'HST (combined)' },
  { value: 'GST+PST', label: 'GST + PST' },
  { value: 'GST+QST', label: 'GST + QST' },
];

/**
 * Timezones a business on this platform plausibly operates in. A free-text
 * field here is a way to store a string no date library can resolve.
 *
 * UTC is last rather than first: it is right for a business reporting across
 * regions, and wrong for the single-location shop that is the common case and
 * wants its own wall clock on a day's takings.
 */
const TIMEZONES = [
  { value: 'America/St_Johns', label: 'Newfoundland - America/St_Johns' },
  { value: 'America/Halifax', label: 'Atlantic - America/Halifax' },
  { value: 'America/Toronto', label: 'Eastern - America/Toronto' },
  { value: 'America/Winnipeg', label: 'Central - America/Winnipeg' },
  { value: 'America/Edmonton', label: 'Mountain - America/Edmonton' },
  { value: 'America/Vancouver', label: 'Pacific - America/Vancouver' },
  { value: 'UTC', label: 'UTC - Coordinated Universal Time' },
];

const provinceName = (code) => PROVINCES.find((p) => p.value === code)?.label ?? code;

/** Fraction to the percentage a staff member types, without float dust: 0.14975 → 14.975. */
const toPercent = (fraction) => String(Math.round(fraction * 1e6) / 1e4);
const toFraction = (percent) => Math.round(Number(percent) * 1e4) / 1e6;

export function AdminSaleSettingsPage() {
  const t = useTableClasses();
  const businessName = useActiveBusinessName();
  const { data, isLoading } = useAdminSettings();
  const { saveSaleSettings } = useAdminMutations();
  const [saved, setSaved] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useAdminForm({
    // The form works in percentages and the API in fractions, so the resolver
    // cannot be the shared schema directly - validation of the converted values
    // happens server-side, and the fields below carry their own bounds.
    resolver: zodResolver(saleSettingsSchema.omit({ taxRatesByProvince: true })),
    defaultValues: {
      timezone: 'America/Toronto',
      defaultDueDays: 30,
      rmaSlaDays: 14,
      ticketSlaDays: 7,
      // Cents, not dollars: the CRA rate carries a tenth of a cent.
      travelRateCentsPerKm: 56.7,
      // The floor the tier bonuses add to. 90 matches the schema default.
      warrantyBaseDays: 90,
      warrantyByGrade: {},
      warrantyBonusByTier: {},
    },
  });

  // The tax table is held outside RHF: it is a fixed-length grid of rows keyed
  // by province, not a list the staff member adds to, and a field array would buy
  // nothing over a plain object keyed on the province code.
  const [rates, setRates] = useState({});
  const [ratesDirty, setRatesDirty] = useState(false);

  useEffect(() => {
    if (!data?.financial || isDirty || ratesDirty) return;

    reset({
      timezone: data.financial.timezone,
      defaultDueDays: data.financial.defaultDueDays,
      rmaSlaDays: data.operations?.rmaSlaDays ?? 14,
      ticketSlaDays: data.operations?.ticketSlaDays ?? 7,
      travelRateCentsPerKm: data.financial?.travelRateCentsPerKm ?? 56.7,
      warrantyBaseDays: data.financial?.warrantyBaseDays ?? 90,
      warrantyByGrade: Object.fromEntries(
        GRADE_ORDER.map((grade) => [grade, data.financial.warrantyByGrade?.[grade] ?? 0]),
      ),
      warrantyBonusByTier: Object.fromEntries(
        MEMBERSHIP_TIERS.map((tier) => [
          tier.value,
          data.financial.warrantyBonusByTier?.[tier.value] ?? 0,
        ]),
      ),
    });

    setRates(
      Object.fromEntries(
        data.financial.taxRatesByProvince.map((row) => [
          row.province,
          { percent: toPercent(row.rate), kind: row.kind },
        ]),
      ),
    );
  }, [data, isDirty, ratesDirty, reset]);

  const dirty = isDirty || ratesDirty;

  async function onSubmit(values) {
    setSaved(false);
    try {
      const next = await saveSaleSettings.mutateAsync({
        ...values,
        taxRatesByProvince: Object.entries(rates).map(([province, row]) => ({
          province,
          rate: toFraction(row.percent),
          kind: row.kind,
        })),
      });

      reset({
        timezone: next.financial.timezone,
        defaultDueDays: next.financial.defaultDueDays,
        rmaSlaDays: next.operations?.rmaSlaDays ?? 14,
        ticketSlaDays: next.operations?.ticketSlaDays ?? 7,
        travelRateCentsPerKm: next.financial?.travelRateCentsPerKm ?? 56.7,
        warrantyBaseDays: next.financial?.warrantyBaseDays ?? 90,
        warrantyByGrade: Object.fromEntries(
          GRADE_ORDER.map((grade) => [grade, next.financial.warrantyByGrade?.[grade] ?? 0]),
        ),
        warrantyBonusByTier: Object.fromEntries(
          MEMBERSHIP_TIERS.map((tier) => [
            tier.value,
            next.financial.warrantyBonusByTier?.[tier.value] ?? 0,
          ]),
        ),
      });
      setRates(
        Object.fromEntries(
          next.financial.taxRatesByProvince.map((row) => [
            row.province,
            { percent: toPercent(row.rate), kind: row.kind },
          ]),
        ),
      );
      setRatesDirty(false);
      setSaved(true);
    } catch (err) {
      setError('root', { message: err.message });
    }
  }

  function editRate(province, patch) {
    setRates((current) => ({ ...current, [province]: { ...current[province], ...patch } }));
    setRatesDirty(true);
    setSaved(false);
  }

  if (isLoading) return <p className="text-sm text-ink-500">Loading settings…</p>;

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <PlaceholderNotice>
        The tax rates and warranty lengths below are seeded with standard figures and have not been
        confirmed by the business. Tax rates decide what every future invoice charges a customer;
        confirm them - including whether reseller exemptions apply - before relying on them.
      </PlaceholderNotice>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-form space-y-4">
        <Panel
          title="Application & regional"
          description={`Where ${businessName} operates, and in what currency.`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={control}
              name="timezone"
              label="Timezone"
              options={TIMEZONES}
              hint="Used for report date ranges and time-lapse invoice statuses."
              error={errors.timezone?.message}
            />
            <Input
              label="Currency"
              value="CAD - Canadian dollar"
              readOnly
              disabled
              hint="Fixed. Every amount in this system is stored in CAD cents."
            />
          </div>
        </Panel>

        <Panel
          title="Invoicing"
          description="The defaults a new invoice carries, and how long a return or a repair may sit before it is overdue."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              type="number"
              min="0"
              max="365"
              label="Default payment due days"
              suffix="days"
              hint="Net terms on an invoice with no other agreement."
              error={errors.defaultDueDays?.message}
              {...register('defaultDueDays')}
            />
            <Input
              type="number"
              min="1"
              max="365"
              label="RMA service level"
              suffix="days"
              hint="How long an RMA may sit before it is flagged as overdue."
              error={errors.rmaSlaDays?.message}
              {...register('rmaSlaDays')}
            />
            {/*
              Its own figure, not the RMA one reused. A return is goods in
              transit and is paced by a courier; a repair is work at a bench and
              is paced by the shop. The ticket board has measured against this
              since tickets shipped - nothing could set it until now.
            */}
            <Input
              type="number"
              min="1"
              max="365"
              label="Ticket service level"
              suffix="days"
              hint="How long a repair may stay open before the board flags it as overdue."
              error={errors.ticketSlaDays?.message}
              {...register('ticketSlaDays')}
            />
            <Input
              type="number"
              step="0.1"
              min="0"
              max="1000"
              label="Travel rate"
              suffix="¢/km"
              hint="What a kilometre is worth on an on-site repair. Internal cost, never billed - the service fee on the invoice is what a customer pays."
              error={errors.travelRateCentsPerKm?.message}
              {...register('travelRateCentsPerKm')}
            />
          </div>
        </Panel>

        <Panel
          title="GST/HST by province"
          description="The rate charged on an order, chosen by the shipping address. Entered as a percentage."
        >
          {/* Carries the density toggle - this grid follows the same density as
              every list table. */}
          <div className="mb-2 border-b border-line pb-2">
            <CountLine total={PROVINCES.length} noun="provinces" />
          </div>

          {/* Scrolls inside itself rather than pushing the page sideways - the
              table is 13 rows of three controls and a phone cannot fit them. */}
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-130 text-left">
              <thead>
                <tr className={t.headRow}>
                  <th scope="col" className={t.headCell()}>
                    Province
                  </th>
                  <th scope="col" className={t.headCell()}>
                    Rate
                  </th>
                  <th scope="col" className={t.headCell()}>
                    Kind
                  </th>
                </tr>
              </thead>
              <tbody>
                {PROVINCES.map((province) => {
                  const row = rates[province.value];
                  if (!row) return null;

                  return (
                    <tr key={province.value} className={t.row}>
                      <th scope="row" className={cn(t.cell(), 'font-medium text-ink-900')}>
                        <span className="tnum mr-2 text-ink-400">{province.value}</span>
                        {province.label}
                      </th>
                      <td className={t.cell()}>
                        <Input
                          type="number"
                          min="0"
                          max="35"
                          step="0.001"
                          suffix="%"
                          aria-label={`${province.label} tax rate`}
                          value={row.percent}
                          onChange={(event) => editRate(province.value, { percent: event.target.value })}
                          containerClassName="w-32"
                        />
                      </td>
                      <td className={t.cell()}>
                        {/* `SelectMenu`, not `SelectField`: the latter is the
                            react-hook-form wrapper and this row is hand-managed
                            state, so the primitive taking value/onChange
                            directly is the right one. */}
                        <SelectMenu
                          srLabel={`${province.label} tax kind`}
                          value={row.kind}
                          onChange={(next) => editRate(province.value, { kind: next })}
                          options={TAX_KINDS}
                          containerClassName="w-full min-w-[9rem]"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            <strong className="font-semibold text-ink-700">Kind is not cosmetic.</strong> HST is one
            combined tax; GST+PST are two taxes collected together. The tax report has to be able to
            say which, rather than printing one blended number.
          </p>
        </Panel>

        <Panel
          title="Warranty by grade"
          description="How long a part is covered, by what the part is. Zero means no warranty."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GRADE_ORDER.map((grade) => (
              <Input
                key={grade}
                type="number"
                min="0"
                max="3650"
                suffix="days"
                label={GRADES[grade]?.label ?? grade}
                error={errors.warrantyByGrade?.[grade]?.message}
                {...register(`warrantyByGrade.${grade}`)}
              />
            ))}
          </div>
        </Panel>

        <Panel
          title="Warranty bonus by membership tier"
          description="Extra days a tier adds on top of the grade above. Standard is the baseline, so it is zero."
        >
          {/* The floor, above the bonuses that add to it - the arithmetic reads
              top to bottom, which is the order the footnote below explains it in.
              It is what a REPAIR is covered for; the grade table above is what a
              PART is covered for, and a repair invoice makes both promises. */}
          <Input
            type="number"
            min="0"
            max="3650"
            suffix="days"
            label="Base warranty on a repair"
            hint="What every repair carries before any tier bonus. Printed on the ticket and in the warranty email."
            containerClassName="sm:max-w-64"
            error={errors.warrantyBaseDays?.message}
            {...register('warrantyBaseDays')}
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MEMBERSHIP_TIERS.map((tier) => (
              <Input
                key={tier.value}
                type="number"
                min="0"
                max="3650"
                suffix="days"
                label={tier.label}
                disabled={tier.value === 'standard'}
                error={errors.warrantyBonusByTier?.[tier.value]?.message}
                {...register(`warrantyBonusByTier.${tier.value}`)}
              />
            ))}
          </div>

          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            <strong className="font-semibold text-ink-700">A bonus, not a replacement.</strong> Cover
            is the grade&rsquo;s days plus the tier&rsquo;s, so a tier can only ever lengthen a
            warranty - a Gold customer&rsquo;s NEW part gets 365 + 90 days, not 90. A grade with no
            warranty gets none: a bonus extends cover that exists rather than creating it.
          </p>
        </Panel>

        <SettingsFormActions
          unsavedLabel="the sale settings"
          dirty={dirty}
          saving={isSubmitting || saveSaleSettings.isPending}
          saved={saved}
          error={errors.root?.message}
          onReset={() => {
            reset();
            // The tax table lives outside RHF, so `reset()` does not touch it
            // discarding has to put the server's rates back by hand, or the
            // form would report itself clean while still showing edited rates.
            setRates(
              Object.fromEntries(
                (data?.financial?.taxRatesByProvince ?? []).map((row) => [
                  row.province,
                  { percent: toPercent(row.rate), kind: row.kind },
                ]),
              ),
            );
            setRatesDirty(false);
            setSaved(false);
          }}
        />
      </form>
    </div>
  );
}

export default AdminSaleSettingsPage;
