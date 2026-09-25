import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  ClipboardList,
  Eye,
  EyeOff,
  MapPin,
  Pencil,
  SlidersHorizontal,
  Truck,
  Wallet,
} from 'lucide-react';
import cn from '@/lib/cn';
import { money, date, dateTime, count as formatCount } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import { PartVisual } from '@/components/product/PartFrame';
import PageHeader from '@/components/admin/PageHeader';
import KpiRow from '@/components/admin/KpiRow';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { OpsForm, AdjustForm, ProductForm } from '@/components/admin/StockForms';
import { useTaxonomy } from '@/hooks/useCatalog';
import {
  useAdminInventoryItem,
  useAdminSuppliers,
  useAdminMutations,
} from '@/hooks/useAdmin';
import Skeleton from '@/components/ui/Skeleton';
import { pressable } from '@/lib/motion';

/**
 * One product, seen from the warehouse (ERP rework §6.10).
 *
 * Fields, taxonomy, competitor benchmarks, the stock movement history and the
 * purchase history that is this part's real price history. Everything here is
 * admin-only - the storefront's product page shows in stock / out of stock and
 * nothing on this screen changes that.
 */

const STOCK_TONES = { in: 'ok', low: 'warn', out: 'danger' };
const STOCK_LABELS = { in: 'in stock', low: 'low stock', out: 'out of stock' };

const MOVEMENT_LABELS = {
  purchase: 'Received',
  sale: 'Sold',
  adjustment: 'Adjustment',
  return: 'Returned',
  damage: 'Damaged',
  transfer: 'Transfer',
};

const PO_STATUS_TONES = {
  draft: 'neutral',
  sent: 'info',
  partial: 'warn',
  received: 'ok',
  cancelled: 'danger',
};

export function AdminInventoryDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useAdminInventoryItem(id);

  // The same three mutations the inventory list uses. A product's own page is
  // where a staff member lands from a low-stock alert, and it was the one screen
  // that could show the problem without offering any way to fix it.
  const { adjustStock, updateInventoryOps, toggleProduct, updateProduct } = useAdminMutations();
  // The catalogue form cascades brand → series → model, so it needs the tree.
  const { data: tree } = useTaxonomy();
  const { data: supplierData } = useAdminSuppliers({ status: 'active' });
  const suppliers = supplierData?.suppliers ?? [];

  const [adjusting, setAdjusting] = useState(false);
  const [editingOps, setEditingOps] = useState(false);
  // Hiding is the one action here that fires on the click itself - the other
  // three open a form that already asks before it writes. A storefront listing
  // vanishing because a button was next to the one somebody meant is exactly
  // the mistake a confirm step exists to catch.
  const [confirmingVisibility, setConfirmingVisibility] = useState(false);
  const [editing, setEditing] = useState(false);

  const product = data?.product;
  const movements = data?.movements ?? [];
  const purchases = data?.purchases ?? [];

  const purchasePage = useTablePage(purchases);

  useSetRecordLabel(product?.name);

  if (error) {
    return (
      <>
        <PageHeader icon={Boxes} title="Product" />
        <Panel>
          <PanelEmpty
            icon={Boxes}
            title="Product not found"
            body={error.message}
            action={
              <Link
                to="/admin/inventory"
                className={cn(pressable, 'inline-flex h-9 select-none items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 font-display text-sm font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
              >
                Back to inventory
              </Link>
            }
          />
        </Panel>
      </>
    );
  }

  if (isLoading || !product) {
    return (
      <>
        <PageHeader icon={Boxes} title="Product" />
        <div className="space-y-3">
          <Skeleton className="h-24" rounded="lg" />
          <Skeleton className="h-64" rounded="lg" />
        </div>
      </>
    );
  }

  const margin =
    product.cost > 0 ? Math.round(((product.price - product.cost) / product.price) * 100) : null;

  const purchaseColumns = [
    {
      key: 'poNumber',
      header: 'PO',
      priority: 1,
      render: (row) => (
        <Link
          to={`/admin/purchase-orders/${row.id}`}
          className="whitespace-nowrap font-mono text-sm font-medium text-ink-900 hover:text-brand"
        >
          {row.poNumber}
        </Link>
      ),
    },
    { key: 'supplier', header: 'Supplier', priority: 2, className: 'max-w-[160px] truncate' },
    {
      key: 'orderDate',
      header: 'Ordered',
      priority: 3,
      render: (row) => <span className="text-sm text-ink-500">{date(row.orderDate)}</span>,
    },
    {
      key: 'qtyReceived',
      header: 'Received',
      priority: 2,
      align: 'right',
      className: 'tnum',
      render: (row) => `${formatCount(row.qtyReceived)} / ${formatCount(row.qtyOrdered)}`,
    },
    {
      key: 'status',
      header: 'Status',
      priority: 3,
      render: (row) => (
        <Badge tone={PO_STATUS_TONES[row.status]} size="sm">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'unitCost',
      header: 'Unit cost',
      priority: 1,
      align: 'right',
      className: 'tnum font-medium text-ink-900',
      render: (row) => money(row.unitCost),
    },
  ];

  return (
    // The record measure, centred - one record is a reading screen, and a
    // list is what earns the shell's full width. The `.record-page` class carries
    // the whole treatment; see the container tokens in index.css.
    <div className="record-page">
      <PageHeader
        icon={Boxes}
        title={product.name}
        description={`${product.brandName ?? ''} ${product.modelName ?? ''} · ${product.partTypeLabel}`.trim()}
        badge={
          <>
            <Badge tone={STOCK_TONES[product.stockStatus]} size="sm">
              {STOCK_LABELS[product.stockStatus]}
            </Badge>
            {!product.isActive && (
              <Badge tone="neutral" size="sm">
                hidden
              </Badge>
            )}
          </>
        }
        // The actions the list already offers on this product, on the screen
        // the staff member actually arrives at from a low-stock alert. Adjust
        // stock leads and takes the solid button: it is the reason somebody
        // opens this page from an alert. Editing the catalogue record itself
        // stays on the list, where the taxonomy pickers live.
        action={
          <>
            <Button size="sm" icon={Boxes} onClick={() => setAdjusting(true)}>
              Adjust stock
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={SlidersHorizontal}
              onClick={() => setEditingOps(true)}
            >
              Reorder point
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={product.isActive ? EyeOff : Eye}
              loading={toggleProduct.isPending}
              onClick={() => setConfirmingVisibility(true)}
            >
              {product.isActive ? 'Hide' : 'List'}
            </Button>
            {/* Opens the form HERE. It used to link to the list pre-searched
                for this SKU, which meant "edit this product" answered with a
                search results page the staff member then had to act on again - the
                work was one click further away than before they clicked. */}
            <Button
              size="sm"
              variant="outline"
              icon={Pencil}
              onClick={() => setEditing(true)}
            >
              Edit product
            </Button>
          </>
        }
      />

      <KpiRow
        tiles={[
          {
            key: 'stock',
            label: 'On hand',
            value: formatCount(product.stock),
            hint:
              product.minStock > 0
                ? `Reorder point ${formatCount(product.minStock)}`
                : 'No reorder point set',
            tone: STOCK_TONES[product.stockStatus],
            icon: Boxes,
          },
          {
            key: 'price',
            label: 'Unit price',
            value: money(product.price),
            hint: 'What a customer pays',
            tone: 'brand',
            icon: Wallet,
          },
          {
            key: 'cost',
            label: 'Unit cost',
            value: product.cost > 0 ? money(product.cost) : '-',
            hint: margin === null ? 'No cost recorded yet' : `${margin}% margin`,
            tone: 'warn',
            icon: Wallet,
          },
          {
            key: 'value',
            label: 'Stock value',
            value: money(product.totalValue),
            hint: 'Quantity × cost',
            tone: 'ok',
            icon: Wallet,
          },
        ]}
      />

      <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
        <div className="space-y-3">
          <Panel title="Product">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 p-1.5">
                <PartVisual product={product} />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-xs text-ink-500">{product.sku}</p>
                <p className="mt-0.5 text-xs text-ink-400">{product.grade}</p>
              </div>
            </div>

            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-400">Device</dt>
                <dd className="text-right text-ink-700">{product.deviceTypeName ?? '-'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-400">Brand</dt>
                <dd className="text-right text-ink-700">{product.brandName ?? '-'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-400">Series</dt>
                <dd className="text-right text-ink-700">{product.seriesName ?? '-'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-400">Model</dt>
                <dd className="text-right text-ink-700">{product.modelName ?? '-'}</dd>
              </div>
              {product.barcode && (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-400">Barcode</dt>
                  <dd className="text-right font-mono text-ink-700">{product.barcode}</dd>
                </div>
              )}
            </dl>
          </Panel>

          <Panel title="Warehouse">
            <dl className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-ink-400">Location</dt>
                  <dd className="text-ink-700">{product.location ?? 'Not set'}</dd>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Truck className="mt-0.5 size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-ink-400">Default supplier</dt>
                  <dd className="text-ink-700">
                    {product.supplier ? (
                      <Link
                        to={`/admin/suppliers/${product.supplier.id}`}
                        className="hover:text-brand"
                      >
                        {product.supplier.name}
                      </Link>
                    ) : (
                      'Not set'
                    )}
                  </dd>
                </div>
              </div>
            </dl>
          </Panel>

          {product.competitors.length > 0 && (
            <Panel
              title="Market benchmarks"
              description="What the same part costs at named rivals."
            >
              <ul className="space-y-1.5">
                {product.competitors.map((competitor) => (
                  <li
                    key={competitor.name}
                    className="tnum flex items-baseline justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-ink-600">{competitor.name}</span>
                    <span
                      className={cn(
                        'shrink-0 font-medium',
                        competitor.price > product.price ? 'text-ok' : 'text-ink-900',
                      )}
                    >
                      {money(competitor.price)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-3">
          <Panel
            title="Purchase history"
            description="What this part has cost, per delivery."
            flush
          >
            <div className="border-b border-line px-3 py-2 sm:px-4">
              <CountLine
                total={purchases.length}
                shown={purchasePage.pageRows.length}
                from={purchasePage.from}
                noun={purchases.length === 1 ? 'delivery' : 'deliveries'}
              />
            </div>

            <DataTable
              columns={purchaseColumns}
              rows={purchasePage.pageRows}
              rowKey={(row) => row.id}
              defaultSort={{ key: 'orderDate', direction: 'desc' }}
              empty={
                <PanelEmpty
                  icon={ClipboardList}
                  title="Never ordered"
                  body="This part has not appeared on a purchase order yet."
                />
              }
            />

            <Pagination
              page={purchasePage.page}
              pages={purchasePage.totalPages}
              onChange={purchasePage.setPage}
              hideWhenSingle
              className="border-t border-line px-3 py-3 sm:px-4"
            />
          </Panel>

          <Panel
            title="Stock movements"
            description="Every change to the quantity on hand, with its reason."
            flush
          >
            {movements.length ? (
              <ul className="divide-y divide-line">
                {movements.map((movement) => {
                  const positive = movement.qtyChange > 0;
                  const Icon = positive ? ArrowUpRight : ArrowDownRight;
                  return (
                    <li key={movement.id} className="flex items-start gap-3 px-4 py-3">
                      <span
                        className={cn(
                          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                          positive ? 'bg-ok-50 text-ok' : 'bg-warn-50 text-warn',
                        )}
                      >
                        <Icon className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span className="text-ink-900">
                            {MOVEMENT_LABELS[movement.type] ?? movement.type}
                          </span>
                          <span
                            className={cn('tnum font-medium', positive ? 'text-ok' : 'text-warn')}
                          >
                            {positive ? '+' : ''}
                            {movement.qtyChange}
                          </span>
                          <span className="tnum text-xs text-ink-400">
                            {movement.qtyAfter} on hand after
                          </span>
                        </p>

                        <p className="mt-0.5 text-xs text-ink-400">
                          {dateTime(movement.at)}
                          {movement.reference?.label ? ` · ${movement.reference.label}` : ''}
                          {movement.unitCost ? ` · ${money(movement.unitCost)} each` : ''}
                        </p>

                        {movement.note && (
                          <p className="mt-0.5 text-xs text-ink-500">{movement.note}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <PanelEmpty
                icon={AlertCircle}
                title="No movements recorded"
                body="Receiving a purchase order or adjusting stock records a movement here."
              />
            )}
          </Panel>
        </div>
      </div>

      {/* The same two forms the inventory list opens, imported rather than
          re-declared - a second copy is how the two screens drift apart. */}
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit product"
        size="lg"
        align="top"
      >
        <ProductForm
          product={product}
          tree={tree}
          isPending={updateProduct.isPending}
          error={updateProduct.error?.message}
          onCancel={() => setEditing(false)}
          onSubmit={(values) =>
            updateProduct.mutate(
              { id: product.id, ...values },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      </Modal>

      <Modal
        open={adjusting}
        onClose={() => setAdjusting(false)}
        title="Adjust stock"
        size="md"
        align="top"
      >
        <AdjustForm
          product={product}
          isPending={adjustStock.isPending}
          error={adjustStock.error?.message}
          onCancel={() => setAdjusting(false)}
          onSubmit={(values) =>
            adjustStock.mutate(
              {
                id: product.id,
                qtyChange: Number(values.qtyChange),
                type: values.type,
                note: values.note,
              },
              { onSuccess: () => setAdjusting(false) },
            )
          }
        />
      </Modal>

      {/* `info`, not `danger`: nothing is destroyed and the same button puts
          it back. The body states what actually changes for a buyer, because
          "hide" alone does not say whether stock or history goes with it. */}
      <ConfirmDialog
        open={confirmingVisibility}
        onClose={() => setConfirmingVisibility(false)}
        onConfirm={() =>
          toggleProduct.mutate(product.id, {
            onSuccess: () => setConfirmingVisibility(false),
          })
        }
        title={product.isActive ? `Hide ${product.name}?` : `List ${product.name}?`}
        body={
          product.isActive
            ? 'It stops appearing in the catalogue and cannot be ordered. Stock, cost and history are untouched, and listing it again puts it straight back.'
            : 'It returns to the catalogue and can be ordered again, at its current price and stock.'
        }
        tone="info"
        confirmLabel={product.isActive ? 'Hide from website' : 'List on website'}
        loading={toggleProduct.isPending}
        error={toggleProduct.error?.message}
      />

      <Modal
        open={editingOps}
        onClose={() => setEditingOps(false)}
        title="Reorder point and cost"
        size="md"
        align="top"
      >
        <OpsForm
          product={product}
          suppliers={suppliers}
          isPending={updateInventoryOps.isPending}
          error={updateInventoryOps.error?.message}
          onCancel={() => setEditingOps(false)}
          onSubmit={(values) =>
            updateInventoryOps.mutate(
              {
                id: product.id,
                minStock: Number(values.minStock) || 0,
                cost: Math.round(Number(values.costDollars || 0) * 100),
                location: values.location || undefined,
                supplier: values.supplier || undefined,
                barcode: values.barcode || undefined,
              },
              { onSuccess: () => setEditingOps(false) },
            )
          }
        />
      </Modal>
    </div>
  );
}

export default AdminInventoryDetailPage;
