"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { authErrorMessage, googleErrorMessage } from "@/components/auth/auth-error";
import { authInput as input, verifyEmailPath } from "@/components/auth/auth-input";
import { GoogleButton } from "@/components/auth/google-button";
import { NewPasswordField } from "@/components/auth/new-password-field";
import { authClient } from "@/lib/auth-client";

type Props = {
  mode: "sign-in" | "sign-up";
  /** Must already be a safe path. */
  next: string;
  /** Show "Continue with Google" (only when its keys are configured). */
  google?: boolean;
  /** The `?error=` a failed Google sign-in came back with. */
  googleError?: string;
};

/** Email and password form for both sign-in and sign-up, with Google above it when enabled. */
export function AuthForm({ mode, next, google = false, googleError }: Props) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";

  const [error, submit, pending] = useActionState(async (_: string | null, formData: FormData) => {
    const email = String(formData.get("email")).trim();
    const password = String(formData.get("password"));
    const { error } = isSignUp
      ? await authClient.signUp.email({ name: String(formData.get("name")), email, password })
      : await authClient.signIn.email({ email, password });

    // The right password but an unconfirmed email: a new code was just sent, so go and type it in.
    if (error?.code === "EMAIL_NOT_VERIFIED") {
      router.replace(verifyEmailPath(next, email, true));
      return null;
    }
    if (error) return authErrorMessage(mode, error);
    // A new account has no session until its email is confirmed with the emailed code.
    router.replace(isSignUp ? verifyEmailPath(next, email) : next);
    router.refresh();
    return null;
  }, null);

  const otherHref = `${isSignUp ? "/sign-in" : "/sign-up"}?next=${encodeURIComponent(next)}`;

  return (
    <div className="space-y-8">
      {googleError && (
        <p role="alert" className="border border-error p-4 text-sm text-error">
          {googleErrorMessage(googleError)}
          {googleError === "email_not_verified" && (
            <>
              {" "}
              <Link href={verifyEmailPath(next)} className="link">
                Enter the code
              </Link>
            </>
          )}
        </p>
      )}
      {google && (
        <>
          <GoogleButton next={next} />
          <p className="flex items-center gap-4 text-xs text-muted uppercase before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
            or
          </p>
        </>
      )}
      {/* A function `action` (not onSubmit) keeps the form from natively submitting before
          hydration, which would put the password in a GET URL. */}
      <form action={submit} className="space-y-6">
        {isSignUp && (
          <label className="block">
            <span className="label">Name</span>
            <input type="text" name="name" required autoComplete="name" className={input} />
          </label>
        )}
        <label className="block">
          <span className="label">Email address</span>
          <input type="email" name="email" required autoComplete="email" className={input} />
        </label>
        {isSignUp ? (
          <NewPasswordField name="password" label="Password" userInputFields={["name", "email"]} />
        ) : (
          <label className="block">
            <span className="label">Password</span>
            <input type="password" name="password" required autoComplete="current-password" className={input} />
          </label>
        )}
        {!isSignUp && (
          <p className="-mt-3 text-right text-sm">
            <Link href="/forgot-password" className="link text-muted">
              Forgot your password?
            </Link>
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary w-full">
          {isSignUp ? "Create account" : "Sign in"}
        </button>

        <p className="text-center text-sm text-muted">
          {isSignUp ? "Already have an account? " : "New to Sydo? "}
          <Link href={otherHref} className="link text-ink">
            {isSignUp ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </form>
    </div>
  );
}
