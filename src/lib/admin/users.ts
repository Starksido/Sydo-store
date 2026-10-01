// Admin user queries, and changing roles. Server-only: this module imports the database client.
// Not a Server Function on purpose: callers (the admin Server Functions) call `requireAdmin` first.
// The role is read from the database on every request (no cookie cache), so a change applies at once.
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { roleChanges, user } from "@/db/schema";
import { escapeLike } from "@/lib/admin/products";

export type Role = "user" | "admin";

export const ADMIN_USERS_PAGE_SIZE = 20;

/** One page of users, newest first, matching `q` on name or email; `admins` lists only admins. */
export async function listUsers({
  q = "",
  admins = false,
  page = 1,
  pageSize = ADMIN_USERS_PAGE_SIZE,
}: { q?: string; admins?: boolean; page?: number; pageSize?: number } = {}) {
  const conditions: (SQL | undefined)[] = [];
  const search = q.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push(or(ilike(user.name, pattern), ilike(user.email, pattern)));
  }
  if (admins) conditions.push(eq(user.role, "admin"));

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      createdAt: user.createdAt,
      // Spelled out: drizzle leaves columns unqualified in a select list, and "id" would mean orders.id.
      orders: sql<number>`(select count(*) from orders o where o.user_id = "user".id)`.mapWith(Number),
    })
    .from(user)
    .where(and(...conditions))
    .orderBy(desc(user.createdAt), desc(user.id))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { users: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

export type AdminUserListItem = Awaited<ReturnType<typeof listUsers>>["users"][number];

/** The latest role changes, newest first, with who changed whose role. */
export async function listRoleChanges(limit = 10) {
  const changedBy = alias(user, "changed_by_user");
  return db
    .select({
      id: roleChanges.id,
      fromRole: roleChanges.fromRole,
      toRole: roleChanges.toRole,
      createdAt: roleChanges.createdAt,
      user: { name: user.name, email: user.email },
      changedBy: { name: changedBy.name, email: changedBy.email },
    })
    .from(roleChanges)
    .innerJoin(user, eq(user.id, roleChanges.userId))
    .innerJoin(changedBy, eq(changedBy.id, roleChanges.changedBy))
    .orderBy(desc(roleChanges.createdAt), desc(roleChanges.id))
    .limit(limit);
}

export type SetRoleResult =
  | { ok: true; changed: boolean; email: string }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "self" | "last-admin" | "unverified"; email: string };

type SetRoleRow = { email: string | null; current: string | null; admins: number; changed: number };

/**
 * Makes `userId` an admin or a customer and records it in `role_changes`, in one statement. It
 * locks every admin row and the target in id order, so two admins removing each other at once
 * can't leave the store with none. Admins can't remove their own role, or the last admin's, and
 * only users who confirmed their email can be made admins (so an address someone signed up with
 * but doesn't own can't be). Removing a role also deletes that user's sessions, signing them out
 * everywhere.
 */
export async function setUserRole({
  actorId,
  userId,
  role,
}: {
  actorId: string;
  userId: string;
  role: Role;
}): Promise<SetRoleResult> {
  if (role !== "user" && role !== "admin") throw new Error(`setUserRole: invalid role ${JSON.stringify(role)}`);

  const { rows } = await db.execute<SetRoleRow>(sql`
    with locked as (
      select id, email, role, email_verified from "user"
      where role = 'admin' or id = ${userId}
      order by id
      for update
    ),
    target as (
      select id, email, role, email_verified from locked where id = ${userId}
    ),
    upd as (
      update "user" u
      set role = ${role}, updated_at = now()
      from target t
      where u.id = t.id and t.role <> ${role}
        and ((${role} = 'admin' and t.email_verified)
          or (${role} = 'user' and u.id <> ${actorId}
            and (select count(*) from locked where role = 'admin') > 1))
      returning u.id, t.role as from_role
    ),
    logged as (
      insert into role_changes (user_id, changed_by, from_role, to_role)
      select id, ${actorId}, from_role, ${role} from upd
      returning id
    ),
    signed_out as (
      delete from session where ${role} = 'user' and user_id in (select id from upd)
    )
    select (select email from target) as email, (select role from target) as current,
      (select count(*) from locked where role = 'admin')::int as admins,
      (select count(*) from logged)::int as changed
  `);

  const [row] = rows;
  if (!row?.email) return { ok: false, reason: "not-found" };
  const { email } = row;
  if (Number(row.changed) > 0) return { ok: true, changed: true, email };
  if (row.current === role) return { ok: true, changed: false, email };
  if (role === "admin") return { ok: false, reason: "unverified", email };
  if (userId === actorId) return { ok: false, reason: "self", email };
  return { ok: false, reason: "last-admin", email };
}
