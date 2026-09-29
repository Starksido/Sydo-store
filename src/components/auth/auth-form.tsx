"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { authClient } from "@/lib/auth-client";

const input =
  "mt-2 h-12 w-full border-0 border-b border-ink bg-transparent px-0 text-base placeholder:text-muted";

/** Email and password form for both sign-in and sign-up. `next` must already be a safe path. */
export function AuthForm({ mode, next }: { mode: "sign-in" | "sign-up"; next: string }) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";

  const [error, submit, pending] = useActionState(async (_: string | null, formData: FormData) => {
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));
    const { error } = isSignUp
      ? await authClient.signUp.email({ name: String(formData.get("name")), email, password })
      : await authClient.signIn.email({ email, password });

    if (error) return error.message ?? "Something went wrong. Please try again.";
    router.replace(next);
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
      <label className="block">
        <span className="label">Password</span>
        <input
          type="password"
          name="password"
          required
          minLength={isSignUp ? 8 : undefined}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          className={input}
        />
        {isSignUp && <span className="mt-2 block text-xs text-muted">At least 8 characters.</span>}
      </label>

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
