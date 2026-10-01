/** The underlined text field the account forms use. */
export const authInput =
  "mt-2 h-12 w-full border-0 border-b border-ink bg-transparent px-0 text-base placeholder:text-muted";

/** Where the link in a verification email lands, then sends the customer on to `next`. */
export function verifyEmailPath(next: string) {
  return `/verify-email?next=${encodeURIComponent(next)}`;
}
