// Drizzle table definitions live here.
// Better Auth's tables are generated into ./auth-schema.ts; after changing auth plugins, rerun:
//   npx auth generate --config src/lib/auth.ts --output src/db/auth-schema.ts --yes
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
    /** Price in KES cents, always whole shillings (a multiple of 100; see the check below). */
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
    // Whole shillings: M-Pesa only takes whole shillings.
    check("products_price_whole_shillings", sql`${table.price} % 100 = 0`),
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
 * `@/lib/cart` enforce this. When a product is deleted its rows stay, with `product_id` null,
 * so the cart can tell the user it was removed.
 */
export const cartItems = pgTable(
  "cart_items",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    cartId: integer("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    /** Null once the product has been deleted. */
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    /** Name when added, shown in the removed-item notice. Not kept in sync; never a price. */
    productName: text("product_name").notNull(),
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
    // One row per product and size (one-size items included, via coalesce). Rows for deleted
    // products are left out, so several of them in one cart can't collide on null.
    uniqueIndex("cart_items_line_unique")
      .on(table.cartId, table.productId, sql`coalesce(${table.size}, '')`)
      .where(sql`${table.productId} is not null`),
    index("cart_items_product_id_idx").on(table.productId),
    check("cart_items_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
]);

/**
 * Placed orders. Written only by `placeOrder` in `@/lib/orders`, in the same statement that takes the
 * stock and clears the ordered cart lines. `reference` is the public order number used in URLs;
 * `checkout_key` comes from the checkout form so a repeated submit returns the same order.
 * Delivery details are copied onto the order.
 */
export const orders = pgTable(
  "orders",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    reference: text().notNull().unique(),
    // Restrict: order history is never deleted along with an account.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    checkoutKey: uuid("checkout_key").notNull(),
    status: orderStatus().notNull().default("pending_payment"),
    /** Sum of the items, in KES cents, calculated from product prices on the server. */
    total: bigint({ mode: "number" }).notNull(),
    deliveryName: text("delivery_name").notNull(),
    /** Normalised to +254XXXXXXXXX. */
    deliveryPhone: text("delivery_phone").notNull(),
    deliveryCounty: text("delivery_county").notNull(),
    deliveryTown: text("delivery_town").notNull(),
    deliveryAddress: text("delivery_address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("orders_user_checkout_key_unique").on(table.userId, table.checkoutKey),
    index("orders_user_id_created_at_idx").on(table.userId, table.createdAt),
    check("orders_total_nonnegative", sql`${table.total} >= 0`),
  ],
);

/**
 * One row per product and size, with the product's name, SKU and price as they were at purchase.
 * `product_id` is kept only as a link and becomes null if the product is deleted.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    sku: text().notNull(),
    /** Null for one-size items. */
    size: text(),
    /** In KES cents. */
    unitPrice: integer("unit_price").notNull(),
    quantity: integer().notNull(),
  },
  (table) => [
    index("order_items_order_id_idx").on(table.orderId),
    index("order_items_product_id_idx").on(table.productId),
    check("order_items_quantity_positive", sql`${table.quantity} > 0`),
    check("order_items_unit_price_nonnegative", sql`${table.unitPrice} >= 0`),
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

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(user, { fields: [orders.userId], references: [user.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));
