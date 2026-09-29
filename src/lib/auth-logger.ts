// Better Auth's logger. Its default prints only the top-level error, which for a failed database
// query is drizzle's "Failed query" wrapper; why the query failed (network, timeout, Postgres
// error) is in `cause`. This prints the cause chain too, and redacts query params, which can hold
// session tokens. Messages can include what users sent (emails, paths), so line breaks and other
// control characters are escaped: a request can't add fake lines to the log.
import type { BetterAuthOptions } from "better-auth";

type AuthLogger = NonNullable<BetterAuthOptions["logger"]>;

const MAX_CAUSE_DEPTH = 5;

const ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/** `text` on one line: control characters and Unicode line separators written as escapes. */
export function escapeLogText(text: string) {
  return text.replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,
    (char) => ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** An error and its causes, one per line, with drizzle's `params:` section redacted. */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      parts.push(escapeLogText(String(current)));
      break;
    }
    const code = (current as { code?: unknown }).code;
    const message = current.message.replace(/\nparams:[\s\S]*$/, "\nparams: [redacted]");
    parts.push(escapeLogText(`${current.name}${code ? ` [${code}]` : ""}: ${message}`));
    current = current.cause;
  }
  return parts.join("\n  caused by: ");
}

export const authLogger: AuthLogger = {
  log(level, message, ...args) {
    // Other values (objects) are printed by console, which escapes the strings inside them.
    const details = args.map((arg) =>
      arg instanceof Error ? describeError(arg) : typeof arg === "string" ? escapeLogText(arg) : arg,
    );
    console[level](`[Better Auth] ${escapeLogText(message)}`, ...details);
  },
};
