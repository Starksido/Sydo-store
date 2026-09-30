// Stock writes. Server-only: this module imports the database client.
// Not a Server Function on purpose: a "use server" export can be called from the browser. Callers
// check the session first.
// neon-http has no interactive transactions, so the whole decrement is one SQL statement: it locks
// every product row (in id order, so concurrent orders can't deadlock), checks all of them against
// the latest committed stock, and updates all or none. `products_stock_nonnegative` is the backstop.
// Checkout needs the decrement in the same statement as its own writes, so the steps are also
// exported as CTEs (`stockDecrementCtes`); `decrementStock` is the standalone form. Returning the
// stock of an expired order (`stockIncrementCtes`) locks in the same order.
import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";

export type StockItem = { productId: number; quantity: number };

export type StockShortage = {
  productId: number;
  /** Total requested across all lines for this product. */
  requested: number;
  /** Current stock; 0 when the product no longer exists. */
  available: number;
};

export type DecrementStockResult = { ok: true } | { ok: false; shortages: StockShortage[] };

function isPositiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * The decrement as the CTEs `locked`, `verdict` and `upd`, to follow a caller-defined
 * `req(product_id, quantity)` CTE with one row per product. `verdict.ok` is true only when every
 * `req` row has a product with enough stock, so a row with a null or unknown `product_id` fails the
 * whole request; `upd` then changes nothing. An empty `req` counts as ok, so callers must refuse
 * empty requests themselves. `locked` also holds each product's name, SKU and price
 * as locked, for callers that record them.
 */
export function stockDecrementCtes(): SQL {
  return sql`
    locked as (
      select p.id, p.stock, p.name, p.sku, p.price
      from products p
      where p.id in (select product_id from req)
      order by p.id
      for update
    ),
    verdict as (
      select count(*) = (select count(*) from req) as ok
      from req r
      join locked l on l.id = r.product_id
      where l.stock >= r.quantity
    ),
    upd as (
      update products p
      set stock = p.stock - r.quantity, updated_at = now()
      from req r, verdict v
      where p.id = r.product_id and v.ok
      returning p.id
    )`;
}

/**
 * Puts stock back, as the CTEs `restock_locked` and `restock_upd`, to follow a caller-defined
 * `restock_req(product_id, quantity)` CTE with one row per product. Rows whose product no longer
 * exists (null or unknown `product_id`) are skipped. Products are locked in id order first, like
 * the decrement, so this can't deadlock with a concurrent order.
 */
export function stockIncrementCtes(): SQL {
  return sql`
    restock_locked as (
      select p.id
      from products p
      where p.id in (select product_id from restock_req)
      order by p.id
      for update
    ),
    -- The aggregate takes every lock, in id order, before the first row is updated.
    restock_upd as (
      update products p
      set stock = p.stock + r.quantity, updated_at = now()
      from restock_req r
      where p.id = r.product_id and (select count(*) from restock_locked) > 0
      returning p.id
    )`;
}

/**
 * Takes `quantity` units of each product, all or nothing. Lines for the same product (different
 * sizes) are summed, since sizes share `products.stock`. Returns the shortages and changes nothing
 * if any product is missing or short. Throws on an empty list or invalid ids and quantities.
 */
export async function decrementStock(items: StockItem[]): Promise<DecrementStockResult> {
  if (items.length === 0) throw new Error("decrementStock: no items");
  for (const item of items) {
    if (!isPositiveInt(item.productId) || !isPositiveInt(item.quantity)) {
      throw new Error(`decrementStock: invalid item ${JSON.stringify(item)}`);
    }
  }

  const payload = JSON.stringify(items.map(({ productId, quantity }) => ({ product_id: productId, quantity })));
  const { rows } = await db.execute<{ product_id: number; quantity: number; available: number; updated: number }>(sql`
    with req as (
      select product_id, sum(quantity)::int as quantity
      from jsonb_to_recordset(${payload}::jsonb) as r(product_id int, quantity int)
      group by product_id
    ),
    ${stockDecrementCtes()}
    select r.product_id, r.quantity, coalesce(l.stock, 0)::int as available, (select count(*) from upd)::int as updated
    from req r
    left join locked l on l.id = r.product_id
    order by r.product_id
  `);

  if (rows.length > 0 && rows[0].updated === rows.length) return { ok: true };
  return {
    ok: false,
    shortages: rows
      .filter((row) => row.available < row.quantity)
      .map((row) => ({ productId: row.product_id, requested: row.quantity, available: row.available })),
  };
}

// ---------- Manual adjustments by admins ----------

export const STOCK_ADJUSTMENT_REASONS = ["received", "correction", "damaged", "returned", "other"] as const;

export type StockAdjustmentReason = (typeof STOCK_ADJUSTMENT_REASONS)[number];

/** Largest change, or stock level, one adjustment may set. */
export const MAX_STOCK_CHANGE = 1_000_000;
const MAX_NOTE = 500;

export type AdjustStockResult =
  | { ok: true; stock: number }
  | { ok: false; reason: "insufficient" | "not-found"; current?: number };

export type SetStockResult =
  | { ok: true; stock: number; changed: boolean }
  | { ok: false; reason: "stale" | "not-found"; current?: number };

type AdjustmentMeta = { reason: StockAdjustmentReason; note: string | null; userId: string };

function checkMeta(name: string, productId: unknown, { reason, note, userId }: AdjustmentMeta) {
  if (!isPositiveInt(productId)) throw new Error(`${name}: invalid product id ${JSON.stringify(productId)}`);
  if (!STOCK_ADJUSTMENT_REASONS.includes(reason)) throw new Error(`${name}: invalid reason ${JSON.stringify(reason)}`);
  if (note !== null && (typeof note !== "string" || note.length > MAX_NOTE)) throw new Error(`${name}: invalid note`);
  if (typeof userId !== "string" || !userId) throw new Error(`${name}: invalid user id`);
}

type AdjustmentRow = { current: number | null; new_stock: number | null };

/**
 * Adds (positive `delta`) or removes (negative) stock and records who did it and why, in one
 * statement: it locks the product row, changes stock only if the result stays at 0 or more, and
 * inserts the `stock_adjustments` row from the update, so the change and its record are atomic.
 * Relative, so a sale between loading the page and saving doesn't matter. Throws on invalid input.
 */
export async function adjustStock({
  productId,
  delta,
  ...meta
}: { productId: number; delta: number } & AdjustmentMeta): Promise<AdjustStockResult> {
  checkMeta("adjustStock", productId, meta);
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > MAX_STOCK_CHANGE) {
    throw new Error(`adjustStock: invalid delta ${JSON.stringify(delta)}`);
  }

  const { rows } = await db.execute<AdjustmentRow>(sql`
    with locked as (
      select id, stock from products where id = ${productId}::int for update
    ),
    upd as (
      update products p
      set stock = p.stock + ${delta}::int, updated_at = now()
      from locked l
      where p.id = l.id and l.stock + ${delta}::int >= 0
      returning p.id, p.stock
    ),
    logged as (
      insert into stock_adjustments (product_id, user_id, delta, previous_stock, new_stock, reason, note)
      select id, ${meta.userId}, ${delta}::int, stock - ${delta}::int, stock, ${meta.reason}, ${meta.note}
      from upd
      returning id
    )
    select (select stock from locked) as current, (select stock from upd) as new_stock,
      (select count(*) from logged) as logged
  `);

  const [row] = rows;
  if (row?.current == null) return { ok: false, reason: "not-found" };
  if (row.new_stock == null) return { ok: false, reason: "insufficient", current: row.current };
  return { ok: true, stock: row.new_stock };
}

/**
 * Sets stock to `stock`, but only if it's still `expected` (what the admin saw), so it can't
 * silently overwrite a sale made in between: then it returns `stale` with the current stock.
 * Setting the value it already has writes nothing. Otherwise like `adjustStock`.
 */
export async function setStockTo({
  productId,
  expected,
  stock,
  ...meta
}: { productId: number; expected: number; stock: number } & AdjustmentMeta): Promise<SetStockResult> {
  checkMeta("setStockTo", productId, meta);
  for (const [name, value] of [
    ["expected", expected],
    ["stock", stock],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_STOCK_CHANGE) {
      throw new Error(`setStockTo: invalid ${name} ${JSON.stringify(value)}`);
    }
  }

  const { rows } = await db.execute<AdjustmentRow>(sql`
    with locked as (
      select id, stock from products where id = ${productId}::int for update
    ),
    upd as (
      update products p
      set stock = ${stock}::int, updated_at = now()
      from locked l
      where p.id = l.id and l.stock = ${expected}::int and l.stock <> ${stock}::int
      returning p.id, p.stock, l.stock as previous_stock
    ),
    logged as (
      insert into stock_adjustments (product_id, user_id, delta, previous_stock, new_stock, reason, note)
      select id, ${meta.userId}, stock - previous_stock, previous_stock, stock, ${meta.reason}, ${meta.note}
      from upd
      returning id
    )
    select (select stock from locked) as current, (select stock from upd) as new_stock,
      (select count(*) from logged) as logged
  `);

  const [row] = rows;
  if (row?.current == null) return { ok: false, reason: "not-found" };
  if (row.current !== expected) return { ok: false, reason: "stale", current: row.current };
  return { ok: true, stock: row.new_stock ?? row.current, changed: row.new_stock != null };
}

/** A product's manual stock changes, newest first, with the admin's name and email. */
export async function getStockHistory(productId: number, limit = 50) {
  const { rows } = await db.execute<{
    id: number;
    delta: number;
    previous_stock: number;
    new_stock: number;
    reason: StockAdjustmentReason;
    note: string | null;
    created_at: string;
    user_name: string;
    user_email: string;
  }>(sql`
    select sa.id, sa.delta, sa.previous_stock, sa.new_stock, sa.reason, sa.note, sa.created_at,
      u.name as user_name, u.email as user_email
    from stock_adjustments sa
    join "user" u on u.id = sa.user_id
    where sa.product_id = ${productId}::int
    order by sa.created_at desc, sa.id desc
    limit ${limit}::int
  `);
  return rows.map((row) => ({
    id: row.id,
    delta: row.delta,
    previousStock: row.previous_stock,
    newStock: row.new_stock,
    reason: row.reason,
    note: row.note,
    createdAt: new Date(row.created_at),
    user: { name: row.user_name, email: row.user_email },
  }));
}

export type StockHistoryEntry = Awaited<ReturnType<typeof getStockHistory>>[number];
