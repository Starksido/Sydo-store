"use server";

import { refresh } from "next/cache";

import { addCartItem, getCart, getCartVariant, removeCartItem, setCartItemQuantity } from "@/lib/cart";
import { requireSession } from "@/lib/session";

export type CartActionResult = { ok: true; count: number } | { ok: false; message: string };

const MAX_LINE_QUANTITY = 99;

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** Adds one unit of a size (variant). Guests are sent to sign in and back to the product page. */
export async function addToCart(variantId: unknown): Promise<CartActionResult> {
  if (!isId(variantId)) return { ok: false, message: "This product is unavailable." };
  const variant = await getCartVariant(variantId);
  if (!variant) return { ok: false, message: "This product is unavailable." };

  const { user } = await requireSession(`/products/${variant.slug}`);

  if (!(await addCartItem(user.id, variantId, 1))) {
    return {
      ok: false,
      message:
        variant.stock > 0
          ? `You already have all ${variant.stock} available in your bag.`
          : variant.label
            ? `Size ${variant.label} is sold out.`
            : "This piece is sold out.",
    };
  }
  const { count } = await getCart(user.id);
  return { ok: true, count };
}

export async function updateCartItem(lineId: unknown, quantity: unknown): Promise<CartActionResult> {
  const { user } = await requireSession("/cart");
  if (!isId(lineId) || !isId(quantity) || quantity > MAX_LINE_QUANTITY) {
    return { ok: false, message: "Please choose a valid quantity." };
  }

  const updated = await setCartItemQuantity(user.id, lineId, quantity);
  const { count, lines } = await getCart(user.id);
  refresh();
  if (!updated) {
    const line = lines.find((l) => l.id === lineId);
    return {
      ok: false,
      message: line ? `Only ${line.maxQuantity} available.` : "This item is no longer in your bag.",
    };
  }
  return { ok: true, count };
}

export async function removeFromCart(lineId: unknown): Promise<CartActionResult> {
  const { user } = await requireSession("/cart");
  if (!isId(lineId)) return { ok: false, message: "This item is no longer in your bag." };

  await removeCartItem(user.id, lineId);
  const { count } = await getCart(user.id);
  refresh();
  return { ok: true, count };
}
