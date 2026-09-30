import type { Metadata } from "next";
import Link from "next/link";

import { ProductForm } from "@/components/admin/product-form";
import { listAdminCategories } from "@/lib/admin/categories";
import { EMPTY_PRODUCT_FORM } from "@/lib/admin/product-input";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../../admin-metadata";
import { createProductAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "New product" });
}

export default async function NewProductPage() {
  await requireAdmin("/admin/products/new");
  const categories = await listAdminCategories();

  return (
    <section aria-labelledby="new-product-heading" className="container-page section">
      <div className="max-w-3xl">
        <Link href="/admin/products" className="eyebrow link-quiet text-muted">
          Products
        </Link>
        <h1 id="new-product-heading" className="mt-3 heading-1">
          New product
        </h1>
        <p className="mt-3 text-muted">New products start with no stock, so they show as sold out until stock is added.</p>

        <div className="mt-10">
          {categories.length === 0 ? (
            <p className="border-y py-10 text-muted">
              Every product needs a category.{" "}
              <Link href="/admin/categories/new" className="link text-ink">
                Create a category
              </Link>{" "}
              first.
            </p>
          ) : (
            <ProductForm
              action={createProductAction}
              initial={EMPTY_PRODUCT_FORM}
              categories={categories.map(({ id, name }) => ({ id, name }))}
              submitLabel="Create product"
            />
          )}
        </div>
      </div>
    </section>
  );
}
