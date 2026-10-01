// Runs against the test database only (see tests/test-env.ts), through the real Better Auth instance.
// Only the request headers and Next's redirect/notFound are mocked.
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";

import { resetCatalog } from "../../tests/fixtures";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const ORIGIN = "http://localhost:3000";

beforeEach(async () => {
  await resetCatalog();
});

/** A JSON POST to Better Auth's route handler, as the browser client would send it. */
function post(path: string, body: Record<string, unknown>, cookie?: string) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie && { cookie }) },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Signs up a new user, confirms its email (sign-in needs that) and signs in. Returns its id, stored
 * role and session cookie.
 */
async function signUp(extra: Record<string, unknown> = {}) {
  const email = `${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  expect((await post("/sign-up/email", { name: "Test user", email, password, ...extra })).status).toBe(200);
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  const response = await post("/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { ...(await getUser(email)), cookie };
}

async function getUser(email: string) {
  const [row] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.email, email));
  return row;
}

async function setRole(id: string, role: string) {
  await db.update(user).set({ role }).where(eq(user.id, id));
}

function requestWith(cookie?: string) {
  vi.mocked(headers).mockResolvedValue(new Headers(cookie ? { cookie } : {}) as Awaited<ReturnType<typeof headers>>);
}

describe("role", () => {
  it("is 'user' after sign-up, even when the request asks for admin", async () => {
    expect((await signUp()).role).toBe("user");
    expect((await signUp({ role: "admin" })).role).toBe("user");
  });

  it("can't be changed through update-user", async () => {
    const { id, cookie } = await signUp();

    const refused = await post("/update-user", { role: "admin" }, cookie);
    expect(refused.status).toBe(400);
    expect((await refused.json()).code).toBe("FIELD_NOT_ALLOWED");

    // The same session can still update the fields users may change.
    expect((await post("/update-user", { name: "New name" }, cookie)).status).toBe(200);
    const [row] = await db.select({ name: user.name, role: user.role }).from(user).where(eq(user.id, id));
    expect(row).toEqual({ name: "New name", role: "user" });
  });
});

describe("requireAdmin", () => {
  it("sends signed-out visitors to sign-in and back", async () => {
    requestWith();
    await expect(requireAdmin("/admin/products?page=2")).rejects.toThrow(
      "REDIRECT /sign-in?next=%2Fadmin%2Fproducts%3Fpage%3D2",
    );

    requestWith("better-auth.session_token=forged.value");
    await expect(requireAdmin("/admin")).rejects.toThrow("REDIRECT /sign-in?next=%2Fadmin");
  });

  it("gives customers a 404", async () => {
    const { cookie } = await signUp();
    requestWith(cookie);
    await expect(requireAdmin("/admin")).rejects.toThrow("NOT_FOUND");
  });

  it("returns the session for admins, and stops as soon as the role is removed", async () => {
    const { id, cookie } = await signUp();
    await setRole(id, "admin");
    requestWith(cookie);
    expect((await requireAdmin("/admin")).user).toMatchObject({ id, role: "admin" });

    await setRole(id, "user");
    await expect(requireAdmin("/admin")).rejects.toThrow("NOT_FOUND");
  });
});
