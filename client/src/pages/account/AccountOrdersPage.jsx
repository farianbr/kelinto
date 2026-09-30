import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsUpDown,
  Package,
  Search,
} from "lucide-react";
import cn from "@/lib/cn";
import { money, date } from "@/lib/format";
import { ORDER_STATUSES } from "@/lib/constants";
import Panel, { PanelEmpty } from "@/components/ui/Panel";
import ReviewPrompt from "@/components/product/ReviewPrompt";
import Input from "@/components/ui/Input";
import SelectMenu from "@/components/ui/SelectMenu";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import { OrderStatusBadge } from "@/components/account/OrderStatusBadge";
import { useOrders } from "@/hooks/useAccount";
import { pressable } from "@/lib/motion";
import { orderPaymentLabel } from '@/lib/paymentLabel';

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  ...ORDER_STATUSES.map((status) => ({
    value: status.value,
    label: status.label,
  })),
  { value: "cancelled", label: "Cancelled" },
];

/** Status sorts by how far through fulfilment it is, not alphabetically. */
const STATUS_RANK = new Map(
  ORDER_STATUSES.map((status, index) => [status.value, index]),
);
STATUS_RANK.set("cancelled", -1);

/**
 * The sortable columns. `get` returns the value a column sorts on - a number
 * for dates, counts and money, a lowercased string for everything else - so the
 * comparator never has to know which column it is looking at.
 */
const COLUMNS = [
  {
    key: "orderNumber",
    label: "Order",
    get: (order) => order.orderNumber.toLowerCase(),
    className: "w-[190px]",
  },
  {
    key: "createdAt",
    label: "Placed",
    get: (order) => new Date(order.createdAt).getTime(),
    // Wide enough for "Aug 26, 2026" on one line - a wrapped date reads as two
    // rows of data rather than one cell.
    className: "w-[124px] whitespace-nowrap",
  },
  {
    key: "poNumber",
    label: "PO",
    get: (order) => (order.poNumber ?? "").toLowerCase(),
  },
  {
    key: "lines",
    label: "Lines",
    get: (order) => order.items.length,
    align: "right",
    className: "w-[74px]",
  },
  {
    key: "status",
    label: "Status",
    get: (order) => STATUS_RANK.get(order.status) ?? 0,
    // Wide enough for the longest label, "Out for delivery", at the badge's
    // letter-spaced 10px - a narrower column wrapped it out of its own pill.
    className: "w-[170px]",
  },
  {
    key: "total",
    label: "Total",
    get: (order) => order.total,
    align: "right",
    className: "w-[116px]",
  },
];

function SortHeader({ column, sort, onSort }) {
  const active = sort.key === column.key;
  const Icon = !active
    ? ChevronsUpDown
    : sort.dir === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 first:pl-5",
        column.align === "right" && "text-right",
        column.className,
      )}
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={cn(
          pressable,
          "eyebrow group inline-flex items-center gap-1 rounded hover:text-ink-900",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900/15",
          column.align === "right" && "flex-row-reverse",
          active ? "text-ink-900" : "text-ink-400",
        )}
      >
        {column.label}
        <Icon
          className={cn(
            "size-3 shrink-0 transition-opacity",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-60",
          )}
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}

export function AccountOrdersPage() {
  const { data: orders, isLoading } = useOrders();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  // Newest first is what a buyer opening this page wants; every other ordering
  // is one click away.
  const [sort, setSort] = useState({ key: "createdAt", dir: "desc" });

  function toggleSort(key) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : // Dates, counts and money read biggest first; text reads A to Z.
          {
            key,
            dir: key === "orderNumber" || key === "poNumber" ? "asc" : "desc",
          },
    );
  }

  const filtered = useMemo(() => {
    if (!orders) return [];
    const needle = query.trim().toLowerCase();

    const matched = orders.filter((order) => {
      if (status !== "all" && order.status !== status) return false;
      if (!needle) return true;
      // Match the order number, a PO, or any SKU or part name in the order
      // a buyer usually remembers the part, not the order number.
      return (
        order.orderNumber.toLowerCase().includes(needle) ||
        order.poNumber?.toLowerCase().includes(needle) ||
        order.items.some(
          (item) =>
            item.sku?.toLowerCase().includes(needle) ||
            item.name?.toLowerCase().includes(needle),
        )
      );
    });

    const column =
      COLUMNS.find((entry) => entry.key === sort.key) ?? COLUMNS[1];
    const direction = sort.dir === "asc" ? 1 : -1;

    return [...matched].sort((a, b) => {
      const left = column.get(a);
      const right = column.get(b);
      if (left === right) return a.orderNumber.localeCompare(b.orderNumber);
      // An order with no PO sinks either way, rather than colonising the top of
      // an ascending sort with blanks.
      if (left === "") return 1;
      if (right === "") return -1;
      return (left > right ? 1 : -1) * direction;
    });
  }, [orders, query, status, sort]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12" />
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- parts waiting on a verdict ---------------------------------
          ABOVE the table rather than a column in it. It is a call to action
          about a handful of lines, and as a column it would be empty on every
          row that is not delivered and already reviewed - a column of blanks
          asking to be ignored. Renders nothing when there is nothing to
          review, which is most of the time once a buyer is caught up. */}
      <ReviewPrompt />

      <Panel
        title="Orders & tracking"
        description={`${filtered.length} of ${orders?.length ?? 0} orders`}
        flush
      >
        <div className="flex flex-wrap gap-2.5 border-b border-line p-4 sm:px-5">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Order number, PO, SKU or part name…"
            icon={Search}
            containerClassName="min-w-[200px] flex-1"
          />
          <SelectMenu
            options={STATUS_FILTERS}
            value={status}
            onChange={setStatus}
            srLabel="Filter by status"
            size="md"
            className="w-[170px]"
          />
        </div>

        {filtered.length === 0 ? (
          <PanelEmpty
            icon={Package}
            title={
              orders?.length ? "No orders match that search" : "No orders yet"
            }
            body={
              orders?.length
                ? "Try a different order number, PO or SKU."
                : "Your orders and their tracking will appear here."
            }
            action={
              orders?.length ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Link to="/shop">
                  <Button variant="outline" size="sm">
                    Browse parts
                  </Button>
                </Link>
              )
            }
          />
        ) : (
          <>
            {/* ---- sortable table, lg and up --------------------------------
              A table because these are records a buyer reconciles against a
              spreadsheet, and reconciling means sorting by date, PO or value.
              Not offered below lg: six columns in a horizontal scroller reads
              worse than the row list underneath. */}
            <div className="hidden lg:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line">
                    {COLUMNS.map((column) => (
                      <SortHeader
                        key={column.key}
                        column={column}
                        sort={sort}
                        onSort={toggleSort}
                      />
                    ))}
                    {/* `relative` contains the `sr-only` label, which is
                      absolutely positioned and would otherwise anchor to the
                      document and stretch the page. */}
                    <th scope="col" className="relative w-10 px-4 py-2.5">
                      <span className="sr-only">View order</span>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-line">
                  {filtered.map((order) => (
                    <tr
                      key={order.orderNumber}
                      className="transition-colors hover:bg-surface-2"
                    >
                      <td className="min-w-0 py-3 pl-5 pr-4">
                        <Link
                          to={`/account/orders/${order.orderNumber}`}
                          className="font-mono text-sm font-medium text-ink-900 hover:text-brand"
                        >
                          {order.orderNumber}
                        </Link>
                        <span className="mt-0.5 line-clamp-1 text-xs text-ink-400">
                          {order.items.map((item) => item.name).join(", ")}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-500">
                        {date(order.createdAt)}
                      </td>

                      <td className="px-4 py-3 text-sm text-ink-500">
                        {order.poNumber ? (
                          <span className="font-mono">{order.poNumber}</span>
                        ) : (
                          <span className="text-ink-300">-</span>
                        )}
                        {order.tracking?.number && (
                          <span className="tnum mt-0.5 block truncate font-mono text-2xs text-ink-400">
                            {order.tracking.carrier} · {order.tracking.number}
                          </span>
                        )}
                      </td>

                      <td className="tnum px-4 py-3 text-right text-sm text-ink-500">
                        {order.items.length}
                      </td>

                      <td className="px-4 py-3">
                        <OrderStatusBadge status={order.status} size="sm" />
                      </td>

                      <td className="px-4 py-3 text-right">
                        <span className="tnum font-display text-md font-bold text-ink-900">
                          {money(order.total)}
                        </span>
                        <span className="block text-2xs text-ink-400">
                          {orderPaymentLabel(order.payment?.method)}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/account/orders/${order.orderNumber}`}
                          aria-label={`Open order ${order.orderNumber}`}
                          className={cn(
                            pressable,
                            "inline-flex text-ink-300 hover:text-brand",
                          )}
                        >
                          <ChevronRight
                            className="size-4"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ---- row list below lg ----------------------------------------- */}
            <ul className="divide-y divide-line lg:hidden">
              {filtered.map((order) => (
                <li key={order.orderNumber}>
                  <Link
                    to={`/account/orders/${order.orderNumber}`}
                    className={cn(
                      pressable,
                      "flex items-center gap-3 px-4 py-4 hover:bg-surface-2 sm:px-5",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-ink-900">
                          {order.orderNumber}
                        </span>
                        <OrderStatusBadge status={order.status} size="sm" />
                      </div>

                      <p className="mt-1 text-sm text-ink-500">
                        {date(order.createdAt)} · {order.items.length}{" "}
                        {order.items.length === 1 ? "line" : "lines"}
                        {order.poNumber && ` · PO ${order.poNumber}`}
                      </p>

                      <p className="mt-1 line-clamp-1 text-sm text-ink-400">
                        {order.items.map((item) => item.name).join(", ")}
                      </p>

                      {order.tracking?.number && (
                        <p className="tnum mt-1 font-mono text-xs text-ink-400">
                          {order.tracking.carrier} · {order.tracking.number}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="tnum font-display text-lg font-bold text-ink-900">
                        {money(order.total)}
                      </p>
                      <p className="text-xs text-ink-400">
                        {orderPaymentLabel(order.payment?.method)}
                      </p>
                    </div>

                    <ChevronRight
                      className="size-4 shrink-0 text-ink-300"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

export default AccountOrdersPage;
