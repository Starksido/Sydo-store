"use server";

import { refresh } from "next/cache";

import {
  addCartItem,
  getCart,
  getCartVariant,
  MAX_LINE_QUANTITY,
  removeCartItem,
  setCartItemQuantity,
} from "@/lib/cart";
import { getCartOwner, getCartOwnerForWrite } from "@/lib/cart-owner";

export type CartActionResult = { ok: true; count: number } | { ok: false; message: string };

const GONE = "This item is no longer in your bag.";

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** Adds one unit of a size (variant), to the user's bag or, for a guest, to their cookie's bag. */
export async function addToCart(variantId: unknown): Promise<CartActionResult> {
  if (!isId(variantId)) return { ok: false, message: "This product is unavailable." };
  const variant = await getCartVariant(variantId);
  if (!variant) return { ok: false, message: "This product is unavailable." };

  const owner = await getCartOwnerForWrite();
  if (!(await addCartItem(owner, variantId, 1))) {
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
  const { count } = await getCart(owner);
  return { ok: true, count };
}

export async function updateCartItem(lineId: unknown, quantity: unknown): Promise<CartActionResult> {
  if (!isId(lineId) || !isId(quantity) || quantity > MAX_LINE_QUANTITY) {
    return { ok: false, message: "Please choose a valid quantity." };
  }
  const owner = await getCartOwner();
  if (!owner) return { ok: false, message: GONE };

  const updated = await setCartItemQuantity(owner, lineId, quantity);
  const { count, lines } = await getCart(owner);
  refresh();
  if (!updated) {
    const line = lines.find((l) => l.id === lineId);
    return { ok: false, message: line ? `Only ${line.maxQuantity} available.` : GONE };
  }
  return { ok: true, count };
}

export async function removeFromCart(lineId: unknown): Promise<CartActionResult> {
  if (!isId(lineId)) return { ok: false, message: GONE };
  const owner = await getCartOwner();
  if (!owner) return { ok: false, message: GONE };

  await removeCartItem(owner, lineId);
  const { count } = await getCart(owner);
  refresh();
  return { ok: true, count };
}
