import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getSession, safeRedirect } from "@/lib/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const next = safeRedirect((await searchParams).next);
  if (await getSession()) redirect(next);

  return (
    <section aria-labelledby="sign-up-heading" className="container-prose section">
      <div className="mx-auto max-w-sm">
        <h1 id="sign-up-heading" className="heading-1">
          Create account
        </h1>
        <p className="mt-3 mb-10 text-muted">Save your details for a faster checkout.</p>
        <AuthForm mode="sign-up" next={next} />
      </div>
    </section>
  );
}
