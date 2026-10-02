// Runs against the test database only (see tests/test-env.ts).
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { carts, productVariants } from "@/db/schema";
import { setProductArchived } from "@/lib/admin/products";
import {
  addCartItem,
  deleteStaleGuestCarts,
  getCart,
  getCartVariant,
  mergeGuestCart,
  reconcileCart,
  setCartItemQuantity,
} from "@/lib/cart";

import {
  createCartLine,
  createGuestCartLine,
  createProduct,
  createSizedProduct,
  createUser,
  getCartQuantities,
  getVariantId,
  resetCatalog,
  setStock,
} from "../../tests/fixtures";

beforeEach(resetCatalog);

describe("reconcileCart", () => {
  it("lowers a line's saved quantity to the stock left", async () => {
    const userId = await createUser();
    const a = await createProduct(5);
    const line = await createCartLine(userId, a, 4);
    await setStock(a, 2);

    expect(await reconcileCart({ userId })).toEqual(new Set([line]));
    expect(await getCartQuantities(userId)).toEqual({ [line]: 2 });

    const { lines } = await getCart({ userId });
    expect(lines[0]).toMatchObject({ quantity: 2, available: 2 });
  });

  it("limits each size by its own stock", async () => {
    const userId = await createUser();
    const { productId: a } = await createSizedProduct([
      ["M", 10],
      ["L", 10],
    ]);
    const m = await createCartLine(userId, a, 2, "M");
    const l = await createCartLine(userId, a, 3, "L");
    await setStock(a, 2, "L");

    expect(await reconcileCart({ userId })).toEqual(new Set([l]));
    expect(await getCartQuantities(userId)).toEqual({ [m]: 2, [l]: 2 });

    const { lines } = await getCart({ userId });
    expect(lines).toMatchObject([
      { id: m, size: "M", available: 2, maxQuantity: 10, product: { stock: 10 } },
      { id: l, size: "L", available: 2, maxQuantity: 2, product: { stock: 2 } },
    ]);
  });

  it("keeps sold-out lines, unchanged, as sold out", async () => {
    const userId = await createUser();
    const a = await createProduct(3);
    const line = await createCartLine(userId, a, 2);
    await setStock(a, 0);

    expect(await reconcileCart({ userId })).toEqual(new Set());
    expect(await getCartQuantities(userId)).toEqual({ [line]: 2 });

    const { lines, count } = await getCart({ userId });
    expect(lines[0]).toMatchObject({ quantity: 2, available: 0, lineTotal: 0 });
    expect(count).toBe(0);
  });

  it("shows a line whose size was removed as no longer available, and leaves it alone", async () => {
    const userId = await createUser();
    const { productId: a, variants } = await createSizedProduct([
      ["M", 0],
      ["L", 5],
    ]);
    const m = await createCartLine(userId, a, 2, "M");
    const l = await createCartLine(userId, a, 1, "L");
    await db.delete(productVariants).where(eq(productVariants.id, variants.M));

    expect(await reconcileCart({ userId })).toEqual(new Set());
    expect(await getCartQuantities(userId)).toEqual({ [m]: 2, [l]: 1 });
    const { lines, count } = await getCart({ userId });
    expect(lines).toMatchObject([
      { id: m, product: null, name: "Saved name", size: "M", available: 0, maxQuantity: 0 },
      { id: l, available: 1 },
    ]);
    expect(count).toBe(1);
    expect(await setCartItemQuantity({ userId }, m, 1)).toBe(false);
  });

  it("leaves lines that stock still covers, and other users' carts, alone", async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const a = await createProduct(5);
    const b = await createProduct(5);
    const covered = await createCartLine(userId, a, 2);
    const others = await createCartLine(otherId, b, 4);
    await setStock(b, 1);

    expect(await reconcileCart({ userId })).toEqual(new Set());
    expect(await getCartQuantities(userId)).toEqual({ [covered]: 2 });
    expect(await getCartQuantities(otherId)).toEqual({ [others]: 4 });
  });
});

describe("addCartItem and setCartItemQuantity", () => {
  it("merge adds of a size into one line, within that size's stock only", async () => {
    const userId = await createUser();
    const { variants } = await createSizedProduct([
      ["S", 2],
      ["M", 1],
    ]);

    expect(await addCartItem({ userId }, variants.S, 1)).toBe(true);
    expect(await addCartItem({ userId }, variants.S, 1)).toBe(true);
    expect(await addCartItem({ userId }, variants.S, 1)).toBe(false);
    // Another size has its own stock, whatever the bag holds of the first.
    expect(await addCartItem({ userId }, variants.M, 1)).toBe(true);
    expect(await addCartItem({ userId }, variants.M, 1)).toBe(false);

    const { lines } = await getCart({ userId });
    expect(lines).toMatchObject([
      { size: "S", quantity: 2, available: 2 },
      { size: "M", quantity: 1, available: 1 },
    ]);
    expect(await setCartItemQuantity({ userId }, lines[0].id, 3)).toBe(false);
    expect(await setCartItemQuantity({ userId }, lines[0].id, 1)).toBe(true);
    expect(await setCartItemQuantity({ userId }, lines[1].id, 2)).toBe(false);
  });

  it("stop a line at 99, however much is in stock", async () => {
    const userId = await createUser();
    const productId = await createProduct(150);
    const variantId = await getVariantId(productId);
    await createCartLine(userId, productId, 98);

    expect(await addCartItem({ userId }, variantId, 1)).toBe(true);
    expect(await addCartItem({ userId }, variantId, 1)).toBe(false);
    expect(Object.values(await getCartQuantities(userId))).toEqual([99]);
  });

  it("show a size by its current label, as the order will record it", async () => {
    const userId = await createUser();
    const { productId, variants } = await createSizedProduct([["M", 5]]);
    await createCartLine(userId, productId, 1, "M");
    // An admin corrects the label after the customer added it.
    await db.update(productVariants).set({ label: "L" }).where(eq(productVariants.id, variants.M));

    expect((await getCart({ userId })).lines).toMatchObject([{ size: "L", available: 1 }]);
  });

  it("refuse a size that's sold out or doesn't exist", async () => {
    const userId = await createUser();
    const { variants } = await createSizedProduct([["S", 0]]);

    expect(await addCartItem({ userId }, variants.S, 1)).toBe(false);
    expect(await addCartItem({ userId }, 999_999, 1)).toBe(false);
    expect(await getCartVariant(999_999)).toBeUndefined();
    expect(await getCartVariant(variants.S)).toMatchObject({ label: "S", stock: 0 });
  });
});

describe("guest carts", () => {
  const guest = "a".repeat(64);

  it("work like a user's: add, read and change by the token hash", async () => {
    const variantId = await getVariantId(await createProduct(2));

    expect(await addCartItem({ tokenHash: guest }, variantId, 2)).toBe(true);
    expect(await addCartItem({ tokenHash: guest }, variantId, 1)).toBe(false);
    const { lines, count } = await getCart({ tokenHash: guest });
    expect(count).toBe(2);
    expect(await setCartItemQuantity({ tokenHash: "b".repeat(64) }, lines[0].id, 1)).toBe(false);
    expect(await setCartItemQuantity({ tokenHash: guest }, lines[0].id, 1)).toBe(true);
    expect(await db.select({ userId: carts.userId, tokenHash: carts.tokenHash }).from(carts)).toEqual([
      { userId: null, tokenHash: guest },
    ]);
  });

  it("must have exactly one owner", async () => {
    const userId = await createUser();
    const both = await db
      .execute(sql`insert into carts (user_id, token_hash) values (${userId}, ${guest})`)
      .catch((e: unknown) => e);
    const neither = await db.execute(sql`insert into carts default values`).catch((e: unknown) => e);
    for (const error of [both, neither]) {
      expect((error as { cause?: { code?: string } }).cause?.code).toBe("23514");
    }
  });
});

describe("mergeGuestCart", () => {
  const guest = "c".repeat(64);

  it("adds the guest's lines to the user's, capped at stock and 99, and deletes the guest cart", async () => {
    const userId = await createUser();
    const { productId: coat } = await createSizedProduct([
      ["M", 3],
      ["L", 200],
    ]);
    const scarf = await createProduct(5);
    const both = await createCartLine(userId, coat, 2, "M");
    await createGuestCartLine(guest, coat, 2, "M"); // 2 + 2 > 3 in stock
    await createGuestCartLine(guest, coat, 120, "L"); // over 99
    await createGuestCartLine(guest, scarf, 1);

    expect(await mergeGuestCart(guest, userId)).toBe(3);

    const { lines } = await getCart({ userId });
    expect(lines.map((line) => [line.name, line.size, line.quantity])).toEqual([
      [expect.any(String), "M", 3],
      [expect.any(String), "L", 99],
      [expect.any(String), null, 1],
    ]);
    expect(lines[0].id).toBe(both);
    expect(await db.select().from(carts).where(eq(carts.tokenHash, guest))).toEqual([]);
  });

  it("keeps sold-out lines as they were, never lowers the user's line, and drops removed sizes", async () => {
    const userId = await createUser();
    const { productId: coat } = await createSizedProduct([
      ["M", 0],
      ["L", 0],
      ["S", 1],
    ]);
    await createCartLine(userId, coat, 2, "L");
    await createCartLine(userId, coat, 4, "S"); // above stock already: reconcileCart lowers it on view
    await createGuestCartLine(guest, coat, 1, "M");
    await createGuestCartLine(guest, coat, 1, "L");
    await createGuestCartLine(guest, coat, 1, "S");
    await createGuestCartLine(guest, coat, 1, "XL"); // size since removed

    expect(await mergeGuestCart(guest, userId)).toBe(3);

    const { lines } = await getCart({ userId });
    expect(lines.map((line) => [line.size, line.quantity, line.available])).toEqual([
      ["L", 2, 0],
      ["S", 4, 1],
      ["M", 1, 0],
    ]);
  });

  it("creates the user's cart if needed, and does nothing without a guest cart", async () => {
    const userId = await createUser();
    const scarf = await createProduct(5);

    expect(await mergeGuestCart(guest, userId)).toBe(0);
    expect(await db.$count(carts)).toBe(0);

    await createGuestCartLine(guest, scarf, 2);
    expect(await mergeGuestCart(guest, userId)).toBe(1);
    expect(Object.values(await getCartQuantities(userId))).toEqual([2]);
    expect(await mergeGuestCart(guest, userId)).toBe(0);
  });
});

describe("deleteStaleGuestCarts", () => {
  it("deletes guest carts with no change for 30 days, and nothing else", async () => {
    const userId = await createUser();
    const scarf = await createProduct(5);
    const old = "d".repeat(64);
    const touched = "e".repeat(64);
    await createGuestCartLine(old, scarf, 1);
    await createGuestCartLine(touched, scarf, 1);
    await createCartLine(userId, scarf, 1);
    const ago = sql`now() - interval '31 days'`;
    await db.update(carts).set({ updatedAt: ago });
    await db.execute(sql`update cart_items set updated_at = now() - interval '31 days'`);
    // A line changed recently keeps its cart.
    await db.execute(sql`
      update cart_items set updated_at = now()
      where cart_id = (select id from carts where token_hash = ${touched})
    `);

    expect(await deleteStaleGuestCarts()).toBe(1);
    expect((await db.select({ tokenHash: carts.tokenHash, userId: carts.userId }).from(carts)).sort((a, b) =>
      String(a.tokenHash).localeCompare(String(b.tokenHash)),
    )).toEqual([
      { tokenHash: touched, userId: null },
      { tokenHash: null, userId },
    ]);
  });
});

describe("archived products in the cart", () => {
  it("show as no longer available, can't be added or raised, and come back when unarchived", async () => {
    const userId = await createUser();
    const a = await createProduct(5);
    const b = await createProduct(5);
    const variantA = await getVariantId(a);
    const archivedLine = await createCartLine(userId, a, 2);
    const keptLine = await createCartLine(userId, b, 1);
    await setProductArchived(a, true);

    const { lines, count, subtotal } = await getCart({ userId });
    expect(lines).toMatchObject([
      { id: archivedLine, product: null, name: "Saved name", available: 0, maxQuantity: 0, lineTotal: 0 },
      { id: keptLine, available: 1 },
    ]);
    expect(count).toBe(1);
    expect(subtotal).toBe(1000);

    expect(await getCartVariant(variantA)).toBeUndefined();
    expect(await addCartItem({ userId }, variantA, 1)).toBe(false);
    expect(await setCartItemQuantity({ userId }, archivedLine, 1)).toBe(false);
    // Stock dropping below the saved quantity doesn't touch an archived product's line.
    await setStock(a, 1);
    expect(await reconcileCart({ userId })).toEqual(new Set());
    expect(await getCartQuantities(userId)).toEqual({ [archivedLine]: 2, [keptLine]: 1 });

    await setStock(a, 5);
    await setProductArchived(a, false);
    expect((await getCart({ userId })).lines[0]).toMatchObject({ id: archivedLine, available: 2, product: { id: a } });
    expect(await addCartItem({ userId }, variantA, 1)).toBe(true);
  });
});
