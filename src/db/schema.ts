// Drizzle table definitions live here.
// Better Auth's tables can be generated with: npx auth generate
import { relations, sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
}));
