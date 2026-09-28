import Link from "next/link";

import { ProductGrid } from "@/components/product-grid";
import { getNewArrivals } from "@/lib/products";

export async function NewArrivals() {
  const newArrivals = await getNewArrivals();

  return (
    <section aria-labelledby="new-arrivals-heading" className="section container-page pt-0">
      <div className="mb-8 flex items-end justify-between gap-6 md:mb-12">
        <div>
          <p className="eyebrow text-muted">Just landed</p>
          <h2 id="new-arrivals-heading" className="heading-2 mt-2">
            New Arrivals
          </h2>
        </div>
        <Link href="/collections/new-in" className="label link shrink-0">
          View all
        </Link>
      </div>
      <ProductGrid products={newArrivals} />
    </section>
  );
}
