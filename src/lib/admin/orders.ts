// Admin order queries, and recording refunds. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers (the admin Server Functions) call `requireAdmin` first.
// Status changes are `changeOrderStatus` / `setTracking` in `@/lib/orders`.
import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { orderEvents, orderItems, orders, payments, user } from "@/db/schema";
import { escapeLike } from "@/lib/admin/products";
import type { OrderStatus } from "@/lib/orders";

export const ADMIN_ORDERS_PAGE_SIZE = 20;

/** Orders waiting for the store to act: paid, or being prepared. */
const TO_FULFIL: OrderStatus[] = ["paid", "processing"];

const refundDue = (orderId: SQL | typeof orders.id) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(payments)
      .where(and(eq(payments.orderId, orderId), eq(payments.refundStatus, "due"))),
  );

/**
 * One page of orders, newest first. `q` matches the reference, the customer's name or email, the
 * delivery name, or the phone number (typed with or without the leading 0 or +254).
 */
export async function listAdminOrders({
  q = "",
  status,
  refund = false,
  page = 1,
  pageSize = ADMIN_ORDERS_PAGE_SIZE,
}: {
  q?: string;
  /** A status, or "to-fulfil" for paid and processing. */
  status?: OrderStatus | "to-fulfil";
  /** Only orders with a refund due. */
  refund?: boolean;
  page?: number;
  pageSize?: number;
} = {}) {
  const conditions: (SQL | undefined)[] = [];
  const search = q.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    const digits = search.replace(/\D/g, "").replace(/^(254|0)/, "");
    conditions.push(
      or(
        ilike(orders.reference, pattern),
        ilike(user.name, pattern),
        ilike(user.email, pattern),
        ilike(orders.deliveryName, pattern),
        digits.length >= 6 ? ilike(orders.deliveryPhone, `%${digits}%`) : undefined,
      ),
    );
  }
  if (status === "to-fulfil") conditions.push(inArray(orders.status, TO_FULFIL));
  else if (status) conditions.push(eq(orders.status, status));
  if (refund) conditions.push(refundDue(orders.id));

  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      total: orders.total,
      createdAt: orders.createdAt,
      customer: { name: user.name, email: user.email },
      refundDue: refundDue(orders.id).mapWith(Boolean),
    })
    .from(orders)
    .innerJoin(user, eq(user.id, orders.userId))
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { orders: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

export type AdminOrderListItem = Awaited<ReturnType<typeof listAdminOrders>>["orders"][number];

/** The order with its items, customer, every payment attempt and its status history. */
export async function getAdminOrder(reference: string) {
  const [order] = await db
    .select({ order: orders, customer: { name: user.name, email: user.email } })
    .from(orders)
    .innerJoin(user, eq(user.id, orders.userId))
    .where(eq(orders.reference, reference));
  if (!order) return undefined;

  const recordedBy = alias(user, "recorded_by");
  const [items, attempts, events] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.order.id)).orderBy(asc(orderItems.id)),
    db
      .select({ payment: payments, refundRecordedByName: recordedBy.name })
      .from(payments)
      .leftJoin(recordedBy, eq(recordedBy.id, payments.refundRecordedBy))
      .where(eq(payments.orderId, order.order.id))
      .orderBy(asc(payments.id)),
    db
      .select({
        id: orderEvents.id,
        fromStatus: orderEvents.fromStatus,
        toStatus: orderEvents.toStatus,
        note: orderEvents.note,
        createdAt: orderEvents.createdAt,
        by: user.name,
      })
      .from(orderEvents)
      .leftJoin(user, eq(user.id, orderEvents.userId))
      .where(eq(orderEvents.orderId, order.order.id))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
  ]);

  return {
    ...order.order,
    customer: order.customer,
    items,
    payments: attempts.map((row) => ({ ...row.payment, refundRecordedByName: row.refundRecordedByName })),
    events,
  };
}

export type AdminOrder = NonNullable<Awaited<ReturnType<typeof getAdminOrder>>>;

/** Payments whose money is owed back, oldest first. */
export async function listRefundsDue() {
  return db
    .select({
      id: payments.id,
      reference: payments.reference,
      amount: payments.amount,
      channel: payments.channel,
      paidAt: payments.paidAt,
      reason: payments.refundReason,
      detail: payments.refundDetail,
      order: { reference: orders.reference, status: orders.status },
      customer: { name: user.name, email: user.email },
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(user, eq(user.id, orders.userId))
    .where(eq(payments.refundStatus, "due"))
    .orderBy(asc(payments.paidAt), asc(payments.id));
}

export type RefundDue = Awaited<ReturnType<typeof listRefundsDue>>[number];

/**
 * Records a refund made in the Paystack dashboard: its reference and date, and who recorded it.
 * Only while the refund is still due, so it can't be recorded twice. False if it isn't due.
 */
export async function recordRefund({
  paymentId,
  refundReference,
  refundedOn,
  userId,
}: {
  paymentId: number;
  refundReference: string;
  /** "YYYY-MM-DD". */
  refundedOn: string;
  userId: string;
}) {
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) throw new Error("recordRefund: invalid payment id");
  if (typeof refundReference !== "string" || !refundReference || refundReference.length > 100) {
    throw new Error("recordRefund: invalid refund reference");
  }
  if (typeof refundedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(refundedOn)) {
    throw new Error("recordRefund: invalid date");
  }
  if (typeof userId !== "string" || !userId) throw new Error("recordRefund: invalid user id");

  const rows = await db
    .update(payments)
    .set({
      refundStatus: "refunded",
      refundReference,
      refundedOn,
      refundRecordedBy: userId,
      refundRecordedAt: sql`now()`,
    })
    .where(and(eq(payments.id, paymentId), eq(payments.refundStatus, "due")))
    .returning({ id: payments.id });
  return rows.length > 0;
}

/** Orders to fulfil (paid or processing) and refunds due, for the overview. */
export async function countOrderWork() {
  const [[fulfil], [refunds]] = await Promise.all([
    db.select({ n: count() }).from(orders).where(inArray(orders.status, TO_FULFIL)),
    db.select({ n: count() }).from(payments).where(eq(payments.refundStatus, "due")),
  ]);
  return { toFulfil: fulfil.n, refundsDue: refunds.n };
}
