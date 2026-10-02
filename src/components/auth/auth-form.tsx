"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { authErrorMessage } from "@/components/auth/auth-error";
import { authInput as input, verifyEmailPath } from "@/components/auth/auth-input";
import { NewPasswordField } from "@/components/auth/new-password-field";
import { authClient } from "@/lib/auth-client";

/** Email and password form for both sign-in and sign-up. `next` must already be a safe path. */
export function AuthForm({ mode, next }: { mode: "sign-in" | "sign-up"; next: string }) {
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
    // A function `action` (not onSubmit) keeps the form from natively submitting
    // before hydration, which would put the password in a GET URL.
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
  );
}
