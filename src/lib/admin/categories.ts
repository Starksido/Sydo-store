// Admin category queries and writes. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers (the admin Server Functions) call `requireAdmin` first.
// Categories can't be deleted: every product needs one (`on delete restrict`).
import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, products } from "@/db/schema";
import type { CategoryField, CategoryInput } from "@/lib/admin/product-input";
import type { SaveResult } from "@/lib/admin/products";
import { pgError } from "@/lib/pg-error";

/** All categories in display order, with how many of their products are on sale and archived. */
export async function listAdminCategories() {
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      image: categories.image,
      position: categories.position,
      activeProducts: sql<number>`count(${products.id}) filter (where ${products.archivedAt} is null)`.mapWith(Number),
      archivedProducts: sql<number>`count(${products.id}) filter (where ${products.archivedAt} is not null)`.mapWith(
        Number,
      ),
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.position), asc(categories.id));
}

export type AdminCategoryListItem = Awaited<ReturnType<typeof listAdminCategories>>[number];

export async function getAdminCategory(id: number) {
  return db.query.categories.findFirst({ where: eq(categories.id, id) });
}

function slugTaken(error: unknown) {
  const { code, constraint } = pgError(error);
  return code === "23505" && constraint === "categories_slug_unique";
}

const SLUG_TAKEN = { slug: "Another category already uses this slug." };

export async function createCategory(input: CategoryInput): Promise<SaveResult<CategoryField>> {
  try {
    const [row] = await db.insert(categories).values(input).returning({ id: categories.id });
    return { ok: true, id: row.id };
  } catch (error) {
    if (slugTaken(error)) return { ok: false, errors: SLUG_TAKEN };
    throw error;
  }
}

/** Undefined if there's no such category. */
export async function updateCategory(id: number, input: CategoryInput): Promise<SaveResult<CategoryField> | undefined> {
  try {
    const [row] = await db.update(categories).set(input).where(eq(categories.id, id)).returning({ id: categories.id });
    return row ? { ok: true, id: row.id } : undefined;
  } catch (error) {
    if (slugTaken(error)) return { ok: false, errors: SLUG_TAKEN };
    throw error;
  }
}
