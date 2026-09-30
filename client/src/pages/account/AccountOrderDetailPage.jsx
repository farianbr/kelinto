import { Link, useParams } from 'react-router';
import { ArrowLeft, ExternalLink, RotateCcw } from 'lucide-react';
import { money, date, dateTime } from '@/lib/format';
import Panel from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import OrderStepper from '@/components/account/OrderStepper';
import { OrderStatusBadge } from '@/components/account/OrderStatusBadge';
import { PartVisual } from '@/components/product/PartFrame';
import { useOrder } from '@/hooks/useAccount';
import { useCart } from '@/hooks/useCart';
import { useAccountMutations } from '@/hooks/useAccount';
import useUiStore from '@/store/uiStore';
import { orderPaymentLabel } from '@/lib/paymentLabel';

function AddressBlock({ title, address }) {
  if (!address) return null;
  return (
    <div>
      <p className="eyebrow mb-1.5 text-ink-400">{title}</p>
      <address className="text-sm not-italic leading-relaxed text-ink-700">
        {address.contactName && <span className="block font-medium text-ink-900">{address.contactName}</span>}
        {address.company && <span className="block">{address.company}</span>}
        <span className="block">{address.line1}</span>
        {address.line2 && <span className="block">{address.line2}</span>}
        <span className="block">
          {address.city}, {address.region} {address.postal}
        </span>
        <span className="block">{address.country}</span>
        {address.phone && <span className="mt-1 block text-ink-500">{address.phone}</span>}
      </address>
    </div>
  );
}

export function AccountOrderDetailPage() {
  const { orderNumber } = useParams();
  const { data: order, isLoading, error } = useOrder(orderNumber);
  const { bulkAdd } = useAccountMutations();
  const openCart = useUiStore((s) => s.openCart);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <Panel>
        <p className="text-md text-ink-500">{error.message}</p>
        <Link
          to="/account/orders"
          className="mt-4 inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700"
        >
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          Back to orders
        </Link>
      </Panel>
    );
  }

  /** Reorder every line at the quantity originally bought. */
  function reorderAll() {
    bulkAdd.mutate(
      order.items.map((item) => ({ sku: item.sku, qty: item.qty })),
      { onSuccess: () => openCart() },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/account/orders"
            className="mb-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-700"
          >
            <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            All orders
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-mono text-xl font-semibold text-ink-900">{order.orderNumber}</h2>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Placed {dateTime(order.createdAt)}
            {order.poNumber && ` · PO ${order.poNumber}`}
          </p>
        </div>

        <Button variant="outline" icon={RotateCcw} loading={bulkAdd.isPending} onClick={reorderAll}>
          Reorder all
        </Button>
      </div>

      {/* ---- tracking ----------------------------------------------------- */}
      <Panel title="Tracking">
        <OrderStepper order={order} />

        {order.tracking?.number && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-2 px-4 py-3">
            <div>
              <p className="eyebrow text-ink-400">{order.tracking.carrier}</p>
              <p className="tnum mt-0.5 font-mono text-md font-medium text-ink-900">
                {order.tracking.number}
              </p>
            </div>
            {order.tracking.url && (
              <a
                href={order.tracking.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-700"
              >
                Track with {order.tracking.carrier}
                <ExternalLink className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </Panel>

      {/* ---- items -------------------------------------------------------- */}
      <Panel title={`Items (${order.items.length})`} flush>
        <ul className="divide-y divide-line">
          {order.items.map((item) => (
            <li key={item.sku} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
              <Link
                to={item.slug ? `/product/${item.slug}` : '/'}
                className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 p-2"
              >
                <PartVisual product={item} />
              </Link>

              <div className="min-w-0 flex-1">
                <Link
                  to={item.slug ? `/product/${item.slug}` : '/'}
                  className="line-clamp-2 text-md font-medium text-ink-900 hover:text-brand"
                >
                  {item.name}
                </Link>
                <p className="mt-0.5 font-mono text-xs text-ink-300">{item.sku}</p>
                {item.grade && (
                  <p className="eyebrow mt-1 text-ink-400">{item.grade.replace('-', ' ')}</p>
                )}
              </div>

              <div className="shrink-0 text-right">
                <p className="tnum font-display text-md font-bold text-ink-900">
                  {money(item.lineTotal)}
                </p>
                <p className="tnum text-xs text-ink-400">
                  {item.qty} × {money(item.unitPrice)}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <dl className="space-y-2 border-t border-line bg-surface-2 px-4 py-4 text-md sm:px-5">
          <div className="flex justify-between">
            <dt className="text-ink-500">Subtotal</dt>
            <dd className="tnum font-medium text-ink-900">{money(order.subtotal)}</dd>
          </div>

          {/* Two savings lines, never merged: one came from a bundle and one
              from an offer, and reconciling an invoice means seeing which. */}
          {order.bundleDiscount > 0 && (
            <div className="flex justify-between">
              <dt className="text-ok">Bundle pricing</dt>
              <dd className="tnum font-medium text-ok">−{money(order.bundleDiscount)}</dd>
            </div>
          )}
          {order.promoDiscount > 0 && (
            <div className="flex justify-between">
              <dt className="text-ok">
                {order.promo?.code ? (
                  <span className="font-mono text-sm">{order.promo.code}</span>
                ) : (
                  'Offer'
                )}{' '}
                <span className="text-ink-400">({order.promo?.label})</span>
              </dt>
              <dd className="tnum font-medium text-ok">−{money(order.promoDiscount)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-500">{order.deliveryMethod?.label ?? 'Shipping'}</dt>
            <dd className="tnum font-medium text-ink-900">
              {order.shipping === 0 ? 'Free' : money(order.shipping)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">HST</dt>
            <dd className="tnum font-medium text-ink-900">{money(order.tax)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-2.5">
            <dt className="font-display text-md font-bold text-ink-900">Total</dt>
            <dd className="tnum font-display text-xl font-bold text-ink-900">
              {money(order.total)}
            </dd>
          </div>
        </dl>
      </Panel>

      {/* ---- addresses & payment ------------------------------------------ */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Delivery">
          <AddressBlock title="Shipping to" address={order.shippingAddress} />
          {order.deliveryNotes && (
            <p className="mt-4 rounded-md bg-surface-2 px-3 py-2.5 text-sm text-ink-500">
              <span className="eyebrow mb-1 block text-ink-400">Delivery notes</span>
              {order.deliveryNotes}
            </p>
          )}
        </Panel>

        <Panel title="Billing & payment">
          <AddressBlock title="Billing to" address={order.billingAddress} />
          <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">Method</dt>
              <dd className="font-medium text-ink-900">
                {orderPaymentLabel(order.payment?.method)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Status</dt>
              <dd className="font-medium capitalize text-ink-900">{order.payment?.status}</dd>
            </div>
            {order.payment?.paidAt && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Paid</dt>
                <dd className="font-medium text-ink-900">{date(order.payment.paidAt)}</dd>
              </div>
            )}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

export default AccountOrderDetailPage;
