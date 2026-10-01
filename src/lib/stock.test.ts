// Runs against the test database only (see tests/test-env.ts).
import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { decrementStock } from "@/lib/stock";

import { createProduct, createSizedProduct, getVariantId, getVariantStock, resetCatalog } from "../../tests/fixtures";

/** A one-size product with `stock`, by its variant id. */
async function oneSize(stock: number) {
  return getVariantId(await createProduct(stock));
}

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
  it("decrements every variant in the list", async () => {
    const a = await oneSize(5);
    const b = await oneSize(2);

    await expect(
      decrementStock([
        { variantId: a, quantity: 3 },
        { variantId: b, quantity: 2 },
      ]),
    ).resolves.toEqual({ ok: true });

    expect(await getVariantStock(a)).toBe(2);
    expect(await getVariantStock(b)).toBe(0);
  });

  it("sums lines for the same variant", async () => {
    const a = await oneSize(3);

    await expect(
      decrementStock([
        { variantId: a, quantity: 2 },
        { variantId: a, quantity: 2 },
      ]),
    ).resolves.toEqual({ ok: false, shortages: [{ variantId: a, requested: 4, available: 3 }] });
    expect(await getVariantStock(a)).toBe(3);

    await expect(
      decrementStock([
        { variantId: a, quantity: 1 },
        { variantId: a, quantity: 2 },
      ]),
    ).resolves.toEqual({ ok: true });
    expect(await getVariantStock(a)).toBe(0);
  });

  it("changes nothing when any variant is short", async () => {
    const a = await oneSize(5);
    const b = await oneSize(0);

    await expect(
      decrementStock([
        { variantId: a, quantity: 1 },
        { variantId: b, quantity: 1 },
      ]),
    ).resolves.toEqual({ ok: false, shortages: [{ variantId: b, requested: 1, available: 0 }] });

    expect(await getVariantStock(a)).toBe(5);
    expect(await getVariantStock(b)).toBe(0);
  });

  it("changes nothing when a variant doesn't exist", async () => {
    const a = await oneSize(5);
    const missing = a + 1000;

    await expect(
      decrementStock([
        { variantId: a, quantity: 1 },
        { variantId: missing, quantity: 1 },
      ]),
    ).resolves.toEqual({ ok: false, shortages: [{ variantId: missing, requested: 1, available: 0 }] });

    expect(await getVariantStock(a)).toBe(5);
  });

  it("keeps each size's stock separate", async () => {
    const { variants } = await createSizedProduct([
      ["S", 1],
      ["M", 2],
    ]);

    await expect(decrementStock([{ variantId: variants.S, quantity: 2 }])).resolves.toEqual({
      ok: false,
      shortages: [{ variantId: variants.S, requested: 2, available: 1 }],
    });
    await expect(
      decrementStock([
        { variantId: variants.S, quantity: 1 },
        { variantId: variants.M, quantity: 2 },
      ]),
    ).resolves.toEqual({ ok: true });

    expect(await getVariantStock(variants.S)).toBe(0);
    expect(await getVariantStock(variants.M)).toBe(0);
  });

  it("rejects invalid input without querying", async () => {
    await expect(decrementStock([])).rejects.toThrow("no items");
    for (const item of [
      { variantId: 1, quantity: 0 },
      { variantId: 1, quantity: -1 },
      { variantId: 1, quantity: 1.5 },
      { variantId: 0, quantity: 1 },
      { variantId: Number.NaN, quantity: 1 },
    ]) {
      await expect(decrementStock([item])).rejects.toThrow("invalid item");
    }
  });
});

describe("decrementStock under concurrency", () => {
  it("sells the last unit to exactly one of two simultaneous buyers", async () => {
    const a = await oneSize(1);

    const results = await Promise.all([
      decrementStock([{ variantId: a, quantity: 1 }]),
      decrementStock([{ variantId: a, quantity: 1 }]),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, shortages: [{ variantId: a, requested: 1, available: 0 }] },
    ]);
    expect(await getVariantStock(a)).toBe(0);
  });

  it("sells the last unit of one size to exactly one buyer, leaving the other sizes alone", async () => {
    const { variants } = await createSizedProduct([
      ["S", 1],
      ["M", 3],
    ]);

    const results = await Promise.all([
      decrementStock([{ variantId: variants.S, quantity: 1 }]),
      decrementStock([{ variantId: variants.S, quantity: 1 }]),
      decrementStock([{ variantId: variants.M, quantity: 1 }]),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results[2]).toEqual({ ok: true });
    expect(await getVariantStock(variants.S)).toBe(0);
    expect(await getVariantStock(variants.M)).toBe(2);
  });

  it("never oversells with many simultaneous buyers", async () => {
    const a = await oneSize(2);

    // Kept small: each call opens its own HTTPS connection to Neon, and larger bursts can time out
    // at the network level (not a test failure of the code under test).
    const results = await Promise.all(
      Array.from({ length: 5 }, () => decrementStock([{ variantId: a, quantity: 1 }])),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(await getVariantStock(a)).toBe(0);
  });

  it("allows only one of two opposite-order multi-item orders, without deadlocking", async () => {
    const a = await oneSize(1);
    const b = await oneSize(1);

    const results = await Promise.all([
      decrementStock([
        { variantId: a, quantity: 1 },
        { variantId: b, quantity: 1 },
      ]),
      decrementStock([
        { variantId: b, quantity: 1 },
        { variantId: a, quantity: 1 },
      ]),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await getVariantStock(a)).toBe(0);
    expect(await getVariantStock(b)).toBe(0);
  });

  describe("while another transaction holds the variant's row lock", () => {
    // An interactive transaction (WebSocket) that holds the lock while decrementStock waits on it.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    afterAll(() => pool.end());

    async function holdLastUnit(variantId: number) {
      const client = await pool.connect();
      await client.query("begin");
      await client.query("update product_variants set stock = stock - 1 where id = $1", [variantId]);
      return client;
    }

    it("re-checks stock after the lock is released and refuses once it's gone", async () => {
      const a = await oneSize(1);
      const other = await holdLastUnit(a);
      try {
        const pending = decrementStock([{ variantId: a, quantity: 1 }]);
        await waitForLockWait();
        await other.query("commit");

        await expect(pending).resolves.toEqual({
          ok: false,
          shortages: [{ variantId: a, requested: 1, available: 0 }],
        });
      } finally {
        other.release();
      }
      expect(await getVariantStock(a)).toBe(0);
    });

    it("succeeds once the other transaction rolls back", async () => {
      const a = await oneSize(1);
      const other = await holdLastUnit(a);
      try {
        const pending = decrementStock([{ variantId: a, quantity: 1 }]);
        await waitForLockWait();
        await other.query("rollback");

        await expect(pending).resolves.toEqual({ ok: true });
      } finally {
        other.release();
      }
      expect(await getVariantStock(a)).toBe(0);
    });
  });
});

describe("product_variants_stock_nonnegative", () => {
  it("rejects negative stock at the database", async () => {
    const a = await oneSize(1);

    const error = await db
      .execute(sql`update product_variants set stock = stock - 2 where id = ${a}`)
      .catch((e: unknown) => e);

    expect(sqlState(error)).toBe("23514");
    expect(await getVariantStock(a)).toBe(1);
  });
});

describe("products_price_whole_shillings", () => {
  it("rejects prices that aren't whole shillings", async () => {
    const a = await createProduct(1, 100_000);

    const error = await db.execute(sql`update products set price = 100050 where id = ${a}`).catch((e: unknown) => e);

    expect(sqlState(error)).toBe("23514");
  });
});
