// Runs against the test database only (see tests/test-env.ts).
import { beforeEach, describe, expect, it } from "vitest";

import { setProductArchived } from "@/lib/admin/products";
import { addCartItem, getCart, getCartProduct, reconcileCart, setCartItemQuantity } from "@/lib/cart";

import { createCartLine, createProduct, createUser, getCartQuantities, resetCatalog, setStock } from "../../tests/fixtures";

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

  it("shares stock across sizes in line order", async () => {
    const userId = await createUser();
    const a = await createProduct(10);
    const m = await createCartLine(userId, a, 2, "M");
    const l = await createCartLine(userId, a, 3, "L");
    await setStock(a, 4);

    expect(await reconcileCart(userId)).toEqual(new Set([l]));
    expect(await getCartQuantities(userId)).toEqual({ [m]: 2, [l]: 2 });
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

  it("gives a size nothing when the product's other sizes in the bag hold all its stock", async () => {
    const userId = await createUser();
    const a = await createProduct(5);
    const m = await createCartLine(userId, a, 2, "M");
    const l = await createCartLine(userId, a, 1, "L");
    await setStock(a, 2);

    expect(await reconcileCart(userId)).toEqual(new Set());
    expect(await getCartQuantities(userId)).toEqual({ [m]: 2, [l]: 1 });

    // The bag shows "Already in your bag in another size" for this: nothing available, stock left.
    const { lines } = await getCart(userId);
    expect(lines[1]).toMatchObject({ id: l, available: 0, product: { stock: 2 } });
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

describe("archived products in the cart", () => {
  it("show as no longer available, can't be added or raised, and come back when unarchived", async () => {
    const userId = await createUser();
    const a = await createProduct(5);
    const b = await createProduct(5);
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

    expect(await getCartProduct(a)).toBeUndefined();
    expect(await addCartItem(userId, a, null, 1)).toBe(false);
    expect(await setCartItemQuantity(userId, archivedLine, 1)).toBe(false);
    // Stock dropping below the saved quantity doesn't touch an archived product's line.
    await setStock(a, 1);
    expect(await reconcileCart(userId)).toEqual(new Set());
    expect(await getCartQuantities(userId)).toEqual({ [archivedLine]: 2, [keptLine]: 1 });

    await setStock(a, 5);
    await setProductArchived(a, false);
    expect((await getCart(userId)).lines[0]).toMatchObject({ id: archivedLine, available: 2, product: { id: a } });
    expect(await addCartItem(userId, a, null, 1)).toBe(true);
  });
});
