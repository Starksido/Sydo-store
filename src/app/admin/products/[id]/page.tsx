import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmButton } from "@/components/admin/confirm-button";
import { ProductForm } from "@/components/admin/product-form";
import { SavedNotice } from "@/components/admin/saved-notice";
import { StatusBadge } from "@/components/admin/status-badge";
import { listAdminCategories } from "@/lib/admin/categories";
import { productFormValues } from "@/lib/admin/product-input";
import { getAdminProduct } from "@/lib/admin/products";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../../admin-metadata";
import { setProductArchivedAction, updateProductAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Edit product" });
}

const SAVED_MESSAGES: Record<string, string> = {
  "1": "Saved. The store shows the change within a minute.",
  archived: "Archived. It's hidden from the store, and bags that hold it show it as no longer available.",
  unarchived: "Back on sale. Bags that held it show it again.",
};

export default async function EditProductPage({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  await requireAdmin("/admin/products");
  const { id: idText } = await params;
  const id = /^\d{1,9}$/.test(idText) ? Number(idText) : 0;
  const [product, categories] = await Promise.all([id ? getAdminProduct(id) : undefined, listAdminCategories()]);
  if (!product) notFound();

  const saved = (await searchParams).saved;
  const savedMessage = typeof saved === "string" ? SAVED_MESSAGES[saved] : undefined;
  const archived = Boolean(product.archivedAt);

  return (
    <section aria-labelledby="product-heading" className="container-page section">
      <div className="max-w-3xl">
        <Link href="/admin/products" className="eyebrow link-quiet text-muted">
          Products
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 id="product-heading" className="heading-1">
            {product.name}
          </h1>
          <StatusBadge archived={archived} />
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted">Stock</dt>
            <dd className={product.stock === 0 ? "text-error" : undefined}>
              {product.stock === 0 ? "Sold out" : product.stock}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">Category</dt>
            <dd>{product.category.name}</dd>
          </div>
          {!archived && (
            <div>
              <dt className="sr-only">Store page</dt>
              <dd>
                <Link href={`/products/${product.slug}`} className="link" target="_blank">
                  View in store
                </Link>
              </dd>
            </div>
          )}
        </dl>

        {savedMessage && (
          <div className="mt-8">
            <SavedNotice>{savedMessage}</SavedNotice>
          </div>
        )}

        <div className="mt-10">
          <ProductForm
            // Remount after each save so every field shows what was stored (e.g. a generated slug).
            key={product.updatedAt.getTime()}
            action={updateProductAction.bind(null, product.id)}
            initial={productFormValues(product)}
            categories={categories.map(({ id, name }) => ({ id, name }))}
            submitLabel="Save changes"
          />
        </div>

        <div className="mt-16 border-t pt-10" role="region" aria-labelledby="archive-heading">
          <h2 id="archive-heading" className="heading-3">
            {archived ? "Archived" : "Archive"}
          </h2>
          <p className="mt-2 mb-6 text-sm text-muted">
            {archived
              ? "Hidden from the store. Unarchiving puts it back on sale, with its stock, and back in bags that held it."
              : "Hides the product from the store and from checkout. Orders already placed aren't affected, and you can unarchive it later."}
          </p>
          {archived ? (
            <ConfirmButton
              action={setProductArchivedAction.bind(null, product.id, false)}
              label="Unarchive"
              confirmLabel="Yes, put it back on sale"
              warning={`${product.name} will be on sale again with ${product.stock} in stock.`}
            />
          ) : (
            <ConfirmButton
              action={setProductArchivedAction.bind(null, product.id, true)}
              label="Archive"
              confirmLabel="Yes, archive it"
              warning={`${product.name} will disappear from the store, and customers can't buy it.`}
            />
          )}
        </div>
      </div>
    </section>
  );
}
