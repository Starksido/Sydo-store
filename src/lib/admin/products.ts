// Admin product queries and writes. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers (the admin Server Functions) call `requireAdmin` first.
// Nothing here changes stock; that stays in `@/lib/stock`.
import { and, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { categories, products } from "@/db/schema";
import type { FieldErrors, ProductField, ProductInput } from "@/lib/admin/product-input";
import { pgError } from "@/lib/pg-error";

export type ProductStatusFilter = "active" | "archived" | "all";

export const ADMIN_PRODUCTS_PAGE_SIZE = 20;

export type SaveResult<F extends string> = { ok: true; id: number } | { ok: false; errors: FieldErrors<F> };

/** `%` and `_` match literally in a search, instead of as wildcards. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** One page of products, newest first, filtered by name/SKU search, category and status. */
export async function listAdminProducts({
  q = "",
  categoryId,
  status = "active",
  page = 1,
  pageSize = ADMIN_PRODUCTS_PAGE_SIZE,
}: {
  q?: string;
  categoryId?: number;
  status?: ProductStatusFilter;
  page?: number;
  pageSize?: number;
} = {}) {
  const conditions: (SQL | undefined)[] = [];
  const search = q.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push(or(ilike(products.name, pattern), ilike(products.sku, pattern)));
  }
  if (categoryId) conditions.push(eq(products.categoryId, categoryId));
  if (status === "active") conditions.push(isNull(products.archivedAt));
  if (status === "archived") conditions.push(isNotNull(products.archivedAt));

  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      sku: products.sku,
      name: products.name,
      image: products.image,
      price: products.price,
      stock: products.stock,
      archivedAt: products.archivedAt,
      category: { id: categories.id, name: categories.name },
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { products: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

export type AdminProductListItem = Awaited<ReturnType<typeof listAdminProducts>>["products"][number];

/** Every field of the product, archived or not, with its category's slug and name. */
export async function getAdminProduct(id: number) {
  return db.query.products.findFirst({
    where: eq(products.id, id),
    with: { category: { columns: { slug: true, name: true } } },
  });
}

export type AdminProduct = NonNullable<Awaited<ReturnType<typeof getAdminProduct>>>;

/** Products on sale and archived, for the overview. */
export async function countAdminProducts() {
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${products.archivedAt} is null)`.mapWith(Number),
      archived: sql<number>`count(*) filter (where ${products.archivedAt} is not null)`.mapWith(Number),
    })
    .from(products);
  return row;
}

/** A duplicate slug or SKU, or a category that no longer exists, as an error on that field. */
function fieldErrorFor(error: unknown): FieldErrors<ProductField> | undefined {
  const { code, constraint } = pgError(error);
  if (code === "23505" && constraint === "products_slug_unique") {
    return { slug: "Another product already uses this slug." };
  }
  if (code === "23505" && constraint === "products_sku_unique") {
    return { sku: "Another product already uses this SKU." };
  }
  if (code === "23503" && constraint === "products_category_id_categories_id_fk") {
    return { categoryId: "That category no longer exists. Choose another." };
  }
}

/** Creates a product with no stock (stock is added separately). */
export async function createProduct(input: ProductInput): Promise<SaveResult<ProductField>> {
  try {
    const [row] = await db.insert(products).values(input).returning({ id: products.id });
    return { ok: true, id: row.id };
  } catch (error) {
    const errors = fieldErrorFor(error);
    if (errors) return { ok: false, errors };
    throw error;
  }
}

/** Updates everything but stock. Undefined if there's no such product. */
export async function updateProduct(id: number, input: ProductInput): Promise<SaveResult<ProductField> | undefined> {
  try {
    const [row] = await db.update(products).set(input).where(eq(products.id, id)).returning({ id: products.id });
    return row ? { ok: true, id: row.id } : undefined;
  } catch (error) {
    const errors = fieldErrorFor(error);
    if (errors) return { ok: false, errors };
    throw error;
  }
}

/**
 * Archives (hides from the storefront, carts and checkout) or unarchives a product. Archiving an
 * archived product keeps its original time. Returns false if there's no such product.
 */
export async function setProductArchived(id: number, archived: boolean) {
  const rows = await db
    .update(products)
    .set({ archivedAt: archived ? sql`coalesce(${products.archivedAt}, now())` : null })
    .where(eq(products.id, id))
    .returning({ id: products.id });
  return rows.length > 0;
}
