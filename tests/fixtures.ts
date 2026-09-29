// Test data helpers. Import only from test files: `tests/setup.ts` has already pointed `@/db` at
// the test database.
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, products } from "@/db/schema";

import { assertTestDatabaseName } from "./test-env";

/** Empties the catalog and carts. Re-checks the server-side database name before truncating. */
export async function resetCatalog() {
  const { rows } = await db.execute<{ name: string }>(sql`select current_database() as name`);
  assertTestDatabaseName(rows[0].name);
  await db.execute(sql`truncate cart_items, carts, products, categories restart identity cascade`);
}

/** Creates a product (in its own category) with the given stock and returns its id. */
export async function createProduct(stock: number) {
  const key = randomUUID().slice(0, 8);
  const [category] = await db
    .insert(categories)
    .values({ slug: `test-category-${key}`, name: `Test category ${key}` })
    .returning({ id: categories.id });
  const [product] = await db
    .insert(products)
    .values({
      categoryId: category.id,
      slug: `test-product-${key}`,
      sku: `TEST-${key}`,
      name: `Test product ${key}`,
      description: "Test product",
      price: 1000,
      stock,
      image: "https://example.com/test.jpg",
    })
    .returning({ id: products.id });
  return product.id;
}

export async function getStock(productId: number) {
  const [row] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, productId));
  return row?.stock;
}
