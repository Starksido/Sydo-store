// Order and payment helpers for tests. Import only from test files (see tests/fixtures.ts).
import { randomUUID } from "node:crypto";

import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import type { Delivery } from "@/lib/delivery";
import { placeOrder } from "@/lib/orders";

import { createCartLine } from "./fixtures";

export const delivery: Delivery = {
  fullName: "Wanjiku Kamau",
  phone: "+254712345678",
  county: "Nairobi",
  town: "Westlands",
  address: "Mpaka Road, Apartment 4B",
};

/** Places a pending order for `lines` of [productId, quantity, size?] and returns its reference. */
export async function createOrder(userId: string, lines: [number, number, string?][]) {
  const checkoutLines = [];
  for (const [productId, quantity, size] of lines) {
    checkoutLines.push({ lineId: await createCartLine(userId, productId, quantity, size ?? null), quantity });
  }
  const result = await placeOrder(userId, { checkoutKey: randomUUID(), lines: checkoutLines, delivery });
  if (!result.ok) throw new Error(`createOrder: ${JSON.stringify(result)}`);
  return result.reference;
}

export async function getOrderRow(reference: string) {
  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      total: orders.total,
      paymentReference: orders.paymentReference,
      paidAt: orders.paidAt,
    })
    .from(orders)
    .where(eq(orders.reference, reference));
  return row;
}

/** The order's payment attempts, oldest first. */
export async function getPayments(orderReference: string) {
  return db
    .select({
      reference: payments.reference,
      status: payments.status,
      amount: payments.amount,
      paystackId: payments.paystackId,
      channel: payments.channel,
      paidAt: payments.paidAt,
      refundStatus: payments.refundStatus,
      refundReason: payments.refundReason,
      refundDetail: payments.refundDetail,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(eq(orders.reference, orderReference))
    .orderBy(asc(payments.id));
}

export async function setOrderStatus(reference: string, status: (typeof orders.status.enumValues)[number]) {
  // A cancelled order needs a cancel reason (orders_cancel_reason_iff_cancelled).
  const cancelReason = status === "cancelled" ? ("other" as const) : null;
  await db.update(orders).set({ status, cancelReason }).where(eq(orders.reference, reference));
}

/** Makes the order look as if it was placed `minutes` ago. */
export async function ageOrder(reference: string, minutes: number) {
  await db.execute(sql`
    update orders set created_at = now() - make_interval(mins => ${minutes}) where reference = ${reference}
  `);
}

/** Makes the order's payment attempts look as if they started `minutes` ago. */
export async function agePayments(orderReference: string, minutes: number) {
  await db.execute(sql`
    update payments set created_at = now() - make_interval(mins => ${minutes})
    where order_id = (select id from orders where reference = ${orderReference})
  `);
}
