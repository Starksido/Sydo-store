// How a customer signs in. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers check the session first.
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { account } from "@/db/schema";

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
