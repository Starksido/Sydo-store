// Runs against the test database only (see tests/test-env.ts).
import { beforeEach, describe, expect, it } from "vitest";

import { getCart, reconcileCart } from "@/lib/cart";

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
