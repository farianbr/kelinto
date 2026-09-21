import { Link, useSearchParams } from 'react-router';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardList,
  Coins,
  Download,
  FileText,
  Info,
  LineChart,
  Percent,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import cn from '@/lib/cn';
import { money, date, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import TabRow from '@/components/ui/TabRow';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import DateRangeBar, { useDateRange } from '@/components/admin/DateRangeBar';
import { BarList, DonutChart } from '@/components/admin/charts/Charts';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminReport } from '@/hooks/useAdmin';
import Skeleton from '@/components/ui/Skeleton';
import { pressable } from '@/lib/motion';
import useActiveBusinessName from '@/hooks/useActiveBusinessName';

/**
 * Reports - the eight analytics tabs (ERP rework §6.12).
 *
 * **Tab and date range both live in the URL**, so every view is a link: a
 * staff member sends "here is the quarter I mean" rather than "set the dates to".
 *
 * Two rules from §9 are visible on every screen below and are worth naming
 * where they are rendered rather than only where they are computed:
 *
 *   - **Invoiced and Collected are never one word.** Every money tile says
 *     which of the two it is, because CellShoppe using "Revenue" for both is
 *     the specific failure this section is written against.
 *   - **A signed figure renders once.** A loss is `−$350.70` under "Net profit"
 *     in the danger token, never a positive number under a "Net loss" label.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/reports'], icon: adminIcon('PieChart') };

const TABS = [
  { key: 'summary', label: 'Summary', icon: BarChart3 },
  { key: 'pl', label: 'Profit & Loss', icon: Scale },
  { key: 'sales', label: 'Sales', icon: FileText },
  { key: 'expense', label: 'Expense', icon: Receipt },
  { key: 'inventory', label: 'Inventory', icon: Boxes },
  { key: 'tax', label: 'Tax', icon: Percent },
  { key: 'staff', label: 'Staff', icon: Users },
  { key: 'supplier-prices', label: 'Supplier Prices', icon: Truck },
];

/** A percentage from a stored fraction. `0.13` is 13%, never 0.13%. */
function percent(fraction, digits = 2) {
  if (fraction == null || Number.isNaN(fraction)) return '-';
  return `${(fraction * 100).toFixed(digits)}%`;
}

/**
 * A signed money figure, rendered once (§9.3).
 *
 * The sign lives in the number and the tone follows it - there is no second
 * "Net loss" label anywhere, because two ways to say the same thing is how a
 * report ends up printing `REVENUE $-350.70` beside `NET LOSS $350.70`.
 */
function Signed({ cents, className }) {
  const negative = cents < 0;
  return (
    <span className={cn('tnum', negative ? 'text-danger' : 'text-ink-900', className)}>
      {negative ? '−' : ''}
      {money(Math.abs(cents))}
    </span>
  );
}

/**
 * The qualifier that travels with every margin figure.
 *
 * Orders placed before cost was tracked carry no `unitCost`. Reporting those
 * lines as pure profit would be a lie the staff member acts on, so the number is
 * shown **and** the gap is named.
 */
function CostCoverageNote({ coverage }) {
  if (!coverage || coverage.uncostedLines === 0) return null;

  return (
    <p className="mb-3 flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm leading-relaxed text-warn">
      <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      <span>
        Margin excludes <strong className="font-semibold">{formatCount(coverage.uncostedLines)}</strong>{' '}
        line{coverage.uncostedLines === 1 ? '' : 's'} with no recorded cost, worth{' '}
        {money(coverage.uncostedRevenue)}. Cost is captured on new orders from the product's cost
        field - those lines are counted as revenue but not as profit.
      </span>
    </p>
  );
}

/** A panel whose emptiness is stated rather than left blank. */
function TableCard({ title, description, columns, rows, empty, emptyIcon = FileText, footer, action, noun = 'rows' }) {
  // Every report tab renders through here, so one hook paginates all ten.
  const { pageRows, page, totalPages, from, setPage } = useTablePage(rows);

  return (
    <Panel title={title} description={description} action={action} flush>
      {/* One `TableCard` serves every report tab, so the count line lands on
          all of them at once - and with it the density toggle, without which
          this whole screen was stuck at whatever a list page last set. */}
      {rows.length > 0 && (
        <div className="border-b border-line px-3 py-2 sm:px-4">
          <CountLine total={rows.length} shown={pageRows.length} from={from} noun={noun} />
        </div>
      )}

      <DataTable
        columns={columns}
        rows={pageRows}
        // `DataTable` passes only the row, so the key has to come from the row
        // itself. Report rows are aggregates and have no id: the composite
        // below is what actually identifies one - a supplier-price row is an
        // item AND a supplier, not either alone.
        rowKey={(row) =>
          row.id ??
          row.number ??
          row.orderNumber ??
          (row.sku ? `${row.sku}::${row.supplierId ?? ''}` : null) ??
          row.label ??
          row.province
        }
        empty={<PanelEmpty icon={emptyIcon} title={empty} />}
      />
      <Pagination
        page={page}
        pages={totalPages}
        onChange={setPage}
        hideWhenSingle
        className="border-t border-line px-3 py-3 sm:px-4"
      />

      {footer}
    </Panel>
  );
}

// ---- tabs -------------------------------------------------------------------

function SummaryTab({ data }) {
  const businessName = useActiveBusinessName();
  const kpis = data.kpis ?? {};
  const ar = data.receivables ?? {};
  const pl = data.profitAndLoss ?? {};
  const inventory = data.inventory ?? {};

  return (
    <>
      <KpiRow
        tiles={[
          { key: 'invoiced', label: 'Invoiced', value: money(kpis.invoiced), hint: 'Issued in range, by invoice date', tone: 'brand', icon: FileText },
          { key: 'collected', label: 'Collected', value: money(kpis.collected), hint: 'Received in range, by payment date', tone: 'ok', icon: Wallet },
          { key: 'gross', label: 'Gross profit', value: money(kpis.grossProfit), hint: 'Revenue less cost of goods', tone: 'ok', icon: TrendingUp },
          { key: 'cogs', label: 'Cost of goods', value: money(kpis.costOfGoods), hint: 'From each line’s own cost snapshot', tone: 'warn', icon: Boxes },
          { key: 'expenses', label: 'Expenses', value: money(kpis.expenses), hint: 'Money out in range', tone: 'warn', icon: Receipt },
          { key: 'tax', label: 'GST/HST collected', value: money(kpis.taxCollected), hint: 'On orders in range', tone: 'info', icon: Percent },
          { key: 'outstanding', label: 'Outstanding', value: money(kpis.outstanding), hint: `Owed to ${businessName}, as of today`, tone: (kpis.outstanding ?? 0) > 0 ? 'danger' : 'ok', icon: AlertCircle },
        ]}
      />

      <CostCoverageNote coverage={data.costCoverage} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Profit & loss"
          description="Revenue through to net profit for this range."
          action={
            <Link to="/admin/reports?tab=pl" className="text-sm font-semibold text-brand hover:underline">
              Details →
            </Link>
          }
        >
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-500">Revenue</dt>
              <dd className="tnum text-ink-900">{money(pl.revenue ?? 0)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-500">Cost of goods</dt>
              <dd className="tnum text-ink-900">{money(pl.costOfGoods ?? 0)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-line pt-2">
              <dt className="text-ink-600">Gross profit</dt>
              <dd className="tnum font-medium text-ink-900">{money(pl.grossProfit ?? 0)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-500">Operating expenses</dt>
              <dd className="tnum text-ink-900">{money(pl.expenses ?? 0)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-line pt-2 text-md font-semibold">
              <dt className="text-ink-700">Net profit</dt>
              <dd>
                <Signed cents={pl.netProfit ?? 0} className="font-semibold" />
              </dd>
            </div>
          </dl>

          {(data.refunds?.total ?? 0) > 0 && (
            <p className="mt-3 border-t border-line pt-2 text-sm text-ink-500">
              {/* Refunds get their own line and never push revenue negative. */}
              Refunds in range:{' '}
              <span className="tnum font-medium text-ink-700">{money(data.refunds.total)}</span>{' '}
              across {formatCount(data.refunds.count)}.
            </p>
          )}
        </Panel>

        <Panel
          title="Outstanding"
          description={`Owed to ${businessName}, as of today - a position, not a flow.`}
          action={
            <Link to="/admin/invoices?status=overdue" className="text-sm font-semibold text-brand hover:underline">
              View all →
            </Link>
          }
        >
          <div className="mb-3 grid grid-cols-2 gap-2">
            {[
              { label: 'Total outstanding', value: money(ar.outstanding ?? 0) },
              { label: 'Overdue amount', value: money(ar.overdueAmount ?? 0), danger: (ar.overdueAmount ?? 0) > 0 },
              { label: 'Total invoices', value: formatCount(ar.totalInvoices ?? 0) },
              { label: 'Overdue count', value: formatCount(ar.overdueCount ?? 0), danger: (ar.overdueCount ?? 0) > 0 },
            ].map((tile) => (
              <div key={tile.label} className="rounded-md bg-surface-2 p-2.5">
                <p className="eyebrow text-ink-400">{tile.label}</p>
                <p className={cn('tnum mt-1 font-display text-lg font-bold', tile.danger ? 'text-danger' : 'text-ink-900')}>
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          {ar.top?.length ? (
            <ul className="space-y-1.5">
              {ar.top.map((invoice) => (
                <li key={invoice.number} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-ink-600">
                    <span className="font-mono">{invoice.number}</span> · {invoice.businessName}
                  </span>
                  <span className={cn('tnum shrink-0 font-medium', invoice.status === 'overdue' ? 'text-danger' : 'text-ink-900')}>
                    {money(invoice.balance)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-400">Nothing outstanding.</p>
          )}
        </Panel>

        <Panel title="Inventory" description="Stock position as of today, whatever the range says.">
          <div className="mb-3 grid grid-cols-2 gap-2">
            {[
              { label: 'Total items', value: formatCount(inventory.items ?? 0) },
              { label: 'Stock value', value: money(inventory.stockValue ?? 0) },
              { label: 'Out of stock', value: formatCount(inventory.outOfStock ?? 0), danger: (inventory.outOfStock ?? 0) > 0 },
              { label: 'Low stock', value: formatCount(inventory.lowStock ?? 0) },
            ].map((tile) => (
              <div key={tile.label} className="rounded-md bg-surface-2 p-2.5">
                <p className="eyebrow text-ink-400">{tile.label}</p>
                <p className={cn('tnum mt-1 font-display text-lg font-bold', tile.danger ? 'text-danger' : 'text-ink-900')}>
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          {inventory.alerts?.length ? (
            <>
              <p className="eyebrow mb-1.5 text-ink-400">Stock alerts</p>
              <ul className="space-y-1">
                {inventory.alerts.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-ink-600">{item.name}</span>
                    <span className="tnum shrink-0 text-warn">Low stock · {item.stock} left</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink-400">Nothing below its reorder point.</p>
          )}
        </Panel>

        <Panel title="Staff performance" description="Who sold what.">
          {/* Nothing here fakes success (invariant 17): staff attribution does
              not exist yet, and an empty table would read as "nobody sold
              anything" rather than "this is not built". */}
          <PanelEmpty
            icon={Users}
            title="Arrives in phase 8"
            body="Staff accounts and per-order attribution ship with roles and access. Until then there is no person to attribute an order to."
          />
        </Panel>
      </div>
    </>
  );
}

function ProfitAndLossTab({ data }) {
  const kpis = data.kpis ?? {};
  const statement = data.statement ?? {};

  return (
    <>
      <KpiRow
        tiles={[
          { key: 'product', label: 'Product revenue', value: money(kpis.productRevenue), hint: 'List value of every line', tone: 'brand', icon: FileText },
          { key: 'shipping', label: 'Shipping revenue', value: money(kpis.shippingRevenue), hint: 'Charged on orders in range', tone: 'info', icon: Truck },
          { key: 'net', label: 'Net revenue', value: money(kpis.netRevenue), hint: 'Less discounts, plus shipping', tone: 'brand', icon: Coins },
          { key: 'cogs', label: 'Cost of goods', value: money(kpis.costOfGoods), hint: 'From each line’s cost snapshot', tone: 'warn', icon: Boxes },
          { key: 'gross', label: 'Gross profit', value: money(kpis.grossProfit), hint: 'Net revenue less cost of goods', tone: 'ok', icon: TrendingUp },
          { key: 'expenses', label: 'Expenses', value: money(kpis.expenses), hint: 'Operating spend in range', tone: 'warn', icon: Receipt },
          {
            key: 'profit',
            label: 'Net profit',
            // Signed once - a loss shows as a negative here and nowhere else.
            value: (
              <>
                {(kpis.netProfit ?? 0) < 0 ? '−' : ''}
                {money(Math.abs(kpis.netProfit ?? 0))}
              </>
            ),
            hint: 'Gross profit less expenses',
            tone: (kpis.netProfit ?? 0) < 0 ? 'danger' : 'ok',
            icon: (kpis.netProfit ?? 0) < 0 ? TrendingDown : TrendingUp,
          },
          { key: 'collected', label: 'Collected', value: money(kpis.collected), hint: 'Cash in, by payment date', tone: 'ok', icon: Wallet },
        ]}
      />

      <CostCoverageNote coverage={data.costCoverage} />

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <Panel title="Profit & loss statement" description="In accounting order.">
          <dl className="space-y-1.5 text-sm">
            {[
              ['Product revenue', statement.productRevenue],
              ['Shipping revenue', statement.shippingRevenue],
              ['Discounts given', -(statement.discounts ?? 0)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-ink-500">{label}</dt>
                <dd><Signed cents={value ?? 0} /></dd>
              </div>
            ))}

            <div className="flex justify-between gap-2 border-t border-line pt-1.5 font-medium">
              <dt className="text-ink-700">Net revenue</dt>
              <dd className="tnum text-ink-900">{money(statement.netRevenue ?? 0)}</dd>
            </div>

            <div className="flex justify-between gap-2 pt-1">
              <dt className="text-ink-500">Cost of goods sold</dt>
              <dd className="tnum text-ink-900">({money(statement.costOfGoods ?? 0)})</dd>
            </div>

            <div className="flex justify-between gap-2 border-t border-line pt-1.5 font-medium">
              <dt className="text-ink-700">Gross profit</dt>
              <dd className="tnum text-ink-900">{money(statement.grossProfit ?? 0)}</dd>
            </div>

            <p className="eyebrow pt-2 text-ink-400">Operating expenses</p>
            {(statement.operatingExpenses ?? []).map((row) => (
              <div key={row.label} className="flex justify-between gap-2">
                <dt className="min-w-0 truncate text-ink-500">{row.label}</dt>
                <dd className="tnum text-ink-900">({money(row.amount)})</dd>
              </div>
            ))}
            {!(statement.operatingExpenses ?? []).length && (
              <p className="text-sm text-ink-400">No expenses in this period.</p>
            )}

            <div className="flex justify-between gap-2 border-t border-line pt-1.5">
              <dt className="text-ink-600">Total expenses</dt>
              <dd className="tnum text-ink-900">({money(statement.totalExpenses ?? 0)})</dd>
            </div>

            <div className="flex justify-between gap-2 border-t-2 border-line-strong pt-2 text-md font-semibold">
              <dt className="text-ink-900">Net profit</dt>
              <dd><Signed cents={statement.netProfit ?? 0} className="font-semibold" /></dd>
            </div>

            <div className="flex justify-between gap-2 pt-2 text-sm">
              <dt className="text-ink-400">GST/HST collected (not revenue)</dt>
              <dd className="tnum text-ink-500">{money(statement.taxCollected ?? 0)}</dd>
            </div>
          </dl>
        </Panel>

        <TableCard
          title="By category"
          description="Where the margin actually comes from."
          rows={data.byCategory ?? []}
          empty="No sales in this period."
          emptyIcon={BarChart3}
          columns={[
            { key: 'label', header: 'Category', priority: 1, className: 'max-w-[160px] truncate' },
            { key: 'orders', header: 'Lines', priority: 3, align: 'right', className: 'tnum', render: (row) => formatCount(row.orders) },
            { key: 'revenue', header: 'Revenue', priority: 1, align: 'right', className: 'tnum', render: (row) => money(row.revenue) },
            { key: 'cost', header: 'Cost', priority: 2, align: 'right', className: 'tnum', render: (row) => money(row.cost) },
            {
              key: 'margin',
              header: 'Margin',
              priority: 1,
              align: 'right',
              className: 'tnum',
              render: (row) =>
                row.margin === null ? (
                  <span className="text-xs text-ink-300">-</span>
                ) : (
                  <>
                    <span className={cn('font-medium', row.margin < 0 ? 'text-danger' : 'text-ink-900')}>
                      {row.margin}%
                    </span>
                    {row.uncostedLines > 0 && (
                      <span className="block text-2xs text-warn">{row.uncostedLines} uncosted</span>
                    )}
                  </>
                ),
            },
          ]}
        />
      </div>
    </>
  );
}

function SalesTab({ data }) {
  const kpis = data.kpis ?? {};
  const ar = data.receivables ?? {};

  return (
    <>
      <KpiRow
        tiles={[
          { key: 'invoices', label: 'Invoices', value: formatCount(kpis.invoices), hint: 'Issued in range', tone: 'brand', icon: FileText },
          { key: 'total', label: 'Invoiced', value: money(kpis.total), hint: 'By invoice date', tone: 'brand', icon: Coins },
          { key: 'paid', label: 'Paid', value: money(kpis.paid), hint: 'Against these invoices', tone: 'ok', icon: Wallet },
          { key: 'unpaid', label: 'Unpaid', value: money(kpis.unpaid), hint: 'Still owed on these invoices', tone: (kpis.unpaid ?? 0) > 0 ? 'warn' : 'ok', icon: AlertCircle },
          { key: 'partial', label: 'Partial', value: formatCount(kpis.partial), hint: 'Part-paid invoices', tone: 'info', icon: Percent },
        ]}
      />

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Panel
          title="Collected in period"
          // CellShoppe's clarifying caption is kept because it is genuinely
          // useful: the tiles above are invoiced totals by invoice date, this
          // is money actually collected in the range.
          description="By payment date. The tiles above are invoiced totals by invoice date - these are different numbers."
        >
          <p className="tnum font-display text-3xl font-bold leading-none text-ok">
            {money(data.collected?.total ?? 0)}
          </p>
          <p className="mt-1.5 text-sm text-ink-500">
            {formatCount(data.collected?.count ?? 0)} payment
            {(data.collected?.count ?? 0) === 1 ? '' : 's'} recorded in this range.
          </p>
        </Panel>

        <Panel title="Income by payment method" description="Payments received in this range.">
          <DonutChart
            slices={(data.collected?.byMethod ?? []).map((row) => ({
              label: row.method,
              value: row.amount,
            }))}
            formatValue={money}
            caption="Collected by payment method"
          />
        </Panel>
      </div>

      <div className="grid gap-3">
        <TableCard
          title="Invoices issued"
          description="Every invoice dated inside the range."
          rows={data.invoices ?? []}
          empty="No invoices issued in this period."
          columns={[
            { key: 'number', header: 'Invoice', priority: 1, render: (row) => <span className="whitespace-nowrap font-mono text-sm text-ink-900">{row.number}</span> },
            { key: 'businessName', header: 'Customer', priority: 1, className: 'max-w-[180px] truncate' },
            { key: 'issuedAt', header: 'Date', priority: 2, render: (row) => <span className="text-sm text-ink-500">{date(row.issuedAt)}</span> },
            { key: 'terms', header: 'Terms', priority: 3, render: (row) => <span className="text-sm text-ink-500">{String(row.terms).replace('net', 'Net ')}</span> },
            {
              key: 'status',
              header: 'Status',
              priority: 1,
              render: (row) => (
                <Badge tone={{ paid: 'ok', partial: 'warn', unpaid: 'neutral', overdue: 'danger' }[row.status]} size="sm">
                  {row.status === 'partial' ? 'partly paid' : row.status}
                </Badge>
              ),
            },
            { key: 'amount', header: 'Total', priority: 1, align: 'right', className: 'tnum', render: (row) => money(row.amount) },
          ]}
        />

        <Panel title="Due & overdue" description="Unpaid invoices, as of today.">
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { label: 'Total outstanding', value: money(ar.outstanding ?? 0) },
              { label: 'Overdue amount', value: money(ar.overdueAmount ?? 0), danger: (ar.overdueAmount ?? 0) > 0 },
              { label: 'Total invoices', value: formatCount(ar.totalInvoices ?? 0) },
              { label: 'Overdue count', value: formatCount(ar.overdueCount ?? 0), danger: (ar.overdueCount ?? 0) > 0 },
            ].map((tile) => (
              <div key={tile.label} className="rounded-md bg-surface-2 p-2.5">
                <p className="eyebrow text-ink-400">{tile.label}</p>
                <p className={cn('tnum mt-1 font-display text-lg font-bold', tile.danger ? 'text-danger' : 'text-ink-900')}>
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          {ar.top?.length ? (
            <ul className="divide-y divide-line">
              {ar.top.map((invoice) => (
                <li key={invoice.number} className="flex items-baseline justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate text-ink-600">
                    <span className="font-mono">{invoice.number}</span> · {invoice.businessName}
                    {invoice.dueDate && <span className="text-ink-400"> · due {date(invoice.dueDate)}</span>}
                  </span>
                  <span className={cn('tnum shrink-0 font-medium', invoice.status === 'overdue' ? 'text-danger' : 'text-ink-900')}>
                    {money(invoice.balance)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-400">Nothing outstanding.</p>
          )}
        </Panel>
      </div>
    </>
  );
}

function ExpenseTab({ data }) {
  const kpis = data.kpis ?? {};

  return (
    <>
      <KpiRow
        tiles={[
          { key: 'total', label: 'Total spent', value: money(kpis.total), hint: 'Expenses dated in range', tone: 'warn', icon: Wallet },
          { key: 'entries', label: 'Entries', value: formatCount(kpis.entries), hint: 'Rows in this period', tone: 'neutral', icon: Receipt },
          { key: 'tax', label: 'GST/HST paid', value: money(kpis.taxPaid), hint: 'Input tax on these expenses', tone: 'info', icon: Percent },
        ]}
      />

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Panel title="By category" description="Where the money went.">
          <BarList
            items={(data.byCategory ?? []).map((row) => ({
              label: row.label,
              value: row.amount,
              hint: `${formatCount(row.count)} entr${row.count === 1 ? 'y' : 'ies'}`,
            }))}
            formatValue={money}
            tone="warn"
            caption="Expenses by category"
          />
        </Panel>

        <Panel title="By payment method" description="How it was paid.">
          <DonutChart
            slices={(data.byMethod ?? []).map((row) => ({ label: row.label, value: row.amount }))}
            formatValue={money}
            caption="Expenses by payment method"
          />
        </Panel>
      </div>

      <TableCard
        title="Expenses"
        description="Every row dated inside the range."
        rows={data.expenses ?? []}
        empty="No expenses in this period."
        emptyIcon={Receipt}
        columns={[
          { key: 'date', header: 'Date', priority: 1, render: (row) => <span className="whitespace-nowrap text-sm text-ink-500">{date(row.date)}</span> },
          {
            key: 'description',
            header: 'Description',
            priority: 1,
            className: 'max-w-[240px]',
            render: (row) => (
              <>
                <span className="block truncate text-sm text-ink-900">{row.description}</span>
                {row.purchaseOrder && (
                  <Link
                    to={`/admin/purchase-orders/${row.purchaseOrder.id}`}
                    className="mt-0.5 inline-flex items-center gap-1 text-2xs text-ink-400 hover:text-brand"
                  >
                    <ClipboardList className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                    {row.purchaseOrder.poNumber ?? 'Purchase order'}
                  </Link>
                )}
              </>
            ),
          },
          { key: 'category', header: 'Category', priority: 2, render: (row) => <Badge tone="neutral" size="sm">{row.category}</Badge> },
          { key: 'payee', header: 'Payee', priority: 3, className: 'max-w-[140px] truncate' },
          { key: 'method', header: 'Method', priority: 3, render: (row) => <span className="text-sm text-ink-500">{row.method ?? '-'}</span> },
          {
            key: 'amount',
            header: 'Amount',
            priority: 1,
            align: 'right',
            className: 'tnum',
            render: (row) => (
              <>
                <span className="text-sm font-medium text-ink-900">{money(row.amount)}</span>
                {row.tax > 0 && <span className="block text-2xs text-ink-400">{money(row.tax)} tax</span>}
              </>
            ),
          },
        ]}
      />
    </>
  );
}

function InventoryTab({ data }) {
  const kpis = data.kpis ?? {};

  return (
    <>
      <KpiRow
        tiles={[
          { key: 'items', label: 'Total items', value: formatCount(kpis.items), hint: 'Products in the catalogue', tone: 'brand', icon: Boxes },
          { key: 'value', label: 'Stock value', value: money(kpis.stockValue), hint: 'At cost, as of today', tone: 'ok', icon: Wallet },
          { key: 'in', label: 'In stock', value: formatCount(kpis.inStock), hint: 'Above their reorder point', tone: 'ok', icon: Boxes },
          { key: 'low', label: 'Low stock', value: formatCount(kpis.lowStock), hint: 'At or under reorder point', tone: (kpis.lowStock ?? 0) > 0 ? 'warn' : 'ok', icon: AlertTriangle },
          { key: 'out', label: 'Out of stock', value: formatCount(kpis.outOfStock), hint: 'Nothing on the shelf', tone: (kpis.outOfStock ?? 0) > 0 ? 'danger' : 'ok', icon: AlertCircle },
        ]}
      />

      <div className="grid gap-3">
        <TableCard
          title="All stock items"
          description="Position as of today - these tiles do not move with the date range."
          rows={data.products ?? []}
          empty="No products in the catalogue."
          emptyIcon={Boxes}
          columns={[
            {
              key: 'name',
              header: 'Product',
              priority: 1,
              className: 'max-w-[220px]',
              render: (row) => (
                <>
                  <span className="block truncate text-sm text-ink-900">{row.name}</span>
                  <span className="block font-mono text-2xs text-ink-300">{row.sku}</span>
                </>
              ),
            },
            { key: 'category', header: 'Category', priority: 3, className: 'max-w-[140px] truncate' },
            { key: 'stock', header: 'Qty', priority: 1, align: 'right', className: 'tnum', render: (row) => formatCount(row.stock) },
            { key: 'minStock', header: 'Min', priority: 3, align: 'right', className: 'tnum', render: (row) => (row.minStock > 0 ? row.minStock : '-') },
            { key: 'cost', header: 'Unit cost', priority: 2, align: 'right', className: 'tnum', render: (row) => (row.cost > 0 ? money(row.cost) : <span className="text-xs text-ink-300">-</span>) },
            { key: 'value', header: 'Value', priority: 1, align: 'right', className: 'tnum', render: (row) => money(row.value) },
            {
              key: 'status',
              header: 'Status',
              priority: 2,
              render: (row) => (
                <Badge tone={{ in: 'ok', low: 'warn', out: 'danger' }[row.status]} size="sm">
                  {{ in: 'in stock', low: 'low', out: 'out' }[row.status]}
                </Badge>
              ),
            },
          ]}
        />

        <TableCard
          title="Period movement"
          description="Stock that moved inside the range - this panel is the period, the tiles above are today."
          rows={data.movements ?? []}
          empty="No transactions this period."
          emptyIcon={Boxes}
          columns={[
            { key: 'at', header: 'When', priority: 1, render: (row) => <span className="whitespace-nowrap text-sm text-ink-500">{date(row.at)}</span> },
            {
              key: 'product',
              header: 'Product',
              priority: 1,
              className: 'max-w-[220px]',
              render: (row) => (
                <>
                  <span className="block truncate text-sm text-ink-900">{row.product}</span>
                  {row.sku && <span className="block font-mono text-2xs text-ink-300">{row.sku}</span>}
                </>
              ),
            },
            { key: 'type', header: 'Type', priority: 2, render: (row) => <Badge tone="neutral" size="sm">{row.type}</Badge> },
            { key: 'reference', header: 'Reference', priority: 3, render: (row) => <span className="font-mono text-xs text-ink-400">{row.reference ?? '-'}</span> },
            {
              key: 'qtyChange',
              header: 'Change',
              priority: 1,
              align: 'right',
              className: 'tnum',
              render: (row) => (
                <>
                  <span className={cn('font-medium', row.qtyChange > 0 ? 'text-ok' : 'text-warn')}>
                    {row.qtyChange > 0 ? '+' : ''}
                    {row.qtyChange}
                  </span>
                  <span className="block text-2xs text-ink-400">{row.qtyAfter} after</span>
                </>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}

function TaxTab({ data }) {
  const businessName = useActiveBusinessName();
  const kpis = data.kpis ?? {};
  const totals = data.totals ?? {};
  const net = kpis.net ?? 0;

  return (
    <>
      <div className="mb-4 grid gap-2.5 sm:grid-cols-3">
        {[
          { label: 'GST/HST collected', hint: 'On orders in this range', value: money(kpis.collected ?? 0), tone: 'text-ink-900' },
          { label: 'GST/HST paid', hint: 'Input tax on expenses', value: money(kpis.paid ?? 0), tone: 'text-ink-900' },
          {
            label: 'Net payable',
            hint: net < 0 ? `Negative - a refund or credit is due to ${businessName}` : 'Owed to the tax authority',
            // Signed once: negative means money comes back, and the hint says
            // so rather than a second "refund due" tile contradicting this one.
            value: `${net < 0 ? '−' : ''}${money(Math.abs(net))}`,
            tone: net < 0 ? 'text-ok' : 'text-ink-900',
          },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border border-line bg-surface p-4">
            <p className="eyebrow text-ink-400">{tile.label}</p>
            <p className={cn('tnum mt-2 font-display text-2xl font-bold leading-none', tile.tone)}>
              {tile.value}
            </p>
            <p className="mt-1.5 text-xs text-ink-400">{tile.hint}</p>
          </div>
        ))}
      </div>

      <KpiRow
        tiles={[
          { key: 'invoices', label: 'Orders', value: formatCount(totals.invoices), hint: 'In this range', tone: 'neutral', icon: FileText },
          { key: 'subtotal', label: 'Subtotal', value: money(totals.subtotal), hint: 'Before tax', tone: 'brand', icon: Coins },
          { key: 'discounts', label: 'Discounts', value: money(totals.discounts), hint: 'Taken off before tax', tone: 'warn', icon: Percent },
          { key: 'shipping', label: 'Shipping', value: money(totals.shipping), hint: 'Taxable in Canada', tone: 'info', icon: Truck },
          { key: 'tax', label: 'Tax collected', value: money(totals.taxCollected), hint: 'At the rate that applied', tone: 'info', icon: Percent },
          { key: 'gross', label: 'Gross revenue', value: money(totals.gross), hint: 'Everything charged', tone: 'ok', icon: Wallet },
        ]}
      />

      <div className="grid gap-3">
        <TableCard
          title="GST/HST register"
          description="The rate shown is the rate that was actually charged, recovered from each order - a rate change today does not restate last quarter."
          rows={data.register ?? []}
          empty="No orders in this period."
          emptyIcon={Percent}
          columns={[
            { key: 'orderNumber', header: 'Order', priority: 1, render: (row) => <span className="whitespace-nowrap font-mono text-sm text-ink-900">{row.orderNumber}</span> },
            { key: 'date', header: 'Date', priority: 2, render: (row) => <span className="text-sm text-ink-500">{date(row.date)}</span> },
            { key: 'businessName', header: 'Customer', priority: 2, className: 'max-w-[160px] truncate' },
            { key: 'province', header: 'Prov.', priority: 3, render: (row) => <span className="font-mono text-xs text-ink-500">{row.province}</span> },
            { key: 'subtotal', header: 'Subtotal', priority: 3, align: 'right', className: 'tnum', render: (row) => money(row.subtotal) },
            { key: 'shipping', header: 'Shipping', priority: 3, align: 'right', className: 'tnum', render: (row) => money(row.shipping) },
            { key: 'discount', header: 'Discount', priority: 3, align: 'right', className: 'tnum', render: (row) => money(row.discount) },
            { key: 'rate', header: 'Rate', priority: 2, align: 'right', className: 'tnum', render: (row) => percent(row.rate) },
            { key: 'tax', header: 'Tax', priority: 1, align: 'right', className: 'tnum font-medium text-ink-900', render: (row) => money(row.tax) },
            { key: 'total', header: 'Total', priority: 1, align: 'right', className: 'tnum', render: (row) => money(row.total) },
          ]}
        />

        <TableCard
          title="By province"
          description={`${businessName} ships Canada-wide, so this is a primary output rather than a footnote. Rates come from Settings.`}
          rows={data.byProvince ?? []}
          empty="No orders in this period."
          emptyIcon={Percent}
          columns={[
            { key: 'province', header: 'Province', priority: 1, render: (row) => <span className="font-mono text-sm text-ink-900">{row.province}</span> },
            { key: 'count', header: 'Orders', priority: 1, align: 'right', className: 'tnum', render: (row) => formatCount(row.count) },
            { key: 'tax', header: 'Tax collected', priority: 1, align: 'right', className: 'tnum font-medium text-ink-900', render: (row) => money(row.tax) },
            { key: 'avgRate', header: 'Avg charged', priority: 2, align: 'right', className: 'tnum', render: (row) => percent(row.avgRate) },
            {
              key: 'settingsRate',
              header: 'Settings rate',
              priority: 2,
              align: 'right',
              className: 'tnum',
              // Showing both is how a staff member finds out a rate moved
              // mid-range, rather than wondering why the average looks odd.
              render: (row) => (
                <span className={cn(Math.abs(row.avgRate - row.settingsRate) > 0.005 ? 'text-warn' : 'text-ink-500')}>
                  {percent(row.settingsRate)}
                </span>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}

function StaffTab({ data }) {
  const kpis = data.kpis ?? {};

  return (
    <>
      {/* Invariant 17: a UI-only surface says what is inactive. It does not
          render an empty table that reads as "nobody sold anything". */}
      <p className="mb-4 flex items-start gap-2 rounded-md bg-info-50 px-3 py-2.5 text-sm leading-relaxed text-info">
        <Info className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        <span>
          <strong className="font-semibold">Staff attribution arrives in phase 8.</strong>{' '}
          {data.reason}
        </span>
      </p>

      <KpiRow
        tiles={[
          { key: 'invoiced', label: 'Total invoiced', value: money(kpis.totalInvoiced), hint: 'Whole business, by invoice date', tone: 'brand', icon: FileText },
          { key: 'invoices', label: 'Total invoices', value: formatCount(kpis.totalInvoices), hint: 'Issued in range', tone: 'neutral', icon: Receipt },
          { key: 'orders', label: 'Orders placed', value: formatCount(kpis.ordersClosed), hint: 'Excluding cancelled', tone: 'info', icon: ClipboardList },
          { key: 'staff', label: 'Active staff', value: '-', hint: 'No staff accounts exist yet', tone: 'neutral', icon: Users },
        ]}
      />

      <Panel title="Contribution">
        <PanelEmpty
          icon={Users}
          title="No staff to report on"
          body="Roles, staff accounts and the per-order attribution this panel needs all ship in phase 8. Until then every order belongs to the business rather than to a person."
        />
      </Panel>
    </>
  );
}

function SupplierPricesTab({ data }) {
  const rows = data.rows ?? [];

  return (
    <>
      <p className="mb-3 text-sm leading-relaxed text-ink-500">
        What each supplier charged per item, taken from purchase orders. The cheapest supplier for
        each item is highlighted - use it to decide who to buy from. Drafts are excluded: a price
        nobody has committed to is a quote, not evidence.
      </p>

      <TableCard
        title="Supplier price comparison"
        description={`One row per item and supplier, from ${formatCount(data.sourceOrders ?? 0)} sent or received purchase order${(data.sourceOrders ?? 0) === 1 ? '' : 's'}.`}
        rows={rows}
        empty="No purchase orders have been sent yet."
        emptyIcon={Truck}
        columns={[
          {
            key: 'name',
            header: 'Item',
            priority: 1,
            className: 'max-w-[200px]',
            render: (row) => (
              <>
                <span className="block truncate text-sm text-ink-900">{row.name}</span>
                <span className="block font-mono text-2xs text-ink-300">{row.sku}</span>
              </>
            ),
          },
          {
            key: 'supplier',
            header: 'Supplier',
            priority: 1,
            className: 'max-w-[180px]',
            render: (row) => (
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-sm text-ink-700">{row.supplier}</span>
                {row.cheapest && (
                  <Badge tone="ok" size="sm">
                    cheapest
                  </Badge>
                )}
              </span>
            ),
          },
          { key: 'lowest', header: 'Lowest', priority: 1, align: 'right', className: 'tnum font-medium text-ink-900', render: (row) => money(row.lowest) },
          { key: 'average', header: 'Avg', priority: 2, align: 'right', className: 'tnum', render: (row) => money(row.average) },
          { key: 'highest', header: 'Highest', priority: 3, align: 'right', className: 'tnum', render: (row) => money(row.highest) },
          { key: 'times', header: 'Times', priority: 3, align: 'right', className: 'tnum', render: (row) => formatCount(row.times) },
          { key: 'lastPurchased', header: 'Last bought', priority: 2, render: (row) => <span className="whitespace-nowrap text-sm text-ink-500">{date(row.lastPurchased)}</span> },
        ]}
      />
    </>
  );
}

const TAB_COMPONENTS = {
  summary: SummaryTab,
  pl: ProfitAndLossTab,
  sales: SalesTab,
  expense: ExpenseTab,
  inventory: InventoryTab,
  tax: TaxTab,
  staff: StaffTab,
  'supplier-prices': SupplierPricesTab,
};

export function AdminReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TAB_COMPONENTS[searchParams.get('tab')] ? searchParams.get('tab') : 'summary';
  const range = useDateRange('this-month');

  const { data, isLoading, error } = useAdminReport(tab, range);
  const TabComponent = TAB_COMPONENTS[tab];

  function setTab(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'summary') params.delete('tab');
    else params.set('tab', next);
    // The range is deliberately preserved across a tab change: a staff member
    // comparing March across two tabs should not have to re-enter March.
    setSearchParams(params, { replace: true });
  }

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <>
            <Link
              to="/admin/reports/business"
              className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
            >
              <LineChart className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              Business overview
            </Link>
            <Button
              variant="outline"
              icon={Download}
              onClick={() =>
                window.alert(
                  `Export to CSV arrives in phase 12. It will carry the current view: the "${tab}" tab, ${range.from ?? 'the default start'} to ${range.to ?? 'today'}.`,
                )
              }
            >
              Export CSV
            </Button>
          </>
        }
      />

      <DateRangeBar />

      {/* The shared `TabRow`. This was a local copy using the full
          `.bg-brand-gradient` on a 36px pill, where the ramp's near-black
          opening reads as a stripe rather than as depth - the shared component
          uses the compact ramp, which is the rule for anything this short. */}
      <TabRow tabs={TABS} value={tab} onChange={setTab} label="Report" className="mb-4" />

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
        <TabComponent data={data} />
      )}
    </>
  );
}

export default AdminReportsPage;
