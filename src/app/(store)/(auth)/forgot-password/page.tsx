import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Forgot your password?" };

export default function ForgotPasswordPage() {
  return (
    <section aria-labelledby="forgot-heading" className="container-prose section">
      <div className="mx-auto max-w-sm">
        <h1 id="forgot-heading" className="heading-1">
          Forgot your password?
        </h1>
        <p className="mt-3 mb-10 text-muted">Enter your email address and we&apos;ll send you a link to choose a new one.</p>
        <ForgotPasswordForm />
        <p className="mt-6 text-center text-sm text-muted">
          Remembered it?{" "}
          <Link href="/sign-in" className="link text-ink">
            Sign in
          </Link>
        </p>
      </div>
    </section>
  );
}
