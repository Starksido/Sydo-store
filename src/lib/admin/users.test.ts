// Runs against the test database only (see tests/test-env.ts).
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { roleChanges, session, user } from "@/db/schema";
import { listRoleChanges, listUsers, setUserRole } from "@/lib/admin/users";

import { createProduct, createUser, resetCatalog } from "../../../tests/fixtures";
import { createOrder } from "../../../tests/orders";

beforeEach(resetCatalog);

async function createAdmin() {
  const id = await createUser();
  await db.update(user).set({ role: "admin" }).where(eq(user.id, id));
  return id;
}

async function roleOf(id: string) {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, id));
  return row?.role;
}

async function signIn(userId: string) {
  const expiresAt = new Date(Date.now() + 86_400_000);
  await db.insert(session).values({ id: randomUUID(), token: randomUUID(), expiresAt, updatedAt: new Date(), userId });
}

async function sessionCount(userId: string) {
  return (await db.select().from(session).where(eq(session.userId, userId))).length;
}

async function emailOf(id: string) {
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, id));
  return row.email;
}

describe("setUserRole", () => {
  it("makes a customer an admin and logs it, keeping their sessions", async () => {
    const actorId = await createAdmin();
    const userId = await createUser();
    await signIn(userId);

    expect(await setUserRole({ actorId, userId, role: "admin" })).toEqual({
      ok: true,
      changed: true,
      email: await emailOf(userId),
    });
    expect(await roleOf(userId)).toBe("admin");
    expect(await sessionCount(userId)).toBe(1);
    expect(await db.select().from(roleChanges)).toEqual([
      expect.objectContaining({ userId, changedBy: actorId, fromRole: "user", toRole: "admin" }),
    ]);
  });

  it("removes another admin's role, signing them out everywhere", async () => {
    const actorId = await createAdmin();
    const userId = await createAdmin();
    await signIn(userId);
    await signIn(userId);
    await signIn(actorId);

    expect(await setUserRole({ actorId, userId, role: "user" })).toMatchObject({ ok: true, changed: true });
    expect(await roleOf(userId)).toBe("user");
    expect(await sessionCount(userId)).toBe(0);
    expect(await sessionCount(actorId)).toBe(1);
    expect(await db.select().from(roleChanges)).toEqual([
      expect.objectContaining({ userId, changedBy: actorId, fromRole: "admin", toRole: "user" }),
    ]);
  });

  it("writes nothing when the role is already set", async () => {
    const actorId = await createAdmin();
    const userId = await createUser();
    await signIn(userId);

    expect(await setUserRole({ actorId, userId, role: "user" })).toMatchObject({ ok: true, changed: false });
    expect(await setUserRole({ actorId, userId: actorId, role: "admin" })).toMatchObject({ ok: true, changed: false });
    expect(await sessionCount(userId)).toBe(1);
    expect(await db.select().from(roleChanges)).toEqual([]);
  });

  it("refuses removing your own role, or the last admin's", async () => {
    const actorId = await createAdmin();
    await signIn(actorId);

    expect(await setUserRole({ actorId, userId: actorId, role: "user" })).toEqual({
      ok: false,
      reason: "self",
      email: await emailOf(actorId),
    });

    // The last-admin check doesn't depend on who asks: once one admin is left, nobody can remove them.
    const other = await createAdmin();
    await db.update(user).set({ role: "user" }).where(eq(user.id, actorId));
    expect(await setUserRole({ actorId, userId: other, role: "user" })).toMatchObject({
      ok: false,
      reason: "last-admin",
    });

    expect(await roleOf(actorId)).toBe("user");
    expect(await roleOf(other)).toBe("admin");
    expect(await sessionCount(actorId)).toBe(1);
    expect(await db.select().from(roleChanges)).toEqual([]);
  });

  it("leaves one admin when two admins remove each other at once", async () => {
    const [a, b] = [await createAdmin(), await createAdmin()];

    const results = await Promise.all([
      setUserRole({ actorId: a, userId: b, role: "user" }),
      setUserRole({ actorId: b, userId: a, role: "user" }),
    ]);

    expect(results.filter((result) => result.ok && result.changed)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === "last-admin")).toHaveLength(1);
    expect([await roleOf(a), await roleOf(b)].sort()).toEqual(["admin", "user"]);
    expect(await db.select().from(roleChanges)).toHaveLength(1);
  });

  it("refuses making a user whose email isn't confirmed an admin", async () => {
    const actorId = await createAdmin();
    const userId = await createUser();
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, userId));

    expect(await setUserRole({ actorId, userId, role: "admin" })).toMatchObject({ ok: false, reason: "unverified" });
    expect(await roleOf(userId)).toBe("user");
    expect(await db.select().from(roleChanges)).toEqual([]);
  });

  it("reports an unknown user, and throws on an invalid role", async () => {
    const actorId = await createAdmin();
    expect(await setUserRole({ actorId, userId: "nobody", role: "admin" })).toEqual({ ok: false, reason: "not-found" });
    await expect(setUserRole({ actorId, userId: actorId, role: "owner" as "admin" })).rejects.toThrow("invalid role");
  });
});

describe("listUsers / listRoleChanges", () => {
  it("lists users newest first with order counts, filtered by name, email and role", async () => {
    const actorId = await createAdmin();
    const customer = await createUser();
    await createOrder(customer, [[await createProduct(5), 1]]);
    await db.update(user).set({ name: "Wanjiku 100%" }).where(eq(user.id, customer));

    const { users, hasMore } = await listUsers();
    expect(hasMore).toBe(false);
    expect(users.map((u) => [u.id, u.role, u.orders])).toEqual([
      [customer, "user", 1],
      [actorId, "admin", 0],
    ]);
    expect((await listUsers({ q: "100%" })).users.map((u) => u.id)).toEqual([customer]);
    expect((await listUsers({ q: "10_%" })).users).toEqual([]);
    expect((await listUsers({ q: (await emailOf(actorId)).slice(0, 12) })).users.map((u) => u.id)).toEqual([actorId]);
    expect((await listUsers({ admins: true })).users.map((u) => u.id)).toEqual([actorId]);
    expect(await listUsers({ page: 2, pageSize: 1 })).toMatchObject({ users: [{ id: actorId }], hasMore: false });
  });

  it("lists role changes newest first, with who made them", async () => {
    const actorId = await createAdmin();
    const userId = await createUser();
    await setUserRole({ actorId, userId, role: "admin" });
    await setUserRole({ actorId, userId, role: "user" });

    const [actorEmail, userEmail] = [await emailOf(actorId), await emailOf(userId)];
    expect(await listRoleChanges()).toEqual([
      expect.objectContaining({ toRole: "user", user: expect.objectContaining({ email: userEmail }) }),
      expect.objectContaining({
        toRole: "admin",
        user: expect.objectContaining({ email: userEmail }),
        changedBy: expect.objectContaining({ email: actorEmail }),
      }),
    ]);
  });
});
