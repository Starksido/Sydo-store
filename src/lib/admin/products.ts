// Admin product queries and writes. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers (the admin Server Functions) call `requireAdmin` first.
// Nothing here changes stock; that stays in `@/lib/stock`. Sizes (variants) are created, renamed,
// reordered and removed with the product, here.
import { and, asc, desc, eq, ilike, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { categories, products, productVariants } from "@/db/schema";
import type { FieldErrors, ProductField, ProductInput } from "@/lib/admin/product-input";
import { LOW_STOCK_THRESHOLD } from "@/lib/catalog";
import { pgError } from "@/lib/pg-error";

export type ProductStatusFilter = "active" | "archived" | "all";

export const ADMIN_PRODUCTS_PAGE_SIZE = 20;

export type SaveResult<F extends string> = { ok: true; id: number } | { ok: false; errors: FieldErrors<F> };

/** A product's total stock: the sum over its sizes. */
const totalStock = sql<number>`(
  select coalesce(sum(v.stock), 0) from product_variants v where v.product_id = ${products.id}
)::int`.mapWith(Number);

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
      stock: totalStock,
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

/**
 * Every field of the product, archived or not, with its category's slug and name, its sizes
 * (variants) in display order and its total stock.
 */
export async function getAdminProduct(id: number) {
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      category: { columns: { slug: true, name: true } },
      variants: {
        columns: { id: true, label: true, stock: true },
        orderBy: [asc(productVariants.position), asc(productVariants.id)],
      },
    },
  });
  if (!product) return undefined;
  return { ...product, stock: product.variants.reduce((sum, variant) => sum + variant.stock, 0) };
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

/**
 * Two sizes that clash within one save, e.g. swapping names: the unique index on labels is checked
 * row by row. Rare, so the admin is asked to save in two steps.
 */
function sizeClashError(error: unknown): FieldErrors<ProductField> | undefined {
  const { code, constraint } = pgError(error);
  if (code === "23505" && constraint === "product_variants_label_unique") {
    return {
      sizes: "These size changes clash with each other (e.g. two sizes swapping names). Save them in two steps.",
    };
  }
}

/**
 * Creates a product with its sizes (or its one variant, for a one-size item), all with no stock
 * (stock is added separately), in one statement.
 */
export async function createProduct({ sizes, ...fields }: ProductInput): Promise<SaveResult<ProductField>> {
  const labels = sizes.length > 0 ? sizes.map((size) => size.label) : [null];
  try {
    const { rows } = await db.execute<{ id: number }>(sql`
      with p as (
        ${db.insert(products).values(fields).returning({ id: products.id }).getSQL()}
      ),
      v as (
        insert into product_variants (product_id, label, position)
        select p.id, s.label, (s.ord - 1)::int
        from p, jsonb_array_elements_text(${JSON.stringify(labels)}::jsonb) with ordinality as s(label, ord)
        returning id
      )
      select id from p
    `);
    return { ok: true, id: rows[0].id };
  } catch (error) {
    const errors = fieldErrorFor(error) ?? sizeClashError(error);
    if (errors) return { ok: false, errors };
    throw error;
  }
}

/**
 * Updates everything but stock, and makes the product's sizes match `sizes` in one statement: sizes
 * with an id are renamed and reordered, new ones are added with no stock, and missing ones are
 * removed, but only while their stock is 0 (otherwise nothing is saved). A new size named like a
 * removed one keeps it (and its stock). A one-size item has one variant with a null label, so adding
 * sizes to it removes that variant, and removing every size adds it back. Undefined if there's no
 * such product.
 */
export async function updateProduct(
  id: number,
  { sizes, ...fields }: ProductInput,
): Promise<SaveResult<ProductField> | undefined> {
  const wanted = JSON.stringify(sizes.length > 0 ? sizes : [{ id: null, label: null }]);
  let rows: { updated: number; blocked: { label: string | null; stock: number }[] | null }[];
  try {
    ({ rows } = await db.execute<(typeof rows)[number]>(sql`
      with locked as (
        select id, label, stock from product_variants
        where product_id = ${id}::int
        order by id
        for update
      ),
      want as (
        select (e->>'id')::int as given_id, e->>'label' as label, (ord - 1)::int as position
        from jsonb_array_elements(${wanted}::jsonb) with ordinality as t(e, ord)
      ),
      -- Each wanted size's variant: its own id if it's one of this product's, else a variant with the
      -- same label that no other row claims, else none (a new size).
      resolved as (
        select coalesce(
          (select l.id from locked l where l.id = w.given_id),
          (select l.id from locked l
            where coalesce(lower(l.label), '') = coalesce(lower(w.label), '')
              and l.id not in (select given_id from want where given_id is not null)
            limit 1)
        ) as id, w.label, w.position
        from want w
      ),
      removed as (
        select l.id, l.label, l.stock from locked l
        where l.id not in (select id from resolved where id is not null)
      ),
      blocked as (
        select label, stock from removed where stock > 0
      ),
      upd as (
        ${db
          .update(products)
          .set(fields)
          .where(and(eq(products.id, id), sql`not exists (select 1 from blocked)`))
          .returning({ id: products.id })
          .getSQL()}
      ),
      gone as (
        delete from product_variants
        where id in (select id from removed) and exists (select 1 from upd)
        returning id
      ),
      kept as (
        update product_variants v
        set label = r.label, position = r.position
        from resolved r
        where v.id = r.id and exists (select 1 from upd)
        returning v.id
      ),
      added as (
        insert into product_variants (product_id, label, position)
        select ${id}::int, r.label, r.position
        from resolved r
        where r.id is null and exists (select 1 from upd)
        returning id
      )
      select (select count(*) from upd)::int as updated,
        (select json_agg(json_build_object('label', label, 'stock', stock) order by label) from blocked) as blocked
    `));
  } catch (error) {
    const errors = fieldErrorFor(error) ?? sizeClashError(error);
    if (errors) return { ok: false, errors };
    throw error;
  }

  const [row] = rows;
  if (row.updated > 0) return { ok: true, id };
  if (!row.blocked) return undefined;
  const oneSize = row.blocked.find((size) => size.label === null);
  const sized = row.blocked.filter((size) => size.label !== null);
  const list = sized.map((size) => `${size.label} (${size.stock})`).join(", ");
  return {
    ok: false,
    errors: {
      sizes: oneSize
        ? `It has ${oneSize.stock} in stock as a one-size item. Set its stock to 0 before adding sizes.`
        : `Set the stock of ${list} to 0 before removing ${sized.length === 1 ? "it" : "them"}.`,
    },
  };
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

/** Sizes (or one-size products) on sale with stock at or below `threshold`, lowest first. */
export async function listLowStockVariants(threshold = LOW_STOCK_THRESHOLD) {
  return db
    .select({
      variantId: productVariants.id,
      /** Null for a one-size product. */
      label: productVariants.label,
      stock: productVariants.stock,
      product: { id: products.id, name: products.name, sku: products.sku, image: products.image },
      category: { name: categories.name },
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(isNull(products.archivedAt), lte(productVariants.stock, threshold)))
    .orderBy(
      asc(productVariants.stock),
      asc(products.name),
      asc(products.id),
      asc(productVariants.position),
      asc(productVariants.id),
    );
}

/** Sizes (or one-size products) on sale that are sold out, and that are low but not out, for the overview. */
export async function countLowStockVariants(threshold = LOW_STOCK_THRESHOLD) {
  const [row] = await db
    .select({
      soldOut: sql<number>`count(*) filter (where ${productVariants.stock} = 0)`.mapWith(Number),
      low: sql<number>`count(*) filter (where ${productVariants.stock} > 0)`.mapWith(Number),
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(isNull(products.archivedAt), lte(productVariants.stock, threshold)));
  return row;
}

/** Whether any order holds the product. Ordered products stay archived; they can't be deleted. */
export async function isProductOrdered(id: number) {
  const { rows } = await db.execute<{ ordered: boolean }>(
    sql`select exists (select 1 from order_items where product_id = ${id}::int) as ordered`,
  );
  return rows[0].ordered;
}

export type DeleteProductResult = { ok: true } | { ok: false; reason: "not-found" | "not-archived" | "ordered" };

/**
 * Deletes an archived product that was never ordered, with its stock history, in one statement.
 * Its sizes go with it. Bags that held it show it as no longer available (`cart_items.product_id`
 * and `variant_id` are set null).
 * Checkout skips archived products, so no order can take it while this runs.
 */
export async function deleteProduct(id: number): Promise<DeleteProductResult> {
  const { rows } = await db.execute<{ id: number }>(sql`
    with gone as (
      delete from products p
      where p.id = ${id}::int and p.archived_at is not null
        and not exists (select 1 from order_items oi where oi.product_id = p.id)
      returning p.id
    ),
    history as (
      delete from stock_adjustments where product_id in (select id from gone)
    )
    select id from gone
  `);
  if (rows.length > 0) return { ok: true };

  const product = await db.query.products.findFirst({ where: eq(products.id, id), columns: { archivedAt: true } });
  if (!product) return { ok: false, reason: "not-found" };
  return { ok: false, reason: product.archivedAt ? "ordered" : "not-archived" };
}
