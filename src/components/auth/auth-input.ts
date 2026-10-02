/** The underlined text field the account forms use. */
export const authInput =
  "mt-2 h-12 w-full border-0 border-b border-ink bg-transparent px-0 text-base placeholder:text-muted";

/**
 * The page where a customer types the code from their confirmation email, then goes on to `next`.
 * `email` fills in the address; `sent` says a new code was just sent (after a sign-in).
 */
export function verifyEmailPath(next: string, email?: string, sent = false) {
  const params = new URLSearchParams({ next });
  if (email) params.set("email", email);
  if (sent) params.set("sent", "1");
  return `/verify-email?${params}`;
}
