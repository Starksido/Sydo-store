import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Where the link in a password reset email lands: Better Auth checks the token and sends it here as
 * `?token=`, or `?error=INVALID_TOKEN` if it has expired or was used.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && token.length > 0 && token.length <= 200;

  return (
    <section aria-labelledby="reset-heading" className="container-prose section">
      <div className="mx-auto max-w-sm">
        <h1 id="reset-heading" className="heading-1">
          {valid ? "Choose a new password" : "This link has expired"}
        </h1>
        {valid ? (
          <div className="mt-10">
            <ResetPasswordForm token={token} />
          </div>
        ) : (
          <>
            <p className="mt-3 text-muted">Reset links work once, for one hour.</p>
            <Link href="/forgot-password" className="btn btn-primary mt-10">
              Get a new link
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
