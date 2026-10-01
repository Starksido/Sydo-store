import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ResendVerificationForm } from "@/components/auth/resend-verification-form";
import { getSession, safeRedirect } from "@/lib/session";

export const metadata: Metadata = { title: "Confirm your email" };

/**
 * Shown after sign-up ("check your inbox"), and where the link in the confirmation email lands:
 * Better Auth confirms the email, signs the customer in and sends them here, and this page sends
 * them on to `next`. An expired or used link comes back with `?error=`.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const params = await searchParams;
  const next = safeRedirect(params.next);
  const failed = typeof params.error === "string";
  if (!failed && (await getSession())) redirect(next);

  return (
    <section aria-labelledby="verify-heading" className="container-prose section">
      <div className="mx-auto max-w-sm">
        <h1 id="verify-heading" className="heading-1">
          {failed ? "This link has expired" : "Check your inbox"}
        </h1>
        <p className="mt-3 text-muted">
          {failed
            ? "Confirmation links work once, for one hour. Enter your email address and we'll send a new one."
            : "We've sent you a link to confirm your email address. Open it to finish creating your account. It works for one hour."}
        </p>
        <div className="mt-10">
          {!failed && <p className="mb-6 text-sm text-muted">Didn&apos;t get it? Check your spam folder, or send a new link.</p>}
          <ResendVerificationForm next={next} />
        </div>
      </div>
    </section>
  );
}
