"use client";

import Link from "next/link";
import { useActionState } from "react";

import { authErrorMessage } from "@/components/auth/auth-error";
import { NewPasswordField } from "@/components/auth/new-password-field";
import { authClient } from "@/lib/auth-client";

type State = { status: "idle" } | { status: "done" } | { status: "error"; message: string; expired: boolean };

/** Sets a new password with the token from a reset link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, submit, pending] = useActionState(async (_: State, formData: FormData): Promise<State> => {
    const { error } = await authClient.resetPassword({ newPassword: String(formData.get("password")), token });
    if (!error) return { status: "done" };
    return {
      status: "error",
      message: authErrorMessage("reset-password", error),
      expired: error.code === "INVALID_TOKEN",
    };
  }, { status: "idle" });

  if (state.status === "done") {
    return (
      <div role="status" className="border-y py-6">
        <p>Your password has been changed, and you&apos;ve been signed out on other devices.</p>
        <Link href="/sign-in" className="btn btn-primary mt-6">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-6">
      <NewPasswordField name="password" label="New password" />
      {state.status === "error" && (
        <p role="alert" className="text-sm text-error">
          {state.message}{" "}
          {state.expired && (
            <Link href="/forgot-password" className="link">
              Get a new link
            </Link>
          )}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        Change password
      </button>
    </form>
  );
}
