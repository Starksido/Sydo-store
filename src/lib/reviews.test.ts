// Runs against the test database only (see tests/test-env.ts). Sessions are mocked for the Server
// Functions: who can review, one review per user, hiding, and the averages.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveReviewAction } from "@/app/(store)/products/actions";
import { setReviewHiddenAction } from "@/app/admin/reviews/actions";
import { db } from "@/db";
import { products, reviews, user } from "@/db/schema";
import {
  canReview,
  getOwnReview,
  getReviewSummary,
  listAdminReviews,
  listReviews,
  saveReview,
  setReviewHidden,
} from "@/lib/reviews";
import { requireAdmin, requireSession } from "@/lib/session";

import { createProduct, createUser, resetCatalog } from "../../tests/fixtures";
import { createOrder, setOrderStatus } from "../../tests/orders";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

beforeEach(resetCatalog);

afterEach(() => {
  vi.clearAllMocks();
});

const review = { rating: 4, title: "Lovely", body: "Fits well." };

/** A user with a delivered order of `productId`. */
async function buyer(productId: number, name?: string) {
  const userId = await createUser();
  if (name) await db.update(user).set({ name }).where(eq(user.id, userId));
  await setOrderStatus(await createOrder(userId, [[productId, 1]]), "delivered");
  return userId;
}

describe("who can review", () => {
  it("only a user whose order of the product was delivered", async () => {
    const [a, b] = [await createProduct(5), await createProduct(5)];
    const pending = await createUser();
    await createOrder(pending, [[a, 1]]);
    const shipped = await createUser();
    await setOrderStatus(await createOrder(shipped, [[a, 1]]), "shipped");
    const otherProduct = await buyer(b);
    const stranger = await createUser();
    const delivered = await buyer(a);

    for (const userId of [pending, shipped, otherProduct, stranger]) {
      expect(await canReview(userId, a)).toBe(false);
      expect(await saveReview(userId, a, review)).toBe(false);
    }
    expect(await db.$count(reviews)).toBe(0);

    expect(await canReview(delivered, a)).toBe(true);
    expect(await saveReview(delivered, a, review)).toBe(true);
    expect(await getOwnReview(delivered, a)).toMatchObject({ ...review, hiddenAt: null });
  });

  it("keeps one review per user and product: a second save edits it", async () => {
    const a = await createProduct(5);
    const userId = await buyer(a);

    await saveReview(userId, a, review);
    await saveReview(userId, a, { rating: 2, title: "Changed my mind", body: "" });

    expect(await db.select({ rating: reviews.rating, title: reviews.title }).from(reviews)).toEqual([
      { rating: 2, title: "Changed my mind" },
    ]);
  });

  it("rejects ratings outside 1–5 and overlong text at the database too", async () => {
    const a = await createProduct(5);
    const userId = await buyer(a);
    await expect(saveReview(userId, a, { ...review, rating: 6 })).rejects.toThrow("invalid rating");
    await expect(saveReview(userId, a, { ...review, title: "x".repeat(121) })).rejects.toThrow();
    await expect(saveReview(userId, a, { ...review, title: "" })).rejects.toThrow();
  });
});

describe("reviews on the product page", () => {
  it("average and list only visible reviews, newest first, with first names", async () => {
    const a = await createProduct(5);
    const [wanjiku, otieno, hidden] = [
      await buyer(a, "Wanjiku Kamau"),
      await buyer(a, "Otieno"),
      await buyer(a, "Hidden Person"),
    ];
    await saveReview(wanjiku, a, { ...review, rating: 5 });
    await saveReview(otieno, a, { ...review, rating: 4 });
    await saveReview(hidden, a, { ...review, rating: 1 });
    const [hiddenRow] = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.userId, hidden));
    const admin = await createUser();
    await setReviewHidden(hiddenRow.id, true, admin);

    expect(await getReviewSummary(a)).toEqual({ count: 2, average: 4.5 });
    const { reviews: listed, hasMore } = await listReviews(a);
    expect(listed.map((r) => r.author)).toEqual(["Otieno", "Wanjiku"]);
    expect(hasMore).toBe(false);
    expect((await listReviews(a, { pageSize: 1 })).hasMore).toBe(true);
    expect(await getReviewSummary(await createProduct(1))).toEqual({ count: 0, average: null });

    // Editing a hidden review keeps it hidden.
    await saveReview(hidden, a, { ...review, rating: 5 });
    expect(await getReviewSummary(a)).toEqual({ count: 2, average: 4.5 });
  });
});

describe("hiding reviews", () => {
  it("hides and shows, keeping the first hide, and lists hidden ones for admins", async () => {
    const a = await createProduct(5);
    const [slug] = (await db.select({ slug: products.slug }).from(products).where(eq(products.id, a))).map((r) => r.slug);
    await saveReview(await buyer(a), a, review);
    const [{ id }] = await db.select({ id: reviews.id }).from(reviews);
    const [first, second] = [await createUser(), await createUser()];

    expect(await setReviewHidden(id, true, first)).toBe(slug);
    const [{ hiddenAt }] = await db.select({ hiddenAt: reviews.hiddenAt }).from(reviews);
    await setReviewHidden(id, true, second);
    expect(await db.select({ hiddenAt: reviews.hiddenAt, hiddenBy: reviews.hiddenBy }).from(reviews)).toEqual([
      { hiddenAt, hiddenBy: first },
    ]);
    expect((await listAdminReviews()).reviews).toMatchObject([{ id, hiddenAt: expect.any(Date), product: { id: a } }]);

    await setReviewHidden(id, false, first);
    expect(await db.select({ hiddenAt: reviews.hiddenAt, hiddenBy: reviews.hiddenBy }).from(reviews)).toEqual([
      { hiddenAt: null, hiddenBy: null },
    ]);
    expect(await setReviewHidden(999_999, true, first)).toBeNull();
  });
});

describe("review Server Functions", () => {
  it("publish a verified buyer's review and refresh the product page, explaining refusals", async () => {
    const a = await createProduct(5);
    const [{ slug }] = await db.select({ slug: products.slug }).from(products).where(eq(products.id, a));
    const form = (fields: Record<string, string>) => {
      const data = new FormData();
      for (const [key, value] of Object.entries({ rating: "5", title: "Great", body: "", ...fields })) data.set(key, value);
      return data;
    };
    const idle = { status: "idle" } as const;

    const stranger = await createUser();
    vi.mocked(requireSession).mockResolvedValue({ user: { id: stranger } } as Awaited<ReturnType<typeof requireSession>>);
    expect(await saveReviewAction(slug, idle, form({}))).toMatchObject({
      status: "error",
      message: "Only customers whose order of this piece has been delivered can review it.",
    });

    const userId = await buyer(a);
    vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as Awaited<ReturnType<typeof requireSession>>);
    expect(await saveReviewAction(slug, idle, form({ rating: "0", title: " " }))).toMatchObject({
      status: "error",
      errors: { rating: expect.any(String), title: expect.any(String) },
    });
    expect(revalidatePath).not.toHaveBeenCalled();

    expect(await saveReviewAction(slug, idle, form({ body: "  Soft and warm.  " }))).toEqual({ status: "saved" });
    expect(await getOwnReview(userId, a)).toMatchObject({ rating: 5, title: "Great", body: "Soft and warm." });
    expect(revalidatePath).toHaveBeenCalledWith(`/products/${slug}`);
    expect(await saveReviewAction("no-such-product", idle, form({}))).toMatchObject({
      message: "This product is unavailable.",
    });
  });

  it("let only admins hide reviews", async () => {
    const a = await createProduct(5);
    await saveReview(await buyer(a), a, review);
    const [{ id }] = await db.select({ id: reviews.id }).from(reviews);

    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("NOT_FOUND"));
    await expect(setReviewHiddenAction(id, true, 1)).rejects.toThrow("NOT_FOUND");
    expect((await db.select({ hiddenAt: reviews.hiddenAt }).from(reviews))[0].hiddenAt).toBeNull();

    const admin = await createUser();
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: admin } } as Awaited<ReturnType<typeof requireAdmin>>);
    await expect(setReviewHiddenAction(id, true, 2)).rejects.toThrow(`REDIRECT /admin/reviews?page=2&saved=hidden#review-${id}`);
    await expect(setReviewHiddenAction(999_999, true, 1)).rejects.toThrow("NOT_FOUND");
    await expect(setReviewHiddenAction(id, "yes", 1)).rejects.toThrow("NOT_FOUND");
  });
});
