// Whose cart a request uses: the signed-in user's, else the guest's from the `cart` cookie.
// Server-only (reads the session and cookies).
import { cookies } from "next/headers";

import type { CartOwner } from "@/lib/cart";
import {
  GUEST_CART_COOKIE,
  guestCookieOptions,
  hashGuestToken,
  newGuestToken,
  readGuestToken,
} from "@/lib/guest-cart-token";
import { getSession } from "@/lib/session";

/** The current cart owner, or null for a guest without a cart cookie (whose cart is empty). */
export async function getCartOwner(): Promise<CartOwner | null> {
  const session = await getSession();
  if (session) return { userId: session.user.id };
  const token = readGuestToken((await cookies()).get(GUEST_CART_COOKIE)?.value);
  return token ? { tokenHash: hashGuestToken(token) } : null;
}

/**
 * The current cart owner for a write. A guest without a valid cookie gets a new token; a guest's
 * cookie is renewed, so the cart lasts 30 days from the last add. Only in Server Functions and
 * Route Handlers, which can set cookies.
 */
export async function getCartOwnerForWrite(): Promise<CartOwner> {
  const session = await getSession();
  if (session) return { userId: session.user.id };
  const store = await cookies();
  const token = readGuestToken(store.get(GUEST_CART_COOKIE)?.value) ?? newGuestToken();
  store.set(GUEST_CART_COOKIE, token, guestCookieOptions());
  return { tokenHash: hashGuestToken(token) };
}
