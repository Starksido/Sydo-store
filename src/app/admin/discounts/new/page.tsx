import type { Metadata } from "next";
import Link from "next/link";

import { DiscountForm } from "@/components/admin/discount-form";
import { EMPTY_DISCOUNT_FORM } from "@/lib/admin/discount-input";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../../admin-metadata";
import { createDiscountAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "New discount code" });
}

export default async function NewDiscountPage() {
  await requireAdmin("/admin/discounts/new");

  return (
    <section aria-labelledby="new-discount-heading" className="container-page section">
      <div className="max-w-3xl">
        <Link href="/admin/discounts" className="eyebrow link-quiet text-muted">
          Discounts
        </Link>
        <h1 id="new-discount-heading" className="mt-3 heading-1">
          New discount code
        </h1>
        <div className="mt-10">
          <DiscountForm action={createDiscountAction} initial={EMPTY_DISCOUNT_FORM} submitLabel="Create code" />
        </div>
      </div>
    </section>
  );
}
