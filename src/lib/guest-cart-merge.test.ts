// Runs against the test database only (see tests/test-env.ts), through the real Better Auth instance,
// with Resend mocked: a guest's bag joins theirs when a session starts, and the cookie is cleared.
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { carts, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getCart } from "@/lib/cart";
import { hashGuestToken, newGuestToken } from "@/lib/guest-cart-token";

import { createGuestCartLine, createProduct, resetCatalog } from "../../tests/fixtures";
import { linkIn, mockResend } from "../../tests/resend-mock";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery";

let resend: ReturnType<typeof mockResend>;

beforeEach(async () => {
  await resetCatalog();
  resend = mockResend();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function post(path: string, body: Record<string, unknown>, cookie?: string) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie && { cookie }) },
      body: JSON.stringify(body),
    }),
  );
}

/** The `cart` cookie the response sets, if any. */
function cartCookie(response: Response) {
  return response.headers.getSetCookie().find((c) => c.startsWith("cart="));
}

async function userIdOf(email: string) {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return row.id;
}

/** A guest token with one unit of a new product in its bag. */
async function guestWithBag() {
  const token = newGuestToken();
  await createGuestCartLine(hashGuestToken(token), await createProduct(5), 1);
  return token;
}

async function signUp(email: string, cookie?: string) {
  expect((await post("/sign-up/email", { name: "Wanjiku", email, password: PASSWORD }, cookie)).status).toBe(200);
  await resend.waitFor(1);
}

describe("merging a guest bag", () => {
  it("happens on sign-in, clearing the cookie", async () => {
    const email = `${randomUUID()}@example.com`;
    await signUp(email);
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
    const token = await guestWithBag();

    const response = await post("/sign-in/email", { email, password: PASSWORD }, `cart=${token}`);

    expect(response.status).toBe(200);
    expect(cartCookie(response)).toMatch(/^cart=;.*Max-Age=0/i);
    expect((await getCart({ userId: await userIdOf(email) })).count).toBe(1);
    expect(await db.select().from(carts).where(eq(carts.tokenHash, hashGuestToken(token)))).toEqual([]);
  });

  it("happens when the confirmation link signs a new user in", async () => {
    const email = `${randomUUID()}@example.com`;
    const token = await guestWithBag();
    await signUp(email, `cart=${token}`);
    // Sign-up makes no session, so nothing is merged yet.
    expect((await getCart({ tokenHash: hashGuestToken(token) })).count).toBe(1);

    const response = await auth.handler(
      new Request(linkIn(resend.sent[0].text, "/api/auth/verify-email"), {
        headers: { origin: ORIGIN, cookie: `cart=${token}` },
      }),
    );

    expect(cartCookie(response)).toMatch(/^cart=;/);
    expect((await getCart({ userId: await userIdOf(email) })).count).toBe(1);
  });

  it("leaves the bag alone when the sign-in fails, and ignores a forged cookie", async () => {
    const email = `${randomUUID()}@example.com`;
    await signUp(email);
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
    const token = await guestWithBag();

    const wrong = await post("/sign-in/email", { email, password: "not-the-password" }, `cart=${token}`);
    expect(wrong.status).toBe(401);
    expect(cartCookie(wrong)).toBeUndefined();
    expect((await getCart({ tokenHash: hashGuestToken(token) })).count).toBe(1);

    const forged = await post("/sign-in/email", { email, password: PASSWORD }, "cart=forged");
    expect(forged.status).toBe(200);
    expect(cartCookie(forged)).toBeUndefined();
    expect((await getCart({ userId: await userIdOf(email) })).count).toBe(0);
  });
});
