// Runs against the test database only (see tests/test-env.ts), through the real Better Auth instance,
// with Resend mocked: email confirmation, sign-up with a taken address, and password reset.
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";

import { resetCatalog } from "../../tests/fixtures";
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
  vi.unstubAllEnvs();
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

/** Opens a link from an email, as the browser would. */
function open(link: string) {
  return auth.handler(new Request(link, { headers: { origin: ORIGIN } }));
}

function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.startsWith("better-auth.session_token=") && !c.endsWith("="))
    .join("; ");
}

async function signedInAs(cookie: string) {
  const response = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }));
  return ((await response.json()) as { user?: { email: string } } | null)?.user?.email ?? null;
}

async function verifiedOf(email: string) {
  const [row] = await db.select({ verified: user.emailVerified }).from(user).where(eq(user.email, email));
  return row?.verified;
}

/** A user whose email is confirmed. */
async function confirmedUser() {
  const email = `${randomUUID()}@example.com`;
  expect((await post("/sign-up/email", { name: "Wanjiku", email, password: PASSWORD })).status).toBe(200);
  await resend.waitFor(1);
  resend.sent.length = 0;
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  return email;
}

describe("email confirmation", () => {
  it("signs up without a session and emails a link that confirms the address and signs in", async () => {
    const email = `${randomUUID()}@example.com`;
    const callbackURL = "/verify-email?next=%2Fcheckout";

    const signUp = await post("/sign-up/email", { name: "Wanjiku <b>", email, password: PASSWORD, callbackURL });
    expect(signUp.status).toBe(200);
    expect(sessionCookie(signUp)).toBe("");

    const [mail] = await resend.waitFor(1);
    expect(mail).toMatchObject({ to: [email], from: "Sydo <orders@example.com>", subject: "Confirm your email for Sydo" });
    expect(mail.html).toContain("Hello Wanjiku &#60;b&#62;,");
    expect(await verifiedOf(email)).toBe(false);

    // Signing in before confirming is refused, and sends a fresh link.
    const early = await post("/sign-in/email", { email, password: PASSWORD, callbackURL });
    expect(early.status).toBe(403);
    expect(await early.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    await resend.waitFor(2);

    const opened = await open(linkIn(mail.text, "/api/auth/verify-email"));
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toBe(callbackURL);
    expect(await verifiedOf(email)).toBe(true);
    expect(await signedInAs(sessionCookie(opened))).toBe(email);
  });

  it("sends a confirmed or unknown address nothing when a new link is asked for", async () => {
    const email = await confirmedUser();
    for (const address of [email, `${randomUUID()}@example.com`]) {
      const response = await post("/send-verification-email", { email: address, callbackURL: "/verify-email" });
      expect(response.status).toBe(200);
    }
    expect(resend.sent).toEqual([]);
  });

  it("answers a sign-up with a taken address as if it worked, and emails the owner instead", async () => {
    const email = await confirmedUser();

    const again = await post("/sign-up/email", { name: "Someone else", email, password: "another-password-1" });
    expect(again.status).toBe(200);
    expect(sessionCookie(again)).toBe("");

    const [mail] = await resend.waitFor(1);
    expect(mail).toMatchObject({ to: [email], subject: "You already have a Sydo account" });
    expect(mail.text).toContain(`${ORIGIN}/forgot-password`);
    // The account and its password are untouched.
    expect((await post("/sign-in/email", { email, password: PASSWORD })).status).toBe(200);
    expect((await post("/sign-in/email", { email, password: "another-password-1" })).status).toBe(401);
  });
});

describe("password reset", () => {
  it("emails a link that sets a new password, confirms the email and signs out other sessions", async () => {
    const email = await confirmedUser();
    const oldSession = sessionCookie(await post("/sign-in/email", { email, password: PASSWORD }));
    expect(await signedInAs(oldSession)).toBe(email);
    // As if they never confirmed it: the reset link proves they own the address.
    await db.update(user).set({ emailVerified: false }).where(eq(user.email, email));

    const asked = await post("/request-password-reset", { email, redirectTo: "/reset-password" });
    expect(asked.status).toBe(200);
    const [mail] = await resend.waitFor(1);
    expect(mail).toMatchObject({ to: [email], subject: "Reset your Sydo password" });

    const opened = await open(linkIn(mail.text, "/api/auth/reset-password/"));
    expect(opened.status).toBe(302);
    const landing = new URL(opened.headers.get("location")!, ORIGIN);
    expect(landing.pathname).toBe("/reset-password");
    const token = landing.searchParams.get("token")!;

    expect((await post("/reset-password", { newPassword: "new-password-123", token })).status).toBe(200);
    expect(await verifiedOf(email)).toBe(true);
    expect(await signedInAs(oldSession)).toBeNull();
    expect((await post("/sign-in/email", { email, password: PASSWORD })).status).toBe(401);
    expect((await post("/sign-in/email", { email, password: "new-password-123" })).status).toBe(200);

    // The token works once.
    const reused = await post("/reset-password", { newPassword: "another-password-1", token });
    expect(await reused.json()).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("answers the same for an unknown address, and sends nothing", async () => {
    const response = await post("/request-password-reset", {
      email: `${randomUUID()}@example.com`,
      redirectTo: "/reset-password",
    });
    expect(response.status).toBe(200);
    expect(resend.sent).toEqual([]);
  });
});
