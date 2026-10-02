import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { user as users } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { authLogger } from "@/lib/auth-logger";
import { inBackground } from "@/lib/background";
import { mergeGuestCart } from "@/lib/cart";
import { trySendEmail } from "@/lib/email/send";
import { existingAccountContent, resetPasswordContent, verifyEmailContent } from "@/lib/email/templates";
import { GUEST_CART_COOKIE, guestCookieOptions, hashGuestToken, readGuestToken } from "@/lib/guest-cart-token";
import { checkPassword } from "@/lib/password-strength";

const MIN_SECRET_BYTES = 32;

/**
 * Google sign-in is on only when both keys are set (Google Cloud Console → APIs & Services →
 * Credentials → an OAuth client of type "Web application"). Without them the button isn't shown.
 */
export function isGoogleSignInEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

/** How long an email confirmation code works, in seconds. */
export const EMAIL_CODE_MINUTES = 10;

/**
 * The email-code plugin's endpoints that stay open: sending a confirmation code and checking it.
 * Its other endpoints (sign-in by code, password reset by code, email change) are refused, so a
 * password is still needed to sign in and resets stay the emailed link.
 */
const OPEN_EMAIL_CODE_PATHS = new Set(["/email-otp/send-verification-otp", "/email-otp/verify-email"]);
const EMAIL_CODE_PATH = /^\/(email-otp\/|sign-in\/email-otp|forget-password\/email-otp)/;

/** Where a new password arrives, its field, and whose details it mustn't be built from. */
const NEW_PASSWORD_PATHS: Record<string, { field: string; inputs: string[] }> = {
  "/sign-up/email": { field: "password", inputs: ["name", "email"] },
  "/reset-password": { field: "newPassword", inputs: [] },
  "/change-password": { field: "newPassword", inputs: [] },
};
const GENERATE_HINT = "Generate one with `npx auth secret` or `openssl rand -base64 32`.";

/**
 * Better Auth signs sessions and email-verification tokens with this secret, so a guessable one
 * allows account takeover. Better Auth itself only warns about weak secrets (and silently uses a
 * public default outside production), so refuse to start unless the secret is present in every
 * environment and looks like 32+ bytes of random data encoded as hex or base64. The character-variety
 * check catches placeholders and passphrases; it can't prove randomness.
 */
function readAuthSecret() {
  if (process.env.BETTER_AUTH_SECRETS) {
    throw new Error("BETTER_AUTH_SECRETS (secret rotation) is not supported; set BETTER_AUTH_SECRET instead.");
  }

  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(`BETTER_AUTH_SECRET is not set. ${GENERATE_HINT}`);
  }

  const distinctChars = new Set(secret).size;
  const isHex = /^[0-9a-f]+$/i.test(secret);
  const isBase64 = /^[A-Za-z0-9+/_-]+={0,2}$/.test(secret);
  const bytes = isHex
    ? secret.length / 2
    : isBase64
      ? Buffer.from(secret, secret.includes("-") || secret.includes("_") ? "base64url" : "base64").length
      : 0;
  const random = isHex ? distinctChars >= 12 : isBase64 && distinctChars >= 20;

  if (bytes < MIN_SECRET_BYTES || !random) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_BYTES} random bytes encoded as hex or base64. ${GENERATE_HINT}`,
    );
  }
  return secret;
}

export const auth = betterAuth({
  secret: readAuthSecret(),
  // From configuration, never the request's Host header; only our own origin may call auth endpoints.
  baseURL: appUrl(),
  trustedOrigins: [appUrl()],
  database: drizzleAdapter(db, { provider: "pg" }),
  // On in production (Better Auth's default). Kept in the database: on serverless, each instance
  // would otherwise count separately in memory.
  rateLimit: { storage: "database" },
  emailAndPassword: {
    enabled: true,
    // No session until the email is confirmed. Sign-up then answers the same whether or not the
    // email already has an account (the owner gets an email instead), so it can't be used to
    // find out who has one.
    requireEmailVerification: true,
    sendResetPassword: ({ user, url }) =>
      trySendEmail("password-reset", { to: user.email, ...resetPasswordContent({ name: user.name, url }) }),
    // The reset link proved they own the address, and signs them out everywhere else.
    onPasswordReset: async ({ user }) => {
      await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
    },
    revokeSessionsOnPasswordReset: true,
    onExistingUserSignUp: ({ user }) =>
      trySendEmail("existing-account", {
        to: user.email,
        ...existingAccountContent({
          name: user.name,
          signInUrl: `${appUrl()}/sign-in`,
          resetUrl: `${appUrl()}/forgot-password`,
        }),
      }),
  },
  // Confirmation emails carry a 6-digit code (the email-code plugin below sends them), typed in on
  // /verify-email; the right code confirms the address and signs the customer in.
  emailVerification: {
    sendOnSignUp: true,
    // A sign-in with the right password but an unconfirmed email sends a fresh code.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
  },
  // "Continue with Google". Google has confirmed the email, so new customers skip the code. Signing
  // in with Google links it to an existing account with that email only when both Google and our
  // account have it confirmed: an unconfirmed account could have been made by someone else.
  socialProviders: isGoogleSignInEnabled()
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
          prompt: "select_account",
          // A Google account whose email Google hasn't confirmed gets no session: we email our own
          // code instead, as for an email sign-up.
          requireEmailVerification: true,
        },
      }
    : undefined,
  account: { accountLinking: { enabled: true, requireLocalEmailVerified: true } },
  user: {
    additionalFields: {
      // "user" or "admin". `input: false`: sign-up always stores the default and update-user refuses
      // it, so the role can only be changed in the database.
      role: { type: "string", required: true, defaultValue: "user", input: false },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (EMAIL_CODE_PATH.test(ctx.path)) {
        if (!OPEN_EMAIL_CODE_PATHS.has(ctx.path)) throw new APIError("NOT_FOUND");
        if (ctx.path === "/email-otp/send-verification-otp") {
          if (ctx.body?.type !== "email-verification") throw new APIError("NOT_FOUND");
          // A confirmed (or unknown) address gets nothing, with the same answer as any other.
          const email = typeof ctx.body.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
          const [found] = email
            ? await db.select({ verified: users.emailVerified }).from(users).where(eq(users.email, email))
            : [];
          if (!found || found.verified) return ctx.json({ success: true });
        }
        return;
      }
      // Weak passwords are refused wherever a new one is set; the forms show a strength meter.
      const rule = NEW_PASSWORD_PATHS[ctx.path];
      const password = rule && ctx.body?.[rule.field];
      if (typeof password === "string") {
        const inputs = rule.inputs.map((name) => (typeof ctx.body?.[name] === "string" ? ctx.body[name] : null));
        if (!checkPassword(password, inputs).ok) {
          throw new APIError("BAD_REQUEST", { code: "WEAK_PASSWORD", message: "Choose a stronger password." });
        }
      }
    }),
    // Whenever a session starts (sign-in, Google, or the code from the confirmation email), a guest's bag from
    // the `cart` cookie joins the user's and the cookie is cleared. A failed merge doesn't fail the
    // sign-in: the cookie stays, so the next sign-in tries again.
    after: createAuthMiddleware(async (ctx) => {
      const session = ctx.context.newSession;
      const token = session && readGuestToken(ctx.getCookie(GUEST_CART_COOKIE));
      if (!session || !token) return;
      try {
        await mergeGuestCart(hashGuestToken(token), session.user.id);
        ctx.setCookie(GUEST_CART_COOKIE, "", guestCookieOptions(0));
      } catch (error) {
        console.error("[cart] could not merge the guest bag on sign-in", error);
      }
    }),
  },
  // Logs the cause of failed database queries, not just "Failed query".
  logger: authLogger,
  // Emails go out after the response, so answers don't take longer when an email is sent (which
  // would show whether an address has an account).
  advanced: { backgroundTasks: { handler: inBackground } },
  plugins: [
    // Replaces confirmation links with 6-digit codes. Codes are stored hashed, work for
    // EMAIL_CODE_MINUTES and allow 5 tries; asking for a new one replaces the old one. Only the
    // paths in OPEN_EMAIL_CODE_PATHS are reachable (see `hooks.before`).
    emailOTP({
      overrideDefaultEmailVerification: true,
      otpLength: 6,
      expiresIn: EMAIL_CODE_MINUTES * 60,
      allowedAttempts: 5,
      storeOTP: "hashed",
      disableSignUp: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== "email-verification") return;
        const [found] = await db.select({ name: users.name }).from(users).where(eq(users.email, email));
        await trySendEmail("verify-email", {
          to: email,
          ...verifyEmailContent({ name: found?.name ?? "", code: otp, minutes: EMAIL_CODE_MINUTES }),
        });
      },
    }),
    // Lets `auth.api.*` calls from Server Actions set cookies. Must stay the last plugin.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
