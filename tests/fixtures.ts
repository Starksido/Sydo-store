// Test data helpers. Import only from test files: `tests/setup.ts` has already pointed `@/db` at
// the test database.
import { randomUUID } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { cartItems, carts, categories, products, productVariants, user } from "@/db/schema";

import { assertTestDatabaseName } from "./test-env";

/** Empties the catalog, stock adjustments, carts, wishlists, reviews, orders, payments, users and role changes. Re-checks the server-side database name before truncating. */
export async function resetCatalog() {
  const { rows } = await db.execute<{ name: string }>(sql`select current_database() as name`);
  assertTestDatabaseName(rows[0].name);
  await db.execute(
    sql`truncate role_changes, order_events, stock_adjustments, payments, order_items, orders, cart_items, carts, wishlist_items, reviews, product_variants, products, categories, "user" restart identity cascade`,
  );
}

/** Creates a one-size product (in its own category) with the given stock and returns its id. */
export async function createProduct(stock: number, price = 1000) {
  const productId = await insertProduct(price);
  await db.insert(productVariants).values({ productId, label: null, stock });
  return productId;
}

/**
 * Creates a product with sizes, given as [label, stock] in display order. Returns its id and each
 * size's variant id by label.
 */
export async function createSizedProduct(sizes: [string, number][], price = 1000) {
  const productId = await insertProduct(price);
  const rows = await db
    .insert(productVariants)
    .values(sizes.map(([label, stock], position) => ({ productId, label, stock, position })))
    .returning({ id: productVariants.id, label: productVariants.label });
  return { productId, variants: Object.fromEntries(rows.map((row) => [row.label!, row.id])) };
}

async function insertProduct(price: number) {
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
      image: "https://example.com/test.jpg",
    })
    .returning({ id: products.id });
  return product.id;
}

/** Creates a category and returns its id. */
export async function createCategory(name = `Category ${randomUUID().slice(0, 8)}`) {
  const [category] = await db
    .insert(categories)
    .values({ slug: `test-${randomUUID().slice(0, 8)}`, name })
    .returning({ id: categories.id });
  return category.id;
}

/** The variant id of a product's size, or of its one variant (`label` null) if it's one-size. */
export async function getVariantId(productId: number, label: string | null = null) {
  const [row] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, productId),
        label === null ? isNull(productVariants.label) : eq(productVariants.label, label),
      ),
    );
  if (!row) throw new Error(`getVariantId: product ${productId} has no size ${label}`);
  return row.id;
}

/** A product's total stock across its sizes; undefined if it has none (or doesn't exist). */
export async function getStock(productId: number) {
  const rows = await db
    .select({ stock: productVariants.stock })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));
  return rows.length > 0 ? rows.reduce((sum, row) => sum + row.stock, 0) : undefined;
}

export async function getVariantStock(variantId: number) {
  const [row] = await db
    .select({ stock: productVariants.stock })
    .from(productVariants)
    .where(eq(productVariants.id, variantId));
  return row?.stock;
}

/** Sets the stock of a one-size product, or of one size with `label`. */
export async function setStock(productId: number, stock: number, label: string | null = null) {
  await db
    .update(productVariants)
    .set({ stock })
    .where(eq(productVariants.id, await getVariantId(productId, label)));
}

/** Creates a user with a confirmed email (as every user who can sign in has) and returns its id. */
export async function createUser() {
  const id = randomUUID();
  await db
    .insert(user)
    .values({ id, name: `Test user ${id.slice(0, 8)}`, email: `${id}@example.com`, emailVerified: true });
  return id;
}

/**
 * Writes a cart line directly, without the stock check in `addCartItem`, so tests can set up carts
 * that stock no longer covers. The line points at the product's variant with that size label (null
 * for one-size); with no such variant, at none, as if the size had been removed. Returns the line id.
 */
export async function createCartLine(userId: string, productId: number, quantity: number, size: string | null = null) {
  const [variant] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, productId),
        size === null ? isNull(productVariants.label) : eq(productVariants.label, size),
      ),
    );
  const [cart] = await db
    .insert(carts)
    .values({ userId })
    .onConflictDoUpdate({ target: carts.userId, set: { updatedAt: sql`now()` } })
    .returning({ id: carts.id });
  const [line] = await db
    .insert(cartItems)
    .values({ cartId: cart.id, productId, variantId: variant?.id ?? null, productName: "Saved name", size, quantity })
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

/**
 * Writes a line into the guest cart of `tokenHash` (creating the cart), without stock checks, like
 * `createCartLine`. Returns the line id.
 */
export async function createGuestCartLine(tokenHash: string, productId: number, quantity: number, size: string | null = null) {
  const [cart] = await db
    .insert(carts)
    .values({ tokenHash })
    .onConflictDoUpdate({ target: carts.tokenHash, set: { updatedAt: sql`now()` } })
    .returning({ id: carts.id });
  const [variant] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, productId),
        size === null ? isNull(productVariants.label) : eq(productVariants.label, size),
      ),
    );
  const [line] = await db
    .insert(cartItems)
    .values({ cartId: cart.id, productId, variantId: variant?.id ?? null, productName: "Guest name", size, quantity })
    .returning({ id: cartItems.id });
  return line.id;
}
