// Runs against the test database only (see tests/test-env.ts). Paystack is mocked.
import { randomUUID } from "node:crypto";

import { Pool } from "@neondatabase/serverless";
import { asc, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { stockAdjustments } from "@/db/schema";
import { placeOrder } from "@/lib/orders";
import { expireUnpaidOrders } from "@/lib/payments";
import { adjustStock, decrementStock, getStockHistory, setStockTo } from "@/lib/stock";

import { createCartLine, createProduct, createUser, getStock, resetCatalog, setStock } from "../../tests/fixtures";
import { ageOrder, createOrder, delivery } from "../../tests/orders";
import { mockPaystack } from "../../tests/paystack-mock";

/** Postgres SQLSTATE from a driver error, unwrapping drizzle's DrizzleQueryError. */
function sqlState(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

/** Resolves once at least one session in this database is waiting on a lock. */
async function waitForLockWait(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await db.execute<{ waiting: number }>(sql`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `);
    if (rows[0].waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("No session started waiting on the row lock");
}

let paystack: ReturnType<typeof mockPaystack>;

beforeEach(async () => {
  await resetCatalog();
  paystack = mockPaystack();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function adjustments() {
  return db
    .select({
      productId: stockAdjustments.productId,
      userId: stockAdjustments.userId,
      delta: stockAdjustments.delta,
      previousStock: stockAdjustments.previousStock,
      newStock: stockAdjustments.newStock,
      reason: stockAdjustments.reason,
      note: stockAdjustments.note,
    })
    .from(stockAdjustments)
    .orderBy(asc(stockAdjustments.id));
}

/** A product with `stock` units and an admin to adjust it. */
async function setup(stock: number) {
  return { productId: await createProduct(stock), userId: await createUser() };
}

/** Every log row adds up, and the last one ends at the product's current stock. */
async function expectLogConsistent(productId: number) {
  const rows = await adjustments();
  for (const row of rows) expect(row.newStock).toBe(row.previousStock + row.delta);
  return { rows, stock: await getStock(productId) };
}

describe("adjustStock", () => {
  it("raises and lowers stock, logging each change with who, why and the before and after", async () => {
    const { productId, userId } = await setup(3);

    expect(await adjustStock({ productId, delta: 10, reason: "received", note: "Invoice 42", userId })).toEqual({
      ok: true,
      stock: 13,
    });
    expect(await adjustStock({ productId, delta: -2, reason: "damaged", note: null, userId })).toEqual({
      ok: true,
      stock: 11,
    });

    expect(await getStock(productId)).toBe(11);
    expect(await adjustments()).toEqual([
      { productId, userId, delta: 10, previousStock: 3, newStock: 13, reason: "received", note: "Invoice 42" },
      { productId, userId, delta: -2, previousStock: 13, newStock: 11, reason: "damaged", note: null },
    ]);
    expect(await getStockHistory(productId)).toMatchObject([
      { delta: -2, previousStock: 13, newStock: 11, reason: "damaged", user: { email: expect.stringContaining("@") } },
      { delta: 10, note: "Invoice 42", createdAt: expect.any(Date) },
    ]);
  });

  it("refuses, changing and logging nothing, to take stock below 0", async () => {
    const { productId, userId } = await setup(2);

    expect(await adjustStock({ productId, delta: -3, reason: "damaged", note: null, userId })).toEqual({
      ok: false,
      reason: "insufficient",
      current: 2,
    });
    expect(await getStock(productId)).toBe(2);
    expect(await adjustments()).toEqual([]);

    // Down to exactly 0 is fine.
    expect(await adjustStock({ productId, delta: -2, reason: "damaged", note: null, userId })).toEqual({
      ok: true,
      stock: 0,
    });
  });

  it("reports a missing product", async () => {
    const { userId } = await setup(1);
    expect(await adjustStock({ productId: 999_999, delta: 1, reason: "received", note: null, userId })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await adjustments()).toEqual([]);
  });

  it("rejects invalid input without querying", async () => {
    const meta = { reason: "received" as const, note: null, userId: "admin" };
    for (const bad of [
      { productId: 0, delta: 1 },
      { productId: 1.5, delta: 1 },
      { productId: 1, delta: 0 },
      { productId: 1, delta: 0.5 },
      { productId: 1, delta: 1_000_001 },
      { productId: 1, delta: -1_000_001 },
      { productId: 1, delta: Number.NaN },
    ]) {
      await expect(adjustStock({ ...bad, ...meta }), JSON.stringify(bad)).rejects.toThrow(/^adjustStock: invalid/);
    }
    await expect(adjustStock({ productId: 1, delta: 1, ...meta, reason: "stolen" as "other" })).rejects.toThrow();
    await expect(adjustStock({ productId: 1, delta: 1, ...meta, note: "x".repeat(501) })).rejects.toThrow();
    await expect(adjustStock({ productId: 1, delta: 1, ...meta, userId: "" })).rejects.toThrow();
  });
});

describe("setStockTo", () => {
  it("sets stock when it's still what the admin saw, logging the difference", async () => {
    const { productId, userId } = await setup(4);

    expect(await setStockTo({ productId, expected: 4, stock: 9, reason: "correction", note: null, userId })).toEqual({
      ok: true,
      stock: 9,
      changed: true,
    });
    expect(
      await setStockTo({ productId, expected: 9, stock: 0, reason: "correction", note: "Count", userId }),
    ).toEqual({ ok: true, stock: 0, changed: true });
    expect(await adjustments()).toEqual([
      { productId, userId, delta: 5, previousStock: 4, newStock: 9, reason: "correction", note: null },
      { productId, userId, delta: -9, previousStock: 9, newStock: 0, reason: "correction", note: "Count" },
    ]);
  });

  it("refuses a stale set, reporting the current stock and changing nothing", async () => {
    const { productId, userId } = await setup(4);
    await setStock(productId, 3); // a sale since the page loaded

    expect(await setStockTo({ productId, expected: 4, stock: 10, reason: "received", note: null, userId })).toEqual({
      ok: false,
      reason: "stale",
      current: 3,
    });
    expect(await getStock(productId)).toBe(3);
    expect(await adjustments()).toEqual([]);
  });

  it("writes nothing when stock already has that value", async () => {
    const { productId, userId } = await setup(4);
    expect(await setStockTo({ productId, expected: 4, stock: 4, reason: "correction", note: null, userId })).toEqual({
      ok: true,
      stock: 4,
      changed: false,
    });
    expect(await adjustments()).toEqual([]);
  });

  it("reports a missing product and rejects invalid input", async () => {
    const { userId } = await setup(1);
    const meta = { reason: "correction" as const, note: null, userId };
    expect(await setStockTo({ productId: 999_999, expected: 0, stock: 1, ...meta })).toEqual({
      ok: false,
      reason: "not-found",
    });
    for (const bad of [
      { expected: -1, stock: 1 },
      { expected: 0, stock: -1 },
      { expected: 0, stock: 1.5 },
      { expected: 0, stock: 1_000_001 },
    ]) {
      await expect(setStockTo({ productId: 1, ...bad, ...meta }), JSON.stringify(bad)).rejects.toThrow(
        /^setStockTo: invalid/,
      );
    }
  });
});

describe("stock adjustments under concurrency", () => {
  it("lets exactly one of an admin removal and a sale take the last units", async () => {
    for (let run = 0; run < 3; run++) {
      await resetCatalog();
      const { productId, userId } = await setup(2);
      const [removed, sold] = await Promise.all([
        adjustStock({ productId, delta: -2, reason: "damaged", note: null, userId }),
        decrementStock([{ productId, quantity: 2 }]),
      ]);
      expect([removed.ok, sold.ok].filter(Boolean)).toHaveLength(1);
      const { rows, stock } = await expectLogConsistent(productId);
      expect(stock).toBe(0);
      expect(rows).toHaveLength(removed.ok ? 1 : 0);
    }
  });

  it("adds stock correctly while a customer places an order", async () => {
    const { productId, userId } = await setup(1);
    const customer = await createUser();
    const lineId = await createCartLine(customer, productId, 1);

    const [added, placed] = await Promise.all([
      adjustStock({ productId, delta: 5, reason: "received", note: null, userId }),
      placeOrder(customer, { checkoutKey: randomUUID(), lines: [{ lineId, quantity: 1 }], delivery }),
    ]);

    expect(added.ok).toBe(true);
    expect(placed.ok).toBe(true);
    const { rows, stock } = await expectLogConsistent(productId);
    expect(stock).toBe(5);
    // Delivery first: 1 → 6, then the order takes 1. Order first: 0 → 5.
    expect([
      [1, 6],
      [0, 5],
    ]).toContainEqual([rows[0].previousStock, rows[0].newStock]);
  });

  it("refuses a stale set, never overwriting a sale that lands first", async () => {
    for (let run = 0; run < 3; run++) {
      await resetCatalog();
      const { productId, userId } = await setup(5);
      const [set, sold] = await Promise.all([
        setStockTo({ productId, expected: 5, stock: 10, reason: "correction", note: null, userId }),
        decrementStock([{ productId, quantity: 2 }]),
      ]);
      expect(sold.ok).toBe(true);
      // Set first: 5 → 10, then the sale: 8. Sale first: 3, and the set is refused as stale.
      const { rows, stock } = await expectLogConsistent(productId);
      expect(stock).toBe(set.ok ? 8 : 3);
      if (!set.ok) expect(set).toEqual({ ok: false, reason: "stale", current: 3 });
      expect(rows).toHaveLength(set.ok ? 1 : 0);
    }
  });

  it("stays consistent with the expiry sweep returning stock", async () => {
    const { productId, userId } = await setup(3);
    const customer = await createUser();
    const reference = await createOrder(customer, [[productId, 2]]);
    await ageOrder(reference, 61);
    expect(await getStock(productId)).toBe(1);

    const [removed, expired] = await Promise.all([
      adjustStock({ productId, delta: -3, reason: "damaged", note: null, userId }),
      expireUnpaidOrders(),
    ]);

    expect(expired).toEqual([reference]);
    // Sweep first: 1 + 2 = 3, then the removal leaves 0. Removal first: refused (only 1), then 3.
    const { rows, stock } = await expectLogConsistent(productId);
    expect(stock).toBe(removed.ok ? 0 : 3);
    expect(rows).toHaveLength(removed.ok ? 1 : 0);
    expect(paystack.initialized).toEqual([]);
  });

  describe("while another transaction holds the product's row lock", () => {
    // An interactive transaction (WebSocket) that holds the lock while the adjustment waits on it.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    afterAll(() => pool.end());

    async function holdSale(productId: number) {
      const client = await pool.connect();
      await client.query("begin");
      await client.query("update products set stock = stock - 1 where id = $1", [productId]);
      return client;
    }

    it("waits, then checks against the committed stock", async () => {
      const { productId, userId } = await setup(1);
      const other = await holdSale(productId);
      try {
        const removal = adjustStock({ productId, delta: -1, reason: "damaged", note: null, userId });
        const set = setStockTo({ productId, expected: 1, stock: 4, reason: "correction", note: null, userId });
        await waitForLockWait();
        await other.query("commit");

        await expect(removal).resolves.toEqual({ ok: false, reason: "insufficient", current: 0 });
        await expect(set).resolves.toEqual({ ok: false, reason: "stale", current: 0 });
      } finally {
        other.release();
      }
      expect(await getStock(productId)).toBe(0);
      expect(await adjustments()).toEqual([]);
    });

    it("applies once the other transaction rolls back", async () => {
      const { productId, userId } = await setup(1);
      const other = await holdSale(productId);
      try {
        const set = setStockTo({ productId, expected: 1, stock: 4, reason: "correction", note: null, userId });
        await waitForLockWait();
        await other.query("rollback");

        await expect(set).resolves.toEqual({ ok: true, stock: 4, changed: true });
      } finally {
        other.release();
      }
      expect(await adjustments()).toMatchObject([{ previousStock: 1, newStock: 4, delta: 3 }]);
    });
  });
});

describe("stock_adjustments constraints", () => {
  it("rejects a record whose numbers don't add up, or a zero change", async () => {
    const { productId, userId } = await setup(1);
    for (const bad of [
      { delta: 1, previousStock: 1, newStock: 3 },
      { delta: 0, previousStock: 1, newStock: 1 },
      { delta: -2, previousStock: 1, newStock: -1 },
    ]) {
      const error = await db
        .insert(stockAdjustments)
        .values({ productId, userId, reason: "other", ...bad })
        .catch((e: unknown) => e);
      expect(sqlState(error), JSON.stringify(bad)).toBe("23514");
    }
  });

  it("keeps the log when a product is deleted, and blocks deleting the admin", async () => {
    const { productId, userId } = await setup(1);
    await adjustStock({ productId, delta: 1, reason: "received", note: null, userId });

    const deleteUser = await db.execute(sql`delete from "user" where id = ${userId}`).catch((e: unknown) => e);
    expect(sqlState(deleteUser)).toBe("23001"); // restrict_violation

    await db.execute(sql`delete from products where id = ${productId}`);
    expect(await adjustments()).toMatchObject([{ productId: null, delta: 1 }]);
  });
});
