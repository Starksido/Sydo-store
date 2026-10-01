"use server";

import { refresh } from "next/cache";

import { addCartItem, getCart } from "@/lib/cart";
import { getProductsByIds } from "@/lib/products";
import { requireSession } from "@/lib/session";
import { setWishlisted } from "@/lib/wishlist";

export type WishlistActionResult = { ok: true; saved: boolean } | { ok: false; message: string };

export type MoveToBagResult = { ok: true; count: number } | { ok: false; message: string };

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** Saves (`saved` true) or unsaves a product. Guests get a sign-in link instead of calling this. */
export async function setWishlistedAction(productId: unknown, saved: unknown): Promise<WishlistActionResult> {
  const { user } = await requireSession("/account/wishlist");
  if (!isId(productId) || typeof saved !== "boolean") return { ok: false, message: "This product is unavailable." };

  const result = await setWishlisted(user.id, productId, saved);
  if (result === null) return { ok: false, message: "This product is unavailable." };
  refresh();
  return { ok: true, saved: result };
}

/**
 * Adds one unit of a saved product to the bag and unsaves it. Only for products sold in one size
 * (or one size of them); others are opened to choose a size.
 */
export async function moveToBagAction(productId: unknown): Promise<MoveToBagResult> {
  const { user } = await requireSession("/account/wishlist");
  const [product] = isId(productId) ? await getProductsByIds([productId]) : [];
  if (!product) return { ok: false, message: "This product is unavailable." };
  if (product.variants.length !== 1) return { ok: false, message: "Choose a size on the product page." };

  const owner = { userId: user.id };
  if (!(await addCartItem(owner, product.variants[0].id, 1))) {
    return {
      ok: false,
      message: product.stock > 0 ? `You already have all ${product.stock} available in your bag.` : "This piece is sold out.",
    };
  }
  await setWishlisted(user.id, product.id, false);
  const { count } = await getCart(owner);
  refresh();
  return { ok: true, count };
}
