// Order creation and queries. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers (the checkout action) check the session first.
// neon-http has no interactive transactions, so placing an order is one SQL statement: it locks the
// ordered cart lines, re-checks and takes the stock (the shared steps from `@/lib/stock`), creates
// the order and its items from the locked size and product rows, and deletes those cart lines, all
// or none.
import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { orderCancelReason, orderItems, orders, orderStatus, payments, user } from "@/db/schema";
import type { Delivery } from "@/lib/delivery";
import { MIN_ORDER_TOTAL, normalizeCode, type DiscountProblem } from "@/lib/discounts";
import { pgError } from "@/lib/pg-error";
import { stockDecrementCtes, stockIncrementCtes } from "@/lib/stock";

/** A cart line as the customer saw it at checkout. */
export type CheckoutLine = { lineId: number; quantity: number };

export type OrderShortage = {
  variantId: number;
  name: string;
  /** Null for one-size items. */
  size: string | null;
  requested: number;
  available: number;
};

export type PlaceOrderResult =
  | { ok: true; reference: string }
  /** A line is gone, changed quantity or its size or product was removed since checkout was rendered. */
  | { ok: false; reason: "cart-changed" }
  | { ok: false; reason: "out-of-stock"; shortages: OrderShortage[] }
  /** The discount code doesn't apply (any more); nothing was ordered. */
  | { ok: false; reason: "discount"; problem: DiscountProblem; minSubtotal: number };

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
 * Orders exactly `lines` from the user's cart, at current product prices, all or nothing, with
 * `discountCode` if given: in the same statement it locks the code, checks it (active, in its time
 * window, under its limits, the minimum subtotal, once per customer) and takes a redemption, or
 * orders nothing if it doesn't apply. Idempotent per `checkoutKey`: repeating a call (a double
 * click, or a retry after a lost response) returns the order the first one created. Throws on
 * invalid input.
 */
export async function placeOrder(
  userId: string,
  {
    checkoutKey,
    lines,
    delivery,
    discountCode = null,
  }: { checkoutKey: string; lines: CheckoutLine[]; delivery: Delivery; discountCode?: string | null },
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
  const code = discountCode ? normalizeCode(discountCode) : null;
  let rows: {
    line_id: number;
    matched: boolean;
    variant_id: number | null;
    name: string | null;
    size: string | null;
    requested: number;
    available: number;
    reference: string | null;
    discount_problem: DiscountProblem | null;
    min_subtotal: number | null;
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
        select ci.id, ci.variant_id, ci.product_name, ci.size, ci.quantity
        from cart_items ci
        join carts c on c.id = ci.cart_id
        where c.user_id = ${userId} and ci.id in (select line_id from snapshot)
        order by ci.id
        for update of ci
      ),
      -- A line whose size or product was deleted, or whose product was archived, since checkout loaded
      -- doesn't match. The archive check reads the latest committed row without locking it, so an
      -- archive that commits while this statement runs may not be seen.
      matched as (
        select s.line_id, s.quantity, cl.variant_id, cl.product_name, cl.size,
          coalesce(
            cl.quantity = s.quantity
              and exists (
                select 1 from product_variants v join products p on p.id = v.product_id
                where v.id = cl.variant_id and p.archived_at is null
              ),
            false
          ) as ok
        from snapshot s
        left join cart_lines cl on cl.id = s.line_id
      ),
      -- One row per size. Lines that don't match collapse into a null variant_id, which fails the
      -- stock verdict, so nothing below runs.
      req as (
        select case when ok then variant_id end as variant_id, sum(quantity)::int as quantity
        from matched
        group by 1
      ),
      ${stockDecrementCtes({
        between: sql`
      -- The code is locked after the sizes (verdict reads every locked size first), in the same
      -- order as the expiry sweep, so concurrent orders and sweeps can't deadlock.
      code as (
        select c.*
        from discount_codes c, verdict
        where ${code}::text is not null and upper(c.code) = ${code}::text
        for update of c
      ),
      priced as (
        select sum(l.price::bigint * m.quantity)::bigint as subtotal
        from matched m
        join locked l on l.id = m.variant_id
      ),
      discount_check as (
        select c.id, c.code, c.min_subtotal, p.subtotal, coalesce(c.once_per_customer, false) as once_per_customer,
          case
            when ${code}::text is null then null
            when c.id is null or not c.active then 'invalid'
            when c.starts_at > now() then 'not-started'
            when c.ends_at <= now() then 'ended'
            when c.max_redemptions is not null and c.redemptions >= c.max_redemptions then 'used-up'
            when p.subtotal < c.min_subtotal then 'minimum'
            when c.once_per_customer and exists (
              select 1 from orders o
              where o.user_id = ${userId} and o.discount_code_id = c.id and o.status <> 'expired'
            ) then 'already-used'
          end as problem,
          -- Kept in step with discountAmount: rounded down to a whole shilling, total at least KES 1.
          case when c.id is null then 0
            else greatest(0, least(
              case c.kind when 'percent' then floor(p.subtotal * c.value / 10000) * 100 else c.value end,
              p.subtotal - ${MIN_ORDER_TOTAL}
            ))
          end::bigint as discount
        from priced p
        left join code c on true
      )`,
        guard: sql`(select problem is null from discount_check)`,
      })},
      new_order as (
        insert into orders (reference, user_id, checkout_key, subtotal, discount, total, discount_code_id,
          discount_code, discount_once_per_customer, delivery_name, delivery_phone, delivery_county, delivery_town,
          delivery_address)
        select ${createReference()}, ${userId}, ${checkoutKey}::uuid,
          d.subtotal, d.discount, d.subtotal - d.discount, d.id, d.code, d.once_per_customer,
          ${delivery.fullName}, ${delivery.phone}, ${delivery.county}, ${delivery.town}, ${delivery.address}
        from verdict v, discount_check d
        where v.ok and d.problem is null
        returning id, reference, discount_code_id
      ),
      redeemed as (
        update discount_codes c
        set redemptions = c.redemptions + 1, updated_at = now()
        from new_order o
        where c.id = o.discount_code_id
        returning c.id
      ),
      new_items as (
        insert into order_items (order_id, product_id, variant_id, product_name, sku, size, unit_price, quantity)
        select o.id, l.product_id, l.id, l.name, l.sku, l.label, l.price, m.quantity
        from new_order o
        cross join matched m
        join locked l on l.id = m.variant_id
        order by m.line_id
        returning id
      ),
      cleared as (
        delete from cart_items
        where id in (select id from cart_lines) and exists (select 1 from new_order)
        returning id
      )
      select m.line_id, m.ok as matched, m.variant_id, coalesce(l.name, m.product_name) as name,
        coalesce(l.label, m.size) as size, coalesce(r.quantity, m.quantity)::int as requested,
        coalesce(l.stock, 0)::int as available, (select reference from new_order) as reference,
        (select problem from discount_check) as discount_problem,
        (select min_subtotal::float8 from discount_check) as min_subtotal
      from matched m
      left join req r on r.variant_id = m.variant_id and m.ok
      left join locked l on l.id = m.variant_id
      order by m.line_id
    `));
  } catch (error) {
    // A concurrent call with the same key committed first; it holds the order.
    const { code: sqlState, constraint } = pgError(error);
    // The same customer's other checkout, committed at the same moment, used this once-per-customer
    // code first (the check above can't see it; the unique index catches it). Nothing was ordered.
    if (sqlState === "23505" && constraint === "orders_discount_once_per_customer") {
      return { ok: false, reason: "discount", problem: "already-used", minSubtotal: 0 };
    }
    if (sqlState === "23505" && constraint === "orders_user_checkout_key_unique") {
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
  const stockOk = rows.every((row) => row.available >= row.requested);
  if (stockOk && rows[0]?.discount_problem) {
    return { ok: false, reason: "discount", problem: rows[0].discount_problem, minSubtotal: rows[0].min_subtotal ?? 0 };
  }
  for (const row of rows) {
    if (row.available < row.requested && !shortages.has(row.variant_id!)) {
      shortages.set(row.variant_id!, {
        variantId: row.variant_id!,
        name: row.name!,
        size: row.size,
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

/**
 * What the order emails need: the order, its items and its customer's name and email, and whether
 * the payment that paid for it has a refund due. For system use (emails), not scoped to a user.
 */
export async function getOrderForEmail(reference: string) {
  const [order] = await db
    .select({ order: orders, customer: { name: user.name, email: user.email } })
    .from(orders)
    .innerJoin(user, eq(user.id, orders.userId))
    .where(eq(orders.reference, reference));
  if (!order) return undefined;
  const [items, [refund]] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.order.id)).orderBy(asc(orderItems.id)),
    order.order.paymentReference
      ? db
          .select({ status: payments.refundStatus })
          .from(payments)
          .where(eq(payments.reference, order.order.paymentReference))
      : [],
  ]);
  return { ...order.order, customer: order.customer, items, refundDue: refund?.status === "due" };
}

/** A payment's amount and recorded refund date, with its order's reference, for the refund email. */
export async function getRefundForEmail(paymentId: number) {
  const [row] = await db
    .select({ amount: payments.amount, refundedOn: payments.refundedOn, orderReference: orders.reference })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(payments.id, paymentId), eq(payments.refundStatus, "refunded")));
  return row?.refundedOn ? { ...row, refundedOn: row.refundedOn } : undefined;
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
      select oi.variant_id, sum(oi.quantity)::int as quantity
      from order_items oi
      where ${cancelling}::boolean and oi.order_id in (select id from upd) and oi.variant_id is not null
      group by oi.variant_id
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
