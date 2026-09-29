import { describe, expect, it } from "vitest";

import { authErrorMessage } from "@/components/auth/auth-error";

describe("authErrorMessage", () => {
  it("doesn't say an email already has an account", () => {
    for (const code of ["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"]) {
      const message = authErrorMessage("sign-up", { code, status: 422 });
      expect(message).toBe(
        "We couldn't create an account with those details. If you already have one, sign in instead.",
      );
      expect(message).not.toMatch(/exists/i);
    }
  });

  it("gives one message for a wrong email or a wrong password", () => {
    expect(authErrorMessage("sign-in", { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toBe(
      "Incorrect email or password.",
    );
    expect(authErrorMessage("sign-in", { status: 401 })).toBe("Incorrect email or password.");
  });

  it("explains input problems and rate limiting", () => {
    expect(authErrorMessage("sign-up", { code: "INVALID_EMAIL", status: 400 })).toBe("Enter a valid email address.");
    expect(authErrorMessage("sign-up", { code: "PASSWORD_TOO_SHORT", status: 400 })).toBe(
      "Use a password of at least 8 characters.",
    );
    expect(authErrorMessage("sign-up", { code: "PASSWORD_TOO_LONG", status: 400 })).toBe("Use a shorter password.");
    expect(authErrorMessage("sign-in", { status: 429 })).toBe("Too many attempts. Please wait a minute and try again.");
  });

  it("never shows anything else the server said", () => {
    for (const mode of ["sign-in", "sign-up"] as const) {
      expect(authErrorMessage(mode, { code: "FAILED_TO_CREATE_USER", status: 500 })).toBe(
        "Something went wrong. Please try again.",
      );
      expect(authErrorMessage(mode, {})).toBe("Something went wrong. Please try again.");
    }
  });
});
