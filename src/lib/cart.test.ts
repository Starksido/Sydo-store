// Runs against the test database only (see tests/test-env.ts).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { productVariants } from "@/db/schema";
import { setProductArchived } from "@/lib/admin/products";
import { addCartItem, getCart, getCartVariant, reconcileCart, setCartItemQuantity } from "@/lib/cart";

import {
  createCartLine,
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

    expect(await reconcileCart(userId)).toEqual(new Set([line]));
    expect(await getCartQuantities(userId)).toEqual({ [line]: 2 });

    const { lines } = await getCart(userId);
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

    expect(await reconcileCart(userId)).toEqual(new Set([l]));
    expect(await getCartQuantities(userId)).toEqual({ [m]: 2, [l]: 2 });

    const { lines } = await getCart(userId);
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

    expect(await reconcileCart(userId)).toEqual(new Set());
    expect(await getCartQuantities(userId)).toEqual({ [line]: 2 });

    const { lines, count } = await getCart(userId);
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

    expect(await reconcileCart(userId)).toEqual(new Set());
    expect(await getCartQuantities(userId)).toEqual({ [m]: 2, [l]: 1 });
    const { lines, count } = await getCart(userId);
    expect(lines).toMatchObject([
      { id: m, product: null, name: "Saved name", size: "M", available: 0, maxQuantity: 0 },
      { id: l, available: 1 },
    ]);
    expect(count).toBe(1);
    expect(await setCartItemQuantity(userId, m, 1)).toBe(false);
  });

  it("leaves lines that stock still covers, and other users' carts, alone", async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const a = await createProduct(5);
    const b = await createProduct(5);
    const covered = await createCartLine(userId, a, 2);
    const others = await createCartLine(otherId, b, 4);
    await setStock(b, 1);

    expect(await reconcileCart(userId)).toEqual(new Set());
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

    expect(await addCartItem(userId, variants.S, 1)).toBe(true);
    expect(await addCartItem(userId, variants.S, 1)).toBe(true);
    expect(await addCartItem(userId, variants.S, 1)).toBe(false);
    // Another size has its own stock, whatever the bag holds of the first.
    expect(await addCartItem(userId, variants.M, 1)).toBe(true);
    expect(await addCartItem(userId, variants.M, 1)).toBe(false);

    const { lines } = await getCart(userId);
    expect(lines).toMatchObject([
      { size: "S", quantity: 2, available: 2 },
      { size: "M", quantity: 1, available: 1 },
    ]);
    expect(await setCartItemQuantity(userId, lines[0].id, 3)).toBe(false);
    expect(await setCartItemQuantity(userId, lines[0].id, 1)).toBe(true);
    expect(await setCartItemQuantity(userId, lines[1].id, 2)).toBe(false);
  });

  it("refuse a size that's sold out or doesn't exist", async () => {
    const userId = await createUser();
    const { variants } = await createSizedProduct([["S", 0]]);

    expect(await addCartItem(userId, variants.S, 1)).toBe(false);
    expect(await addCartItem(userId, 999_999, 1)).toBe(false);
    expect(await getCartVariant(999_999)).toBeUndefined();
    expect(await getCartVariant(variants.S)).toMatchObject({ label: "S", stock: 0 });
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

    const { lines, count, subtotal } = await getCart(userId);
    expect(lines).toMatchObject([
      { id: archivedLine, product: null, name: "Saved name", available: 0, maxQuantity: 0, lineTotal: 0 },
      { id: keptLine, available: 1 },
    ]);
    expect(count).toBe(1);
    expect(subtotal).toBe(1000);

    expect(await getCartVariant(variantA)).toBeUndefined();
    expect(await addCartItem(userId, variantA, 1)).toBe(false);
    expect(await setCartItemQuantity(userId, archivedLine, 1)).toBe(false);
    // Stock dropping below the saved quantity doesn't touch an archived product's line.
    await setStock(a, 1);
    expect(await reconcileCart(userId)).toEqual(new Set());
    expect(await getCartQuantities(userId)).toEqual({ [archivedLine]: 2, [keptLine]: 1 });

    await setStock(a, 5);
    await setProductArchived(a, false);
    expect((await getCart(userId)).lines[0]).toMatchObject({ id: archivedLine, available: 2, product: { id: a } });
    expect(await addCartItem(userId, variantA, 1)).toBe(true);
  });
});
