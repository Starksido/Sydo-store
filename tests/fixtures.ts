// Test data helpers. Import only from test files: `tests/setup.ts` has already pointed `@/db` at
// the test database.
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { cartItems, carts, categories, products, user } from "@/db/schema";

import { assertTestDatabaseName } from "./test-env";

/** Empties the catalog, carts, orders, payments and users. Re-checks the server-side database name before truncating. */
export async function resetCatalog() {
  const { rows } = await db.execute<{ name: string }>(sql`select current_database() as name`);
  assertTestDatabaseName(rows[0].name);
  await db.execute(
    sql`truncate payments, order_items, orders, cart_items, carts, products, categories, "user" restart identity cascade`,
  );
}

/** Creates a product (in its own category) with the given stock and returns its id. */
export async function createProduct(stock: number, price = 1000) {
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
      price,
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

export async function setStock(productId: number, stock: number) {
  await db.update(products).set({ stock }).where(eq(products.id, productId));
}

/** Creates a user and returns its id. */
export async function createUser() {
  const id = randomUUID();
  await db.insert(user).values({ id, name: `Test user ${id.slice(0, 8)}`, email: `${id}@example.com` });
  return id;
}

/**
 * Writes a cart line directly, without the stock check in `addCartItem`, so tests can set up carts
 * that stock no longer covers. Returns the line id.
 */
export async function createCartLine(userId: string, productId: number, quantity: number, size: string | null = null) {
  const [cart] = await db
    .insert(carts)
    .values({ userId })
    .onConflictDoUpdate({ target: carts.userId, set: { updatedAt: sql`now()` } })
    .returning({ id: carts.id });
  const [line] = await db
    .insert(cartItems)
    .values({ cartId: cart.id, productId, productName: "Saved name", size, quantity })
    .returning({ id: cartItems.id });
  return line.id;
}

/** Saved quantities by line id for the user's cart. */
export async function getCartQuantities(userId: string) {
  const rows = await db
    .select({ id: cartItems.id, quantity: cartItems.quantity })
    .from(cartItems)
    .innerJoin(carts, eq(cartItems.cartId, carts.id))
    .where(eq(carts.userId, userId));
  return Object.fromEntries(rows.map((row) => [row.id, row.quantity]));
}
