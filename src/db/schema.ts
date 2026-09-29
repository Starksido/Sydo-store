// Drizzle table definitions live here.
// Better Auth's tables are generated into ./auth-schema.ts; after changing auth plugins, rerun:
//   npx auth generate --config src/lib/auth.ts --output src/db/auth-schema.ts --yes
import { relations, sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

export * from "./auth-schema";

export type ProductSize = {
  label: string;
  available: boolean;
};

export const categories = pgTable("categories", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  /** Tile image. Categories without one are left out of the home category grid. */
  image: text(),
  position: integer().notNull().default(0),
});

export const products = pgTable(
  "products",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    slug: text().notNull().unique(),
    sku: text().notNull().unique(),
    name: text().notNull(),
    description: text().notNull(),
    /** Price in cents (USD). */
    price: integer().notNull(),
    /** Units in stock across all sizes. 0 means sold out. */
    stock: integer().notNull().default(0),
    /** Null for one-size items. */
    sizes: jsonb().$type<ProductSize[]>(),
    image: text().notNull(),
    altImage: text("alt_image"),
    gallery: text().array().notNull().default(sql`'{}'::text[]`),
    details: text().array().notNull().default(sql`'{}'::text[]`),
    badge: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("products_category_id_idx").on(table.categoryId),
    index("products_created_at_idx").on(table.createdAt),
    check("products_price_nonnegative", sql`${table.price} >= 0`),
    check("products_stock_nonnegative", sql`${table.stock} >= 0`),
  ],
);

/** One cart per signed-in user, created on first add. */
export const carts = pgTable("carts", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * One row per product and size. No price column: prices are always read from `products`.
 * Quantities for all sizes of a product together may not exceed `products.stock`; writes in
 * `@/lib/cart` enforce this.
 */
export const cartItems = pgTable(
  "cart_items",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    cartId: integer("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Null for one-size items. */
    size: text(),
    quantity: integer().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("cart_items_cart_product_size_unique")
      .on(table.cartId, table.productId, table.size)
      .nullsNotDistinct(),
    index("cart_items_product_id_idx").on(table.productId),
    check("cart_items_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
}));

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(user, { fields: [carts.userId], references: [user.id] }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  product: one(products, { fields: [cartItems.productId], references: [products.id] }),
}));
