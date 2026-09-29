import Link from "next/link";

import { ProductGrid } from "@/components/product-grid";
import type { Product } from "@/lib/products";

/** Full-page product listing: breadcrumb, title, item count and grid, with an empty state. */
export function CollectionListing({
  title,
  eyebrow,
  products,
}: {
  title: string;
  eyebrow?: string;
  products: Product[];
}) {
  return (
    <section aria-labelledby="collection-heading" className="container-page pb-section">
      <header className="pt-8 pb-8 md:pt-10 md:pb-12">
        <nav aria-label="Breadcrumb">
          <ol className="eyebrow flex flex-wrap gap-2 text-muted">
            <li>
              <Link href="/" className="link-quiet">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{title}</li>
          </ol>
        </nav>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            {eyebrow && <p className="eyebrow mb-2 text-muted">{eyebrow}</p>}
            <h1 id="collection-heading" className="heading-1">
              {title}
            </h1>
          </div>
          {products.length > 0 && (
            <p className="text-xs text-muted">
              {products.length} {products.length === 1 ? "item" : "items"}
            </p>
          )}
        </div>
      </header>

      {products.length > 0 ? (
        <ProductGrid products={products} trimPartialRow={false} />
      ) : (
        <div className="border-t py-section text-center">
          <p className="text-muted">New pieces are on their way. Check back soon.</p>
          <Link href="/" className="btn btn-secondary mt-6">
            Continue shopping
          </Link>
        </div>
      )}
    </section>
  );
}
