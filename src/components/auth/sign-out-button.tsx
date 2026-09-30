"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className = "btn btn-secondary" }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const signOut = () =>
    startTransition(async () => {
      await authClient.signOut();
      router.replace("/");
      router.refresh();
    });

  return (
    <button type="button" onClick={signOut} disabled={pending} className={className}>
      Sign out
    </button>
  );
}
