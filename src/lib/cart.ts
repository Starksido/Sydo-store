// Cart queries and writes. Server-only: this module imports the database client.
// Prices are always read from `products`; nothing here accepts a price from the caller.
// All sizes of a product in a cart share `products.stock`. neon-http has no interactive
// transactions, so each write checks stock in the same SQL statement that changes the row.
import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { cartItems, carts, products, type ProductSize } from "@/db/schema";

export type CartLine = {
  id: number;
  /** Null when the product has been deleted; the line is then shown as removed. */
  product: { id: number; slug: string; name: string; image: string; price: number; stock: number } | null;
  /** Current product name, or the name saved when added if the product was deleted. */
  name: string;
  /** Null for one-size items. */
  size: string | null;
  /** Quantity saved in the cart. */
  quantity: number;
  /** Quantity that can still be fulfilled from current stock: `quantity` or less, 0 when sold out or removed. */
  available: number;
  /** Highest quantity this line can be set to, given the product's other lines. */
  maxQuantity: number;
  /** `available × price`, in cents. */
  lineTotal: number;
};

export type Cart = {
  lines: CartLine[];
  /** Units that can be fulfilled, for the header count. */
  count: number;
  /** In cents, over available units only. */
  subtotal: number;
};

/** Quantity held by earlier lines of the same product, so stock is shared across sizes. */
const heldBefore = sql`coalesce(sum(${cartItems.quantity}) over (partition by ${cartItems.productId} order by ${cartItems.id} rows between unbounded preceding and 1 preceding), 0)`;

export async function getCart(userId: string): Promise<Cart> {
  const rows = await db
    .select({
      id: cartItems.id,
      size: cartItems.size,
      quantity: cartItems.quantity,
      savedName: cartItems.productName,
      available: sql<number>`least(${cartItems.quantity}, greatest(coalesce(${products.stock}, 0) - ${heldBefore}, 0))::int`.mapWith(
        Number,
      ),
      product: {
        id: products.id,
        slug: products.slug,
        name: products.name,
        image: products.image,
        price: products.price,
        stock: products.stock,
      },
    })
    .from(cartItems)
    .innerJoin(carts, eq(cartItems.cartId, carts.id))
    // Left join: rows for deleted products stay in the cart with a null product.
    .leftJoin(products, eq(cartItems.productId, products.id))
    .where(eq(carts.userId, userId))
    .orderBy(asc(cartItems.id));

  const heldByProduct = new Map<number, number>();
  for (const row of rows) {
    if (!row.product) continue;
    heldByProduct.set(row.product.id, (heldByProduct.get(row.product.id) ?? 0) + row.quantity);
  }

  const lines = rows.map(({ savedName, ...row }) => {
    if (!row.product) {
      return { ...row, name: savedName, available: 0, maxQuantity: 0, lineTotal: 0 };
    }
    const heldByOthers = heldByProduct.get(row.product.id)! - row.quantity;
    return {
      ...row,
      name: row.product.name,
      maxQuantity: Math.max(row.available, row.product.stock - heldByOthers),
      lineTotal: row.available * row.product.price,
    };
  });

  return {
    lines,
    count: lines.reduce((sum, line) => sum + line.available, 0),
    subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
  };
}

/** The fields needed to validate an add; stock here is only for messages, not the check. */
export async function getCartProduct(productId: number) {
  const [row] = await db
    .select({ slug: products.slug, stock: products.stock, sizes: products.sizes })
    .from(products)
    .where(eq(products.id, productId));
  return row as { slug: string; stock: number; sizes: ProductSize[] | null } | undefined;
}

async function getOrCreateCartId(userId: string) {
  const [row] = await db
    .insert(carts)
    .values({ userId })
    .onConflictDoUpdate({ target: carts.userId, set: { updatedAt: sql`now()` } })
    .returning({ id: carts.id });
  return row.id;
}

/**
 * Adds `quantity` units, merging with an existing line for the same size.
 * Returns false (and changes nothing) if the product's total in the cart would exceed stock.
 */
export async function addCartItem(userId: string, productId: number, size: string | null, quantity: number) {
  const cartId = await getOrCreateCartId(userId);
  const { rows } = await db.execute(sql`
    insert into cart_items (cart_id, product_id, product_name, size, quantity)
    select ${cartId}::int, p.id, p.name, ${size}::text, ${quantity}::int
    from products p
    where p.id = ${productId}::int
      and ${quantity}::int + (
        select coalesce(sum(ci.quantity), 0) from cart_items ci
        where ci.cart_id = ${cartId}::int and ci.product_id = p.id
      ) <= p.stock
    on conflict (cart_id, product_id, (coalesce(size, ''))) where product_id is not null
    do update set quantity = cart_items.quantity + excluded.quantity, updated_at = now()
    returning id
  `);
  return rows.length > 0;
}

/**
 * Sets a line's quantity. Lowering is always allowed; raising only while the product's total in
 * the cart stays within stock. Returns false if nothing changed (over stock, or not this user's line).
 */
export async function setCartItemQuantity(userId: string, lineId: number, quantity: number) {
  const { rows } = await db.execute(sql`
    update cart_items ci
    set quantity = ${quantity}::int, updated_at = now()
    from products p
    where ci.id = ${lineId}::int
      and ci.cart_id = (select id from carts where user_id = ${userId})
      and p.id = ci.product_id
      and (
        ${quantity}::int <= ci.quantity
        or ${quantity}::int + (
          select coalesce(sum(o.quantity), 0) from cart_items o
          where o.cart_id = ci.cart_id and o.product_id = ci.product_id and o.id <> ci.id
        ) <= p.stock
      )
    returning ci.id
  `);
  return rows.length > 0;
}

export async function removeCartItem(userId: string, lineId: number) {
  await db.execute(sql`
    delete from cart_items
    where id = ${lineId}::int and cart_id = (select id from carts where user_id = ${userId})
  `);
}
