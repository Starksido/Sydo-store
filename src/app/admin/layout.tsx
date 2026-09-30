import type { Metadata } from "next";
import Link from "next/link";

import { AdminNav } from "@/components/admin/admin-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "./admin-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({
    title: { default: "Admin", template: "%s | Sydo Admin" },
    robots: { index: false, follow: false },
  });
}

// Outside `(store)`, so no storefront header. This check covers the shell only: every admin page and
// Server Function calls `requireAdmin` itself.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin("/admin");

  return (
    <>
      <header className="header-bar">
        <div className="container-page flex h-full items-center justify-between gap-4">
          <Link href="/admin" className="label">
            Sydo <span className="text-muted">Admin</span>
          </Link>
          <div className="flex items-center gap-5">
            <Link href="/" className="label link-quiet">
              View store
            </Link>
            <SignOutButton className="btn btn-secondary btn-sm" />
          </div>
        </div>
      </header>
      <AdminNav />
      <main className="flex-1">{children}</main>
    </>
  );
}
