"use client";

import { useActionState } from "react";

import { authErrorMessage } from "@/components/auth/auth-error";
import { authInput } from "@/components/auth/auth-input";
import { authClient } from "@/lib/auth-client";

type State = { status: "idle" } | { status: "done" } | { status: "error"; message: string };

/** Changes the signed-in customer's password and signs them out on their other devices. */
export function ChangePasswordForm() {
  const [state, submit, pending] = useActionState(async (_: State, formData: FormData): Promise<State> => {
    const { error } = await authClient.changePassword({
      currentPassword: String(formData.get("currentPassword")),
      newPassword: String(formData.get("newPassword")),
      revokeOtherSessions: true,
    });
    return error ? { status: "error", message: authErrorMessage("change-password", error) } : { status: "done" };
  }, { status: "idle" });

  return (
    <form action={submit} className="max-w-sm space-y-6">
      <label className="block">
        <span className="label">Current password</span>
        <input type="password" name="currentPassword" required autoComplete="current-password" className={authInput} />
      </label>
      <label className="block">
        <span className="label">New password</span>
        <input type="password" name="newPassword" required minLength={8} autoComplete="new-password" className={authInput} />
        <span className="mt-2 block text-xs text-muted">At least 8 characters.</span>
      </label>
      {state.status === "done" && (
        <p role="status" className="text-sm text-success">
          Password changed. You&apos;ve been signed out on your other devices.
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-error">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-secondary">
        Change password
      </button>
    </form>
  );
}
