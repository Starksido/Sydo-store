// Review queries and writes. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers check the session (or `requireAdmin`) first.
// Only verified buyers review: a user with a delivered order containing the product. Reviews are
// published straight away; hidden ones (by an admin) are left out of the product page and average.
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { products, reviews, user } from "@/db/schema";
import type { ReviewInput } from "@/lib/review-input";

export const REVIEWS_PAGE_SIZE = 10;

/** Whether the user has a delivered order containing the product. */
function deliveredTo(userId: string, productId: number) {
  return sql`exists (
    select 1 from orders o
    join order_items oi on oi.order_id = o.id
    where o.user_id = ${userId} and o.status = 'delivered' and oi.product_id = ${productId}::int
  )`;
}

/** Whether the user may write (or edit) a review of the product. */
export async function canReview(userId: string, productId: number) {
  const { rows } = await db.execute<{ ok: boolean }>(sql`select ${deliveredTo(userId, productId)} as ok`);
  return rows[0].ok;
}

/**
 * Writes the user's review of the product, or edits it, in one statement, only if they have a
 * delivered order containing it. An edit keeps a hidden review hidden. Returns false (writing
 * nothing) if they aren't eligible. Throws on invalid input.
 */
export async function saveReview(userId: string, productId: number, { rating, title, body }: ReviewInput) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("saveReview: invalid rating");
  const { rows } = await db.execute<{ id: number }>(sql`
    insert into reviews (product_id, user_id, rating, title, body)
    select ${productId}::int, ${userId}, ${rating}::int, ${title}, ${body}
    where ${deliveredTo(userId, productId)}
    on conflict (product_id, user_id) do update
    set rating = excluded.rating, title = excluded.title, body = excluded.body, updated_at = now()
    returning id
  `);
  return rows.length > 0;
}

/** The user's own review of the product, hidden or not, or null. */
export async function getOwnReview(userId: string, productId: number) {
  const [row] = await db
    .select({ rating: reviews.rating, title: reviews.title, body: reviews.body, hiddenAt: reviews.hiddenAt })
    .from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.productId, productId)));
  return row ?? null;
}

/** Average rating (rounded to one decimal) and count of the product's visible reviews. */
export async function getReviewSummary(productId: number) {
  const [row] = await db
    .select({
      count: count(),
      average: sql<number | null>`round(avg(${reviews.rating}), 1)`.mapWith((value) =>
        value === null ? null : Number(value),
      ),
    })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), isNull(reviews.hiddenAt)));
  return { count: row.count, average: row.count > 0 ? row.average : null };
}

/**
 * One page of the product's visible reviews, newest first, with the reviewer's first name only.
 * `hasMore` is true when another page exists.
 */
export async function listReviews(productId: number, { page = 1, pageSize = REVIEWS_PAGE_SIZE } = {}) {
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      createdAt: reviews.createdAt,
      name: user.name,
    })
    .from(reviews)
    .innerJoin(user, eq(user.id, reviews.userId))
    .where(and(eq(reviews.productId, productId), isNull(reviews.hiddenAt)))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return {
    reviews: rows.slice(0, pageSize).map(({ name, ...review }) => ({
      ...review,
      author: name.trim().split(/\s+/)[0] || "Customer",
    })),
    hasMore: rows.length > pageSize,
  };
}

export type ReviewListItem = Awaited<ReturnType<typeof listReviews>>["reviews"][number];

// ---------- Admin ----------

export const ADMIN_REVIEWS_PAGE_SIZE = 20;

/** One page of all reviews, hidden ones included, newest first, with product and author. */
export async function listAdminReviews({ page = 1, pageSize = ADMIN_REVIEWS_PAGE_SIZE } = {}) {
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      hiddenAt: reviews.hiddenAt,
      createdAt: reviews.createdAt,
      product: { id: products.id, name: products.name, slug: products.slug },
      author: { name: user.name, email: user.email },
    })
    .from(reviews)
    .innerJoin(products, eq(products.id, reviews.productId))
    .innerJoin(user, eq(user.id, reviews.userId))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { reviews: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

/**
 * Hides or shows a review. Hiding a hidden one keeps its first time and admin. Returns the product's
 * slug (to refresh its page), or null if there's no such review.
 */
export async function setReviewHidden(id: number, hidden: boolean, adminId: string) {
  const { rows } = await db.execute<{ slug: string }>(sql`
    update reviews r
    set hidden_at = case when ${hidden}::boolean then coalesce(r.hidden_at, now()) end,
      hidden_by = case when ${hidden}::boolean then coalesce(r.hidden_by, ${adminId}) end
    from products p
    where r.id = ${id}::int and p.id = r.product_id
    returning p.slug
  `);
  return rows[0]?.slug ?? null;
}
