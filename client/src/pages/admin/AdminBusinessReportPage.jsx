import { Link, useSearchParams } from 'react-router';
import {
  AlertCircle,
  Boxes,
  Coins,
  Info,
  LineChart,
  Printer,
  Receipt,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react';
import cn from '@/lib/cn';
import { money, date, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/admin/PageHeader';
import { useTableClasses, CountLine } from '@/components/admin/DataTable';
import KpiRow from '@/components/admin/KpiRow';
import DateRangeBar, { useDateRange } from '@/components/admin/DateRangeBar';
import { BarList, DonutChart } from '@/components/admin/charts/Charts';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminReport } from '@/hooks/useAdmin';
import { useTaxonomy } from '@/hooks/useCatalog';
import Skeleton from '@/components/ui/Skeleton';
import { pressable } from '@/lib/motion';
import SelectMenu from '@/components/ui/SelectMenu';
import useActiveBusinessName from '@/hooks/useActiveBusinessName';

/**
 * Business Overview - the printable period report (ERP rework §6.11).
 *
 * Standalone from the tabbed analytics screen, because this one is a document:
 * a staff member prints it, files it, or sends it to an accountant. **Print is a
 * real requirement**, not a nicety - the `print:` utilities below drop the
 * shell chrome and force the light palette, because a dark-themed report wastes
 * a cartridge and reads badly on paper.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/reports/business'], icon: adminIcon('LineChart') };

/** A total row that closes a table, so the eye can check the column adds up. */
function TotalRow({ cells }) {
  const t = useTableClasses();
  // The heavier rule stays: the line between the last row and the total is a
  // real boundary - data against a sum of it - unlike the hairlines between two
  // rows of the same kind.
  return (
    <tr className="border-t-2 border-line-strong font-semibold">
      {cells.map((cell, index) => (
        <td
          key={index}
          className={cn(
            t.cell(index === 0 ? 'left' : 'right'),
            'text-ink-900',
            index !== 0 && 'tnum',
          )}
        >
          {cell}
        </td>
      ))}
    </tr>
  );
}

/**
 * A plain table. Deliberately not `DataTable`: this page prints, and a sortable
 * table with a row menu is interactive furniture that means nothing on paper.
 */
function ReportTable({ headers, rows, total, empty, caption }) {
  const t = useTableClasses();
  if (!rows.length) {
    return (
      <>
        {caption && <p className="mb-2 text-xs text-ink-400">{caption}</p>}
        <p className="py-6 text-center text-sm text-ink-400">{empty}</p>
      </>
    );
  }

  return (
    <>
      {caption && <p className="mb-2 text-xs text-ink-400">{caption}</p>}

      {/* Carries the density toggle, and is `print:hidden` for the same reason
          this page avoids `DataTable` entirely - a control a staff member presses
          is chrome that means nothing on paper. */}
      <div className="mb-2 border-b border-line pb-2 print:hidden">
        <CountLine total={rows.length} noun="rows" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className={t.headRow}>
              {headers.map((header, index) => (
                <th
                  key={header}
                  scope="col"
                  className={t.headCell(index === 0 ? 'left' : 'right')}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={t.row}>
                {row.cells.map((cell, index) => (
                  <td
                    key={index}
                    className={cn(
                      t.cell(index === 0 ? 'left' : 'right'),
                      index === 0 ? 'text-ink-900' : 'tnum text-ink-700',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {total && <TotalRow cells={total} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function AdminBusinessReportPage() {
  const businessName = useActiveBusinessName();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = useDateRange('this-month');
  const brand = searchParams.get('brand') ?? '';

  const { data, isLoading, error } = useAdminReport('business', range, brand ? { brand } : undefined);

  // The taxonomy is `deviceType > brand > series > model`, so brands are the
  // second level. Flattened and de-duplicated because the same brand appears
  // under more than one device type.
  const { data: tree } = useTaxonomy();
  const brands = [
    ...new Map(
      (tree ?? [])
        .flatMap((deviceType) => deviceType.children ?? [])
        .map((node) => [node.slug, { slug: node.slug, name: node.name }]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  function setBrand(next) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('brand', next);
    else params.delete('brand');
    setSearchParams(params, { replace: true });
  }

  const kpis = data?.kpis ?? {};
  const tax = data?.tax ?? {};
  const netProfit = kpis.netProfit ?? 0;

  return (
    <div
      // Forces the light palette on paper regardless of theme, and drops the
      // interactive chrome. The shell's sidebar and top bar carry `print:hidden`
      // of their own - this is the page's half of the contract.
      className="print:bg-white print:text-black"
    >
      <div className="print:hidden">
        <PageHeader
          icon={ADMIN_PAGE.icon}
          title={ADMIN_PAGE.title}
          description={ADMIN_PAGE.description}
          action={
            <>
              <Link
                to="/admin/reports"
                className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
              >
                All reports
              </Link>
              <Button icon={Printer} onClick={() => window.print()}>
                Print / Save PDF
              </Button>
            </>
          }
        />

        <DateRangeBar />

        <div className="mb-4 flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface p-3">
          <label className="flex flex-col gap-1">
            <span className="eyebrow text-ink-400">Brand / category</span>
            <SelectMenu
              srLabel="Filter by brand"
              value={brand}
              onChange={setBrand}
              options={[
                { value: '', label: 'Every brand' },
                ...(brands ?? []).map((row) => ({ value: row.slug, label: row.name })),
              ]}
              className="min-w-[200px]"
            />
          </label>
          <p className="pb-1.5 text-xs text-ink-400">
            Narrows every figure below to parts for one brand. Filtering happens per line, so an
            order carrying two brands still reports each correctly.
          </p>
        </div>
      </div>

      {/* The printed header. Hidden on screen because the page header above
          already says all this - on paper there is no shell to say it. */}
      <div className="hidden print:mb-6 print:block">
        <h1 className="text-2xl font-bold">{businessName} - Business Overview</h1>
        <p className="mt-1 text-sm">
          {data?.range ? `${date(data.range.from)} to ${date(data.range.to)}` : ''}
          {brand ? ` · ${brands?.find((row) => row.slug === brand)?.name ?? brand}` : ' · every brand'}
        </p>
      </div>

      {error ? (
        <Panel>
          <PanelEmpty icon={AlertCircle} title="That report could not be built" body={error.message} />
        </Panel>
      ) : isLoading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-24" rounded="lg" />
          <Skeleton className="h-64" rounded="lg" />
        </div>
      ) : (
        <>
          <KpiRow
            tiles={[
              { key: 'invoiced', label: 'Invoiced', value: money(kpis.invoiced), hint: 'Issued in range, by invoice date', tone: 'brand', icon: Coins },
              { key: 'expenses', label: 'Expenses', value: money(kpis.expenses), hint: 'Money out in range', tone: 'warn', icon: Receipt },
              {
                key: 'profit',
                label: 'Net profit',
                // Signed once (§9.3). A loss is a negative here, never a
                // positive under a "Net loss" heading.
                value: `${netProfit < 0 ? '−' : ''}${money(Math.abs(netProfit))}`,
                hint: 'Revenue less cost of goods and expenses',
                tone: netProfit < 0 ? 'danger' : 'ok',
                icon: netProfit < 0 ? TrendingDown : TrendingUp,
              },
              {
                key: 'bought',
                label: 'Units purchased',
                value: formatCount(kpis.unitsPurchased),
                hint: `${money(kpis.purchaseSpend ?? 0)} spent on stock received`,
                tone: 'info',
                icon: Truck,
              },
              { key: 'sold', label: 'Units sold', value: formatCount(kpis.unitsSold), hint: 'Across orders in range', tone: 'ok', icon: Boxes },
            ]}
          />

          {data.costCoverage?.uncostedLines > 0 && (
            <p className="mb-3 flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm leading-relaxed text-warn print:border print:border-black print:bg-white print:text-black">
              <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              <span>
                Net profit excludes{' '}
                <strong className="font-semibold">{formatCount(data.costCoverage.uncostedLines)}</strong>{' '}
                line{data.costCoverage.uncostedLines === 1 ? '' : 's'} with no recorded cost, worth{' '}
                {money(data.costCoverage.uncostedRevenue)}. Those lines count as revenue but not as
                profit.
              </span>
            </p>
          )}

          <div className="mb-3 grid gap-3 lg:grid-cols-2">
            <Panel title="Income by payment method" description="Payments collected in this range, by payment date.">
              <DonutChart
                slices={(data.collected?.byMethod ?? []).map((row) => ({
                  label: row.method,
                  value: row.amount,
                }))}
                formatValue={money}
                caption="Collected by payment method"
              />
              <p className="mt-3 border-t border-line pt-2 text-sm text-ink-500">
                {/* Named apart from Invoiced, deliberately (§9.1). */}
                {money(data.collected?.total ?? 0)} collected - a different figure from the
                {' '}{money(kpis.invoiced)} invoiced above.
              </p>
              {(data.refunds?.total ?? 0) > 0 && (
                <p className="mt-1.5 text-sm text-ink-500">
                  Refunds in range: {money(data.refunds.total)} across{' '}
                  {formatCount(data.refunds.count)}.
                </p>
              )}
            </Panel>

            <Panel title="Top categories by invoiced value" description="Where the money came from.">
              <BarList
                items={(data.topCategories ?? []).map((row) => ({
                  label: row.label,
                  value: row.value,
                  hint: `${formatCount(row.units)} unit${row.units === 1 ? '' : 's'}`,
                }))}
                formatValue={money}
                caption="Top categories by value"
              />
            </Panel>
          </div>

          <div className="mb-3 grid gap-3 lg:grid-cols-2">
            <Panel title="Sales per category">
              <ReportTable
                headers={['Category', 'Times sold', 'Value']}
                rows={(data.salesPerCategory ?? []).map((row) => ({
                  key: row.label,
                  cells: [row.label, formatCount(row.times), money(row.value)],
                }))}
                total={[
                  'Total',
                  formatCount((data.salesPerCategory ?? []).reduce((sum, row) => sum + row.times, 0)),
                  money((data.salesPerCategory ?? []).reduce((sum, row) => sum + row.value, 0)),
                ]}
                empty="No sales in this period."
              />
            </Panel>

            <Panel title="Units bought">
              <ReportTable
                caption="Counts stock received from purchase orders in the period."
                headers={['Item', 'Units', 'Spend']}
                rows={(data.unitsBought ?? []).map((row) => ({
                  key: row.label,
                  cells: [row.label, formatCount(row.units), money(row.spend)],
                }))}
                total={[
                  'Total',
                  formatCount(kpis.unitsPurchased ?? 0),
                  money(kpis.purchaseSpend ?? 0),
                ]}
                empty="No stock received in this period."
              />
            </Panel>
          </div>

          <div className="mb-3 grid gap-3 lg:grid-cols-2">
            <Panel title="Units sold" description="Items shipped in the period, by component type.">
              {/* Sub-tiles for the top two categories, as §6.11 asks. */}
              <div className="mb-3 grid grid-cols-2 gap-2">
                {(data.topCategories ?? []).slice(0, 2).map((row) => (
                  <div key={row.label} className="rounded-md bg-surface-2 p-2.5">
                    <p className="eyebrow truncate text-ink-400">{row.label}</p>
                    <p className="tnum mt-1 font-display text-lg font-bold text-ink-900">
                      {formatCount(row.units)}
                    </p>
                    <p className="mt-0.5 text-2xs text-ink-400">{money(row.value)}</p>
                  </div>
                ))}
              </div>

              <ReportTable
                headers={['Category', 'Units', 'Value']}
                rows={(data.salesPerCategory ?? []).map((row) => ({
                  key: row.label,
                  cells: [row.label, formatCount(row.units), money(row.value)],
                }))}
                empty="Nothing shipped in this period."
              />
            </Panel>

            <Panel title="Sales by brand / model">
              <ReportTable
                headers={['Model', 'Units', 'Value']}
                rows={(data.byModel ?? []).map((row) => ({
                  key: row.label,
                  cells: [row.label, formatCount(row.units), money(row.value)],
                }))}
                empty="No sales in this period."
              />
            </Panel>
          </div>

          <Panel title="GST/HST summary" description="Collected on sales, paid on expenses, and the difference.">
            <div className="grid gap-2.5 sm:grid-cols-3">
              {[
                { label: 'Collected (income)', value: money(tax.collected ?? 0) },
                { label: 'Paid (expenses)', value: money(tax.paid ?? 0) },
                {
                  label: 'Owed to tax authority',
                  value: `${(tax.net ?? 0) < 0 ? '−' : ''}${money(Math.abs(tax.net ?? 0))}`,
                  tone: (tax.net ?? 0) < 0 ? 'text-ok' : 'text-ink-900',
                },
              ].map((tile) => (
                <div key={tile.label} className="rounded-md bg-surface-2 p-3 print:border print:border-black print:bg-white">
                  <p className="eyebrow text-ink-400">{tile.label}</p>
                  <p className={cn('tnum mt-1.5 font-display text-xl font-bold', tile.tone ?? 'text-ink-900')}>
                    {tile.value}
                  </p>
                </div>
              ))}
            </div>

            {/* The arithmetic printed underneath, as §6.11 asks - a tax figure
                an accountant cannot check is a tax figure they will not use. */}
            <p className="tnum mt-3 border-t border-line pt-2.5 text-sm text-ink-500">
              {money(tax.collected ?? 0)} collected − {money(tax.paid ?? 0)} paid ={' '}
              <span className={cn('font-medium', (tax.net ?? 0) < 0 ? 'text-ok' : 'text-ink-900')}>
                {(tax.net ?? 0) < 0 ? '−' : ''}
                {money(Math.abs(tax.net ?? 0))}
              </span>
              {(tax.net ?? 0) < 0 && ` - a refund or credit is due to ${businessName}.`}
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

export default AdminBusinessReportPage;
