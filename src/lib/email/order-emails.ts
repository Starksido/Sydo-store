// Emails to customers about their orders. Each is sent only when its change was actually made
// (`confirmPayment` returned "paid", `changeOrderStatus` or `recordRefund` succeeded), with an
// idempotency key so a repeated trigger can't send it twice. They never throw: a failed email is
// logged and the order change stands. Server-only: they read the database.
import { appUrl } from "@/lib/app-url";
import { getOrderForEmail, getRefundForEmail } from "@/lib/orders";

import { trySendEmail } from "./send";
import {
  type EmailContent,
  type OrderEmailData,
  orderCancelledContent,
  orderPaidContent,
  orderShippedContent,
  refundRecordedContent,
} from "./templates";

async function loadOrder(reference: string): Promise<OrderEmailData | undefined> {
  const order = await getOrderForEmail(reference);
  if (!order) return undefined;
  return {
    reference: order.reference,
    total: order.total,
    customer: order.customer,
    items: order.items.map((item) => ({
      name: item.productName,
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    delivery: {
      name: order.deliveryName,
      town: order.deliveryTown,
      county: order.deliveryCounty,
      address: order.deliveryAddress,
    },
    cancelReason: order.cancelReason,
    shippingCarrier: order.shippingCarrier,
    trackingNumber: order.trackingNumber,
    refundDue: order.refundDue,
    url: `${appUrl()}/account/orders/${order.reference}`,
  };
}

async function sendOrderEmail(
  label: string,
  reference: string,
  content: (order: OrderEmailData) => EmailContent | undefined,
) {
  try {
    const order = await loadOrder(reference);
    const email = order && content(order);
    if (!order || !email) return;
    await trySendEmail(label, { to: order.customer.email, ...email, idempotencyKey: `${label}/${reference}` });
  } catch (error) {
    console.error(`[email] could not prepare ${label} for ${reference}`, error);
  }
}

/** After `confirmPayment` returned "paid": the order confirmation. */
export function notifyOrderPaid(reference: string) {
  return sendOrderEmail("order-paid", reference, orderPaidContent);
}

/** After `changeOrderStatus` succeeded: shipped and cancelled orders get an email, other steps don't. */
export function notifyOrderStatus(reference: string, status: string) {
  if (status === "shipped") return sendOrderEmail("order-shipped", reference, orderShippedContent);
  if (status === "cancelled") return sendOrderEmail("order-cancelled", reference, orderCancelledContent);
  return Promise.resolve();
}

/** After `recordRefund` succeeded for `paymentId`. */
export async function notifyRefundRecorded(paymentId: number) {
  try {
    const refund = await getRefundForEmail(paymentId);
    if (!refund) return;
    await sendOrderEmail(`refund-${paymentId}`, refund.orderReference, (order) => refundRecordedContent(order, refund));
  } catch (error) {
    console.error(`[email] could not prepare the refund email for payment ${paymentId}`, error);
  }
}
