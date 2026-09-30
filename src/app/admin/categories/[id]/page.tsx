import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CategoryForm } from "@/components/admin/category-form";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { SavedNotice } from "@/components/admin/saved-notice";
import { listAdminCategories } from "@/lib/admin/categories";
import { linkedCategorySlugs } from "@/lib/catalog";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../../admin-metadata";
import { deleteCategoryAction, updateCategoryAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Edit category" });
}

export default async function EditCategoryPage({ params, searchParams }: PageProps<"/admin/categories/[id]">) {
  await requireAdmin("/admin/categories");
  const { id: idText } = await params;
  const id = /^\d{1,9}$/.test(idText) ? Number(idText) : 0;
  // The list carries the product counts the delete section needs.
  const category = id ? (await listAdminCategories()).find((c) => c.id === id) : undefined;
  if (!category) notFound();
  const productCount = category.activeProducts + category.archivedProducts;
  const linked = linkedCategorySlugs().has(category.slug);

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

        <div id="delete" className="mt-16 scroll-mt-header border-t pt-10" role="region" aria-labelledby="delete-heading">
          <h2 id="delete-heading" className="heading-3">
            Delete
          </h2>
          {linked ? (
            <p className="mt-2 text-sm text-muted">
              The store&apos;s menu or home page links to this category, so it can&apos;t be deleted.
            </p>
          ) : productCount > 0 ? (
            <p className="mt-2 text-sm text-muted">
              {productCount === 1 ? "1 product is" : `${productCount} products are`} in this category
              {category.archivedProducts > 0 && ` (${category.archivedProducts} archived)`}. Move{" "}
              {productCount === 1 ? "it" : "them"} to another category first, then it can be deleted.{" "}
              <Link href={`/admin/products?category=${category.id}&status=all`} className="link">
                See {productCount === 1 ? "it" : "them"}
              </Link>
            </p>
          ) : (
            <>
              <p className="mt-2 mb-6 text-sm text-muted">
                No products are in this category, so it can be deleted. Its collection page will no longer exist.
              </p>
              <ConfirmButton
                action={deleteCategoryAction.bind(null, category.id)}
                label="Delete category"
                confirmLabel="Yes, delete it"
                warning={`${category.name} will be deleted, and /collections/${category.slug} will show a page not found. This can't be undone.`}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
