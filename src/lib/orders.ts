// Order creation and queries. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers (the checkout action) check the session first.
// neon-http has no interactive transactions, so placing an order is one SQL statement: it locks the
// ordered cart lines, re-checks and takes the stock (the shared steps from `@/lib/stock`), creates
// the order and its items from the locked product rows, and deletes those cart lines, all or none.
import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { orderCancelReason, orderItems, orders, orderStatus, payments } from "@/db/schema";
import type { Delivery } from "@/lib/delivery";
import { pgError } from "@/lib/pg-error";
import { stockDecrementCtes, stockIncrementCtes } from "@/lib/stock";

/** A cart line as the customer saw it at checkout. */
export type CheckoutLine = { lineId: number; quantity: number };

export type OrderShortage = {
  productId: number;
  name: string;
  /** Total the order asked for, across sizes. */
  requested: number;
  available: number;
};

export type PlaceOrderResult =
  | { ok: true; reference: string }
  /** A line is gone, changed quantity or its product was deleted since checkout was rendered. */
  | { ok: false; reason: "cart-changed" }
  | { ok: false; reason: "out-of-stock"; shortages: OrderShortage[] };

const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 symbols, no 0/O/1/I

/** `length` random symbols from the reference alphabet. */
export function randomCode(length: number) {
  return Array.from(randomBytes(length), (byte) => REFERENCE_ALPHABET[byte % 32]).join("");
}

/** Random public order number, e.g. SY-7K4Q9M2X. 32^8 values, so collisions are negligible. */
function createReference() {
  return `SY-${randomCode(8)}`;
}

/** How long a new order holds its stock while waiting for payment. */
export const PAYMENT_WINDOW_MINUTES = 60;

/** When the payment window of an order placed at `createdAt` closes. */
export function paymentDueAt(createdAt: Date) {
  return new Date(createdAt.getTime() + PAYMENT_WINDOW_MINUTES * 60_000);
}

/** Whether the customer can still start a payment for the order. */
export function isPaymentOpen(order: { status: string; createdAt: Date }, now = new Date()) {
  return order.status === "pending_payment" && now < paymentDueAt(order.createdAt);
}

function isPositiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

async function findOrderReference(userId: string, checkoutKey: string) {
  const [row] = await db
    .select({ reference: orders.reference })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.checkoutKey, checkoutKey)));
  return row?.reference;
}

/**
 * Orders exactly `lines` from the user's cart, at current product prices, all or nothing.
 * Idempotent per `checkoutKey`: repeating a call (a double click, or a retry after a lost response)
 * returns the order the first one created. Throws on invalid input.
 */
export async function placeOrder(
  userId: string,
  { checkoutKey, lines, delivery }: { checkoutKey: string; lines: CheckoutLine[]; delivery: Delivery },
): Promise<PlaceOrderResult> {
  if (lines.length === 0) throw new Error("placeOrder: no lines");
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) {
    throw new Error("placeOrder: duplicate lines");
  }
  for (const line of lines) {
    if (!isPositiveInt(line.lineId) || !isPositiveInt(line.quantity)) {
      throw new Error(`placeOrder: invalid line ${JSON.stringify(line)}`);
    }
  }

  const existing = await findOrderReference(userId, checkoutKey);
  if (existing) return { ok: true, reference: existing };

  const payload = JSON.stringify(lines.map(({ lineId, quantity }) => ({ line_id: lineId, quantity })));
  let rows: {
    line_id: number;
    matched: boolean;
    product_id: number | null;
    name: string | null;
    requested: number;
    available: number;
    reference: string | null;
  }[];
  try {
    ({ rows } = await db.execute<(typeof rows)[number]>(sql`
      with snapshot as (
        select line_id, quantity
        from jsonb_to_recordset(${payload}::jsonb) as s(line_id int, quantity int)
      ),
      -- Locked in id order, like reconcileCart. A line deleted by a concurrent checkout drops out
      -- here once that commits, so the same lines can't be ordered twice.
      cart_lines as (
        select ci.id, ci.product_id, ci.product_name, ci.size, ci.quantity
        from cart_items ci
        join carts c on c.id = ci.cart_id
        where c.user_id = ${userId} and ci.id in (select line_id from snapshot)
        order by ci.id
        for update of ci
      ),
      -- A line whose product was deleted or archived since checkout loaded doesn't match. The
      -- archive check reads the latest committed row without locking it, so an archive that commits
      -- while this statement runs may not be seen.
      matched as (
        select s.line_id, s.quantity, cl.product_id, cl.product_name, cl.size,
          coalesce(
            cl.quantity = s.quantity
              and exists (select 1 from products p where p.id = cl.product_id and p.archived_at is null),
            false
          ) as ok
        from snapshot s
        left join cart_lines cl on cl.id = s.line_id
      ),
      -- One row per product. Lines that don't match collapse into a null product_id, which fails
      -- the stock verdict, so nothing below runs.
      req as (
        select case when ok then product_id end as product_id, sum(quantity)::int as quantity
        from matched
        group by 1
      ),
      ${stockDecrementCtes()},
      new_order as (
        insert into orders (reference, user_id, checkout_key, total, delivery_name, delivery_phone,
          delivery_county, delivery_town, delivery_address)
        select ${createReference()}, ${userId}, ${checkoutKey}::uuid,
          (select sum(l.price::bigint * m.quantity) from matched m join locked l on l.id = m.product_id),
          ${delivery.fullName}, ${delivery.phone}, ${delivery.county}, ${delivery.town}, ${delivery.address}
        from verdict v
        where v.ok
        returning id, reference
      ),
      new_items as (
        insert into order_items (order_id, product_id, product_name, sku, size, unit_price, quantity)
        select o.id, l.id, l.name, l.sku, m.size, l.price, m.quantity
        from new_order o
        cross join matched m
        join locked l on l.id = m.product_id
        order by m.line_id
        returning id
      ),
      cleared as (
        delete from cart_items
        where id in (select id from cart_lines) and exists (select 1 from new_order)
        returning id
      )
      select m.line_id, m.ok as matched, m.product_id, coalesce(l.name, m.product_name) as name,
        coalesce(r.quantity, m.quantity)::int as requested, coalesce(l.stock, 0)::int as available,
        (select reference from new_order) as reference
      from matched m
      left join req r on r.product_id = m.product_id and m.ok
      left join locked l on l.id = m.product_id
      order by m.line_id
    `));
  } catch (error) {
    // A concurrent call with the same key committed first; it holds the order.
    const { code, constraint } = pgError(error);
    if (code === "23505" && constraint === "orders_user_checkout_key_unique") {
      const reference = await findOrderReference(userId, checkoutKey);
      if (reference) return { ok: true, reference };
    }
    throw error;
  }

  if (rows[0]?.reference) return { ok: true, reference: rows[0].reference };

  if (rows.some((row) => !row.matched)) {
    // Also what a concurrent call with the same key sees after it ordered and cleared these lines.
    const reference = await findOrderReference(userId, checkoutKey);
    return reference ? { ok: true, reference } : { ok: false, reason: "cart-changed" };
  }

  const shortages = new Map<number, OrderShortage>();
  for (const row of rows) {
    if (row.available < row.requested && !shortages.has(row.product_id!)) {
      shortages.set(row.product_id!, {
        productId: row.product_id!,
        name: row.name!,
        requested: row.requested,
        available: row.available,
      });
    }
  }
  return { ok: false, reason: "out-of-stock", shortages: [...shortages.values()] };
}

/**
 * The order with its items, the payment that paid it (if any) and any refunds owed on it, or undefined
 * if it doesn't exist or isn't this user's.
 */
export async function getOrderForUser(userId: string, reference: string) {
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.reference, reference), eq(orders.userId, userId)),
    with: { items: { orderBy: asc(orderItems.id) } },
  });
  if (!order) return undefined;
  const [payment] = order.paymentReference
    ? await db
        .select({ reference: payments.reference, channel: payments.channel, paidAt: payments.paidAt })
        .from(payments)
        .where(eq(payments.reference, order.paymentReference))
    : [];
  // Money owed back on this order (a cancelled paid order, or a payment that couldn't be applied).
  const refunds = await db
    .select({ amount: payments.amount, status: payments.refundStatus, refundedOn: payments.refundedOn })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), isNotNull(payments.refundStatus)))
    .orderBy(asc(payments.id));
  return {
    ...order,
    payment: payment ?? null,
    refunds: refunds.map((refund) => ({ ...refund, status: refund.status! })),
  };
}

export const ORDERS_PAGE_SIZE = 10;

/** One page of the user's orders, newest first. `hasMore` is true when an older page exists. */
export async function listOrdersForUser(userId: string, { page = 1, pageSize = ORDERS_PAGE_SIZE } = {}) {
  const rows = await db
    .select({ reference: orders.reference, status: orders.status, total: orders.total, createdAt: orders.createdAt })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { orders: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

export type OrderListItem = Awaited<ReturnType<typeof listOrdersForUser>>["orders"][number];

export type Order = NonNullable<Awaited<ReturnType<typeof getOrderForUser>>>;

// ---------- Status changes by admins ----------

export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type OrderCancelReason = (typeof orderCancelReason.enumValues)[number];

/** The one step forward from each status that has one. */
export const NEXT_ORDER_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  paid: "processing",
  processing: "shipped",
  shipped: "delivered",
};

/** Statuses an admin can cancel from. Never once shipped. */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = ["pending_payment", "paid", "processing"];

export function isAllowedChange(from: OrderStatus, to: OrderStatus) {
  return NEXT_ORDER_STATUS[from] === to || (to === "cancelled" && CANCELLABLE_STATUSES.includes(from));
}

const MAX_NOTE = 500;
const MAX_TRACKING = 100;

export type ChangeOrderStatusResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * `stale`: the order isn't in `expected` status any more, or changed while this waited (e.g. a
       * payment started). `payment-open`: an unpaid order still has a payment attempt open.
       */
      reason: "stale" | "payment-open" | "not-allowed" | "not-found";
      current?: OrderStatus;
    };

function checkOptionalText(name: string, value: unknown, max: number) {
  if (value !== null && (typeof value !== "string" || value.length > max)) {
    throw new Error(`changeOrderStatus: invalid ${name}`);
  }
}

/**
 * Moves an order one step forward (paid → processing → shipped → delivered) or cancels it (from
 * awaiting payment, paid or processing), only if it's still in `expected` status. One statement:
 * it locks the order, applies the change, records the `order_events` row and, for a cancel, returns
 * the stock (like the expiry sweep) and marks the paying payment's refund due. An unpaid order with
 * a payment attempt still open can't be cancelled: the customer may be paying. `startPayment`
 * touches the order row, so an attempt started while this waits for the lock is caught by the row
 * version check. Throws on invalid input.
 */
export async function changeOrderStatus({
  orderId,
  expected,
  to,
  cancelReason = null,
  note = null,
  carrier = null,
  trackingNumber = null,
  userId,
}: {
  orderId: number;
  expected: OrderStatus;
  to: OrderStatus;
  cancelReason?: OrderCancelReason | null;
  note?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  userId: string;
}): Promise<ChangeOrderStatusResult> {
  if (!isPositiveInt(orderId)) throw new Error(`changeOrderStatus: invalid order id ${JSON.stringify(orderId)}`);
  for (const status of [expected, to]) {
    if (!orderStatus.enumValues.includes(status)) {
      throw new Error(`changeOrderStatus: invalid status ${JSON.stringify(status)}`);
    }
  }
  const cancelling = to === "cancelled";
  if (cancelling ? !orderCancelReason.enumValues.includes(cancelReason!) : cancelReason !== null) {
    throw new Error("changeOrderStatus: a cancel reason goes with, and only with, a cancel");
  }
  if (to !== "shipped" && (carrier !== null || trackingNumber !== null)) {
    throw new Error("changeOrderStatus: tracking only goes with shipping");
  }
  checkOptionalText("note", note, MAX_NOTE);
  checkOptionalText("carrier", carrier, MAX_TRACKING);
  checkOptionalText("tracking number", trackingNumber, MAX_TRACKING);
  if (typeof userId !== "string" || !userId) throw new Error("changeOrderStatus: invalid user id");
  if (!isAllowedChange(expected, to)) return { ok: false, reason: "not-allowed" };

  const shipping = to === "shipped";
  const { rows } = await db.execute<{
    current: OrderStatus;
    unchanged: boolean;
    payment_open: boolean;
    applied: number;
  }>(sql`
    with o as (
      select id, status, payment_reference, xmin::text as version
      from orders where id = ${orderId}::int
      for update
    ),
    -- The row as this statement's snapshot saw it. If the locked row is newer, another transaction
    -- changed the order while this one waited for the lock, and this snapshot may miss what it did.
    seen as (
      select xmin::text as version from orders where id = ${orderId}::int
    ),
    open_attempt as (
      select exists (
        select 1 from payments where order_id = ${orderId}::int and status = 'pending'
      ) as open
    ),
    ok as (
      select o.id
      from o, seen, open_attempt
      where o.status = ${expected}::order_status
        and o.version = seen.version
        and not (${cancelling}::boolean and o.status = 'pending_payment' and open_attempt.open)
    ),
    upd as (
      update orders
      set status = ${to}::order_status,
        cancel_reason = ${cancelReason}::order_cancel_reason,
        shipping_carrier = case when ${shipping}::boolean then ${carrier}::text else shipping_carrier end,
        tracking_number = case when ${shipping}::boolean then ${trackingNumber}::text else tracking_number end,
        updated_at = now()
      from ok
      where orders.id = ok.id
      returning orders.id
    ),
    event as (
      insert into order_events (order_id, user_id, from_status, to_status, note)
      select id, ${userId}, ${expected}::order_status, ${to}::order_status, ${note}::text from upd
      returning id
    ),
    restock_req as (
      select oi.product_id, sum(oi.quantity)::int as quantity
      from order_items oi
      where ${cancelling}::boolean and oi.order_id in (select id from upd) and oi.product_id is not null
      group by oi.product_id
    ),
    ${stockIncrementCtes()},
    refund as (
      update payments p
      set refund_status = 'due', refund_reason = 'order_cancelled', refund_detail = 'Cancelled by an admin',
        updated_at = now()
      from o
      where ${cancelling}::boolean and exists (select 1 from upd)
        and p.reference = o.payment_reference and p.refund_status is null
      returning p.id
    )
    select o.status::text as current, o.version = seen.version as unchanged,
      (select open from open_attempt) as payment_open, (select count(*) from upd)::int as applied
    from o, seen
  `);

  const [row] = rows;
  if (!row) return { ok: false, reason: "not-found" };
  if (row.applied > 0) return { ok: true };
  if (row.current === expected && row.unchanged && cancelling && row.payment_open) {
    return { ok: false, reason: "payment-open", current: row.current };
  }
  return { ok: false, reason: "stale", current: row.current };
}

/** Corrects the carrier and tracking number of a shipped or delivered order. False if it isn't one. */
export async function setTracking({
  orderId,
  carrier,
  trackingNumber,
}: {
  orderId: number;
  carrier: string | null;
  trackingNumber: string | null;
}) {
  if (!isPositiveInt(orderId)) throw new Error(`setTracking: invalid order id ${JSON.stringify(orderId)}`);
  for (const value of [carrier, trackingNumber]) {
    if (value !== null && (typeof value !== "string" || value.length > MAX_TRACKING)) {
      throw new Error("setTracking: invalid tracking");
    }
  }
  const { rows } = await db.execute<{ id: number }>(sql`
    update orders
    set shipping_carrier = ${carrier}::text, tracking_number = ${trackingNumber}::text, updated_at = now()
    where id = ${orderId}::int and status in ('shipped', 'delivered')
    returning id
  `);
  return rows.length > 0;
}
