"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import { authErrorMessage } from "@/components/auth/auth-error";
import { authInput } from "@/components/auth/auth-input";
import { authClient } from "@/lib/auth-client";

type Props = {
  /** Filled in from the sign-up or sign-in that sent the code; can be changed. */
  email: string;
  /** Where to go once confirmed. Must already be a safe path. */
  next: string;
};

/**
 * Confirms an email address with the 6-digit code we emailed, which also signs the customer in, and
 * sends a new code on request. Asking for a code answers the same whether or not the address has an
 * unconfirmed account.
 */
export function VerifyEmailForm({ email: initialEmail, next }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [resent, setResent] = useState<"sent" | string | null>(null);
  const [resending, startResend] = useTransition();

  const [error, submit, pending] = useActionState(async (_: string | null, formData: FormData) => {
    const otp = String(formData.get("code")).replace(/\s+/g, "");
    if (!/^\d{6}$/.test(otp)) return "Enter the 6-digit code from the email.";
    const { error } = await authClient.emailOtp.verifyEmail({ email: email.trim(), otp });
    if (error) return authErrorMessage("verify-email", error);
    router.replace(next);
    router.refresh();
    return null;
  }, null);

  const resend = () => {
    setResent(null);
    startResend(async () => {
      const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "email-verification" });
      setResent(error ? authErrorMessage("verify-email", error) : "sent");
    });
  };

  return (
    <form action={submit} className="space-y-6">
      <label className="block">
        <span className="label">Email address</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={authInput}
        />
      </label>
      <label className="block">
        <span className="label">Confirmation code</span>
        <input
          type="text"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123456"
          className={`${authInput} text-lg tracking-[0.3em]`}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Confirming…" : "Confirm email"}
      </button>

      <div className="border-t pt-6 text-sm">
        <p className="text-muted">Didn&apos;t get it? Check your spam folder, or</p>
        <button
          type="button"
          onClick={resend}
          disabled={resending || !email.trim()}
          className="link mt-2 cursor-pointer disabled:opacity-40"
        >
          {resending ? "Sending…" : "send a new code"}
        </button>
        {resent && (
          <p role={resent === "sent" ? "status" : "alert"} className={`mt-2 ${resent === "sent" ? "" : "text-error"}`}>
            {resent === "sent"
              ? "If that address has an account that isn't confirmed yet, we've sent a new code. Earlier codes no longer work."
              : resent}
          </p>
        )}
      </div>
    </form>
  );
}
