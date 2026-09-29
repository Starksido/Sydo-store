import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/lib/auth";

const DEFAULT_REDIRECT = "/account";

/** The current session, or null. Deduplicated per request. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/**
 * Returns the session, or redirects to sign-in and back to `returnTo` afterwards. Call it in every
 * protected page or Server Function: the proxy only checks that a session cookie exists.
 */
export async function requireSession(returnTo: string) {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return session;
}

// Stands in for our origin when resolving `next`; never used in a redirect.
const PLACEHOLDER_ORIGIN = "https://sydo.invalid";

/**
 * Only same-origin paths, so `?next=` can't send users to another site. `next` is resolved the way
 * a browser would (which drops tabs and newlines and reads `\` as `/`, so `/<tab>/evil.com` means
 * `//evil.com`) and refused unless it stays on our origin.
 */
export function safeRedirect(next: unknown) {
  if (typeof next !== "string" || !next.startsWith("/")) return DEFAULT_REDIRECT;
  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return DEFAULT_REDIRECT;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return DEFAULT_REDIRECT;
  return `${url.pathname}${url.search}${url.hash}`;
}
