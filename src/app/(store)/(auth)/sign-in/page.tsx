import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getSession, safeRedirect } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const next = safeRedirect((await searchParams).next);
  if (await getSession()) redirect(next);

  return (
    <section aria-labelledby="sign-in-heading" className="container-prose section">
      <div className="mx-auto max-w-sm">
        <h1 id="sign-in-heading" className="heading-1">
          Sign in
        </h1>
        <p className="mt-3 mb-10 text-muted">Access your account and checkout.</p>
        <AuthForm mode="sign-in" next={next} />
      </div>
    </section>
  );
}
