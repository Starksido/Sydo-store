// Runs against the test database only (see tests/test-env.ts), through the real Better Auth instance,
// with Google faked: its token endpoint answers with an ID token for the profile a test chooses.
// Nothing reaches Google.
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { account, user } from "@/db/schema";
import { hasPassword } from "@/lib/account";
import { auth } from "@/lib/auth";
import { getCart } from "@/lib/cart";
import { hashGuestToken, newGuestToken } from "@/lib/guest-cart-token";

import { createGuestCartLine, createProduct, resetCatalog } from "../../tests/fixtures";
import { linkIn, mockResend } from "../../tests/resend-mock";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery";

type GoogleProfile = { email: string; emailVerified?: boolean; name?: string };

beforeEach(resetCatalog);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** An unsigned JWT: Better Auth reads the ID token Google's token endpoint returns without verifying it. */
function idToken({ email, emailVerified = true, name = "Wanjiku Kamau" }: GoogleProfile) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    part({ alg: "RS256", typ: "JWT" }),
    part({
      iss: "https://accounts.google.com",
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: `google-${email}`,
      email,
      email_verified: emailVerified,
      name,
      iat: now,
      exp: now + 3600,
    }),
    "signature",
  ].join(".");
}

/** Fakes Google's token endpoint; every other request (the database) goes through. */
function fakeGoogle(profile: GoogleProfile) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({
        access_token: "ya29.test",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid email profile",
        id_token: idToken(profile),
      });
    }
    return realFetch(input, init);
  });
}

function cookiesFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="));
}

/**
 * "Continue with Google" from start to finish: the start request, then Google sending the browser
 * back to our callback. Returns the callback's response and the cookies the browser would hold.
 */
async function signInWithGoogle(profile: GoogleProfile, cookie = "") {
  fakeGoogle(profile);
  const start = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie && { cookie }) },
      body: JSON.stringify({ provider: "google", callbackURL: "/checkout", errorCallbackURL: "/sign-in?next=%2Fcheckout" }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  expect(new URL(url).hostname).toBe("accounts.google.com");
  const state = new URL(url).searchParams.get("state")!;

  const jar = [cookie, ...cookiesFrom(start)].filter(Boolean).join("; ");
  const callback = await auth.handler(
    new Request(`${ORIGIN}/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: jar },
    }),
  );
  return { callback, location: callback.headers.get("location") ?? "", cookies: cookiesFrom(callback).join("; ") };
}

async function signedInAs(cookie: string) {
  const response = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }));
  return ((await response.json()) as { user?: { email: string } } | null)?.user?.email ?? null;
}

async function userRow(email: string) {
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return row;
}

async function signUpWithPassword(email: string) {
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name: "Wanjiku", email, password: PASSWORD }),
    }),
  );
  expect(response.status).toBe(200);
}

describe("Continue with Google", () => {
  it("creates a confirmed customer (never an admin), signed in, with no password", async () => {
    const email = `${randomUUID()}@gmail.com`;

    const { location, cookies } = await signInWithGoogle({ email });

    expect(location).toBe("/checkout");
    expect(await signedInAs(cookies)).toBe(email);
    const created = await userRow(email);
    expect(created).toMatchObject({ emailVerified: true, role: "user", name: "Wanjiku Kamau" });
    expect(await hasPassword(created.id)).toBe(false);
  });

  it("links Google to an existing confirmed account with the same email", async () => {
    const email = `${randomUUID()}@gmail.com`;
    await signUpWithPassword(email);
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));

    const { location, cookies } = await signInWithGoogle({ email });

    expect(location).toBe("/checkout");
    expect(await signedInAs(cookies)).toBe(email);
    const { id } = await userRow(email);
    const providers = (await db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, id)))
      .map((row) => row.providerId)
      .sort();
    expect(providers).toEqual(["credential", "google"]);
    expect(await db.$count(user)).toBe(1);
  });

  it("refuses to link an account whose email isn't confirmed, saying why", async () => {
    const email = `${randomUUID()}@gmail.com`;
    await signUpWithPassword(email);

    const { location, cookies } = await signInWithGoogle({ email });

    const landing = new URL(location, ORIGIN);
    expect(landing.pathname).toBe("/sign-in");
    expect(landing.searchParams.get("error")).toBe("account_not_linked");
    expect(landing.searchParams.get("next")).toBe("/checkout");
    expect(await signedInAs(cookies)).toBeNull();
    const { id, emailVerified } = await userRow(email);
    expect(emailVerified).toBe(false);
    expect(await db.select().from(account).where(eq(account.userId, id))).toHaveLength(1);
  });

  it("signs no one in whose email Google hasn't confirmed, sending them to confirm it with our code", async () => {
    const email = `${randomUUID()}@gmail.com`;

    const { location, cookies } = await signInWithGoogle({ email, emailVerified: false });

    const landing = new URL(location, ORIGIN);
    expect(landing.pathname).toBe("/sign-in");
    expect(landing.searchParams.get("error")).toBe("email_not_verified");
    expect(await signedInAs(cookies)).toBeNull();
    expect((await userRow(email)).emailVerified).toBe(false);
  });

  it("brings a guest's bag along", async () => {
    const email = `${randomUUID()}@gmail.com`;
    const token = newGuestToken();
    await createGuestCartLine(hashGuestToken(token), await createProduct(5), 2);

    const { callback } = await signInWithGoogle({ email }, `cart=${token}`);

    expect(callback.headers.getSetCookie().find((c) => c.startsWith("cart="))).toMatch(/^cart=;/);
    expect((await getCart({ userId: (await userRow(email)).id })).count).toBe(2);
  });

  it("lets a Google-only customer add a password with Forgot your password?", async () => {
    const email = `${randomUUID()}@gmail.com`;
    await signInWithGoogle({ email });
    vi.unstubAllGlobals();
    const resend = mockResend();

    const post = (path: string, body: object) =>
      auth.handler(
        new Request(`${ORIGIN}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify(body),
        }),
      );
    await post("/request-password-reset", { email, redirectTo: "/reset-password" });
    const [mail] = await resend.waitFor(1);
    const opened = await auth.handler(new Request(linkIn(mail.text, "/api/auth/reset-password/")));
    const token = new URL(opened.headers.get("location")!, ORIGIN).searchParams.get("token")!;
    expect((await post("/reset-password", { newPassword: "lantern orchard river", token })).status).toBe(200);

    expect(await hasPassword((await userRow(email)).id)).toBe(true);
    expect((await post("/sign-in/email", { email, password: "lantern orchard river" })).status).toBe(200);
  });
});
