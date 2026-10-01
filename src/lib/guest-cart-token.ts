// The guest cart cookie. Server-only. A guest's cart is found by the SHA-256 hash of a random token
// kept in an httpOnly cookie; only the hash is stored, so a database leak doesn't hand out carts.
import { createHash, randomBytes } from "node:crypto";

import { appUrl } from "@/lib/app-url";

export const GUEST_CART_COOKIE = "cart";

/** How long a guest cart lasts untouched; the cookie is renewed on each add. */
export const GUEST_CART_DAYS = 30;

/** 32 random bytes, base64url: 43 characters. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function newGuestToken() {
  return randomBytes(32).toString("base64url");
}

/** The token if it's well formed, else null (a forged or mangled cookie is simply ignored). */
export function readGuestToken(value: string | null | undefined) {
  return value && TOKEN.test(value) ? value : null;
}

export function hashGuestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Cookie options: httpOnly, lax, and secure whenever the site is served over https. */
export function guestCookieOptions(maxAge = GUEST_CART_DAYS * 24 * 60 * 60) {
  return {
    httpOnly: true,
    secure: appUrl().startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
