// Runs against the test database only (see tests/test-env.ts). The session and cookies are mocked:
// cart actions for guests (kept by the `cart` cookie) and for signed-in users.
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addToCart, removeFromCart, updateCartItem } from "@/app/(store)/cart/actions";
import { db } from "@/db";
import { carts } from "@/db/schema";
import { getCart } from "@/lib/cart";
import { getSession } from "@/lib/session";

import {
  createCartLine,
  createProduct,
  createUser,
  getCartQuantities,
  getVariantId,
  resetCatalog,
} from "../../../../tests/fixtures";

/** The request's cookies as the browser sent them, and what the action set. */
const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => jar.set(name, { value, options }),
  }),
}));

function signedOut() {
  vi.mocked(getSession).mockResolvedValue(null);
}

function signedInAs(userId: string) {
  vi.mocked(getSession).mockResolvedValue({ user: { id: userId } } as Awaited<ReturnType<typeof getSession>>);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

beforeEach(async () => {
  await resetCatalog();
  jar.clear();
  signedOut();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("guest bag", () => {
  it("is kept by a random httpOnly cookie whose hash, not the token, is stored", async () => {
    const variantId = await getVariantId(await createProduct(5));

    expect(await addToCart(variantId)).toEqual({ ok: true, count: 1 });

    const cookie = jar.get("cart")!;
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
    const rows = await db.select().from(carts);
    expect(rows).toEqual([expect.objectContaining({ userId: null, tokenHash: sha256(cookie.value) })]);

    // The same cookie finds the same bag.
    expect(await addToCart(variantId)).toEqual({ ok: true, count: 2 });
    expect(jar.get("cart")!.value).toBe(cookie.value);
    expect(await db.$count(carts)).toBe(1);
  });

  it("can change and remove its lines", async () => {
    const variantId = await getVariantId(await createProduct(5));
    await addToCart(variantId);
    const { lines } = await getCart({ tokenHash: sha256(jar.get("cart")!.value) });

    expect(await updateCartItem(lines[0].id, 3)).toEqual({ ok: true, count: 3 });
    expect(await updateCartItem(lines[0].id, 6)).toEqual({ ok: false, message: "Only 5 available." });
    expect(await removeFromCart(lines[0].id)).toEqual({ ok: true, count: 0 });
  });

  it("ignores a forged cookie, and can't touch another bag's lines", async () => {
    const variantId = await getVariantId(await createProduct(5));
    await addToCart(variantId);
    const theirs = jar.get("cart")!.value;
    const [line] = (await getCart({ tokenHash: sha256(theirs) })).lines;

    // A well-formed but unknown token: an empty bag, and nothing changes.
    jar.set("cart", { value: "A".repeat(43) });
    expect(await updateCartItem(line.id, 2)).toEqual({ ok: false, message: "This item is no longer in your bag." });
    expect(await removeFromCart(line.id)).toEqual({ ok: true, count: 0 });
    // A malformed one is ignored too, and an add replaces it with a fresh token.
    jar.set("cart", { value: "not-a-token" });
    expect(await updateCartItem(line.id, 2)).toEqual({ ok: false, message: "This item is no longer in your bag." });
    expect(await addToCart(variantId)).toEqual({ ok: true, count: 1 });
    expect(jar.get("cart")!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect((await getCart({ tokenHash: sha256(theirs) })).lines).toMatchObject([{ id: line.id, quantity: 1 }]);
  });
});

describe("the 99 limit", () => {
  it("says why an add is refused once a line holds 99", async () => {
    const userId = await createUser();
    signedInAs(userId);
    const productId = await createProduct(150);
    const variantId = await getVariantId(productId);
    await createCartLine(userId, productId, 99);

    expect(await addToCart(variantId)).toEqual({ ok: false, message: "You can have up to 99 of one size in your bag." });
  });
});

describe("signed-in bag", () => {
  it("uses the user's cart and sets no cookie", async () => {
    const userId = await createUser();
    signedInAs(userId);
    const productId = await createProduct(5);

    expect(await addToCart(await getVariantId(productId))).toEqual({ ok: true, count: 1 });

    expect(jar.has("cart")).toBe(false);
    expect(Object.values(await getCartQuantities(userId))).toEqual([1]);
    expect(await db.select({ userId: carts.userId }).from(carts).where(eq(carts.userId, userId))).toHaveLength(1);
  });
});
