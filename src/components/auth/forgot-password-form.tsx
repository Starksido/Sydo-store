"use client";

import { useActionState } from "react";

import { authErrorMessage } from "@/components/auth/auth-error";
import { authInput } from "@/components/auth/auth-input";
import { authClient } from "@/lib/auth-client";

type State = { status: "idle" } | { status: "sent" } | { status: "error"; message: string };

/** Emails a password reset link. Answers the same whether or not the address has an account. */
export function ForgotPasswordForm() {
  const [state, submit, pending] = useActionState(async (_: State, formData: FormData): Promise<State> => {
    const { error } = await authClient.requestPasswordReset({
      email: String(formData.get("email")),
      redirectTo: "/reset-password",
    });
    return error ? { status: "error", message: authErrorMessage("forgot-password", error) } : { status: "sent" };
  }, { status: "idle" });

  if (state.status === "sent") {
    return (
      <p role="status" className="border-y py-6">
        If an account uses that address, we&apos;ve sent it a link to choose a new password. It works for one hour.
      </p>
    );
  }

  return (
    <form action={submit} className="space-y-6">
      <label className="block">
        <span className="label">Email address</span>
        <input type="email" name="email" required autoComplete="email" className={authInput} />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-error">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        Send reset link
      </button>
    </form>
  );
}
