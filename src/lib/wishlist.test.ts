// Runs against the test database only (see tests/test-env.ts). The session is mocked for the Server
// Functions: saving, archived products hidden, cascades, and moving a saved product to the bag.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { moveToBagAction, setWishlistedAction } from "@/app/(store)/account/wishlist/actions";
import { db } from "@/db";
import { products, user, wishlistItems } from "@/db/schema";
import { setProductArchived } from "@/lib/admin/products";
import { getSession, requireSession } from "@/lib/session";
import { isWishlisted, listWishlist, setWishlisted } from "@/lib/wishlist";

import {
  createProduct,
  createSizedProduct,
  createUser,
  getCartQuantities,
  resetCatalog,
} from "../../tests/fixtures";

// "Move to bag" goes through the bag's own action, which reads the session with getSession.
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(), getSession: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

beforeEach(resetCatalog);

afterEach(() => {
  vi.clearAllMocks();
});

function signedInAs(userId: string) {
  const session = { user: { id: userId } } as Awaited<ReturnType<typeof requireSession>>;
  vi.mocked(requireSession).mockResolvedValue(session);
  vi.mocked(getSession).mockResolvedValue(session);
}

describe("setWishlisted", () => {
  it("saves and unsaves, idempotently, newest first in the list", async () => {
    const userId = await createUser();
    const [a, b] = [await createProduct(1), await createProduct(1)];

    expect(await setWishlisted(userId, a, true)).toBe(true);
    expect(await setWishlisted(userId, b, true)).toBe(true);
    expect(await setWishlisted(userId, a, true)).toBe(true);
    await db.update(wishlistItems).set({ createdAt: new Date(Date.UTC(2026, 0, 1)) }).where(eq(wishlistItems.productId, a));
    expect((await listWishlist(userId)).map((p) => p.id)).toEqual([b, a]);

    expect(await setWishlisted(userId, a, false)).toBe(false);
    expect(await setWishlisted(userId, a, false)).toBe(false);
    expect(await isWishlisted(userId, a)).toBe(false);
    expect(await isWishlisted(userId, b)).toBe(true);
    // Another user's list is their own.
    expect(await listWishlist(await createUser())).toEqual([]);
  });

  it("refuses to save a product that's missing or archived, and hides archived ones until unarchived", async () => {
    const userId = await createUser();
    const a = await createProduct(1);
    await setWishlisted(userId, a, true);

    await setProductArchived(a, true);
    expect(await listWishlist(userId)).toEqual([]);
    const archived = await createProduct(1);
    await setProductArchived(archived, true);
    expect(await setWishlisted(userId, archived, true)).toBeNull();
    expect(await setWishlisted(userId, 999_999, true)).toBeNull();

    await setProductArchived(a, false);
    expect((await listWishlist(userId)).map((p) => p.id)).toEqual([a]);
  });

  it("goes with the product or the user", async () => {
    const [userId, other] = [await createUser(), await createUser()];
    const [a, b] = [await createProduct(1), await createProduct(1)];
    await setWishlisted(userId, a, true);
    await setWishlisted(other, b, true);

    await db.delete(products).where(eq(products.id, a));
    await db.delete(user).where(eq(user.id, other));

    expect(await db.select().from(wishlistItems)).toEqual([]);
  });
});

describe("wishlist Server Functions", () => {
  it("save for the signed-in user and reject bad input", async () => {
    const userId = await createUser();
    signedInAs(userId);
    const a = await createProduct(1);

    expect(await setWishlistedAction(a, true)).toEqual({ ok: true, saved: true });
    expect(await setWishlistedAction(a, false)).toEqual({ ok: true, saved: false });
    expect(await setWishlistedAction("1", true)).toEqual({ ok: false, message: "This product is unavailable." });
    expect(await setWishlistedAction(a, "yes")).toEqual({ ok: false, message: "This product is unavailable." });
    expect(requireSession).toHaveBeenCalledTimes(4);
  });

  it("move a one-size product to the bag and unsave it; sized or sold-out ones stay", async () => {
    const userId = await createUser();
    signedInAs(userId);
    const scarf = await createProduct(2);
    const soldOut = await createProduct(0);
    const { productId: coat } = await createSizedProduct([
      ["S", 1],
      ["M", 1],
    ]);
    for (const id of [scarf, soldOut, coat]) await setWishlisted(userId, id, true);

    expect(await moveToBagAction(scarf)).toEqual({ ok: true, count: 1 });
    expect(await isWishlisted(userId, scarf)).toBe(false);
    expect(Object.values(await getCartQuantities(userId))).toEqual([1]);

    expect(await moveToBagAction(soldOut)).toEqual({ ok: false, message: "This piece is sold out." });
    expect(await moveToBagAction(coat)).toEqual({ ok: false, message: "Choose a size on the product page." });
    expect(await moveToBagAction(999_999)).toEqual({ ok: false, message: "This product is unavailable." });
    expect(await isWishlisted(userId, soldOut)).toBe(true);
    expect(await isWishlisted(userId, coat)).toBe(true);
  });
});
