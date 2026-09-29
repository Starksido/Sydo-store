// Better Auth's logger. Its default prints only the top-level error, which for a failed database
// query is drizzle's "Failed query" wrapper; why the query failed (network, timeout, Postgres
// error) is in `cause`. This prints the cause chain too, and redacts query params, which can hold
// session tokens.
import type { BetterAuthOptions } from "better-auth";

type AuthLogger = NonNullable<BetterAuthOptions["logger"]>;

const MAX_CAUSE_DEPTH = 5;

/** An error and its causes, one per line, with drizzle's `params:` section redacted. */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    const code = (current as { code?: unknown }).code;
    const message = current.message.replace(/\nparams:[\s\S]*$/, "\nparams: [redacted]");
    parts.push(`${current.name}${code ? ` [${code}]` : ""}: ${message}`);
    current = current.cause;
  }
  return parts.join("\n  caused by: ");
}

export const authLogger: AuthLogger = {
  log(level, message, ...args) {
    const details = args.map((arg) => (arg instanceof Error ? describeError(arg) : arg));
    console[level](`[Better Auth] ${message}`, ...details);
  },
};
