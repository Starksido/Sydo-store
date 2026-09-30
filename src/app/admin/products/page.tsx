import type { Metadata } from "next";
import Form from "next/form";
import Image from "next/image";
import Link from "next/link";

import { SavedNotice } from "@/components/admin/saved-notice";
import { StatusBadge } from "@/components/admin/status-badge";
import { listAdminCategories } from "@/lib/admin/categories";
import { listAdminProducts, type ProductStatusFilter } from "@/lib/admin/products";
import { formatPrice } from "@/lib/catalog";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../admin-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Products" });
}

const MAX_PAGE = 1000;
const STATUSES: { value: ProductStatusFilter; label: string }[] = [
  { value: "active", label: "On sale" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export default async function AdminProductsPage({ searchParams }: PageProps<"/admin/products">) {
  await requireAdmin("/admin/products");
  const params = await searchParams;

  const q = one(params.q).slice(0, 100);
  const categoryId = /^\d{1,9}$/.test(one(params.category)) ? Number(one(params.category)) : undefined;
  const status = STATUSES.find((s) => s.value === one(params.status))?.value ?? "active";
  const pageText = one(params.page);
  const page = Math.min(Math.max(/^\d+$/.test(pageText) ? Number(pageText) : 1, 1), MAX_PAGE);

  const [{ products, hasMore }, categories] = await Promise.all([
    listAdminProducts({ q, categoryId, status, page }),
    listAdminCategories(),
  ]);

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (categoryId) query.set("category", String(categoryId));
    if (status !== "active") query.set("status", status);
    if (target > 1) query.set("page", String(target));
    const search = query.toString();
    return search ? `/admin/products?${search}` : "/admin/products";
  };
  const filtered = Boolean(q || categoryId || status !== "active");
  const deleted = one(params.saved) === "deleted";

  return (
    <section aria-labelledby="products-heading" className="container-page section">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 id="products-heading" className="heading-1">
          Products
        </h1>
        <Link href="/admin/products/new" className="btn btn-primary">
          New product
        </Link>
      </div>

      {deleted && (
        <div className="mt-8">
          <SavedNotice>Product deleted. The store shows the change within a minute.</SavedNotice>
        </div>
      )}

      <Form action="/admin/products" className="mt-8 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
        <label className="block">
          <span className="label">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Name or SKU"
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">Category</span>
          <select name="category" defaultValue={categoryId ?? ""} className="input">
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Status</span>
          <select name="status" defaultValue={status} className="input">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-3">
          <button type="submit" className="btn btn-secondary">
            Filter
          </button>
          {filtered && (
            <Link href="/admin/products" className="btn btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </Form>

      {products.length === 0 ? (
        <p className="mt-8 border-y py-10 text-muted">
          {page > 1
            ? "There are no products on this page."
            : filtered
              ? "No products match these filters."
              : "There are no products yet."}
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="table-data">
            <thead>
              <tr>
                <th scope="col" className="w-14">
                  <span className="sr-only">Image</span>
                </th>
                <th scope="col">Product</th>
                <th scope="col" className="hidden md:table-cell">
                  Category
                </th>
                <th scope="col" className="hidden text-right sm:table-cell">
                  Price
                </th>
                <th scope="col" className="text-right">
                  Stock
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="media-frame w-12">
                      <Image src={product.image} alt="" fill sizes="48px" />
                    </div>
                  </td>
                  <td>
                    <Link href={`/admin/products/${product.id}`} className="link-quiet">
                      {product.name}
                    </Link>
                    <span className="mt-1 block text-xs text-muted">{product.sku}</span>
                  </td>
                  <td className="hidden text-sm md:table-cell">{product.category.name}</td>
                  <td className="hidden text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {formatPrice(product.price)}
                  </td>
                  <td className={`text-right tabular-nums ${product.stock === 0 ? "text-error" : ""}`}>
                    {product.stock}
                  </td>
                  <td>
                    <StatusBadge archived={Boolean(product.archivedAt)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || hasMore) && (
        <nav aria-label="Product pages" className="mt-6 flex justify-between gap-4">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn btn-secondary">
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={pageHref(page + 1)} className="btn btn-secondary">
              Older
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
