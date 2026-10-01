import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
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

/**
 * Like `requireSession`, but signed-in users without the admin role get a 404, so the admin area
 * looks like it doesn't exist. Call it in the admin layout, every admin page (layouts don't protect
 * nested pages) and first in every admin Server Function.
 */
export async function requireAdmin(returnTo: string) {
  const session = await requireSession(returnTo);
  if (session.user.role !== "admin") notFound();
  return session;
}

// Stands in for our origin when resolving `next`; never used in a redirect.
const PLACEHOLDER_ORIGIN = "https://sydo.invalid";

/**
 * Only same-origin paths, so `?next=` can't send users to another site. `next` is resolved the way
 * a browser would (which drops tabs and newlines and reads `\` as `/`, so `/<tab>/evil.com` means
 * `//evil.com`) and refused unless it stays on our origin. The resolved path is refused too if it
 * starts with `//`: dot segments can collapse into one (`/.//evil.com` resolves to `//evil.com`),
 * which a browser would read as another site.
 */
export function safeRedirect(next: unknown) {
  if (typeof next !== "string" || !next.startsWith("/")) return DEFAULT_REDIRECT;
  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return DEFAULT_REDIRECT;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN || url.pathname.startsWith("//")) return DEFAULT_REDIRECT;
  return `${url.pathname}${url.search}${url.hash}`;
}
