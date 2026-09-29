// Runs against the test database only (see tests/test-env.ts).
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { products, user } from "@/db/schema";
import type { Delivery } from "@/lib/delivery";
import { getOrderForUser, listOrdersForUser, placeOrder, type CheckoutLine } from "@/lib/orders";

import {
  createCartLine,
  createProduct,
  createUser,
  getCartQuantities,
  getStock,
  resetCatalog,
  setStock,
} from "../../tests/fixtures";

const delivery: Delivery = {
  fullName: "Wanjiku Kamau",
  phone: "+254712345678",
  county: "Nairobi",
  town: "Westlands",
  address: "Mpaka Road, Apartment 4B",
};

function order(userId: string, lines: CheckoutLine[], checkoutKey = randomUUID()) {
  return placeOrder(userId, { checkoutKey, lines, delivery });
}

async function orderCount() {
  const { rows } = await db.execute<{ count: number }>(sql`select count(*)::int as count from orders`);
  return rows[0].count;
}

async function productName(id: number) {
  const [row] = await db.select({ name: products.name }).from(products).where(eq(products.id, id));
  return row.name;
}

function referenceOf(result: Awaited<ReturnType<typeof placeOrder>>) {
  if (!result.ok) throw new Error(`Expected an order, got ${JSON.stringify(result)}`);
  return result.reference;
}

/** Postgres SQLSTATE from a driver error, unwrapping drizzle's DrizzleQueryError. */
function sqlState(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

beforeEach(resetCatalog);

describe("placeOrder", () => {
  it("creates the order from product prices, takes the stock and clears the ordered lines", async () => {
    const userId = await createUser();
    const coat = await createProduct(5, 3_757_000);
    const scarf = await createProduct(2, 520_000);
    const m = await createCartLine(userId, coat, 1, "M");
    const l = await createCartLine(userId, coat, 2, "L");
    const s = await createCartLine(userId, scarf, 1);

    const result = await order(userId, [
      { lineId: m, quantity: 1 },
      { lineId: l, quantity: 2 },
      { lineId: s, quantity: 1 },
    ]);

    expect(referenceOf(result)).toMatch(/^SY-[2-9A-HJ-NP-Z]{8}$/);
    const placed = await getOrderForUser(userId, referenceOf(result));
    expect(placed).toMatchObject({
      userId,
      status: "pending_payment",
      total: 3 * 3_757_000 + 520_000,
      deliveryName: delivery.fullName,
      deliveryPhone: delivery.phone,
      deliveryCounty: delivery.county,
      deliveryTown: delivery.town,
      deliveryAddress: delivery.address,
    });
    const coatName = await productName(coat);
    expect(placed!.items).toMatchObject([
      { productId: coat, productName: coatName, size: "M", unitPrice: 3_757_000, quantity: 1 },
      { productId: coat, productName: coatName, size: "L", unitPrice: 3_757_000, quantity: 2 },
      { productId: scarf, productName: await productName(scarf), size: null, unitPrice: 520_000, quantity: 1 },
    ]);
    expect(await getStock(coat)).toBe(2);
    expect(await getStock(scarf)).toBe(1);
    expect(await getCartQuantities(userId)).toEqual({});
  });

  it("keeps the name and price at purchase when the product changes later", async () => {
    const userId = await createUser();
    const a = await createProduct(5, 100_000);
    const line = await createCartLine(userId, a, 1);
    const name = await productName(a);

    const reference = referenceOf(await order(userId, [{ lineId: line, quantity: 1 }]));
    await db.update(products).set({ price: 999_900, name: "Renamed" }).where(eq(products.id, a));

    const placed = await getOrderForUser(userId, reference);
    expect(placed!.total).toBe(100_000);
    expect(placed!.items[0]).toMatchObject({ productName: name, unitPrice: 100_000 });
  });

  it("leaves out lines not in the checkout, such as sold-out ones", async () => {
    const userId = await createUser();
    const a = await createProduct(3);
    const soldOut = await createProduct(0);
    const ordered = await createCartLine(userId, a, 1);
    const kept = await createCartLine(userId, soldOut, 1);

    expect(await order(userId, [{ lineId: ordered, quantity: 1 }])).toMatchObject({ ok: true });
    expect(await getCartQuantities(userId)).toEqual({ [kept]: 1 });
  });

  it("names the short item and changes nothing when any item is out of stock", async () => {
    const userId = await createUser();
    const a = await createProduct(5);
    const b = await createProduct(3);
    const lineA = await createCartLine(userId, a, 2);
    const lineB = await createCartLine(userId, b, 2);
    await setStock(b, 1);

    const result = await order(userId, [
      { lineId: lineA, quantity: 2 },
      { lineId: lineB, quantity: 2 },
    ]);

    expect(result).toEqual({
      ok: false,
      reason: "out-of-stock",
      shortages: [{ productId: b, name: await productName(b), requested: 2, available: 1 }],
    });
    expect(await getStock(a)).toBe(5);
    expect(await getStock(b)).toBe(1);
    expect(await getCartQuantities(userId)).toEqual({ [lineA]: 2, [lineB]: 2 });
    expect(await orderCount()).toBe(0);
  });

  it("checks stock across sizes of the same product", async () => {
    const userId = await createUser();
    const a = await createProduct(4);
    const m = await createCartLine(userId, a, 2, "M");
    const l = await createCartLine(userId, a, 2, "L");
    await setStock(a, 3);

    expect(
      await order(userId, [
        { lineId: m, quantity: 2 },
        { lineId: l, quantity: 2 },
      ]),
    ).toEqual({
      ok: false,
      reason: "out-of-stock",
      shortages: [{ productId: a, name: await productName(a), requested: 4, available: 3 }],
    });
    expect(await getStock(a)).toBe(3);
  });

  it("refuses, changing nothing, when the cart no longer matches the checkout", async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const a = await createProduct(5);
    const b = await createProduct(5);
    const line = await createCartLine(userId, a, 2);
    const deleted = await createCartLine(userId, b, 1);
    const othersLine = await createCartLine(otherId, a, 1);
    await db.delete(products).where(eq(products.id, b));

    for (const lines of [
      [{ lineId: line, quantity: 1 }], // quantity changed
      [{ lineId: deleted, quantity: 1 }], // product deleted
      [{ lineId: othersLine, quantity: 1 }], // another user's line
      [{ lineId: line + 1000, quantity: 1 }], // no such line
      [
        { lineId: line, quantity: 2 },
        { lineId: deleted, quantity: 1 },
      ], // one good line doesn't carry a bad one
    ]) {
      expect(await order(userId, lines)).toEqual({ ok: false, reason: "cart-changed" });
    }
    expect(await getStock(a)).toBe(5);
    expect(await getCartQuantities(userId)).toEqual({ [line]: 2, [deleted]: 1 });
    expect(await getCartQuantities(otherId)).toEqual({ [othersLine]: 1 });
    expect(await orderCount()).toBe(0);
  });

  it("rejects invalid input", async () => {
    const userId = await createUser();
    await expect(order(userId, [])).rejects.toThrow("no lines");
    await expect(
      order(userId, [
        { lineId: 1, quantity: 1 },
        { lineId: 1, quantity: 1 },
      ]),
    ).rejects.toThrow("duplicate lines");
    await expect(order(userId, [{ lineId: 1, quantity: 0 }])).rejects.toThrow("invalid line");
  });
});

describe("placeOrder duplicate protection", () => {
  it("returns the same order when the same checkout is submitted again", async () => {
    const userId = await createUser();
    const a = await createProduct(5);
    const line = await createCartLine(userId, a, 2);
    const key = randomUUID();

    const first = await order(userId, [{ lineId: line, quantity: 2 }], key);
    const second = await order(userId, [{ lineId: line, quantity: 2 }], key);

    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
    expect(await orderCount()).toBe(1);
    expect(await getStock(a)).toBe(3);
  });

  it("creates one order from two simultaneous submits of the same checkout", async () => {
    const userId = await createUser();
    const a = await createProduct(5);
    const line = await createCartLine(userId, a, 2);
    const key = randomUUID();

    const [first, second] = await Promise.all([
      order(userId, [{ lineId: line, quantity: 2 }], key),
      order(userId, [{ lineId: line, quantity: 2 }], key),
    ]);

    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
    expect(await orderCount()).toBe(1);
    expect(await getStock(a)).toBe(3);
  });

  it("creates one order when the same cart is checked out from two tabs at once", async () => {
    const userId = await createUser();
    const a = await createProduct(5);
    const line = await createCartLine(userId, a, 2);

    const results = await Promise.all([
      order(userId, [{ lineId: line, quantity: 2 }]),
      order(userId, [{ lineId: line, quantity: 2 }]),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "cart-changed" }]);
    expect(await orderCount()).toBe(1);
    expect(await getStock(a)).toBe(3);
  });

  it("sells the last unit to exactly one of two customers ordering at once", async () => {
    const buyers = [await createUser(), await createUser()];
    const a = await createProduct(1);
    const lines = [await createCartLine(buyers[0], a, 1), await createCartLine(buyers[1], a, 1)];

    const results = await Promise.all(buyers.map((id, i) => order(id, [{ lineId: lines[i], quantity: 1 }])));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      {
        ok: false,
        reason: "out-of-stock",
        shortages: [{ productId: a, name: await productName(a), requested: 1, available: 0 }],
      },
    ]);
    expect(await getStock(a)).toBe(0);
  });
});

describe("getOrderForUser", () => {
  it("returns an order only to its owner", async () => {
    const ownerId = await createUser();
    const otherId = await createUser();
    const a = await createProduct(5);
    const line = await createCartLine(ownerId, a, 1);
    const reference = referenceOf(await order(ownerId, [{ lineId: line, quantity: 1 }]));

    expect(await getOrderForUser(ownerId, reference)).toMatchObject({ reference, userId: ownerId });
    expect(await getOrderForUser(otherId, reference)).toBeUndefined();
    expect(await getOrderForUser(ownerId, "SY-NOTREAL2")).toBeUndefined();
  });
});

describe("listOrdersForUser", () => {
  async function placeOne(userId: string) {
    const product = await createProduct(5);
    const line = await createCartLine(userId, product, 1);
    return referenceOf(await order(userId, [{ lineId: line, quantity: 1 }]));
  }

  it("lists only the user's own orders, newest first", async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const first = await placeOne(userId);
    const second = await placeOne(userId);
    await placeOne(otherId);

    const { orders, hasMore } = await listOrdersForUser(userId);
    expect(orders.map((o) => o.reference)).toEqual([second, first]);
    expect(hasMore).toBe(false);
  });

  it("pages through orders without loading them all", async () => {
    const userId = await createUser();
    const references = [];
    for (let i = 0; i < 3; i++) references.push(await placeOne(userId));
    references.reverse();

    const page1 = await listOrdersForUser(userId, { page: 1, pageSize: 2 });
    expect(page1.orders.map((o) => o.reference)).toEqual(references.slice(0, 2));
    expect(page1.hasMore).toBe(true);

    const page2 = await listOrdersForUser(userId, { page: 2, pageSize: 2 });
    expect(page2.orders.map((o) => o.reference)).toEqual(references.slice(2));
    expect(page2.hasMore).toBe(false);
  });

  it("returns nothing for a user without orders", async () => {
    const userId = await createUser();
    expect(await listOrdersForUser(userId)).toEqual({ orders: [], hasMore: false });
  });
});

describe("orders_user_id_user_id_fk", () => {
  it("keeps users who have orders from being deleted", async () => {
    const userId = await createUser();
    const a = await createProduct(5);
    const line = await createCartLine(userId, a, 1);
    await order(userId, [{ lineId: line, quantity: 1 }]);

    const error = await db
      .delete(user)
      .where(eq(user.id, userId))
      .catch((e: unknown) => e);

    expect(sqlState(error)).toBe("23001"); // restrict_violation
    expect(await orderCount()).toBe(1);
  });
});
