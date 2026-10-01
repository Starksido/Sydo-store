// Drizzle table definitions live here.
// Better Auth's tables are generated into ./auth-schema.ts; after changing auth plugins, rerun:
//   npx auth generate --config src/lib/auth.ts --output src/db/auth-schema.ts --yes
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
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
  ],
);

/**
 * What a product is sold in: one row per size, or a single row with a null label for a one-size
 * product. Stock is held here, per size; a product's stock is the sum of its variants. Stock is
 * only changed by `@/lib/stock`. A size can be removed only while its stock is 0.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Null for the one variant of a one-size product. */
    label: text(),
    /** Units in stock. 0 means this size is sold out. */
    stock: integer().notNull().default(0),
    /** Display order of the sizes. */
    position: integer().notNull().default(0),
  },
  (table) => [
    // One variant per size, case-insensitively; one-size products have exactly one (null label).
    uniqueIndex("product_variants_label_unique").on(table.productId, sql`coalesce(lower(${table.label}), '')`),
    check("product_variants_stock_nonnegative", sql`${table.stock} >= 0`),
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
    /**
     * The size changed. Null once the size has been removed, and on changes made before stock was
     * kept per size, which were to the product's total.
     */
    variantId: integer("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    /** The size's label at the time (null for one-size products and changes to the total). */
    size: text(),
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
    index("stock_adjustments_variant_id_idx").on(table.variantId),
    check("stock_adjustments_delta_nonzero", sql`${table.delta} <> 0`),
    check("stock_adjustments_new_stock_nonnegative", sql`${table.newStock} >= 0`),
    check("stock_adjustments_delta_matches", sql`${table.newStock} = ${table.previousStock} + ${table.delta}`),
    check("stock_adjustments_note_length", sql`char_length(${table.note}) <= 500`),
  ],
);

/**
 * One cart per signed-in user, or per guest, created on first add. A guest's cart is found by the
 * SHA-256 hash of the random token in their `cart` cookie (the token itself is never stored); it's
 * merged into the user's cart when they sign in, and deleted after 30 days untouched.
 */
export const carts = pgTable(
  "carts",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** Null for a guest's cart. */
    userId: text("user_id")
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Hex SHA-256 of the guest's cookie token. Null for a user's cart. */
    tokenHash: text("token_hash").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check("carts_one_owner", sql`(${table.userId} is null) <> (${table.tokenHash} is null)`)],
);

/**
 * One row per size (variant). No price column: prices are always read from `products`. A line's
 * quantity may not exceed its size's stock; writes in `@/lib/cart` enforce this. When a product or
 * size is deleted its rows stay, with `variant_id` null, so the cart can tell the user it was removed.
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
    /** Null once the size (or the product) has been removed; the line then shows as removed. */
    variantId: integer("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
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
    // One row per size. Rows for removed sizes are left out, so several can't collide on null.
    uniqueIndex("cart_items_variant_unique")
      .on(table.cartId, table.variantId)
      .where(sql`${table.variantId} is not null`),
    index("cart_items_product_id_idx").on(table.productId),
    index("cart_items_variant_id_idx").on(table.variantId),
    check("cart_items_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

/** Products a signed-in user saved for later. Gone with the user or the product. */
export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("wishlist_items_user_product_unique").on(table.userId, table.productId),
    index("wishlist_items_product_id_idx").on(table.productId),
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

/** Why an admin cancelled an order. Shown to the customer. */
export const orderCancelReason = pgEnum("order_cancel_reason", [
  "out_of_stock",
  "payment_issue",
  "customer_request",
  "other",
]);

/**
 * Placed orders. Created only by `placeOrder` in `@/lib/orders`, in the same statement that takes the
 * stock and clears the ordered cart lines; marked paid or expired only by `@/lib/payments`; moved
 * on (processing, shipped, delivered, cancelled) only by `changeOrderStatus` in `@/lib/orders`.
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
    /** Set exactly when the order is cancelled. */
    cancelReason: orderCancelReason("cancel_reason"),
    /** Optional, set when shipping; shown to the customer only when filled in. */
    shippingCarrier: text("shipping_carrier"),
    trackingNumber: text("tracking_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("orders_user_checkout_key_unique").on(table.userId, table.checkoutKey),
    index("orders_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("orders_status_created_at_idx").on(table.status, table.createdAt),
    check("orders_total_nonnegative", sql`${table.total} >= 0`),
    check("orders_cancel_reason_iff_cancelled", sql`(${table.status} = 'cancelled') = (${table.cancelReason} is not null)`),
    check("orders_shipping_carrier_length", sql`char_length(${table.shippingCarrier}) <= 100`),
    check("orders_tracking_number_length", sql`char_length(${table.trackingNumber}) <= 100`),
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
    /** The size ordered, for returning stock on cancel or expiry. Null once the size is removed. */
    variantId: integer("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
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
    index("order_items_variant_id_idx").on(table.variantId),
    check("order_items_quantity_positive", sql`${table.quantity} > 0`),
    check("order_items_unit_price_nonnegative", sql`${table.unitPrice} >= 0`),
  ],
);

export const paymentStatus = pgEnum("payment_status", ["pending", "success", "failed", "abandoned"]);

/** A successful payment that has to be refunded by hand in the Paystack dashboard. */
export const refundStatus = pgEnum("refund_status", ["due", "refunded"]);

export const refundReason = pgEnum("refund_reason", [
  /** An admin cancelled the order this payment paid for. */
  "order_cancelled",
  /** The order was already paid by another attempt. */
  "duplicate_payment",
  /** The order was cancelled, or expired and sold out, when this payment landed. */
  "order_unavailable",
  /** Paystack's record didn't match the order (amount, currency or order). */
  "mismatch",
]);

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
    /**
     * Set when money was taken that has to go back: by an admin cancelling a paid order, or by
     * `confirmPayment` for a payment it can't apply. Refunds are made in the Paystack dashboard and
     * then recorded here by an admin.
     */
    refundStatus: refundStatus("refund_status"),
    refundReason: refundReason("refund_reason"),
    /** What the system saw, e.g. the mismatch. */
    refundDetail: text("refund_detail"),
    /** Paystack's refund reference, entered by the admin who made the refund. */
    refundReference: text("refund_reference"),
    refundedOn: date("refunded_on", { mode: "string" }),
    refundRecordedBy: text("refund_recorded_by").references(() => user.id, { onDelete: "restrict" }),
    refundRecordedAt: timestamp("refund_recorded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("payments_order_id_created_at_idx").on(table.orderId, table.createdAt),
    index("payments_refund_status_idx").on(table.refundStatus),
    check("payments_amount_nonnegative", sql`${table.amount} >= 0`),
    check("payments_refund_reason_iff_status", sql`(${table.refundStatus} is null) = (${table.refundReason} is null)`),
    check(
      "payments_refunded_recorded",
      sql`${table.refundStatus} is distinct from 'refunded' or (${table.refundReference} is not null and ${table.refundedOn} is not null and ${table.refundRecordedBy} is not null and ${table.refundRecordedAt} is not null)`,
    ),
    check("payments_refund_reference_length", sql`char_length(${table.refundReference}) <= 100`),
  ],
);

/**
 * One row per order status change: by an admin (`user_id`), or by the system (null) when a payment
 * lands or the sweep expires the order. Written in the same statement as the change. `note` is
 * internal and never shown to customers.
 */
export const orderEvents = pgTable(
  "order_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    userId: text("user_id").references(() => user.id, { onDelete: "restrict" }),
    fromStatus: orderStatus("from_status").notNull(),
    toStatus: orderStatus("to_status").notNull(),
    note: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("order_events_order_id_created_at_idx").on(table.orderId, table.createdAt),
    check("order_events_status_changes", sql`${table.fromStatus} <> ${table.toStatus}`),
    check("order_events_note_length", sql`char_length(${table.note}) <= 500`),
  ],
);

/**
 * One row per change to a user's role (`user.role`, "user" or "admin") made on /admin/users,
 * written by `setUserRole` in the same statement as the change. Roles set in SQL aren't recorded.
 */
export const roleChanges = pgTable(
  "role_changes",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** Whose role changed. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** The admin who changed it. */
    changedBy: text("changed_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    fromRole: text("from_role").notNull(),
    toRole: text("to_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("role_changes_created_at_idx").on(table.createdAt),
    check("role_changes_roles", sql`${table.fromRole} in ('user', 'admin') and ${table.toRole} in ('user', 'admin')`),
    check("role_changes_role_changes", sql`${table.fromRole} <> ${table.toRole}`),
  ],
);

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  variants: many(productVariants),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
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
