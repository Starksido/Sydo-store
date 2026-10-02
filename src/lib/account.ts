// How a customer signs in, and the account lookups sign-in needs. Server-only: this module imports
// the database client. Not a Server Function on purpose: callers check the session first, or are
// Better Auth's own hooks in `@/lib/auth`.
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { account, user } from "@/db/schema";

/**
 * Whether the user can sign in with a password. Someone who signed up with Google has none until
 * they set one through "Forgot your password?".
 */
export async function hasPassword(userId: string) {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
  return rows.length > 0;
}

/** The account with this (lower-case) email: its name and whether the email is confirmed. */
export async function findUserByEmail(email: string) {
  const [row] = await db
    .select({ name: user.name, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email));
  return row;
}

/** Marks the user's email as confirmed (a password reset link proved they own it). */
export async function confirmEmail(userId: string) {
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
}
