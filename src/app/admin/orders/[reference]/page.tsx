import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderStatusBadge, PAYMENT_STATUS_LABELS, REFUND_REASON_LABELS, RefundBadge } from "@/components/admin/order-badges";
import { CancelOrderForm, NextStepForm, RefundForm, TrackingForm } from "@/components/admin/order-forms";
import { SavedNotice } from "@/components/admin/saved-notice";
import { OrderSummary } from "@/components/checkout/order-summary";
import { todayInNairobi } from "@/lib/admin/order-input";
import { getAdminOrder } from "@/lib/admin/orders";
import {
  CANCEL_REASONS,
  formatCalendarDate,
  formatOrderDate,
  formatPrice,
  orderStatusLabel,
  paymentChannelLabel,
} from "@/lib/catalog";
import { CANCELLABLE_STATUSES, NEXT_ORDER_STATUS, type OrderStatus } from "@/lib/orders";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../../admin-metadata";
import { changeOrderStatusAction, recordRefundAction, setTrackingAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Order" });
}

const REFERENCE = /^SY-[A-Z0-9]{8}$/;

const SAVED_MESSAGES: Record<string, string> = {
  processing: "Marked as processing.",
  shipped: "Marked as shipped. The customer sees the tracking details you entered.",
  delivered: "Marked as delivered.",
  cancelled: "Cancelled, and its items are back in stock.",
  tracking: "Tracking saved.",
  refund: "Refund recorded. The customer sees it as refunded.",
};

const NEXT_STEP_WARNINGS: Partial<Record<OrderStatus, string>> = {
  processing: "The customer sees the order as Processing.",
  shipped: "The customer sees the order as Shipped, with the carrier and tracking number if you entered them.",
  delivered: "The customer sees the order as Delivered. This is the last step.",
};

const detailRow = "flex flex-wrap justify-between gap-x-6 gap-y-1 py-3";

export default async function AdminOrderPage({ params, searchParams }: PageProps<"/admin/orders/[reference]">) {
  await requireAdmin("/admin/orders");
  const { reference } = await params;
  const order = REFERENCE.test(reference) ? await getAdminOrder(reference) : undefined;
  if (!order) notFound();

  const saved = (await searchParams).saved;
  const savedMessage = typeof saved === "string" ? SAVED_MESSAGES[saved] : undefined;
  const next = NEXT_ORDER_STATUS[order.status];
  const cancellable = CANCELLABLE_STATUSES.includes(order.status);
  const openAttempt = order.payments.some((payment) => payment.status === "pending");
  const statusAction = changeOrderStatusAction.bind(null, order.id, order.reference);
  const today = todayInNairobi();

  return (
    <section aria-labelledby="order-heading" className="container-page section">
      <Link href="/admin/orders" className="eyebrow link-quiet text-muted">
        Orders
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 id="order-heading" className="heading-1">
          {order.reference}
        </h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="mt-2 text-sm text-muted">Placed {formatOrderDate(order.createdAt)}</p>

      {savedMessage && (
        <div className="mt-8 max-w-3xl">
          <SavedNotice>{savedMessage}</SavedNotice>
        </div>
      )}

      <div className="mt-10 grid gap-y-12 lg:grid-cols-12 lg:gap-x-10 xl:gap-x-16">
        <aside aria-labelledby="summary-heading" className="lg:order-last lg:col-span-5 xl:col-span-4 xl:col-start-9">
          <OrderSummary
            items={order.items.map((item) => ({
              id: item.id,
              name: `${item.productName} · ${item.sku}`,
              size: item.size,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            }))}
            subtotal={order.subtotal}
            discount={order.discount}
            discountCode={order.discountCode}
            total={order.total}
          />
        </aside>

        <div className="space-y-12 lg:col-span-7">
          {next && (
            <div role="region" aria-labelledby="next-heading">
              <h2 id="next-heading" className="heading-3">
                Next step
              </h2>
              <div className="mt-4">
                <NextStepForm
                  key={order.status}
                  action={statusAction}
                  expected={order.status}
                  to={next}
                  label={`Mark as ${orderStatusLabel(next).toLowerCase()}`}
                  warning={NEXT_STEP_WARNINGS[next]!}
                />
              </div>
            </div>
          )}

          {(order.status === "shipped" || order.status === "delivered") && (
            <div role="region" aria-labelledby="tracking-heading">
              <h2 id="tracking-heading" className="heading-3">
                Tracking
              </h2>
              <p className="mt-2 mb-4 text-sm text-muted">Optional. The customer sees whichever of these is filled in.</p>
              <TrackingForm
                key={`${order.shippingCarrier}|${order.trackingNumber}`}
                action={setTrackingAction.bind(null, order.id, order.reference)}
                carrier={order.shippingCarrier}
                trackingNumber={order.trackingNumber}
              />
            </div>
          )}

          {order.cancelReason && (
            <p className="border p-4 text-sm">
              <span className="label text-muted">Reason shown to the customer</span>
              <span className="mt-1 block">
                {CANCEL_REASONS[order.cancelReason].label}: {CANCEL_REASONS[order.cancelReason].customer}
              </span>
            </p>
          )}

          <div role="region" aria-labelledby="customer-heading">
            <h2 id="customer-heading" className="heading-3">
              Customer and delivery
            </h2>
            <dl className="mt-4 divide-y border-y text-sm">
              <div className={detailRow}>
                <dt className="text-muted">Account</dt>
                <dd className="text-right">
                  {order.customer.name}
                  <span className="block break-all text-muted">{order.customer.email}</span>
                </dd>
              </div>
              <div className={detailRow}>
                <dt className="text-muted">Deliver to</dt>
                <dd className="text-right">
                  {order.deliveryName}
                  <br />
                  {order.deliveryAddress}
                  <br />
                  {order.deliveryTown}, {order.deliveryCounty}
                </dd>
              </div>
              <div className={detailRow}>
                <dt className="text-muted">Phone</dt>
                <dd>{order.deliveryPhone}</dd>
              </div>
            </dl>
          </div>

          <div role="region" aria-labelledby="payments-heading">
            <h2 id="payments-heading" className="heading-3">
              Payments
            </h2>
            {order.payments.length === 0 ? (
              <p className="mt-4 border-y py-4 text-sm text-muted">The customer hasn&apos;t started a payment.</p>
            ) : (
              <ul className="mt-4 divide-y border-y">
                {order.payments.map((payment) => (
                  <li key={payment.id} className="space-y-2 py-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                      <span className="break-all">
                        {payment.reference}
                        {payment.reference === order.paymentReference && (
                          <span className="ml-2 text-muted">(paid this order)</span>
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="badge">{PAYMENT_STATUS_LABELS[payment.status]}</span>
                        {payment.refundStatus && <RefundBadge status={payment.refundStatus} />}
                      </span>
                    </div>
                    <p className="text-muted">
                      {formatPrice(payment.amount)} · started {formatOrderDate(payment.createdAt)}
                      {payment.paidAt && ` · paid ${formatOrderDate(payment.paidAt)}`}
                      {payment.channel && ` · ${paymentChannelLabel(payment.channel)}`}
                    </p>
                    {payment.refundReason && (
                      <p>
                        {REFUND_REASON_LABELS[payment.refundReason]}
                        {payment.refundDetail && <span className="text-muted"> · {payment.refundDetail}</span>}
                      </p>
                    )}
                    {payment.refundStatus === "refunded" && (
                      <p className="text-muted">
                        Refunded {payment.refundedOn && formatCalendarDate(payment.refundedOn)} · Paystack ref.{" "}
                        {payment.refundReference} · recorded by {payment.refundRecordedByName}
                      </p>
                    )}
                    {payment.refundStatus === "due" && (
                      <div className="pt-2">
                        <RefundForm
                          action={recordRefundAction.bind(null, payment.id, order.reference, "order")}
                          today={today}
                          idPrefix={`refund-${payment.id}`}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cancellable && (
            <div role="region" aria-labelledby="cancel-heading">
              <h2 id="cancel-heading" className="heading-3">
                Cancel
              </h2>
              {order.status === "pending_payment" && openAttempt ? (
                <p className="mt-2 text-sm text-muted">
                  The customer has a payment in progress, so the order can&apos;t be cancelled yet. If it isn&apos;t
                  paid, it expires by itself and its items go back into stock.
                </p>
              ) : (
                <div className="mt-4">
                  <CancelOrderForm key={order.status} action={statusAction} expected={order.status} paid={order.status !== "pending_payment"} />
                </div>
              )}
            </div>
          )}

          <div role="region" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" className="heading-3">
              Timeline
            </h2>
            <ol className="mt-4 divide-y border-y text-sm">
              <li className="py-3">
                <span className="text-muted">{formatOrderDate(order.createdAt)}</span> · Placed by the customer
              </li>
              {order.events.map((event) => (
                <li key={event.id} className="py-3">
                  <span className="text-muted">{formatOrderDate(event.createdAt)}</span> ·{" "}
                  {orderStatusLabel(event.fromStatus)} → {orderStatusLabel(event.toStatus)} · {event.by ?? "System"}
                  {event.note && <span className="mt-1 block text-muted">{event.note}</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
