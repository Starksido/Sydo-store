// Runs against the test database only (see tests/test-env.ts).
import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { decrementStock } from "@/lib/stock";

import { createProduct, getStock, resetCatalog } from "../../tests/fixtures";

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

beforeEach(resetCatalog);

describe("decrementStock", () => {
  it("decrements every product in the list", async () => {
    const a = await createProduct(5);
    const b = await createProduct(2);

    await expect(
      decrementStock([
        { productId: a, quantity: 3 },
        { productId: b, quantity: 2 },
      ]),
    ).resolves.toEqual({ ok: true });

    expect(await getStock(a)).toBe(2);
    expect(await getStock(b)).toBe(0);
  });

  it("sums lines for the same product, since sizes share stock", async () => {
    const a = await createProduct(3);

    await expect(
      decrementStock([
        { productId: a, quantity: 2 },
        { productId: a, quantity: 2 },
      ]),
    ).resolves.toEqual({ ok: false, shortages: [{ productId: a, requested: 4, available: 3 }] });
    expect(await getStock(a)).toBe(3);

    await expect(
      decrementStock([
        { productId: a, quantity: 1 },
        { productId: a, quantity: 2 },
      ]),
    ).resolves.toEqual({ ok: true });
    expect(await getStock(a)).toBe(0);
  });

  it("changes nothing when any product is short", async () => {
    const a = await createProduct(5);
    const b = await createProduct(0);

    await expect(
      decrementStock([
        { productId: a, quantity: 1 },
        { productId: b, quantity: 1 },
      ]),
    ).resolves.toEqual({ ok: false, shortages: [{ productId: b, requested: 1, available: 0 }] });

    expect(await getStock(a)).toBe(5);
    expect(await getStock(b)).toBe(0);
  });

  it("changes nothing when a product doesn't exist", async () => {
    const a = await createProduct(5);
    const missing = a + 1000;

    await expect(
      decrementStock([
        { productId: a, quantity: 1 },
        { productId: missing, quantity: 1 },
      ]),
    ).resolves.toEqual({ ok: false, shortages: [{ productId: missing, requested: 1, available: 0 }] });

    expect(await getStock(a)).toBe(5);
  });

  it("rejects invalid input without querying", async () => {
    await expect(decrementStock([])).rejects.toThrow("no items");
    for (const item of [
      { productId: 1, quantity: 0 },
      { productId: 1, quantity: -1 },
      { productId: 1, quantity: 1.5 },
      { productId: 0, quantity: 1 },
      { productId: Number.NaN, quantity: 1 },
    ]) {
      await expect(decrementStock([item])).rejects.toThrow("invalid item");
    }
  });
});

describe("decrementStock under concurrency", () => {
  it("sells the last unit to exactly one of two simultaneous buyers", async () => {
    const a = await createProduct(1);

    const results = await Promise.all([
      decrementStock([{ productId: a, quantity: 1 }]),
      decrementStock([{ productId: a, quantity: 1 }]),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, shortages: [{ productId: a, requested: 1, available: 0 }] },
    ]);
    expect(await getStock(a)).toBe(0);
  });

  it("never oversells with many simultaneous buyers", async () => {
    const a = await createProduct(2);

    // Kept small: each call opens its own HTTPS connection to Neon, and larger bursts can time out
    // at the network level (not a test failure of the code under test).
    const results = await Promise.all(
      Array.from({ length: 5 }, () => decrementStock([{ productId: a, quantity: 1 }])),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(await getStock(a)).toBe(0);
  });

  it("allows only one of two opposite-order multi-item orders, without deadlocking", async () => {
    const a = await createProduct(1);
    const b = await createProduct(1);

    const results = await Promise.all([
      decrementStock([
        { productId: a, quantity: 1 },
        { productId: b, quantity: 1 },
      ]),
      decrementStock([
        { productId: b, quantity: 1 },
        { productId: a, quantity: 1 },
      ]),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await getStock(a)).toBe(0);
    expect(await getStock(b)).toBe(0);
  });

  describe("while another transaction holds the product's row lock", () => {
    // An interactive transaction (WebSocket) that holds the lock while decrementStock waits on it.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    afterAll(() => pool.end());

    async function holdLastUnit(productId: number) {
      const client = await pool.connect();
      await client.query("begin");
      await client.query("update products set stock = stock - 1 where id = $1", [productId]);
      return client;
    }

    it("re-checks stock after the lock is released and refuses once it's gone", async () => {
      const a = await createProduct(1);
      const other = await holdLastUnit(a);
      try {
        const pending = decrementStock([{ productId: a, quantity: 1 }]);
        await waitForLockWait();
        await other.query("commit");

        await expect(pending).resolves.toEqual({
          ok: false,
          shortages: [{ productId: a, requested: 1, available: 0 }],
        });
      } finally {
        other.release();
      }
      expect(await getStock(a)).toBe(0);
    });

    it("succeeds once the other transaction rolls back", async () => {
      const a = await createProduct(1);
      const other = await holdLastUnit(a);
      try {
        const pending = decrementStock([{ productId: a, quantity: 1 }]);
        await waitForLockWait();
        await other.query("rollback");

        await expect(pending).resolves.toEqual({ ok: true });
      } finally {
        other.release();
      }
      expect(await getStock(a)).toBe(0);
    });
  });
});

describe("products_stock_nonnegative", () => {
  it("rejects negative stock at the database", async () => {
    const a = await createProduct(1);

    const error = await db.execute(sql`update products set stock = stock - 2 where id = ${a}`).catch((e: unknown) => e);

    expect(sqlState(error)).toBe("23514");
    expect(await getStock(a)).toBe(1);
  });
});
