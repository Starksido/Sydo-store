import type { Metadata } from "next";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const { user } = await requireSession("/account");

  return (
    <section aria-labelledby="account-heading" className="container-prose section">
      <h1 id="account-heading" className="heading-1">
        My account
      </h1>
      <dl className="mt-10 divide-y border-y">
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
          <dt className="label text-muted">Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
          <dt className="label text-muted">Email</dt>
          <dd className="break-all">{user.email}</dd>
        </div>
      </dl>
      <div className="mt-10">
        <SignOutButton />
      </div>
    </section>
  );
}
