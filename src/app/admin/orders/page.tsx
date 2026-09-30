import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";

import { OrderStatusBadge, RefundBadge } from "@/components/admin/order-badges";
import { listAdminOrders } from "@/lib/admin/orders";
import { formatOrderDate, formatPrice, orderStatusLabel } from "@/lib/catalog";
import type { OrderStatus } from "@/lib/orders";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../admin-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Orders" });
}

const MAX_PAGE = 1000;
const STATUSES: OrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "expired"];

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireAdmin("/admin/orders");
  const params = await searchParams;

  const q = one(params.q).slice(0, 100);
  const statusParam = one(params.status);
  const status =
    statusParam === "to-fulfil" ? ("to-fulfil" as const) : STATUSES.find((s) => s === statusParam) ?? undefined;
  const refund = one(params.refund) === "due";
  const pageText = one(params.page);
  const page = Math.min(Math.max(/^\d+$/.test(pageText) ? Number(pageText) : 1, 1), MAX_PAGE);

  const { orders, hasMore } = await listAdminOrders({ q, status, refund, page });

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    if (refund) query.set("refund", "due");
    if (target > 1) query.set("page", String(target));
    const search = query.toString();
    return search ? `/admin/orders?${search}` : "/admin/orders";
  };
  const filtered = Boolean(q || status || refund);

  return (
    <section aria-labelledby="orders-heading" className="container-page section">
      <h1 id="orders-heading" className="heading-1">
        Orders
      </h1>

      <Form
        action="/admin/orders"
        className="mt-8 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end"
      >
        <label className="block">
          <span className="label">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Reference, name, email or phone"
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">Status</span>
          <select name="status" defaultValue={status ?? ""} className="input">
            <option value="">All statuses</option>
            <option value="to-fulfil">To fulfil (paid or processing)</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {orderStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Refunds</span>
          <select name="refund" defaultValue={refund ? "due" : ""} className="input">
            <option value="">Any</option>
            <option value="due">Refund due</option>
          </select>
        </label>
        <div className="flex gap-3">
          <button type="submit" className="btn btn-secondary">
            Filter
          </button>
          {filtered && (
            <Link href="/admin/orders" className="btn btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </Form>

      {orders.length === 0 ? (
        <p className="mt-8 border-y py-10 text-muted">
          {page > 1
            ? "There are no orders on this page."
            : filtered
              ? "No orders match these filters."
              : "There are no orders yet."}
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="table-data">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col" className="hidden md:table-cell">
                  Customer
                </th>
                <th scope="col" className="hidden text-right sm:table-cell">
                  Total
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link href={`/admin/orders/${order.reference}`} className="link-quiet">
                      {order.reference}
                    </Link>
                    <span className="mt-1 block text-xs text-muted">{formatOrderDate(order.createdAt)}</span>
                  </td>
                  <td className="hidden text-sm md:table-cell">
                    {order.customer.name}
                    <span className="block text-xs break-all text-muted">{order.customer.email}</span>
                  </td>
                  <td className="hidden text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {formatPrice(order.total)}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <OrderStatusBadge status={order.status} />
                      {order.refundDue && <RefundBadge status="due" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || hasMore) && (
        <nav aria-label="Order pages" className="mt-6 flex justify-between gap-4">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn btn-secondary">
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={pageHref(page + 1)} className="btn btn-secondary">
              Older
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
