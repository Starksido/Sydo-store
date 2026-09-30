import type { Metadata } from "next";

import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "./admin-metadata";

// Absolute title because the layout's "%s | Sydo Admin" template only applies below this segment.
export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: { absolute: "Overview | Sydo Admin" } });
}

export default async function AdminOverviewPage() {
  const { user } = await requireAdmin("/admin");

  return (
    <section aria-labelledby="admin-heading" className="container-page section">
      <h1 id="admin-heading" className="heading-1">
        Overview
      </h1>
      <p className="mt-3 text-muted">
        Signed in as <span className="break-all text-ink">{user.email}</span>.
      </p>
      <p className="mt-10 border-y py-10 text-muted">Products, categories and stock will be managed here.</p>
    </section>
  );
}
