// Product and category queries for the storefront. Server-only: this module imports the database
// client. Archived products are left out everywhere, as if they didn't exist.
import { and, asc, desc, eq, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
import { categories, products, productVariants } from "@/db/schema";

/** A size the product is sold in, with its own stock. One-size products have one, labelled null. */
export type ProductVariant = {
  id: number;
  /** Null for the one variant of a one-size product. */
  label: string | null;
  /** 0 means this size is sold out. */
  stock: number;
};

export type Product = {
  id: number;
  slug: string;
  sku: string;
  name: string;
  category: { slug: string; name: string };
  /** Price in KES cents (whole shillings). */
  price: number;
  /** Units in stock across all sizes (the sum of `variants`). 0 means sold out. */
  stock: number;
  /** The sizes in display order, or one variant with a null label for a one-size product. */
  variants: ProductVariant[];
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
  variants: ProductVariant[];
};

const withCategory = {
  category: { columns: { slug: true, name: true } },
  variants: {
    columns: { id: true, label: true, stock: true },
    // Not readonly (`as const` would make it so), which the query's types require.
    orderBy: [asc(productVariants.position), asc(productVariants.id)] as SQL[],
  },
} as const;

const onSale = isNull(products.archivedAt);

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    category: row.category,
    price: row.price,
    stock: row.variants.reduce((sum, variant) => sum + variant.stock, 0),
    variants: row.variants,
    image: row.image,
    altImage: row.altImage ?? undefined,
    gallery: row.gallery,
    description: row.description,
    details: row.details,
    badge: row.badge ?? undefined,
  };
}

export async function getProductSlugs() {
  const rows = await db.select({ slug: products.slug }).from(products).where(onSale);
  return rows.map((row) => row.slug);
}

/** Deduplicated per request, so metadata and the page share one query. */
export const getProductBySlug = cache(async (slug: string) => {
  const row = await db.query.products.findFirst({
    where: and(eq(products.slug, slug), onSale),
    with: withCategory,
  });
  return row ? toProduct(row) : undefined;
});

export async function getNewArrivals(limit = 8) {
  const rows = await db.query.products.findMany({
    where: onSale,
    with: withCategory,
    orderBy: [desc(products.createdAt), desc(products.id)],
    limit,
  });
  return rows.map(toProduct);
}

/** Same-category products first, then the rest, excluding the product itself. */
export async function getRelatedProducts(product: Product, limit = 4) {
  const rows = await db.query.products.findMany({
    where: and(ne(products.id, product.id), onSale),
    with: withCategory,
    orderBy: (p) => [
      sql`${p.categoryId} = (select id from categories where slug = ${product.category.slug}) desc`,
      desc(p.createdAt),
      desc(p.id),
    ],
    limit,
  });
  return rows.map(toProduct);
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
    where: and(eq(products.categoryId, categoryId), onSale),
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
