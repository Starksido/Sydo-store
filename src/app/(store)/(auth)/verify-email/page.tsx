import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import { EMAIL_CODE_MINUTES } from "@/lib/auth";
import { getSession, safeRedirect } from "@/lib/session";

export const metadata: Metadata = { title: "Confirm your email" };

/**
 * Where a customer types the code from their confirmation email: after sign-up, or after signing in
 * before confirming (`?sent=1`, a new code was just sent). The right code confirms the address,
 * signs them in and sends them on to `next`.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const params = await searchParams;
  const next = safeRedirect(params.next);
  if (await getSession()) redirect(next);
  const email = typeof params.email === "string" ? params.email.slice(0, 254) : "";
  const resentOnSignIn = params.sent === "1";

  return (
    <section aria-labelledby="verify-heading" className="container-prose section">
      <div className="mx-auto max-w-sm">
        <h1 id="verify-heading" className="heading-1">
          Check your inbox
        </h1>
        <p className="mt-3 text-muted">
          {resentOnSignIn ? "Your email address isn't confirmed yet, so we've sent you a new code. " : ""}
          We&apos;ve emailed a 6-digit code to {email ? <span className="break-all text-ink">{email}</span> : "you"}.
          Enter it below to confirm your email and finish signing in. It works for {EMAIL_CODE_MINUTES} minutes.
        </p>
        <div className="mt-10">
          <VerifyEmailForm email={email} next={next} />
        </div>
      </div>
    </section>
  );
}
