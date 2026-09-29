import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderSummary } from "@/components/checkout/order-summary";
import { getOrderForUser, type Order } from "@/lib/orders";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Order confirmation" };

const STATUS_LABELS: Record<Order["status"], string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const placedAt = new Intl.DateTimeFormat("en-KE", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Nairobi" });

// Only the order's owner can see it; anyone else gets the same 404 as for an unknown reference.
export default async function OrderPage({ params }: PageProps<"/orders/[reference]">) {
  const { reference } = await params;
  const { user } = await requireSession(`/orders/${encodeURIComponent(reference)}`);
  const order = await getOrderForUser(user.id, reference);
  if (!order) notFound();

  return (
    <section aria-labelledby="order-heading" className="container-page section">
      <p className="eyebrow">Order {order.reference}</p>
      <h1 id="order-heading" className="heading-1 mt-2">
        Thank you for your order
      </h1>
      <p className="mt-2 text-sm text-muted">Placed {placedAt.format(order.createdAt)}</p>

      <div className="mt-8 grid gap-y-10 md:mt-12 lg:grid-cols-12 lg:gap-x-10 xl:gap-x-16">
        <aside aria-labelledby="summary-heading" className="lg:order-last lg:col-span-5 xl:col-span-4 xl:col-start-9">
          <OrderSummary
            items={order.items.map((item) => ({
              id: item.id,
              name: item.productName,
              size: item.size,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            }))}
            total={order.total}
          />
        </aside>

        <div className="lg:col-span-7">
          <dl className="divide-y border-y">
            <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
              <dt className="label text-muted">Status</dt>
              <dd>{STATUS_LABELS[order.status]}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
              <dt className="label text-muted">Deliver to</dt>
              <dd className="text-right">
                {order.deliveryName}
                <br />
                {order.deliveryAddress}
                <br />
                {order.deliveryTown}, {order.deliveryCounty}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
              <dt className="label text-muted">Phone</dt>
              <dd>{order.deliveryPhone}</dd>
            </div>
          </dl>
          {order.status === "pending_payment" && (
            <p className="mt-6 text-sm text-muted">No payment has been taken for this order yet.</p>
          )}
          <Link href="/collections/new-in" className="btn btn-secondary mt-8">
            Continue shopping
          </Link>
        </div>
      </div>
    </section>
  );
}
