"use client";

import { useActionState } from "react";

import { authErrorMessage } from "@/components/auth/auth-error";
import { authInput, verifyEmailPath } from "@/components/auth/auth-input";
import { authClient } from "@/lib/auth-client";

type State = { status: "idle" } | { status: "sent" } | { status: "error"; message: string };

/** Sends a new confirmation link. Answers the same whether or not the address has an account. */
export function ResendVerificationForm({ next }: { next: string }) {
  const [state, submit, pending] = useActionState(async (_: State, formData: FormData): Promise<State> => {
    const { error } = await authClient.sendVerificationEmail({
      email: String(formData.get("email")),
      callbackURL: verifyEmailPath(next),
    });
    return error ? { status: "error", message: authErrorMessage("verify-email", error) } : { status: "sent" };
  }, { status: "idle" });

  return (
    <form action={submit} className="space-y-6">
      <label className="block">
        <span className="label">Email address</span>
        <input type="email" name="email" required autoComplete="email" className={authInput} />
      </label>
      {state.status === "sent" && (
        <p role="status" className="text-sm">
          If that address has an account that isn&apos;t confirmed yet, we&apos;ve sent a new link.
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-error">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-secondary w-full">
        Send a new link
      </button>
    </form>
  );
}
