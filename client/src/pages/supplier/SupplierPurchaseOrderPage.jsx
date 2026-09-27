import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  MessageSquare,
  Send,
  Trophy,
  Truck,
  XCircle,
} from 'lucide-react';
import { money, date } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectMenu from '@/components/ui/SelectMenu';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useTableClasses } from '@/components/admin/DataTable';
import { toast } from '@/store/toastStore';
import { apiUrl } from '@/lib/api';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';
import { useSupplierOrder, useSupplierPortalMutations } from '@/hooks/useSupplierPortal';

/**
 * One purchase order, and the form that prices it (§6.8a).
 *
 * **A price per line, and the ability to say "not this one".** A supplier who
 * stocks nine of the ten parts must be able to answer for the nine without
 * quoting zero on the tenth - a zero is a legitimate price for a sample, and
 * conflating the two is how an order gets placed for something nobody has. That
 * is the `available` toggle, and the server ranks an incomplete bid below a
 * complete one rather than letting a smaller total look like a better offer.
 *
 * **Prices are typed in dollars and sent in cents.** Every money field in this
 * app is an integer cent server-side; this is the boundary where that
 * conversion happens, and the running total below the table is a preview the
 * server recomputes on submit.
 *
 * **Nothing here names another supplier.** The serializer returns this
 * supplier's own bid and nothing else - no rank, no gap to the leader - because
 * a sealed process that quietly reports the competition is a live auction
 * nobody agreed to run.
 *
 * Re-submittable while the order is open. A supplier correcting a typo should
 * not have to ask anybody to reopen anything.
 */

/**
 * How many of a line a supplier is offering.
 *
 * Blank means "all of them", which is what a quote said before the field
 * existed and is the answer most suppliers give. Capped at what was asked for,
 * matching the server: a bigger number is a different order.
 */
function suppliedQtyFor(line, asked) {
  const raw = String(line?.qty ?? '').trim();
  if (raw === "") return asked;
  const n = Number(raw);
  if (!Number.isFinite(n)) return asked;
  return Math.min(Math.max(0, Math.round(n)), asked);
}

/** What each status is called in a sentence, for the confirmation. */
const DELIVERY_LABELS = {
  pending: 'not dispatched',
  preparing: 'preparing',
  dispatched: 'dispatched',
  in_transit: 'in transit',
  delivered: 'delivered',
};

const DELIVERY_OPTIONS = [
  { value: 'pending', label: 'Not started' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'delivered', label: 'Delivered' },
];

export function SupplierPurchaseOrderPage() {
  const { id } = useParams();
  const t = useTableClasses();

  const { data, isLoading } = useSupplierOrder(id);
  const { submitQuote, declineQuote, submitProforma, setDeliveryStatus } =
    useSupplierPortalMutations();

  const [declining, setDeclining] = useState(false);
  // The validated payload, held while the confirmation is open.
  const [confirmingQuote, setConfirmingQuote] = useState(null);
  const [error, setError] = useState(null);

  const order = data?.order;
  const bid = order?.myBid;

  const { register, handleSubmit, watch, setValue } = useForm({
    // Populated from the order once it loads - `values` rather than
    // `defaultValues`, so a supplier returning to a price they already sent
    // sees their own numbers rather than an empty form.
    //
    // Gated on `bid`, not on `order`: a hook cannot sit behind an early return,
    // so the condition has to name the thing it actually dereferences.
    values: bid
      ? {
          shipping: ((bid.shipping ?? 0) / 100).toFixed(2),
          leadTimeDays: bid.leadTimeDays ?? '',
          validUntil: bid.validUntil ? new Date(bid.validUntil).toISOString().slice(0, 10) : '',
          note: bid.note ?? '',
          // The invoice half of the same form, seeded from whatever was last
          // issued so a revision starts from the previous one.
          piNumber: bid.proforma?.number ?? '',
          piValidUntil: bid.proforma?.validUntil
            ? new Date(bid.proforma.validUntil).toISOString().slice(0, 10)
            : '',
          piPaymentTerms: bid.proforma?.paymentTerms ?? '',
          piBankDetails: bid.proforma?.bankDetails ?? '',
          lines: order.items.map((item) => {
            const existing = bid.lines.find((line) => line.sku === item.sku);
            return {
              sku: item.sku,
              unitCost: existing ? (existing.unitCost / 100).toFixed(2) : '',
              // Blank when they never narrowed it, so the field shows the full
              // quantity as a placeholder rather than repeating it as a value.
              qty: existing?.qty != null ? String(existing.qty) : '',
              available: existing ? existing.available : true,
            };
          }),
        }
      : undefined,
  });

  const lines = watch('lines') ?? [];
  const shipping = Math.round(Number(watch('shipping') || 0) * 100);

  // Also `order.items`, not `order` - see the note on `values` above: the
  // gated response has an order with no items on it.
  const subtotal = order?.items
    ? order.items.reduce((sum, item, index) => {
        const line = lines[index];
        if (!line || line.available === false) return sum;
        const cost = Math.round(Number(line.unitCost || 0) * 100);
        // Their quantity, not ours: the preview has to agree with what the
        // server will total when this is sent.
        return sum + (Number.isFinite(cost) ? cost * suppliedQtyFor(line, item.qty) : 0);
      }, 0)
    : 0;

  if (isLoading) {
    return (
      <>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-64 w-full" />
      </>
    );
  }

  if (!order) {
    return (
      <Panel>
        <PanelEmpty
          icon={Send}
          title="Order not found"
          body="It may have been withdrawn, or the link is out of date. Check the email it came from."
        />
      </Panel>
    );
  }

  const locked = order.state !== 'open';
  const won = order.state === 'won';
  const priced = ['quoted', 'negotiating', 'confirmed'].includes(bid.status);
  // The round we have opened and they have not yet answered - the whole reason
  // to show a negotiation banner rather than burying it in history.
  const openRound = (bid.negotiations ?? []).find((round) => !round.respondedAt);

  /**
   * Sending a price is a commitment, so it confirms first.
   *
   * The form is validated here and the payload held, rather than confirming
   * first and validating after: a dialog that appears and then reports "enter a
   * price for at least one line" has asked the supplier to commit to something
   * it already knew was incomplete.
   */
  function submit(values) {
    setError(null);

    const answered = values.lines.filter(
      (line) => line.available === false || String(line.unitCost).trim() !== '',
    );
    if (!answered.length) {
      setError('Enter a price for at least one line, or mark the lines you cannot supply.');
      return;
    }

    setConfirmingQuote({
      quote: {
        id: order.id,
        shipping,
        leadTimeDays: values.leadTimeDays === '' ? undefined : Number(values.leadTimeDays),
        validUntil: values.validUntil || undefined,
        note: values.note || undefined,
        lines: answered.map((line) => ({
          sku: line.sku,
          unitCost: Math.round(Number(line.unitCost || 0) * 100),
          // Omitted when left blank, which the server reads as "all of them" -
          // so a quote that never touched the field behaves exactly as it did
          // before the field existed.
          qty:
            String(line.qty ?? '').trim() === ''
              ? undefined
              : Math.max(0, Math.round(Number(line.qty))),
          available: line.available !== false,
        })),
      },
      /**
       * The invoice always goes out with the price.
       *
       * It used to be raised only when one of the invoice fields was filled in,
       * which contradicted the button beside it: a supplier pressed **Send my
       * PI** and, having left the reference blank, got no PI. Those fields are
       * details *on* the document - a reference, terms, where the money goes -
       * not a switch deciding whether the document exists. A supplier with none
       * of them still has an invoice; it simply carries our order number
       * instead of theirs.
       */
      proforma: {
        id: order.id,
        number: values.piNumber?.trim() || undefined,
        validUntil: values.piValidUntil || undefined,
        paymentTerms: values.piPaymentTerms?.trim() || undefined,
        bankDetails: values.piBankDetails?.trim() || undefined,
      },
      lineCount: answered.filter((line) => line.available !== false).length,
    });
  }

  /**
   * The price first, then the invoice against it.
   *
   * **In that order, and only if the price lands.** A proforma is totalled from
   * the bid server-side, so issuing one against prices that failed to save would
   * produce a document whose figures came from nowhere. Chaining them also means
   * a supplier sees one confirmation and one result for what is, to them, a
   * single act.
   */
  function sendQuote() {
    const { quote, proforma } = confirmingQuote;

    submitQuote.mutate(quote, {
      onSuccess: () => {
        submitProforma.mutate(proforma, {
          onSuccess: () => {
            setConfirmingQuote(null);
            toast.ok(
              priced ? 'Your revised PI is with us' : 'Your PI is with us',
              'Our purchasing team has it.',
            );
          },
          onError: (err) => {
            setConfirmingQuote(null);
            // Named precisely: the price DID save, and a supplier told only
            // "that failed" will send the whole thing again.
            setError(`Your price was saved, but the invoice was not: ${err.message}`);
          },
        });
      },
      onError: (err) => {
        setConfirmingQuote(null);
        setError(err.message);
      },
    });
  }

  return (
    <>
      <Link
        to="/supplier"
        className={cn(
          pressable,
          'mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900',
        )}
      >
        <ArrowLeft className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        All orders
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold leading-tight text-ink-900">
            {order.title || 'Purchase order'}
          </h1>
          <p className="mt-1 font-mono text-sm text-ink-400">{order.poNumber}</p>
        </div>

        {order.closesAt && !locked && (
          <Badge tone={order.closed ? 'danger' : 'info'}>
            {order.closed ? 'Closed' : 'Closes'} {date(order.closesAt)}
          </Badge>
        )}
      </div>

      {/* What state this order is in, said plainly. A supplier who won needs to
          know goods are expected; one who was not chosen is owed a straight
          answer rather than silence. */}
      {won && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-ok-50 px-3 py-2.5 text-sm text-ok">
          <Trophy className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          Your price was accepted and this order is confirmed with you.
        </p>
      )}
      {order.state === 'closed' && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-surface-3 px-3 py-2.5 text-sm text-ink-500">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          This order has been decided. Thank you for pricing it - we will be in touch with the next
          one.
        </p>
      )}
      {order.state === 'cancelled' && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-surface-3 px-3 py-2.5 text-sm text-ink-500">
          <XCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          This order was withdrawn.
        </p>
      )}
      {bid.status === 'declined' && (
        <p className="mb-4 flex items-start gap-2 rounded-md bg-surface-3 px-3 py-2.5 text-sm text-ink-500">
          <XCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          You told us you could not supply this one.
        </p>
      )}

      {/* An open negotiation round leads the page: it is a question waiting on
          an answer, and burying it under the price table is how it goes unread. */}
      {openRound && !locked && (
        <Panel className="mb-3 border-brand/40">
          <p className="flex items-start gap-2 text-sm text-ink-900">
            <MessageSquare
              className="mt-0.5 size-4 shrink-0 text-brand"
              strokeWidth={2}
              aria-hidden="true"
            />
            <span>
              <strong className="font-semibold">We have asked about your price.</strong>{' '}
              {openRound.askedTotal != null && (
                <>
                  Our target for the order is{' '}
                  <span className="tnum font-semibold">{money(openRound.askedTotal)}</span>.{' '}
                </>
              )}
              {openRound.note}
            </span>
          </p>
          <p className="mt-2 text-xs text-ink-400">
            Update your prices below and send them again to answer.
          </p>
        </Panel>
      )}

      {order.notes && (
        <Panel className="mb-3">
          <p className="text-sm leading-relaxed text-ink-700">{order.notes}</p>
        </Panel>
      )}

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit(submit)}>
        <Panel title="Your quote" flush className="mb-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-150 text-left">
              <thead>
                <tr className={t.headRow}>
                  <th scope="col" className={t.headCell()}>
                    Part
                  </th>
                  {/* "You can supply", not "Qty": the column is now an answer
                      rather than a restatement of what we asked for. */}
                  <th scope="col" className={cn(t.headCell('right'), 'w-36')}>
                    You can supply
                  </th>
                  <th scope="col" className={cn(t.headCell('right'), 'w-32')}>
                    Unit price
                  </th>
                  <th scope="col" className={cn(t.headCell('right'), 'w-28')}>
                    Line total
                  </th>
                  {/* "Stocked", not "Can supply": the quantity column now
                      answers how many, and two columns reading "can supply"
                      made the yes/no toggle look like a duplicate of it. This
                      one is whether they carry the part at all. */}
                  <th scope="col" className={cn(t.headCell('right'), 'w-24')}>
                    Stocked
                  </th>
                </tr>
              </thead>

              <tbody>
                {order.items.map((item, index) => {
                  const line = lines[index];
                  const available = line?.available !== false;
                  const cost = Math.round(Number(line?.unitCost || 0) * 100);
                  // What they can actually send, capped at what was asked for.
                  const supplied = suppliedQtyFor(line, item.qty);
                  const short = available && supplied < item.qty;
                  const lineTotal = available && Number.isFinite(cost) ? cost * supplied : 0;

                  return (
                    <tr key={item.sku} className={cn(t.row, !available && 'opacity-60')}>
                      <td className={t.cell()}>
                        <span className="block truncate text-sm text-ink-900">{item.name}</span>
                        <span className="block font-mono text-2xs text-ink-400">{item.sku}</span>
                      </td>

                      {/**
                       * How many they can supply, **editable**.
                       *
                       * A supplier holding 30 of the 40 asked for previously had
                       * two ways to answer: quote for 40 they cannot ship, or
                       * mark the line unavailable and lose the 30 they can. Both
                       * are worse than the truth, and the second costs us stock
                       * somebody had.
                       *
                       * The asked-for figure stays beside it, because "30" alone
                       * does not say whether that is short.
                       */}
                      <td className={cn(t.cell('right'), 'tnum')}>
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="number"
                            min="0"
                            max={item.qty}
                            disabled={locked || !available}
                            aria-label={`How many ${item.name} you can supply`}
                            placeholder={String(item.qty)}
                            className={cn(
                              'h-8 w-16 rounded-sm border bg-surface px-1.5 text-right text-xs tabular-nums text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                              short ? 'border-warn/50 bg-warn-50' : 'border-line focus:border-brand',
                            )}
                            {...register(`lines.${index}.qty`)}
                          />
                          <span className="shrink-0 text-2xs text-ink-400">of {item.qty}</span>
                        </div>
                      </td>
                      <td className={t.cell('right')}>
                        <Input
                          inputMode="decimal"
                          placeholder="0.00"
                          suffix="$"
                          disabled={locked || !available}
                          aria-label={`Your unit price for ${item.name}`}
                          {...register(`lines.${index}.unitCost`)}
                        />
                      </td>
                      <td className={cn(t.cell('right'), 'tnum text-sm font-medium text-ink-900')}>
                        {available ? money(lineTotal) : <span className="text-ink-300">-</span>}
                      </td>
                      <td className={t.cell('right')}>
                        {/* A toggle, not a price of zero. "We do not stock this"
                            and "this one is free" are different answers, and
                            only one of them should end up on a purchase order. */}
                        <button
                          type="button"
                          disabled={locked}
                          aria-pressed={available}
                          onClick={() =>
                            setValue(`lines.${index}.available`, !available, { shouldDirty: true })
                          }
                          className={cn(
                            pressable,
                            'rounded-full border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
                            available
                              ? 'border-ok/30 bg-ok-50 text-ok'
                              : 'border-line bg-surface text-ink-400 hover:border-line-strong',
                          )}
                        >
                          {available ? 'Yes' : 'No'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid items-start gap-3 lg:grid-cols-[1fr_minmax(0,320px)]">
          <Panel title="Delivery and terms">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Lead time"
                type="number"
                min="0"
                suffix="days"
                disabled={locked}
                hint="How long from order to delivery."
                {...register('leadTimeDays')}
              />
              <Input
                label="Price valid until"
                type="date"
                disabled={locked}
                {...register('validUntil')}
              />
            </div>

            <Textarea
              label="Anything we should know"
              rows={3}
              disabled={locked}
              placeholder="Minimum order, part condition, packaging…"
              containerClassName="mt-3"
              {...register('note')}
            />

            {!locked && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {/* The label names the **document**, not the act.
                    "Send my price" described a step in a flow; a supplier
                    thinks in terms of the proforma invoice they are issuing,
                    which is also what our purchasing desk receives and pays
                    against. `priced` picks send from update, because reissuing
                    is a revision rather than a first offer. */}
                <Button
                  type="submit"
                  icon={Send}
                  loading={submitQuote.isPending || submitProforma.isPending}
                >
                  {priced ? 'Update my PI' : 'Send my PI'}
                </Button>

                {/* Both of these confirm through `ConfirmDialog` rather than an
                    inline two-step: one confirmation in the app, so a supplier
                    learns the pattern once (Instructions §3.0.1). */}
                <Button
                  type="button"
                  variant="ghost"
                  icon={XCircle}
                  onClick={() => setDeclining(true)}
                >
                  I cannot supply this
                </Button>
              </div>
            )}
          </Panel>

          <Panel>
            <dl className="space-y-2 text-sm">
              <div className="tnum flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Parts</dt>
                <dd className="font-medium text-ink-900">{money(subtotal)}</dd>
              </div>

              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-500">Shipping</dt>
                <dd className="w-28">
                  <Input
                    inputMode="decimal"
                    suffix="$"
                    disabled={locked}
                    aria-label="Shipping"
                    {...register('shipping')}
                  />
                </dd>
              </div>

              <div className="tnum flex items-baseline justify-between gap-3 border-t border-line pt-2 font-display text-lg font-bold text-ink-900">
                <dt>Your total</dt>
                <dd>{money(subtotal + shipping)}</dd>
              </div>
            </dl>

            <p className="mt-2.5 text-xs leading-relaxed text-ink-400">
              A preview - we recalculate this from your line prices when you send it.
            </p>

            {bid.quotedAt && (
              <p className="mt-2 text-xs text-ink-400">Last sent {date(bid.quotedAt)}.</p>
            )}
          </Panel>

          {/**
           * The invoice details, in the **same form** as the prices.
           *
           * They were a separate panel with its own submit, which split one job
           * in two: a supplier priced an order, pressed send, then had to find a
           * second form to raise the document carrying those prices. A proforma
           * IS the quote, formalised, so the reference, the terms and the bank
           * details sit beside the total they belong to and go out with it.
           *
           * Every field here is optional, but **the invoice is not**: it goes
           * out with every price. These add a supplier's own reference, terms
           * and bank details to it; blank ones simply leave the document
           * carrying ours.
           */}
          {!locked && (
            <Panel
              title="Invoice details"
              // Says what the fields ADD, not what they gate. The old wording -
              // "Fill these in to issue a proforma invoice" - read as though
              // leaving them blank meant no invoice, which was both misleading
              // and, at the time, true. Both were fixed together.
              description="Your invoice goes out with the price. Add your own reference and terms here, or leave them blank and we will use ours."
            >
              {/**
               * Document-scale fields, not the settings-page `Input`.
               *
               * The shared control is 44px tall with 15px text, which is right
               * for a form somebody fills in deliberately and wrong beside a
               * 12px document: the invoice block ended up shouting over the
               * order it belongs to. These match the agreement's own scale -
               * 32px boxes, 11px labels, 12px values - so the two panels read
               * as one sheet.
               */}
              <div className="space-y-2.5">
                <label className="block">
                  <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-400">
                    Your reference
                  </span>
                  <input
                    placeholder="PI-00123"
                    className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs text-ink-900 placeholder:text-ink-300 focus:border-brand focus:outline-none"
                    {...register('piNumber')}
                  />
                  <span className="mt-1 block text-2xs text-ink-400">
                    Your own invoice number, if you use one.
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-400">
                    Valid until
                  </span>
                  <input
                    type="date"
                    className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs text-ink-900 focus:border-brand focus:outline-none"
                    {...register('piValidUntil')}
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-400">
                    Payment terms
                  </span>
                  <input
                    placeholder="30% deposit, balance before dispatch"
                    className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs text-ink-900 placeholder:text-ink-300 focus:border-brand focus:outline-none"
                    {...register('piPaymentTerms')}
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-400">
                    Bank details
                  </span>
                  <textarea
                    rows={3}
                    placeholder="Bank, SWIFT/IBAN, account name and number"
                    className="w-full resize-none rounded-sm border border-line bg-surface px-2 py-1.5 text-xs leading-relaxed text-ink-900 placeholder:text-ink-300 focus:border-brand focus:outline-none"
                    {...register('piBankDetails')}
                  />
                </label>
              </div>

              {bid.proforma && (
                <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-500">
                  <FileText
                    className="mt-px size-3.5 shrink-0 text-ink-400"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <span>
                    Revision {bid.proforma.revision} issued {date(bid.proforma.issuedAt)}.{' '}
                    <a
                      href={apiUrl(`/supplier-portal/orders/${order.id}/proforma`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-brand hover:underline"
                    >
                      View or print it
                    </a>
                    . Sending again issues revision {bid.proforma.revision + 1}.
                  </span>
                </p>
              )}

              {/* What we asked for, if we did. A revision request is the reason
                  a supplier is issuing a second one, so it leads rather than
                  sitting somewhere they have to find. */}
              {bid.proforma?.review === 'revision_requested' && (
                <p className="mt-3 flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-xs leading-relaxed text-ink-700">
                  <AlertCircle
                    className="mt-0.5 size-3.5 shrink-0 text-warn"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-medium text-warn">We asked for a revision</span>
                    {bid.proforma.revisionNote && <>: “{bid.proforma.revisionNote}”</>}
                  </span>
                </p>
              )}

              {bid.proforma?.review === 'accepted' && (
                <p className="mt-3 flex items-start gap-2 rounded-md bg-ok-50 px-3 py-2.5 text-xs text-ok">
                  <CheckCircle2
                    className="mt-0.5 size-3.5 shrink-0"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  We accepted this invoice
                  {bid.proforma.acceptedAt && <> on {date(bid.proforma.acceptedAt)}</>}.
                </p>
              )}
            </Panel>
          )}
        </div>
      </form>

      {/* Delivery reporting, only for the confirmed supplier - a losing bidder
          marking a delivery dispatched is a fact about nothing. */}
      {won && (
        <DeliveryPanel order={order} bid={bid} setDeliveryStatus={setDeliveryStatus} />
      )}

      {/**
       * Every mutation on this page confirms first (Instructions §3.0.1).
       *
       * Sending a price and issuing an invoice are both **critical**: they reach
       * our purchasing desk, they are what we buy against, and a supplier cannot
       * take either back. Declining is ordinary - it is reversible by sending a
       * price afterwards - so it asks once without a typed phrase.
       */}
      <ConfirmDialog
        open={Boolean(confirmingQuote)}
        onClose={() => setConfirmingQuote(null)}
        onConfirm={sendQuote}
        tone="warn"
        title={priced ? 'Send an updated PI?' : 'Send your PI?'}
        body={
          confirmingQuote
            ? `${confirmingQuote.lineCount} line${
                confirmingQuote.lineCount === 1 ? '' : 's'
              } priced, ${money(subtotal + shipping)} in total including shipping.`
            : undefined
        }
        // Always the invoice warning now: a PI goes out with every price, so
        // there is no longer a lighter case to soften the wording for.
        confirmPhrase={order.poNumber}
        confirmPhraseLabel="the order number above"
        confirmLabel={priced ? 'Update my PI' : 'Send my PI'}
        loading={submitQuote.isPending || submitProforma.isPending}
      />

      <ConfirmDialog
        open={declining}
        onClose={() => setDeclining(false)}
        onConfirm={() =>
          declineQuote.mutate(
            { id: order.id },
            {
              onSuccess: () => {
                setDeclining(false);
                toast.ok('Thanks for telling us', 'We will not chase this one.');
              },
              onError: (err) => {
                setDeclining(false);
                setError(err.message);
              },
            },
          )
        }
        tone="danger"
        title={`Tell us you cannot supply ${order.poNumber}?`}
        body="We will stop chasing you for a price on this order."
        confirmLabel="Yes, I cannot supply this"
        confirmPhrase={order.poNumber}
        confirmPhraseLabel="the order number"
        loading={declineQuote.isPending}
      />
    </>
  );
}

/**
 * Where the goods are, reported by the supplier who is sending them.
 *
 * **This never moves stock.** Receiving is a physical count somebody makes at
 * our end, and a supplier saying "delivered" is a claim rather than a receipt
 * so this updates a status and notifies the purchasing desk, and the stock
 * ledger stays behind the admin's own receiving screen.
 */
function DeliveryPanel({ order, bid, setDeliveryStatus }) {
  const delivery = bid.delivery ?? { status: 'pending' };
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(delivery.status);
  const [confirming, setConfirming] = useState(null);

  const { register, handleSubmit } = useForm({
    values: {
      carrier: delivery.carrier ?? '',
      trackingNumber: delivery.trackingNumber ?? '',
      expectedAt: delivery.expectedAt
        ? new Date(delivery.expectedAt).toISOString().slice(0, 10)
        : '',
      note: delivery.note ?? '',
    },
  });

  function submit(values) {
    setError(null);
    setConfirming({ id: order.id, status, ...values, expectedAt: values.expectedAt || undefined });
  }

  function report() {
    setDeliveryStatus.mutate(confirming, {
      onSuccess: () => {
        setConfirming(null);
        toast.ok('Thank you', 'We have updated the order.');
      },
      onError: (err) => {
        setConfirming(null);
        setError(err.message);
      },
    });
  }

  return (
    <Panel
      title="Delivery"
      description="Tell us where this order has got to."
      className="mt-3"
    >
      <form onSubmit={handleSubmit(submit)}>
        {error && (
          <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="eyebrow mb-1.5 text-ink-400">Status</p>
            <SelectMenu
              srLabel="Delivery status"
              value={status}
              onChange={setStatus}
              options={DELIVERY_OPTIONS}
              containerClassName="w-full"
            />
          </div>
          <Input label="Expected arrival" type="date" {...register('expectedAt')} />
          <Input label="Carrier" placeholder="Purolator" {...register('carrier')} />
          <Input label="Tracking number" {...register('trackingNumber')} />
        </div>

        <Textarea label="Notes" rows={2} containerClassName="mt-3" {...register('note')} />

        <Button type="submit" icon={Truck} className="mt-3" loading={setDeliveryStatus.isPending}>
          Update delivery
        </Button>
      </form>
    </Panel>
  );
}

export default SupplierPurchaseOrderPage;
