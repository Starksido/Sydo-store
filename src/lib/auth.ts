import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/db";
import { authLogger } from "@/lib/auth-logger";

const MIN_SECRET_BYTES = 32;
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
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      // "user" or "admin". `input: false`: sign-up always stores the default and update-user refuses
      // it, so the role can only be changed in the database.
      role: { type: "string", required: true, defaultValue: "user", input: false },
    },
  },
  // Logs the cause of failed database queries, not just "Failed query".
  logger: authLogger,
  // Lets `auth.api.*` calls from Server Actions set cookies. Must stay the last plugin.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
