import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SavedNotice } from "@/components/admin/saved-notice";
import { listAdminCategories } from "@/lib/admin/categories";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../admin-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Categories" });
}

export default async function AdminCategoriesPage({ searchParams }: PageProps<"/admin/categories">) {
  await requireAdmin("/admin/categories");
  const categories = await listAdminCategories();
  const deleted = (await searchParams).saved === "deleted";

  return (
    <section aria-labelledby="categories-heading" className="container-page section">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 id="categories-heading" className="heading-1">
          Categories
        </h1>
        <Link href="/admin/categories/new" className="btn btn-primary">
          New category
        </Link>
      </div>
      <p className="mt-3 max-w-2xl text-muted">
        Every product belongs to one category. A category can be deleted once no product is in it, on sale or
        archived, and the store&apos;s menu and home page don&apos;t link to it.
      </p>

      {deleted && (
        <div className="mt-8">
          <SavedNotice>Category deleted.</SavedNotice>
        </div>
      )}

      {categories.length === 0 ? (
        <p className="mt-8 border-y py-10 text-muted">There are no categories yet.</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="table-data">
            <thead>
              <tr>
                <th scope="col" className="w-14">
                  <span className="sr-only">Tile image</span>
                </th>
                <th scope="col">Category</th>
                <th scope="col" className="hidden text-right sm:table-cell">
                  Position
                </th>
                <th scope="col" className="text-right">
                  On sale
                </th>
                <th scope="col" className="hidden text-right sm:table-cell">
                  Archived
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td>
                    <div className="media-frame w-12">
                      {category.image && <Image src={category.image} alt="" fill sizes="48px" />}
                    </div>
                  </td>
                  <td>
                    <Link href={`/admin/categories/${category.id}`} className="link-quiet">
                      {category.name}
                    </Link>
                    <span className="mt-1 block text-xs text-muted">/collections/{category.slug}</span>
                  </td>
                  <td className="hidden text-right tabular-nums sm:table-cell">{category.position}</td>
                  <td className="text-right tabular-nums">{category.activeProducts}</td>
                  <td className="hidden text-right tabular-nums text-muted sm:table-cell">{category.archivedProducts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
