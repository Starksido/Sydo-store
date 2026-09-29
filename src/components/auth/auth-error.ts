/** The parts of a Better Auth client error the form looks at. */
export type AuthClientError = { code?: string; status?: number };

/**
 * What the sign-in or sign-up form shows for a failed attempt. Our own wording for the errors we
 * expect, so Better Auth's messages (such as "User already exists") never reach the page.
 */
export function authErrorMessage(mode: "sign-in" | "sign-up", error: AuthClientError) {
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  switch (error.code) {
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    case "PASSWORD_TOO_SHORT":
      return "Use a password of at least 8 characters.";
    case "PASSWORD_TOO_LONG":
      return "Use a shorter password.";
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Incorrect email or password.";
    // Doesn't say the email has an account. Fully hiding that needs email verification.
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "We couldn't create an account with those details. If you already have one, sign in instead.";
  }
  if (mode === "sign-in" && error.status === 401) return "Incorrect email or password.";
  return "Something went wrong. Please try again.";
}
