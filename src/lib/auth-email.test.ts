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

/** The 6-digit code in a confirmation email. */
function codeIn(mail: { text: string }) {
  const match = /^(\d{6})$/m.exec(mail.text);
  if (!match) throw new Error("no code in the email");
  return match[1];
}

function verify(email: string, otp: string, cookie?: string) {
  return post("/email-otp/verify-email", { email, otp }, cookie);
}

describe("email confirmation", () => {
  it("signs up without a session and emails a code that confirms the address and signs in", async () => {
    const email = `${randomUUID()}@example.com`;

    const signUp = await post("/sign-up/email", { name: "Wanjiku <b>", email, password: PASSWORD });
    expect(signUp.status).toBe(200);
    expect(sessionCookie(signUp)).toBe("");

    const [mail] = await resend.waitFor(1);
    const code = codeIn(mail);
    expect(mail).toMatchObject({ to: [email], from: "Sydo <orders@example.com>", subject: `${code} is your Sydo confirmation code` });
    expect(mail.html).toContain("Hello Wanjiku &#60;b&#62;,");
    expect(mail.text).not.toMatch(/https?:\/\//);
    expect(await verifiedOf(email)).toBe(false);

    // Signing in before confirming is refused, and sends a fresh code (the first stops working).
    const early = await post("/sign-in/email", { email, password: PASSWORD });
    expect(early.status).toBe(403);
    expect(await early.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    const [, second] = await resend.waitFor(2);
    const fresh = codeIn(second);
    if (fresh !== code) expect(await (await verify(email, code)).json()).toMatchObject({ code: "INVALID_OTP" });

    const confirmed = await verify(email, fresh);
    expect(confirmed.status).toBe(200);
    expect(await verifiedOf(email)).toBe(true);
    expect(await signedInAs(sessionCookie(confirmed))).toBe(email);
    // A code works once.
    expect((await verify(email, fresh)).status).toBe(400);
  });

  it("refuses wrong codes, and the code itself after five wrong tries", async () => {
    const email = `${randomUUID()}@example.com`;
    expect((await post("/sign-up/email", { name: "Wanjiku", email, password: PASSWORD })).status).toBe(200);
    const code = codeIn((await resend.waitFor(1))[0]);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await (await verify(email, wrong)).json()).toMatchObject({ code: "INVALID_OTP" });
    }
    expect(await (await verify(email, code)).json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    expect(await verifiedOf(email)).toBe(false);
  });

  it("sends a new code only to an unconfirmed address, answering the same for any", async () => {
    const unconfirmed = `${randomUUID()}@example.com`;
    expect((await post("/sign-up/email", { name: "Wanjiku", email: unconfirmed, password: PASSWORD })).status).toBe(200);
    await resend.waitFor(1);
    resend.sent.length = 0;
    const confirmed = await confirmedUser();

    for (const address of [confirmed, `${randomUUID()}@example.com`, unconfirmed]) {
      const response = await post("/email-otp/send-verification-otp", { email: address, type: "email-verification" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
    }
    const sent = await resend.waitFor(1);
    expect(sent.map((mail) => mail.to)).toEqual([[unconfirmed]]);
  });

  it("keeps the plugin's other routes closed: no sign-in or password reset by code", async () => {
    const email = await confirmedUser();
    for (const [path, body] of [
      ["/email-otp/send-verification-otp", { email, type: "sign-in" }],
      ["/email-otp/send-verification-otp", { email, type: "forget-password" }],
      ["/sign-in/email-otp", { email, otp: "123456" }],
      ["/email-otp/request-password-reset", { email }],
      ["/forget-password/email-otp", { email }],
      ["/email-otp/reset-password", { email, otp: "123456", password: "a-new-long-passphrase-here" }],
      ["/email-otp/check-verification-otp", { email, type: "sign-in", otp: "123456" }],
      ["/email-otp/request-email-change", { newEmail: "x@example.com" }],
    ] as const) {
      expect((await post(path, body)).status, path).toBe(404);
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

describe("weak passwords", () => {
  it("are refused at sign-up, including ones built from the person's name or email", async () => {
    for (const [password, name] of [
      ["123456789", "Wanjiku"],
      ["password1", "Wanjiku"],
      ["qwertyuiop", "Wanjiku"],
      ["Wanjiku2026!", "Wanjiku"],
    ]) {
      const response = await post("/sign-up/email", { name, email: `${randomUUID()}@example.com`, password });
      expect(response.status, password).toBe(400);
      expect(await response.json(), password).toMatchObject({ code: "WEAK_PASSWORD" });
    }
    expect(resend.sent).toEqual([]);
    expect(await db.$count(user)).toBe(0);
  });

  it("are refused when resetting or changing a password", async () => {
    const email = await confirmedUser();
    const session = sessionCookie(await post("/sign-in/email", { email, password: PASSWORD }));

    const change = await post("/change-password", { currentPassword: PASSWORD, newPassword: "12345678910" }, session);
    expect(await change.json()).toMatchObject({ code: "WEAK_PASSWORD" });

    await post("/request-password-reset", { email, redirectTo: "/reset-password" });
    const [mail] = await resend.waitFor(1);
    const opened = await open(linkIn(mail.text, "/api/auth/reset-password/"));
    const token = new URL(opened.headers.get("location")!, ORIGIN).searchParams.get("token")!;
    const reset = await post("/reset-password", { newPassword: "password123", token });
    expect(await reset.json()).toMatchObject({ code: "WEAK_PASSWORD" });

    // The old password still works; a strong new one is taken.
    expect((await post("/sign-in/email", { email, password: PASSWORD })).status).toBe(200);
    expect((await post("/reset-password", { newPassword: "lantern orchard river", token })).status).toBe(200);
  });
});
