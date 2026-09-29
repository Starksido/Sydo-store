// Stock writes. Server-only: this module imports the database client.
// Not a Server Function on purpose: a "use server" export can be called from the browser. Callers
// check the session first.
// neon-http has no interactive transactions, so the whole decrement is one SQL statement: it locks
// every product row (in id order, so concurrent orders can't deadlock), checks all of them against
// the latest committed stock, and updates all or none. `products_stock_nonnegative` is the backstop.
// Checkout needs the decrement in the same statement as its own writes, so the steps are also
// exported as CTEs (`stockDecrementCtes`); `decrementStock` is the standalone form.
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
