import { Smartphone } from 'lucide-react';

import { date, money } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import { useMyBuybacks } from '@/hooks/usePreowned';

const TONES = { pending: 'warn', accepted: 'ok', declined: 'neutral' };
const LABELS = { pending: 'Being checked', accepted: 'Bought', declined: 'Returned to you' };

/**
 * "Phones you sold us": the customer's side of Sell your phone.
 *
 * ## What the page is opened for
 *
 * "Did they buy it, and what did I get?" So each row leads with the phone and
 * ends with the answer: while it is being checked, that it is; once bought, the
 * amount and how it was paid (store credit shows up in Credit & balance too).
 * Never what we are selling it on for: that is ours, not theirs.
 *
 * Phones are sold at the kiosk in the shop, not from here (client ruling,
 * 2026-09-29), so there is no "sell another" button to press.
 */
export function AccountSoldPhonesPage() {
  const { data, isLoading, error } = useMyBuybacks();
  const rows = data?.buybacks ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12" />
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-16" />
        ))}
      </div>
    );
  }

  return (
    <Panel
      title="Phones you sold us"
      description="Sold at the kiosk in our shop. We check each phone, then agree a price with you at the counter."
      flush
    >
      {error ? (
        <PanelEmpty icon={Smartphone} title="This is not available" body={error.message} />
      ) : rows.length === 0 ? (
        <PanelEmpty
          icon={Smartphone}
          title="No phones yet"
          body="Selling a phone you no longer use? Choose Sell your phone on the kiosk in our shop."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-md font-semibold text-ink-900">{row.device}</p>
                <p className="mt-0.5 text-sm text-ink-500">
                  <span className="font-mono text-xs">{row.number}</span> · {date(row.createdAt)}
                </p>
              </div>
              <div className="text-right">
                {row.status === 'accepted' ? (
                  <>
                    <p className="tnum font-display text-md font-bold text-ink-900">{money(row.paidCents)}</p>
                    <p className="text-xs text-ink-500">Paid by {row.paidBy}</p>
                  </>
                ) : (
                  <Badge tone={TONES[row.status]} size="sm">
                    {LABELS[row.status]}
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default AccountSoldPhonesPage;
