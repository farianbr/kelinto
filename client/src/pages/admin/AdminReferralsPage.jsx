import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Coins, Gift, Users } from 'lucide-react';

import Panel, { PanelEmpty, StatTile } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminReferrals, useAdminMutations } from '@/hooks/useAdmin';
import { money, date } from '@/lib/format';

/**
 * Referral commission (§6.13, phase 10).
 *
 * A referring business earns a percentage of what the accounts it referred
 * actually **pay** - credited as store credit, through the one service allowed
 * to move a store-credit balance.
 *
 * **Nothing on this screen writes a commission.** The only control is the rate,
 * and it governs future accruals only. Commission is earned when a payment is
 * recorded and reversed when that money goes back, both inside the services
 * that own those events - there is no button here that could pay somebody
 * without a payment behind it, and attribution is fixed at registration and
 * shown read-only.
 */
const ROUTE = ADMIN_ROUTES['/admin/marketing/referrals'];
// The icon comes from the route entry rather than being named twice: this
// screen moved categories on 2026-09-21 and its glyph moved with it.
const ADMIN_PAGE = { ...ROUTE, icon: adminIcon(ROUTE.icon) };

/**
 * The rate control.
 *
 * Says out loud that a change is not retroactive. That is the first question a
 * staff member has when they raise a rate, and every accrual snapshots the rate in
 * force when it was earned, so the honest answer is on the screen rather than
 * in a doc nobody opens.
 */
function RateControl({ percent }) {
  const [value, setValue] = useState(String(percent ?? 5));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const { setReferralRate } = useAdminMutations();

  // The server is the source of truth; refetches must not overwrite an edit in
  // progress, so this only re-syncs when the field is not being worked on.
  useEffect(() => {
    if (!setReferralRate.isPending) setValue(String(percent ?? 5));
  }, [percent]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setError(null);
    setSaved(false);
    try {
      await setReferralRate.mutateAsync(Number(value));
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Panel
      title="Commission rate"
      description="Applies to commission earned from now on. Anything already earned keeps the rate it was earned at."
    >
      <div className="flex flex-wrap items-start gap-3">
        <Input
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          suffix="%"
          aria-label="Commission percentage"
          error={error}
          containerClassName="w-32"
        />
        <Button onClick={save} loading={setReferralRate.isPending} className="mt-0">
          Save rate
        </Button>

        {saved && !error && (
          <p className="mt-2.5 flex items-center gap-1.5 text-sm text-ok">
            <CheckCircle2 className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            Saved. Existing commission is unchanged.
          </p>
        )}
      </div>
    </Panel>
  );
}

export function AdminReferralsPage() {
  const { data, isLoading } = useAdminReferrals();

  const rows = data?.referrals ?? [];

  // A page of rows for the table; counts and tiles still read the full set.
  const { pageRows: pageReferrals, page, totalPages, from, setPage } = useTablePage(rows);
  const totals = data?.totals ?? {};

  const columns = [
    {
      key: 'referrer',
      header: 'Referrer',
      priority: 1,
      sortValue: (row) => row.referrer.businessName,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{row.referrer.businessName}</p>
          {row.referrer.referralCode && (
            <p className="tnum truncate text-xs text-ink-400">{row.referrer.referralCode}</p>
          )}
        </div>
      ),
    },
    {
      key: 'referred',
      header: 'Referred account',
      priority: 1,
      sortValue: (row) => row.referred.businessName,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink-900">{row.referred.businessName}</p>
          <p className="truncate text-xs text-ink-400">{row.referred.email}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      priority: 3,
      sortValue: (row) => row.referred.status,
      render: (row) => (
        <Badge tone={row.referred.status === 'approved' ? 'ok' : 'neutral'} size="sm">
          {row.referred.status}
        </Badge>
      ),
    },
    {
      key: 'joinedAt',
      header: 'Joined',
      priority: 3,
      sortValue: (row) => row.joinedAt,
      render: (row) => <span className="text-ink-500">{date(row.joinedAt)}</span>,
    },
    {
      key: 'paymentsCounted',
      header: 'Payments',
      align: 'right',
      priority: 2,
      sortValue: (row) => row.paymentsCounted,
      // Payments, not orders: an unpaid invoice has earned nobody anything, and
      // this column is the count of what actually paid out.
      render: (row) => <span className="tnum">{row.paymentsCounted}</span>,
    },
    {
      key: 'commissionEarned',
      header: 'Commission',
      align: 'right',
      priority: 1,
      sortValue: (row) => row.commissionEarned,
      // The net of accruals and reversals, so a pairing whose money came back
      // reads as what it is rather than as what it briefly was.
      render: (row) => (
        <span className="tnum font-medium text-ink-900">{money(row.commissionEarned)}</span>
      ),
    },
    {
      key: 'lastPayoutAt',
      header: 'Last payout',
      priority: 3,
      sortValue: (row) => row.lastPayoutAt ?? '',
      render: (row) => (
        <span className="text-ink-500">{row.lastPayoutAt ? date(row.lastPayoutAt) : '-'}</span>
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

      <div className="flex flex-col gap-4">
        <RateControl percent={data?.percent} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Active referrers"
            value={totals.activeReferrers ?? 0}
            icon={Users}
            hint="Have earned at least once"
          />
          <StatTile
            label="Referred accounts"
            value={totals.referredAccounts ?? 0}
            icon={Gift}
            hint="Signed up with a code"
          />
          {/* The tile shows what referrers have actually KEPT. Showing the
              gross would overstate the cost of the programme whenever money
              has been clawed back, and the reversal is named in the hint rather
              than hidden inside a number that looks smaller than it should. */}
          <StatTile
            label="Credit issued"
            value={money(totals.creditNet ?? totals.creditIssued ?? 0)}
            icon={Coins}
            tone="ok"
            hint={
              (totals.creditReversed ?? 0) < 0
                ? `${money(totals.creditIssued)} earned, ${money(Math.abs(totals.creditReversed))} reversed`
                : 'Paid as store credit'
            }
          />
          <StatTile
            label="Pending"
            value={totals.pending ?? 0}
            hint="Referred, not yet earning"
          />
        </div>

        {/* Reversals are surfaced rather than quietly netted away: money that
            went back out is a fact the staff member should see stated, not have to
            infer from a total that moved. */}
        {(totals.creditReversed ?? 0) < 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-sm leading-relaxed text-ink-600">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
            {money(Math.abs(totals.creditReversed))} of commission has been reversed, because the
            payments behind it were refunded or their invoices voided. The commission column below
            is net of that.
          </p>
        )}

        <Panel flush>
          {isLoading ? (
            <p className="p-4 text-sm text-ink-500">Loading referrals…</p>
          ) : rows.length === 0 ? (
            <PanelEmpty
              icon={Gift}
              title="No referrals yet"
              body="An approved account gets a referral code. When somebody signs up with it and pays an invoice, the commission appears here."
            />
          ) : (
            <>
              <div className="border-b border-line px-3 py-2 sm:px-4">
                <CountLine
                  total={rows.length}
                  shown={pageReferrals.length}
                  from={from}
                  noun={rows.length === 1 ? 'referral' : 'referrals'}
                />
              </div>

              <DataTable
                rows={pageReferrals}
                columns={columns}
                defaultSort={{ key: 'commissionEarned', direction: 'desc' }}
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
      </div>
    </>
  );
}

export default AdminReferralsPage;
