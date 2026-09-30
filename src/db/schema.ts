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
    /**
     * Set when an admin archives the product: the storefront, carts and checkout then treat it as
     * gone (see `@/lib/products` and `@/lib/cart`). Stock and payments ignore it, so a late payment
     * for an order that includes it still goes through. Null = on sale.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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

export const stockAdjustmentReason = pgEnum("stock_adjustment_reason", [
  "received",
  "correction",
  "damaged",
  "returned",
  "other",
]);

/**
 * One row per manual stock change by an admin, written by `@/lib/stock` in the same statement as
 * the change. Checkout, expiry and late payments aren't recorded here.
 */
export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** Null once the product has been deleted. */
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    /** The admin who made the change. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    delta: integer().notNull(),
    previousStock: integer("previous_stock").notNull(),
    newStock: integer("new_stock").notNull(),
    reason: stockAdjustmentReason().notNull(),
    note: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("stock_adjustments_product_id_created_at_idx").on(table.productId, table.createdAt),
    check("stock_adjustments_delta_nonzero", sql`${table.delta} <> 0`),
    check("stock_adjustments_new_stock_nonnegative", sql`${table.newStock} >= 0`),
    check("stock_adjustments_delta_matches", sql`${table.newStock} = ${table.previousStock} + ${table.delta}`),
    check("stock_adjustments_note_length", sql`char_length(${table.note}) <= 500`),
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
  /** Not paid within the payment window; the sweep in `@/lib/payments` returned its stock. */
  "expired",
]);

/**
 * Placed orders. Created only by `placeOrder` in `@/lib/orders`, in the same statement that takes the
 * stock and clears the ordered cart lines; marked paid or expired only by `@/lib/payments`.
 * `reference` is the public order number used in URLs;
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
    /** Paystack reference of the payment that paid this order. Null until paid. */
    paymentReference: text("payment_reference").unique(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
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

export const paymentStatus = pgEnum("payment_status", ["pending", "success", "failed", "abandoned"]);

/**
 * One row per Paystack payment attempt, written only by `@/lib/payments`. The row is created before
 * the transaction is initialized, so every reference Paystack can report back is known here.
 * A `success` row whose reference isn't its order's `payment_reference` is money taken but not
 * applied (paid twice, or paid after the order expired and its stock was gone): refund it.
 */
export const payments = pgTable(
  "payments",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    /** Unique per attempt, e.g. SY-7K4Q9M2X-P3F8Q2A9. */
    reference: text().notNull().unique(),
    /** Amount asked for, in KES cents: the order total when the attempt started. */
    amount: bigint({ mode: "number" }).notNull(),
    status: paymentStatus().notNull().default("pending"),
    /** Paystack's transaction id, once verified. */
    paystackId: bigint("paystack_id", { mode: "number" }),
    /** e.g. "mobile_money" or "card", once verified. */
    channel: text(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("payments_order_id_created_at_idx").on(table.orderId, table.createdAt),
    check("payments_amount_nonnegative", sql`${table.amount} >= 0`),
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
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));
