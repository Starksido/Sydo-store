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

/** Only same-origin paths, so `?next=` can't send users to another site. */
export function safeRedirect(next: unknown) {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return DEFAULT_REDIRECT;
  }
  return next;
}
