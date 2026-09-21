import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import useAdminForm from '@/hooks/useAdminForm';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ClipboardList,
  Plus,
  Save,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import cn from '@/lib/cn';
import { money } from '@/lib/format';
import Panel from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/admin/PageHeader';
import InventoryPicker from '@/components/admin/InventoryPicker';
import ComponentTypePicker from '@/components/admin/ComponentTypePicker';
import { useTableClasses } from '@/components/admin/DataTable';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import {
  useAdminSuppliers,
  useAdminMutations,
  useSuppliersForComponentTypes,
  useReorderQueue,
} from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';

/**
 * Raise a purchase order (ERP rework §6.8).
 *
 * **A page, not a modal.** This was a dialog on the list screen, which is the
 * wrong shape for the work: a PO can run to a dozen lines, each one searched or
 * scanned, with a running total beside them - and a dialog gives that a scroll
 * container inside a scroll container and loses the draft the moment it is
 * dismissed. A page also has a URL, so "the order I was part-way through" is
 * something a staff member can come back to.
 *
 * `?supplier=<id>` preselects, which is how the supplier profile's **New PO**
 * button arrives here.
 *
 * **An order is raised to several suppliers, not one** (re-ruled 2026-09-11).
 * The picker is tag-driven - tick the component types, and every active
 * supplier carrying one of them is offered - because "who sells batteries" is
 * the question a purchasing clerk actually has. Anybody can still be added by
 * hand: the tags are a default, not a rule.
 *
 * **Nothing this page computes is trusted.** The totals below are a preview;
 * `purchaseService` recomputes every one of them from the lines on write
 * (§8, invariant 8). Unit costs typed here are an *expectation* - the price the
 * order is finally placed at comes from the confirmed supplier's own bid.
 */
const ADMIN_PAGE = {
  ...ADMIN_ROUTES['/admin/purchase-orders'],
  icon: adminIcon('ClipboardList'),
};

/**
 * Who the order goes to.
 *
 * **Tag-suggested and pre-ticked, with every other supplier underneath.** The
 * suggestion answers the question a clerk actually has - "who sells batteries"
 * - and pre-ticking it means the common case is no clicks at all. The full list
 * stays reachable because a tag is a default, not a rule: a supplier nobody has
 * tagged yet is still a supplier somebody may want a price from.
 */
function SupplierMultiSelect({ componentTypes, allSuppliers, value, onChange }) {
  const { data, isLoading } = useSuppliersForComponentTypes(componentTypes);
  const suggested = data?.suppliers ?? [];
  const suggestedIds = new Set(suggested.map((supplier) => supplier.id));

  // Everything the tags did not surface, so the picker is never a dead end.
  const others = allSuppliers.filter((supplier) => !suggestedIds.has(supplier.id));

  function toggle(id) {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  }

  function Row({ id, name, hint }) {
    const on = value.includes(id);
    return (
      <button
        key={id}
        type="button"
        aria-pressed={on}
        onClick={() => toggle(id)}
        className={cn(
          pressable,
          'flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left',
          on ? 'border-ok/40 bg-ok-50' : 'border-line bg-surface hover:border-line-strong',
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
          <span className="block truncate text-sm font-medium text-ink-900">{name}</span>
          {hint && <span className="block truncate text-xs text-ink-400">{hint}</span>}
        </span>
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {componentTypes.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5 text-ink-400">Tagged with what you picked</p>
          {isLoading ? (
            <p className="text-sm text-ink-400">Looking…</p>
          ) : !suggested.length ? (
            <p className="text-sm text-ink-400">
              Nobody is tagged with these component types yet. Tag your suppliers on the Suppliers
              screen, or pick from the full list below.
            </p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {suggested.map((supplier) => (
                <Row
                  key={supplier.id}
                  id={supplier.id}
                  name={supplier.name}
                  hint={`${supplier.matched.join(', ')}${supplier.hasPortal ? '' : ' · no portal access'}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {others.length > 0 && (
        <details className="rounded-md border border-line">
          <summary
            className={cn(
              pressable,
              'cursor-pointer select-none px-3 py-2 text-sm font-medium text-ink-700',
            )}
          >
            Every other supplier ({others.length})
          </summary>
          <div className="grid gap-1.5 border-t border-line p-2.5 sm:grid-cols-2">
            {others.map((supplier) => (
              <Row key={supplier.id} id={supplier.id} name={supplier.name} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** `YYYY-MM-DD` in local time - `toISOString()` would shift the day westward. */
function isoDay(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** A blank line. `product` holds the whole inventory row once one is chosen. */
const emptyLine = () => ({ product: null, qtyOrdered: 1, unitCostDollars: '0.00' });

export function AdminPurchaseOrderCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const t = useTableClasses();

  const { data: supplierData } = useAdminSuppliers({ status: 'active' });
  const suppliers = supplierData?.suppliers ?? [];

  const { createPurchaseOrder } = useAdminMutations();
  const [error, setError] = useState(null);

  // Who the order goes to, and what it is tagged with. Local state rather than
  // form fields: both are lists the pickers own, and `react-hook-form` gains
  // nothing from holding an array nobody validates per-field.
  const preselected = searchParams.get('supplier');
  const [pickedSuppliers, setPickedSuppliers] = useState(
    preselected ? [preselected] : [],
  );
  const [componentTypes, setComponentTypes] = useState([]);

  const { register, handleSubmit, control, watch, setValue } = useAdminForm({
    defaultValues: {
      orderDate: isoDay(),
      // A week out. A date a staff member can correct beats an empty field they
      // have to fill in on every order.
      expectedDate: isoDay(7),
      status: 'draft',
      notes: '',
      taxDollars: '0',
      shippingDollars: '0',
      items: [emptyLine()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');

  /**
   * Arriving from the reorder queue with `?reorder=1`, lines already filled in.
   *
   * **The queue is fetched here rather than passed through the URL.** A list of
   * a hundred product ids does not belong in an address bar, and more to the
   * point the quantities would be stale: seeding from a fetch made when this
   * screen opened means the numbers describe the shelf now, not whenever the
   * Inventory page last polled. It is the same reason the server re-derives
   * them rather than trusting a client.
   *
   * This replaces raising the draft outright. A generated PO was landing in the
   * list before anybody had seen a line of it - which is the moment a staff member
   * most wants to change a quantity, drop a product, or pick different
   * suppliers. Now nothing is written until they press save, so abandoning the
   * screen leaves no record behind.
   */
  const wantsReorder = searchParams.get('reorder') === '1';
  const { data: reorderData } = useReorderQueue(wantsReorder);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!wantsReorder || seeded || !reorderData?.items) return;

    // `?products=` narrows the queue to what was ticked on the Inventory
    // screen. Intersected rather than trusted: an id that is no longer below
    // its reorder point is dropped, so a stale selection cannot put a
    // well-stocked product on the order.
    const picked = searchParams.get('products');
    const wanted = picked ? new Set(picked.split(',').filter(Boolean)) : null;
    const queue = wanted
      ? reorderData.items.filter((item) => wanted.has(item.id))
      : reorderData.items;

    if (!queue.length) {
      // Nothing to reorder any more - somebody restocked, or a second tab got
      // here first. Said plainly rather than leaving an empty form that looks
      // like it failed to load.
      setError(
        wanted
          ? 'None of those products are below their reorder point any more.'
          : 'Nothing is below its reorder point right now.',
      );
      setSeeded(true);
      return;
    }

    setValue(
      'items',
      queue.map((item) => ({
        // The whole row, in the shape `InventoryPicker` renders.
        product: {
          id: item.id,
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          stock: item.stock,
          cost: item.cost ?? 0,
        },
        qtyOrdered: item.suggestedQty,
        unitCostDollars: ((item.cost ?? 0) / 100).toFixed(2),
      })),
      { shouldDirty: true },
    );

    // Tagged with what the lines actually cover, so the supplier picker offers
    // the people who sell these parts without the staff member tagging it by hand.
    setComponentTypes([...new Set(queue.map((item) => item.partType).filter(Boolean))]);
    setValue(
      'notes',
      `Raised from the reorder queue: ${queue.filter((i) => i.status === 'out').length} out of stock, ${queue.filter((i) => i.status === 'low').length} below reorder point.`,
      { shouldDirty: true },
    );

    setSeeded(true);
  }, [wantsReorder, seeded, reorderData, searchParams, setValue]);

  const tax = Math.round(Number(watch('taxDollars') || 0) * 100);
  const shipping = Math.round(Number(watch('shippingDollars') || 0) * 100);

  const subtotal = (items ?? []).reduce((sum, line) => {
    const qty = Number(line?.qtyOrdered ?? 0);
    const cost = Math.round(Number(line?.unitCostDollars ?? 0) * 100);
    return sum + (Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : 0);
  }, 0);

  /**
   * Choosing an item fills the rest of the row.
   *
   * SKU and barcode are displayed rather than typed - they identify the product
   * that was picked, and a field a staff member can edit is a field that can
   * disagree with the line it belongs to. Cost is seeded from the catalogue and
   * stays editable, because what a supplier charges this time is the one number
   * on the row that is genuinely negotiable.
   */
  function chooseItem(index, product) {
    setValue(`items.${index}.product`, product, { shouldDirty: true });
    if (product) {
      setValue(`items.${index}.unitCostDollars`, ((product.cost ?? 0) / 100).toFixed(2), {
        shouldDirty: true,
      });
    }
  }

  function submit(values) {
    setError(null);

    const lines = values.items.filter((line) => line.product?.id);
    if (lines.length === 0) {
      setError('Add at least one item to the order.');
      return;
    }

    createPurchaseOrder.mutate(
      {
        title: values.title || undefined,
        suppliers: pickedSuppliers,
        componentTypes,
        orderDate: values.orderDate || undefined,
        expectedDate: values.expectedDate || undefined,
        closesAt: values.closesAt || undefined,
        tax,
        shipping,
        notes: values.notes || undefined,
        items: lines.map((line) => ({
          product: line.product.id,
          qtyOrdered: Number(line.qtyOrdered),
          unitCost: Math.round(Number(line.unitCostDollars || 0) * 100),
        })),
      },
      {
        onSuccess: (payload) => {
          if (payload?.order?.id) navigate(`/admin/purchase-orders/${payload.order.id}`);
          else navigate('/admin/purchase-orders');
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title="New purchase order"
        description="Create a new order to send to a supplier."
        action={
          <Link
            to="/admin/purchase-orders"
            className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
          >
            <ArrowLeft className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            Back
          </Link>
        }
      />

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Panel title="Who to ask" className="mb-3">
        <p className="mb-2 text-sm text-ink-500">
          Tick the component types this order covers and the suppliers tagged with them appear
          below, already selected. Add anybody else by hand.
        </p>

        <ComponentTypePicker value={componentTypes} onChange={setComponentTypes} />

        <SupplierMultiSelect
          componentTypes={componentTypes}
          allSuppliers={suppliers}
          value={pickedSuppliers}
          onChange={setPickedSuppliers}
        />

        {/* The supplier list owns the add form, so this hands off to it and
            comes back - one form, one place its rules can drift. */}
        <Link
          to="/admin/suppliers?new=1"
          className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
        >
          <Plus className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          Add new supplier
        </Link>
      </Panel>

      <Panel title="Order details" className="mb-3">
        <Input
          label="Title"
          placeholder="Q4 screen restock - Samsung S-series"
          hint="Optional. What this order is for, in a few words."
          containerClassName="mb-3"
          {...register('title')}
        />

        {/* Status is no longer chosen here. An order reaches `sent` by actually
            being sent - which mails every supplier on it - so offering it as a
            dropdown on create would record a state nobody was told about. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Order date" type="date" required {...register('orderDate')} />
          <Input label="Expected delivery" type="date" {...register('expectedDate')} />
          <Input
            label="Prices due by"
            type="date"
            hint="Optional deadline for answers."
            {...register('closesAt')}
          />
        </div>

        <Textarea
          label="Notes / instructions"
          rows={3}
          placeholder="Shipping instructions, special requests…"
          containerClassName="mt-3"
          {...register('notes')}
        />
      </Panel>

      <Panel title="Order items" flush className="mb-3">
        <p className="border-b border-line px-4 py-3 text-sm leading-relaxed text-ink-500">
          Search an inventory item by <strong className="font-semibold text-ink-700">name, SKU
          or barcode</strong> - scan straight into the box and the SKU, barcode and cost fill in
          automatically. Out-of-stock items are included, so you can restock them.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-left">
            <thead>
              <tr className={t.headRow}>
                <th scope="col" className={t.headCell()}>
                  Item / part
                </th>
                <th scope="col" className={t.headCell()}>
                  SKU
                </th>
                <th scope="col" className={t.headCell()}>
                  Barcode
                </th>
                <th scope="col" className={cn(t.headCell('right'), 'w-24')}>
                  Qty
                </th>
                <th scope="col" className={cn(t.headCell('right'), 'w-32')}>
                  Unit cost
                </th>
                <th scope="col" className={cn(t.headCell('right'), 'w-28')}>
                  Total
                </th>
                {/* `relative` is load-bearing, not decoration.

                    `sr-only` is `position: absolute`, so it anchors to the
                    nearest positioned ancestor - and this cell had none, which
                    sent it up to the document. Absolutely placed at the foot of
                    a 1372px form inside a `h-dvh` shell, that 1px box stretched
                    the *document* to 1002px against a 900px viewport: a second
                    scrollbar beside the panel's own, scrolling 102px of blank
                    space. Containing it here costs nothing and keeps the label
                    for a screen reader, which still needs to hear what the
                    column of buttons is for. */}
                <th scope="col" className={cn(t.headCell('right'), 'relative w-12')}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {fields.map((field, index) => {
                const line = items?.[index];
                const lineTotal =
                  Number(line?.qtyOrdered ?? 0) *
                  Math.round(Number(line?.unitCostDollars ?? 0) * 100);

                return (
                  <tr key={field.id} className={t.row}>
                    <td className={t.cell()}>
                      <InventoryPicker
                        value={line?.product ?? null}
                        onChange={(product) => chooseItem(index, product)}
                        autoFocus={index === 0 && !line?.product}
                      />
                    </td>

                    {/* Read-only: these identify the product that was picked,
                        and a field somebody can edit is one that can disagree
                        with the line it belongs to. */}
                    <td className={cn(t.cell(), 'font-mono text-xs text-ink-500')}>
                      {line?.product?.sku ?? <span className="text-ink-300">-</span>}
                    </td>
                    <td className={cn(t.cell(), 'font-mono text-xs text-ink-500')}>
                      {line?.product?.barcode ?? <span className="text-ink-300">-</span>}
                    </td>

                    <td className={t.cell('right')}>
                      <Input
                        type="number"
                        min="1"
                        aria-label={`Quantity for line ${index + 1}`}
                        {...register(`items.${index}.qtyOrdered`)}
                      />
                    </td>
                    <td className={t.cell('right')}>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label={`Unit cost for line ${index + 1}`}
                        {...register(`items.${index}.unitCostDollars`)}
                      />
                    </td>
                    <td className={cn(t.cell('right'), 'tnum text-sm font-medium text-ink-900')}>
                      {money(Number.isFinite(lineTotal) ? lineTotal : 0)}
                    </td>
                    <td className={t.cell('right')}>
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        disabled={fields.length === 1}
                        aria-label={`Remove line ${index + 1}`}
                        className={cn(pressable, 'flex size-8 shrink-0 items-center justify-center rounded-md border border-line text-ink-400 hover:border-danger/30 hover:bg-danger-50 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40')}
                      >
                        <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="p-3 sm:p-4">
          <button
            type="button"
            onClick={() => append(emptyLine())}
            className={cn(pressable, 'flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-brand/40 bg-brand-50/40 py-2.5 font-display text-sm font-semibold text-brand hover:border-brand/60 hover:bg-brand-50')}
          >
            <Plus className="size-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            Add item
          </button>
        </div>
      </Panel>

      <div className="grid items-start gap-3 lg:grid-cols-[1fr_minmax(0,320px)]">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" icon={Save} loading={createPurchaseOrder.isPending}>
            Create purchase order
          </Button>
          <Link
            to="/admin/purchase-orders"
            className={cn(pressable, 'inline-flex h-11 select-none items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
          >
            <X className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            Cancel
          </Link>
        </div>

        <Panel>
          <dl className="space-y-2 text-sm">
            <div className="tnum flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">Subtotal</dt>
              <dd className="font-medium text-ink-900">{money(subtotal)}</dd>
            </div>

            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-500">Tax</dt>
              <dd className="w-28">
                <Input
                  inputMode="decimal"
                  suffix="$"
                  aria-label="Tax"
                  {...register('taxDollars')}
                />
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-500">Shipping</dt>
              <dd className="w-28">
                <Input
                  inputMode="decimal"
                  suffix="$"
                  aria-label="Shipping"
                  {...register('shippingDollars')}
                />
              </dd>
            </div>

            <div className="tnum flex items-baseline justify-between gap-3 border-t border-line pt-2 font-display text-lg font-bold text-ink-900">
              <dt>Total</dt>
              <dd>{money(subtotal + tax + shipping)}</dd>
            </div>
          </dl>

          <p className="mt-2.5 text-xs leading-relaxed text-ink-400">
            A preview. Every total is recomputed on the server from the lines.
          </p>
        </Panel>
      </div>
    </form>
  );
}

export default AdminPurchaseOrderCreatePage;
