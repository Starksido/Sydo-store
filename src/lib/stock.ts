// Stock writes. Server-only: this module imports the database client.
// Not a Server Function on purpose: a "use server" export can be called from the browser. Callers
// check the session first.
// Stock is held per size, in `product_variants` (a one-size product has one variant). neon-http has
// no interactive transactions, so the whole decrement is one SQL statement: it locks every variant
// row (in id order, so concurrent orders can't deadlock), checks all of them against the latest
// committed stock, and updates all or none. `product_variants_stock_nonnegative` is the backstop.
// Checkout needs the decrement in the same statement as its own writes, so the steps are also
// exported as CTEs (`stockDecrementCtes`); `decrementStock` is the standalone form. Returning the
// stock of an expired order (`stockIncrementCtes`) locks in the same order.
import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";

export type StockItem = { variantId: number; quantity: number };

export type StockShortage = {
  variantId: number;
  /** Total requested across all lines for this variant. */
  requested: number;
  /** Current stock; 0 when the variant no longer exists. */
  available: number;
};

export type DecrementStockResult = { ok: true } | { ok: false; shortages: StockShortage[] };

function isPositiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * The decrement as the CTEs `locked`, `verdict` and `upd`, to follow a caller-defined
 * `req(variant_id, quantity)` CTE with one row per variant. `verdict.ok` is true only when every
 * `req` row has a variant with enough stock, so a row with a null or unknown `variant_id` fails the
 * whole request; `upd` then changes nothing. An empty `req` counts as ok, so callers must refuse
 * empty requests themselves. `locked` also holds each variant's label and product id, and its
 * product's name, SKU and price, for callers that record them.
 */
export function stockDecrementCtes(): SQL {
  return sql`
    locked as (
      select v.id, v.stock, v.label, v.product_id, p.name, p.sku, p.price
      from product_variants v
      join products p on p.id = v.product_id
      where v.id in (select variant_id from req)
      order by v.id
      for update of v
    ),
    verdict as (
      select count(*) = (select count(*) from req) as ok
      from req r
      join locked l on l.id = r.variant_id
      where l.stock >= r.quantity
    ),
    upd as (
      update product_variants v
      set stock = v.stock - r.quantity
      from req r, verdict
      where v.id = r.variant_id and verdict.ok
      returning v.id
    )`;
}

/**
 * Puts stock back, as the CTEs `restock_locked` and `restock_upd`, to follow a caller-defined
 * `restock_req(variant_id, quantity)` CTE with one row per variant. Rows whose variant no longer
 * exists (null or unknown `variant_id`) are skipped. Variants are locked in id order first, like
 * the decrement, so this can't deadlock with a concurrent order.
 */
export function stockIncrementCtes(): SQL {
  return sql`
    restock_locked as (
      select v.id
      from product_variants v
      where v.id in (select variant_id from restock_req)
      order by v.id
      for update
    ),
    -- The aggregate takes every lock, in id order, before the first row is updated.
    restock_upd as (
      update product_variants v
      set stock = v.stock + r.quantity
      from restock_req r
      where v.id = r.variant_id and (select count(*) from restock_locked) > 0
      returning v.id
    )`;
}

/**
 * Takes `quantity` units of each variant, all or nothing. Lines for the same variant are summed.
 * Returns the shortages and changes nothing if any variant is missing or short. Throws on an empty
 * list or invalid ids and quantities.
 */
export async function decrementStock(items: StockItem[]): Promise<DecrementStockResult> {
  if (items.length === 0) throw new Error("decrementStock: no items");
  for (const item of items) {
    if (!isPositiveInt(item.variantId) || !isPositiveInt(item.quantity)) {
      throw new Error(`decrementStock: invalid item ${JSON.stringify(item)}`);
    }
  }

  const payload = JSON.stringify(items.map(({ variantId, quantity }) => ({ variant_id: variantId, quantity })));
  const { rows } = await db.execute<{ variant_id: number; quantity: number; available: number; updated: number }>(sql`
    with req as (
      select variant_id, sum(quantity)::int as quantity
      from jsonb_to_recordset(${payload}::jsonb) as r(variant_id int, quantity int)
      group by variant_id
    ),
    ${stockDecrementCtes()}
    select r.variant_id, r.quantity, coalesce(l.stock, 0)::int as available, (select count(*) from upd)::int as updated
    from req r
    left join locked l on l.id = r.variant_id
    order by r.variant_id
  `);

  if (rows.length > 0 && rows[0].updated === rows.length) return { ok: true };
  return {
    ok: false,
    shortages: rows
      .filter((row) => row.available < row.quantity)
      .map((row) => ({ variantId: row.variant_id, requested: row.quantity, available: row.available })),
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

/** Which size to change: `variantId`, which must belong to `productId`. */
type AdjustmentTarget = { productId: number; variantId: number };

type AdjustmentMeta = { reason: StockAdjustmentReason; note: string | null; userId: string };

function checkMeta(name: string, { productId, variantId }: AdjustmentTarget, { reason, note, userId }: AdjustmentMeta) {
  if (!isPositiveInt(productId)) throw new Error(`${name}: invalid product id ${JSON.stringify(productId)}`);
  if (!isPositiveInt(variantId)) throw new Error(`${name}: invalid variant id ${JSON.stringify(variantId)}`);
  if (!STOCK_ADJUSTMENT_REASONS.includes(reason)) throw new Error(`${name}: invalid reason ${JSON.stringify(reason)}`);
  if (note !== null && (typeof note !== "string" || note.length > MAX_NOTE)) throw new Error(`${name}: invalid note`);
  if (typeof userId !== "string" || !userId) throw new Error(`${name}: invalid user id`);
}

type AdjustmentRow = { current: number | null; new_stock: number | null };

/**
 * Adds (positive `delta`) or removes (negative) stock of one size and records who did it and why, in
 * one statement: it locks the variant row, changes stock only if the result stays at 0 or more, and
 * inserts the `stock_adjustments` row from the update, so the change and its record are atomic.
 * Relative, so a sale between loading the page and saving doesn't matter. `not-found` if the variant
 * doesn't exist or isn't the product's. Throws on invalid input.
 */
export async function adjustStock({
  productId,
  variantId,
  delta,
  ...meta
}: AdjustmentTarget & { delta: number } & AdjustmentMeta): Promise<AdjustStockResult> {
  checkMeta("adjustStock", { productId, variantId }, meta);
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > MAX_STOCK_CHANGE) {
    throw new Error(`adjustStock: invalid delta ${JSON.stringify(delta)}`);
  }

  const { rows } = await db.execute<AdjustmentRow>(sql`
    with locked as (
      select id, product_id, label, stock from product_variants
      where id = ${variantId}::int and product_id = ${productId}::int
      for update
    ),
    upd as (
      update product_variants v
      set stock = v.stock + ${delta}::int
      from locked l
      where v.id = l.id and l.stock + ${delta}::int >= 0
      returning v.id, v.product_id, v.label, v.stock
    ),
    logged as (
      insert into stock_adjustments (product_id, variant_id, size, user_id, delta, previous_stock, new_stock, reason, note)
      select product_id, id, label, ${meta.userId}, ${delta}::int, stock - ${delta}::int, stock, ${meta.reason}, ${meta.note}
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
 * Sets a size's stock to `stock`, but only if it's still `expected` (what the admin saw), so it
 * can't silently overwrite a sale made in between: then it returns `stale` with the current stock.
 * Setting the value it already has writes nothing. Otherwise like `adjustStock`.
 */
export async function setStockTo({
  productId,
  variantId,
  expected,
  stock,
  ...meta
}: AdjustmentTarget & { expected: number; stock: number } & AdjustmentMeta): Promise<SetStockResult> {
  checkMeta("setStockTo", { productId, variantId }, meta);
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
      select id, stock from product_variants
      where id = ${variantId}::int and product_id = ${productId}::int
      for update
    ),
    upd as (
      update product_variants v
      set stock = ${stock}::int
      from locked l
      where v.id = l.id and l.stock = ${expected}::int and l.stock <> ${stock}::int
      returning v.id, v.product_id, v.label, v.stock, l.stock as previous_stock
    ),
    logged as (
      insert into stock_adjustments (product_id, variant_id, size, user_id, delta, previous_stock, new_stock, reason, note)
      select product_id, id, label, ${meta.userId}, stock - previous_stock, previous_stock, stock, ${meta.reason}, ${meta.note}
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

/**
 * A product's manual stock changes, newest first, with the size and the admin's name and email.
 * `size` is null for one-size products, and for changes made to the shared total before stock was
 * kept per size (`variantId` null too).
 */
export async function getStockHistory(productId: number, limit = 50) {
  const { rows } = await db.execute<{
    id: number;
    variant_id: number | null;
    size: string | null;
    delta: number;
    previous_stock: number;
    new_stock: number;
    reason: StockAdjustmentReason;
    note: string | null;
    created_at: string;
    user_name: string;
    user_email: string;
  }>(sql`
    select sa.id, sa.variant_id, sa.size, sa.delta, sa.previous_stock, sa.new_stock, sa.reason, sa.note,
      sa.created_at, u.name as user_name, u.email as user_email
    from stock_adjustments sa
    join "user" u on u.id = sa.user_id
    where sa.product_id = ${productId}::int
    order by sa.created_at desc, sa.id desc
    limit ${limit}::int
  `);
  return rows.map((row) => ({
    id: row.id,
    variantId: row.variant_id,
    size: row.size,
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
