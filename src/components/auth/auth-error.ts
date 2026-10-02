/** The parts of a Better Auth client error the form looks at. */
export type AuthClientError = { code?: string; status?: number };

export type AuthFormMode = "sign-in" | "sign-up" | "forgot-password" | "reset-password" | "change-password" | "verify-email";

/**
 * What an account form shows for a failed attempt. Our own wording for the errors we expect, so
 * Better Auth's messages (such as "User already exists") never reach the page.
 */
export function authErrorMessage(mode: AuthFormMode, error: AuthClientError) {
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  switch (error.code) {
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    case "PASSWORD_TOO_SHORT":
      return "Use a password of at least 8 characters.";
    // Refused by the strength check in src/lib/auth.ts; the form's meter says why.
    case "WEAK_PASSWORD":
      return "That password is too easy to guess. Try a longer one, such as a few unrelated words.";
    case "PASSWORD_TOO_LONG":
      return "Use a shorter password.";
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Incorrect email or password.";
    // Sign-in with the right password before the email is confirmed; a new code was just sent.
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email address first. We've sent you a new code.";
    case "INVALID_OTP":
      return "That code isn't right. Check the latest email we sent, or ask for a new code.";
    case "OTP_EXPIRED":
      return "That code has expired. Ask for a new one.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong codes. Ask for a new one.";
    case "INVALID_TOKEN":
      return "This link has expired or has already been used. Ask for a new one.";
    case "INVALID_PASSWORD":
      return "Your current password is incorrect.";
    // Sign-up answers as if it worked when the email has an account (the owner is emailed instead),
    // so this only shows if that changes. It still doesn't say the email has an account.
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "We couldn't create an account with those details. If you already have one, sign in instead.";
  }
  if (mode === "sign-in" && error.status === 401) return "Incorrect email or password.";
  return "Something went wrong. Please try again.";
}

/**
 * Why a Google sign-in came back to /sign-in with `?error=`. Our own wording, never Google's or
 * Better Auth's.
 */
export function googleErrorMessage(code: string) {
  switch (code) {
    // An account with this email exists but isn't confirmed, so it wasn't linked (it could have
    // been made by someone else). Resetting the password confirms the email.
    case "account_not_linked":
      return "An account with this email already exists but isn't confirmed. Sign in with your password, or use “Forgot your password?” to confirm it, then Google will work too.";
    case "access_denied":
      return "Google sign-in was cancelled.";
    case "email_not_verified":
      return "Google hasn't confirmed your email address, so we've emailed you a 6-digit code to confirm it.";
    case "email_not_found":
      return "Your Google account didn't share an email address, so we couldn't sign you in with it.";
  }
  return "Google sign-in didn't work. Please try again, or use your email and password.";
}
