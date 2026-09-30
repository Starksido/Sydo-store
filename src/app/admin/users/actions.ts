"use server";

import { notFound, redirect } from "next/navigation";

import { setUserRole } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/session";

/**
 * Bound to the user's id and the new role by the users page. Goes back to the page searched for
 * that user, with what happened (`?result=`).
 */
export async function setUserRoleAction(userId: unknown, role: unknown): Promise<void> {
  const { user } = await requireAdmin("/admin/users");
  if (typeof userId !== "string" || !userId || userId.length > 100) notFound();
  if (role !== "user" && role !== "admin") notFound();

  const result = await setUserRole({ actorId: user.id, userId, role });
  if (!result.ok && result.reason === "not-found") notFound();

  const outcome = result.ok ? (result.changed ? (role === "admin" ? "added" : "removed") : "unchanged") : result.reason;
  redirect(`/admin/users?q=${encodeURIComponent(result.email)}&result=${outcome}`);
}
