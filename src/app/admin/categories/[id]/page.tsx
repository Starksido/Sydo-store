import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CategoryForm } from "@/components/admin/category-form";
import { SavedNotice } from "@/components/admin/saved-notice";
import { getAdminCategory } from "@/lib/admin/categories";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../../admin-metadata";
import { updateCategoryAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Edit category" });
}

export default async function EditCategoryPage({ params, searchParams }: PageProps<"/admin/categories/[id]">) {
  await requireAdmin("/admin/categories");
  const { id: idText } = await params;
  const id = /^\d{1,9}$/.test(idText) ? Number(idText) : 0;
  const category = id ? await getAdminCategory(id) : undefined;
  if (!category) notFound();

  const saved = (await searchParams).saved === "1";

  return (
    <section aria-labelledby="category-heading" className="container-page section">
      <div className="max-w-3xl">
        <Link href="/admin/categories" className="eyebrow link-quiet text-muted">
          Categories
        </Link>
        <h1 id="category-heading" className="mt-3 heading-1">
          {category.name}
        </h1>
        <p className="mt-3 text-sm">
          <Link href={`/collections/${category.slug}`} className="link" target="_blank">
            View in store
          </Link>
          <span className="mx-3 text-muted">·</span>
          <Link href={`/admin/products?category=${category.id}`} className="link">
            Its products
          </Link>
        </p>

        {saved && (
          <div className="mt-8">
            <SavedNotice>Saved. The store shows the change within a minute.</SavedNotice>
          </div>
        )}

        <div className="mt-10">
          <CategoryForm
            // Remount after each save so every field shows what was stored (e.g. a generated slug).
            key={`${category.name}|${category.slug}|${category.image}|${category.position}`}
            action={updateCategoryAction.bind(null, category.id)}
            initial={{
              name: category.name,
              slug: category.slug,
              image: category.image ?? "",
              position: String(category.position),
            }}
            submitLabel="Save changes"
          />
        </div>
      </div>
    </section>
  );
}
