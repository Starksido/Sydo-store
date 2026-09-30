import Link from "next/link";

import { OrderSummary } from "@/components/checkout/order-summary";
import { orderStatusText } from "@/components/orders/order-status";
import { PayButton } from "@/components/orders/pay-button";
import {
  CANCEL_REASONS,
  formatOrderDate,
  formatPaymentTime,
  formatPrice,
  paymentChannelLabel,
  refundText,
} from "@/lib/catalog";
import { isPaymentOpen, paymentDueAt, type Order } from "@/lib/orders";

/**
 * The order page shared by the post-checkout confirmation, the payment callback and the account
 * order history. `notice` is shown above the details, e.g. the result of a payment.
 */
export function OrderDetail({
  order,
  variant,
  notice,
}: {
  order: Order;
  variant: "confirmation" | "detail";
  notice?: React.ReactNode;
}) {
  const payable = isPaymentOpen(order);
  const channel = paymentChannelLabel(order.payment?.channel ?? null);
  const tracking = [order.shippingCarrier, order.trackingNumber].filter(Boolean).join(" · ");

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
          {notice}
          <dl className="divide-y border-y">
            <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
              <dt className="label text-muted">Status</dt>
              <dd>{orderStatusText(order)}</dd>
            </div>
            {order.cancelReason && (
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
                <dt className="label text-muted">Reason</dt>
                <dd className="text-right">{CANCEL_REASONS[order.cancelReason].customer}</dd>
              </div>
            )}
            {tracking && (order.status === "shipped" || order.status === "delivered") && (
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
                <dt className="label text-muted">Tracking</dt>
                <dd className="text-right break-all">{tracking}</dd>
              </div>
            )}
            {order.refunds.map((refund, index) => (
              <div key={index} className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
                <dt className="label text-muted">Refund</dt>
                <dd className="text-right">
                  {formatPrice(refund.amount)} · {refundText(refund)}
                </dd>
              </div>
            ))}
            {order.paidAt && (
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
                <dt className="label text-muted">Payment</dt>
                <dd className="text-right">
                  Paid {formatOrderDate(order.paidAt)}
                  {channel && ` · ${channel}`}
                  <br />
                  <span className="text-sm text-muted">Ref. {order.paymentReference}</span>
                </dd>
              </div>
            )}
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

          {payable && (
            <div className="mt-8 border border-line-strong p-6">
              <p className="text-sm">
                Your items are reserved until {formatPaymentTime(paymentDueAt(order.createdAt))}. Pay with M-Pesa or
                card on Paystack&apos;s secure page.
              </p>
              <div className="mt-6">
                <PayButton reference={order.reference} label={`Pay ${formatPrice(order.total)}`} />
              </div>
            </div>
          )}
          {order.status === "pending_payment" && !payable && (
            <p className="mt-6 text-sm text-muted">
              The payment window for this order has closed and its items are being returned to stock.
            </p>
          )}
          {order.status === "expired" && (
            <p className="mt-6 text-sm text-muted">
              We didn&apos;t receive payment in time, so this order was cancelled and its items returned to stock. If
              you were charged for it, contact Client Services and we&apos;ll refund you.
            </p>
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
