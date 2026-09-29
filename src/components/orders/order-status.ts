import { formatPaymentTime, orderStatusLabel } from "@/lib/catalog";
import { isPaymentOpen, paymentDueAt, type OrderListItem } from "@/lib/orders";

/**
 * The order's status as customers read it. A pending order shows when payment is due, or that the
 * window has closed while it waits for the expiry sweep.
 */
export function orderStatusText(order: Pick<OrderListItem, "status" | "createdAt">) {
  if (order.status !== "pending_payment") return orderStatusLabel(order.status);
  return isPaymentOpen(order)
    ? `${orderStatusLabel(order.status)} · pay by ${formatPaymentTime(paymentDueAt(order.createdAt))}`
    : "Payment window closed";
}
