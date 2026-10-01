import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { listLowStockVariants } from "@/lib/admin/products";
import { LOW_STOCK_THRESHOLD } from "@/lib/catalog";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../admin-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Stock" });
}

export default async function AdminStockPage() {
  await requireAdmin("/admin/stock");
  const variants = await listLowStockVariants();

  return (
    <section aria-labelledby="stock-heading" className="container-page section">
      <h1 id="stock-heading" className="heading-1">
        Stock
      </h1>
      <p className="mt-3 max-w-2xl text-muted">
        Sizes of products on sale that are sold out or have {LOW_STOCK_THRESHOLD} or fewer left, lowest first.
        One-size products are listed as a whole. Archived products aren&apos;t listed.
      </p>

      {variants.length === 0 ? (
        <p className="mt-8 border-y py-10 text-muted">Every size on sale has more than {LOW_STOCK_THRESHOLD} in stock.</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="table-data">
            <thead>
              <tr>
                <th scope="col" className="w-14">
                  <span className="sr-only">Image</span>
                </th>
                <th scope="col">Product</th>
                <th scope="col">Size</th>
                <th scope="col" className="hidden md:table-cell">
                  Category
                </th>
                <th scope="col" className="text-right">
                  Stock
                </th>
                <th scope="col">
                  <span className="sr-only">Adjust</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {variants.map(({ variantId, label, stock, product, category }) => (
                <tr key={variantId}>
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
                  <td className="text-sm">{label ?? <span className="text-muted">One size</span>}</td>
                  <td className="hidden text-sm md:table-cell">{category.name}</td>
                  <td className="text-right tabular-nums">
                    {stock === 0 ? <span className="badge badge-error">Sold out</span> : stock}
                  </td>
                  <td className="text-right">
                    <Link
                      href={`/admin/products/${product.id}#stock`}
                      className="link text-sm"
                      aria-label={`Adjust stock of ${product.name}${label ? `, size ${label}` : ""}`}
                    >
                      Adjust
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
