"use client";

import { useState, useTransition } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * "Continue with Google": off to Google and back, signed in, to `next`. A failed sign-in comes back
 * to `/sign-in?error=…`, which explains it (`googleErrorMessage`). `next` must already be a safe path.
 */
export function GoogleButton({ next }: { next: string }) {
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const start = () => {
    setFailed(false);
    startTransition(async () => {
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: next,
        errorCallbackURL: `/sign-in?next=${encodeURIComponent(next)}`,
      });
      // On success the browser is already on its way to Google.
      if (error) setFailed(true);
    });
  };

  return (
    <div>
      <button type="button" onClick={start} disabled={pending} className="btn btn-secondary w-full gap-3">
        <GoogleLogo />
        {pending ? "Opening Google…" : "Continue with Google"}
      </button>
      {failed && (
        <p role="alert" className="mt-3 text-sm text-error">
          Google sign-in couldn&apos;t start. Please try again, or use your email and password.
        </p>
      )}
    </div>
  );
}

/** Google's "G", in its own colours as their brand guidelines ask. */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="size-4 shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
