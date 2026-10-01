// Wishlist queries and writes. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers check the session first. Archived products stay saved
// but are left out (they come back on unarchive), like in the bag.
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { products, wishlistItems } from "@/db/schema";
import { getProductsByIds, type Product } from "@/lib/products";

/** Whether the user saved the product. */
export async function isWishlisted(userId: string, productId: number) {
  const rows = await db
    .select({ id: wishlistItems.id })
    .from(wishlistItems)
    .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)));
  return rows.length > 0;
}

/**
 * Saves or unsaves a product; repeating either is a no-op. Saving needs the product on sale (not
 * archived). Returns whether it's saved afterwards, or null if there's no such product on sale.
 */
export async function setWishlisted(userId: string, productId: number, saved: boolean) {
  if (!saved) {
    await db
      .delete(wishlistItems)
      .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)));
    return false;
  }
  const { rows } = await db.execute<{ on_sale: boolean }>(sql`
    with p as (
      select id from products where id = ${productId}::int and archived_at is null
    ),
    added as (
      insert into wishlist_items (user_id, product_id)
      select ${userId}, id from p
      on conflict (user_id, product_id) do nothing
    )
    select exists (select 1 from p) as on_sale
  `);
  return rows[0].on_sale ? true : null;
}

/** The user's saved products on sale, most recently saved first. */
export async function listWishlist(userId: string): Promise<Product[]> {
  const rows = await db
    .select({ productId: wishlistItems.productId })
    .from(wishlistItems)
    .innerJoin(products, and(eq(products.id, wishlistItems.productId), isNull(products.archivedAt)))
    .where(eq(wishlistItems.userId, userId))
    .orderBy(desc(wishlistItems.createdAt), desc(wishlistItems.id));
  return getProductsByIds(rows.map((row) => row.productId));
}
