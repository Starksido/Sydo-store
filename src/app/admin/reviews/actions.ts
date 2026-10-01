"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { setReviewHidden } from "@/lib/reviews";
import { requireAdmin } from "@/lib/session";

import { isId } from "../revalidate";

/**
 * Bound to the review's id, the new state and the list page by the reviews page. Refreshes the
 * product page, where hidden reviews are left out of the list and the average.
 */
export async function setReviewHiddenAction(id: unknown, hidden: unknown, page: unknown): Promise<void> {
  const { user } = await requireAdmin("/admin/reviews");
  if (!isId(id) || typeof hidden !== "boolean") notFound();

  const slug = await setReviewHidden(id, hidden, user.id);
  if (!slug) notFound();

  revalidatePath(`/products/${slug}`);
  const pageParam = isId(page) && page > 1 ? `page=${page}&` : "";
  redirect(`/admin/reviews?${pageParam}saved=${hidden ? "hidden" : "shown"}#review-${id}`);
}
