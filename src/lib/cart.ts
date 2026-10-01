// Cart queries and writes. Server-only: this module imports the database client.
// Prices are always read from `products`; nothing here accepts a price from the caller.
// Each line is one size (variant) and is limited by that size's stock. neon-http has no interactive
// transactions, so each write checks stock in the same SQL statement that changes the row.
// Archived products count as removed: their lines stay (and come back if the product is unarchived)
// but show as no longer available, can't be added or raised, and are left out of checkout. So do
// lines whose size was removed.
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { cartItems, carts, products, productVariants } from "@/db/schema";

export type CartLine = {
  id: number;
  /**
   * Null when the product or the size has been deleted, or the product archived; the line is then
   * shown as removed. `stock` is the size's stock.
   */
  product: { id: number; slug: string; name: string; image: string; price: number; stock: number } | null;
  /** Current product name, or the name saved when added if the product was deleted or archived. */
  name: string;
  /** Null for one-size items. */
  size: string | null;
  /** Quantity saved in the cart. */
  quantity: number;
  /** Quantity that can still be fulfilled from current stock: `quantity` or less, 0 when sold out or removed. */
  available: number;
  /** Highest quantity this line can be set to: the size's stock. */
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

export async function getCart(userId: string): Promise<Cart> {
  const rows = await db
    .select({
      id: cartItems.id,
      size: cartItems.size,
      quantity: cartItems.quantity,
      savedName: cartItems.productName,
      stock: productVariants.stock,
      product: {
        id: products.id,
        slug: products.slug,
        name: products.name,
        image: products.image,
        price: products.price,
      },
    })
    .from(cartItems)
    .innerJoin(carts, eq(cartItems.cartId, carts.id))
    // Left joins: rows for deleted sizes, or deleted or archived products, stay in the cart with a
    // null product.
    .leftJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .leftJoin(products, and(eq(productVariants.productId, products.id), isNull(products.archivedAt)))
    .where(eq(carts.userId, userId))
    .orderBy(asc(cartItems.id));

  const lines = rows.map(({ savedName, stock, product, ...row }) => {
    if (!product || stock === null) {
      return { ...row, product: null, name: savedName, available: 0, maxQuantity: 0, lineTotal: 0 };
    }
    const available = Math.min(row.quantity, stock);
    return {
      ...row,
      product: { ...product, stock },
      name: product.name,
      available,
      maxQuantity: stock,
      lineTotal: available * product.price,
    };
  });

  return {
    lines,
    count: lines.reduce((sum, line) => sum + line.available, 0),
    subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
  };
}

/**
 * Lowers saved quantities that stock can no longer cover to what's available. Lines with nothing
 * available keep their quantity and show as sold out (quantities can't be 0). Only ever lowers.
 * Returns the ids of the lines it changed. Locks the cart's rows in id order first, like checkout
 * does, so the two can't deadlock.
 */
export async function reconcileCart(userId: string): Promise<Set<number>> {
  const { rows } = await db.execute<{ id: number }>(sql`
    with locked as (
      select ci.id
      from cart_items ci
      join carts c on c.id = ci.cart_id
      where c.user_id = ${userId}
      order by ci.id
      for update of ci
    ),
    fit as (
      select ci.id, least(ci.quantity, v.stock)::int as available
      from cart_items ci
      join locked on locked.id = ci.id
      join product_variants v on v.id = ci.variant_id
      join products p on p.id = v.product_id and p.archived_at is null
    )
    update cart_items ci
    set quantity = fit.available, updated_at = now()
    from fit
    where ci.id = fit.id and fit.available > 0 and fit.available < ci.quantity
    returning ci.id
  `);
  return new Set(rows.map((row) => row.id));
}

/**
 * The fields needed to validate an add of a size, or undefined if it doesn't exist or its product
 * is archived. Stock here is only for messages, not the check.
 */
export async function getCartVariant(variantId: number) {
  const [row] = await db
    .select({
      slug: products.slug,
      label: productVariants.label,
      stock: productVariants.stock,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(productVariants.id, variantId), isNull(products.archivedAt)));
  return row;
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
 * Adds `quantity` units of a size, merging with an existing line for it.
 * Returns false (and changes nothing) if the line would exceed the size's stock.
 */
export async function addCartItem(userId: string, variantId: number, quantity: number) {
  const cartId = await getOrCreateCartId(userId);
  const { rows } = await db.execute(sql`
    insert into cart_items (cart_id, product_id, variant_id, product_name, size, quantity)
    select ${cartId}::int, p.id, v.id, p.name, v.label, ${quantity}::int
    from product_variants v
    join products p on p.id = v.product_id
    where v.id = ${variantId}::int
      and p.archived_at is null
      and ${quantity}::int + (
        select coalesce(sum(ci.quantity), 0) from cart_items ci
        where ci.cart_id = ${cartId}::int and ci.variant_id = v.id
      ) <= v.stock
    on conflict (cart_id, variant_id) where variant_id is not null
    do update set quantity = cart_items.quantity + excluded.quantity, updated_at = now()
    returning id
  `);
  return rows.length > 0;
}

/**
 * Sets a line's quantity. Lowering is always allowed; raising only within the size's stock.
 * Returns false if nothing changed (over stock, not this user's line, or the size or product was
 * deleted or archived).
 */
export async function setCartItemQuantity(userId: string, lineId: number, quantity: number) {
  const { rows } = await db.execute(sql`
    update cart_items ci
    set quantity = ${quantity}::int, updated_at = now()
    from product_variants v
    join products p on p.id = v.product_id
    where ci.id = ${lineId}::int
      and ci.cart_id = (select id from carts where user_id = ${userId})
      and v.id = ci.variant_id
      and p.archived_at is null
      and (${quantity}::int <= ci.quantity or ${quantity}::int <= v.stock)
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
