// Admin category queries and writes. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers (the admin Server Functions) call `requireAdmin` first.
// A category is deleted only once no product uses it (`on delete restrict`) and the store's static
// content doesn't link to it.
import { and, asc, eq, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, products } from "@/db/schema";
import type { CategoryField, CategoryInput } from "@/lib/admin/product-input";
import type { SaveResult } from "@/lib/admin/products";
import { linkedCategorySlugs } from "@/lib/catalog";
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

export type DeleteCategoryResult = { ok: true } | { ok: false; reason: "not-found" | "in-use" | "linked" };

/**
 * Deletes a category no product uses, on sale or archived, and that the store's menu, hero and
 * collections don't link to. A product added to it meanwhile makes the delete fail (`restrict`).
 */
export async function deleteCategory(id: number): Promise<DeleteCategoryResult> {
  const linked = [...linkedCategorySlugs()];
  try {
    const rows = await db
      .delete(categories)
      .where(
        and(
          eq(categories.id, id),
          notInArray(categories.slug, linked),
          sql`not exists (select 1 from ${products} where ${products.categoryId} = ${categories.id})`,
        ),
      )
      .returning({ id: categories.id });
    if (rows.length > 0) return { ok: true };
  } catch (error) {
    const { code, constraint } = pgError(error);
    if (code === "23503" && constraint === "products_category_id_categories_id_fk") return { ok: false, reason: "in-use" };
    throw error;
  }

  const category = await getAdminCategory(id);
  if (!category) return { ok: false, reason: "not-found" };
  return { ok: false, reason: linked.includes(category.slug) ? "linked" : "in-use" };
}
