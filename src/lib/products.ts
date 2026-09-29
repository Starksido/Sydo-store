// Product and category queries. Server-only: this module imports the database client.
import { asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
import { categories, products, type ProductSize } from "@/db/schema";

export type { ProductSize };

export type Product = {
  id: number;
  slug: string;
  sku: string;
  name: string;
  category: { slug: string; name: string };
  /** Price in cents (USD). */
  price: number;
  /** Units in stock across all sizes. 0 means sold out. */
  stock: number;
  /** Omitted for one-size items. */
  sizes?: ProductSize[];
  image: string;
  /** Optional second image, shown on hover in listings. */
  altImage?: string;
  /** Further images shown only on the product page. */
  gallery: string[];
  description: string;
  details: string[];
  badge?: string;
};

export type Category = {
  slug: string;
  name: string;
  image: string;
};

type ProductRow = typeof products.$inferSelect & {
  category: { slug: string; name: string };
};

const withCategory = { category: { columns: { slug: true, name: true } } } as const;

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    category: row.category,
    price: row.price,
    stock: row.stock,
    sizes: row.sizes ?? undefined,
    image: row.image,
    altImage: row.altImage ?? undefined,
    gallery: row.gallery,
    description: row.description,
    details: row.details,
    badge: row.badge ?? undefined,
  };
}

export async function getProductSlugs() {
  const rows = await db.select({ slug: products.slug }).from(products);
  return rows.map((row) => row.slug);
}

/** Deduplicated per request, so metadata and the page share one query. */
export const getProductBySlug = cache(async (slug: string) => {
  const row = await db.query.products.findFirst({
    where: eq(products.slug, slug),
    with: withCategory,
  });
  return row ? toProduct(row) : undefined;
});

export async function getNewArrivals(limit = 8) {
  const rows = await db.query.products.findMany({
    with: withCategory,
    orderBy: [desc(products.createdAt), desc(products.id)],
    limit,
  });
  return rows.map(toProduct);
}

/** Same-category products first, then the rest, excluding the product itself. */
export async function getRelatedProducts(product: Product, limit = 4) {
  const rows = await db
    .select({ product: products, category: { slug: categories.slug, name: categories.name } })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(ne(products.id, product.id))
    .orderBy(
      sql`${categories.slug} = ${product.category.slug} desc`,
      desc(products.createdAt),
      desc(products.id),
    )
    .limit(limit);
  return rows.map((row) => toProduct({ ...row.product, category: row.category }));
}

export async function getCategorySlugs() {
  const rows = await db.select({ slug: categories.slug }).from(categories);
  return rows.map((row) => row.slug);
}

/** Deduplicated per request, so metadata and the page share one query. */
export const getCategoryBySlug = cache(async (slug: string) => {
  return db.query.categories.findFirst({
    where: eq(categories.slug, slug),
    columns: { id: true, slug: true, name: true },
  });
});

/** Products in one category, newest first. */
export async function getCategoryProducts(categoryId: number) {
  const rows = await db.query.products.findMany({
    where: eq(products.categoryId, categoryId),
    with: withCategory,
    orderBy: [desc(products.createdAt), desc(products.id)],
  });
  return rows.map(toProduct);
}

/** Categories with a tile image, in display order. */
export async function getCategories(): Promise<Category[]> {
  const rows = await db
    .select({ slug: categories.slug, name: categories.name, image: categories.image })
    .from(categories)
    .where(isNotNull(categories.image))
    .orderBy(asc(categories.position), asc(categories.id));
  return rows.map((row) => ({ ...row, image: row.image! }));
}
