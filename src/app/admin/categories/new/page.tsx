import type { Metadata } from "next";
import Link from "next/link";

import { CategoryForm } from "@/components/admin/category-form";
import { EMPTY_CATEGORY_FORM } from "@/lib/admin/product-input";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../../admin-metadata";
import { createCategoryAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "New category" });
}

export default async function NewCategoryPage() {
  await requireAdmin("/admin/categories/new");

  return (
    <section aria-labelledby="new-category-heading" className="container-page section">
      <div className="max-w-3xl">
        <Link href="/admin/categories" className="eyebrow link-quiet text-muted">
          Categories
        </Link>
        <h1 id="new-category-heading" className="mt-3 heading-1">
          New category
        </h1>
        <p className="mt-3 text-muted">
          It gets a collection page right away. It isn&apos;t added to the store&apos;s menu automatically.
        </p>
        <div className="mt-10">
          <CategoryForm action={createCategoryAction} initial={EMPTY_CATEGORY_FORM} submitLabel="Create category" />
        </div>
      </div>
    </section>
  );
}
