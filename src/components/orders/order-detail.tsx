import Link from "next/link";

import { OrderSummary } from "@/components/checkout/order-summary";
import { formatOrderDate, orderStatusLabel } from "@/lib/catalog";
import type { Order } from "@/lib/orders";

/** The order page shared by the post-checkout confirmation and the account order history. */
export function OrderDetail({ order, variant }: { order: Order; variant: "confirmation" | "detail" }) {
  return (
    <section aria-labelledby="order-heading" className="container-page section">
      {variant === "detail" && (
        <Link href="/account" className="link-quiet text-sm">
          ← My account
        </Link>
      )}
      <p className={variant === "detail" ? "eyebrow mt-6" : "eyebrow"}>Order {order.reference}</p>
      <h1 id="order-heading" className="heading-1 mt-2">
        {variant === "confirmation" ? "Thank you for your order" : "Order details"}
      </h1>
      <p className="mt-2 text-sm text-muted">Placed {formatOrderDate(order.createdAt)}</p>

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
              <dd>{orderStatusLabel(order.status)}</dd>
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
          {variant === "confirmation" ? (
            <Link href="/collections/new-in" className="btn btn-secondary mt-8">
              Continue shopping
            </Link>
          ) : (
            <Link href="/account" className="btn btn-secondary mt-8">
              Back to my orders
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
