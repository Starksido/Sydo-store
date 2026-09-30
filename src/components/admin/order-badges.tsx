import { orderStatusLabel } from "@/lib/catalog";
import type { OrderStatus } from "@/lib/orders";

const TONES: Record<OrderStatus, string> = {
  pending_payment: "",
  paid: "badge-strong",
  processing: "badge-strong",
  shipped: "",
  delivered: "badge-success",
  cancelled: "",
  expired: "",
};

/** The order's status; paid and processing stand out because they need the store to act. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge ${TONES[status]}`}>{orderStatusLabel(status)}</span>;
}

export function RefundBadge({ status }: { status: "due" | "refunded" }) {
  return status === "due" ? (
    <span className="badge badge-error">Refund due</span>
  ) : (
    <span className="badge badge-success">Refunded</span>
  );
}

export const PAYMENT_STATUS_LABELS = {
  pending: "Open",
  success: "Succeeded",
  failed: "Failed",
  abandoned: "Abandoned",
} as const;

/** Why a payment's money is owed back, as admins read it. */
export const REFUND_REASON_LABELS = {
  order_cancelled: "Order cancelled",
  duplicate_payment: "Order was already paid",
  order_unavailable: "Order was cancelled or had expired",
  mismatch: "Didn't match the order",
} as const;
