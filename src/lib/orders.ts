// Order creation and queries. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers (the checkout action) check the session first.
// neon-http has no interactive transactions, so placing an order is one SQL statement: it locks the
// ordered cart lines, re-checks and takes the stock (the shared steps from `@/lib/stock`), creates
// the order and its items from the locked product rows, and deletes those cart lines, all or none.
import { randomBytes } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { orderItems, orders } from "@/db/schema";
import type { Delivery } from "@/lib/delivery";
import { stockDecrementCtes } from "@/lib/stock";

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

/** Random public order number, e.g. SY-7K4Q9M2X. 32^8 values, so collisions are negligible. */
function createReference() {
  return `SY-${Array.from(randomBytes(8), (byte) => REFERENCE_ALPHABET[byte % 32]).join("")}`;
}

function isPositiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** Postgres SQLSTATE and constraint from a driver error, unwrapping drizzle's DrizzleQueryError. */
function pgError(error: unknown) {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return { code: e.cause?.code ?? e.code, constraint: e.cause?.constraint ?? e.constraint };
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
      matched as (
        select s.line_id, s.quantity, cl.product_id, cl.product_name, cl.size,
          coalesce(cl.product_id is not null and cl.quantity = s.quantity, false) as ok
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

/** The order with its items, or undefined if it doesn't exist or isn't this user's. */
export async function getOrderForUser(userId: string, reference: string) {
  return db.query.orders.findFirst({
    where: and(eq(orders.reference, reference), eq(orders.userId, userId)),
    with: { items: { orderBy: asc(orderItems.id) } },
  });
}

export type Order = NonNullable<Awaited<ReturnType<typeof getOrderForUser>>>;
