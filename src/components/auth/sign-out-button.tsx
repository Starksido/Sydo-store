"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const signOut = () =>
    startTransition(async () => {
      await authClient.signOut();
      router.replace("/");
      router.refresh();
    });

  return (
    <button type="button" onClick={signOut} disabled={pending} className="btn btn-secondary">
      Sign out
    </button>
  );
}
