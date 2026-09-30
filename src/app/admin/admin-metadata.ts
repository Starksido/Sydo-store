import type { Metadata } from "next";

import { notFoundMetadata } from "@/components/not-found-message";
import { getSession } from "@/lib/session";

/**
 * Every admin layout's and page's `generateMetadata` returns its metadata through this. Next
 * resolves (and streams) metadata separately from rendering, even when `requireAdmin` 404s the
 * render, so non-admins get the store 404's metadata instead of admin titles. Calling `notFound()`
 * here instead would leave the 404 without a title, unlike other 404s.
 */
export async function adminMetadata(metadata: Metadata): Promise<Metadata> {
  const session = await getSession();
  return session?.user.role === "admin" ? metadata : notFoundMetadata;
}
