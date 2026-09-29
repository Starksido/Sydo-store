import type { Metadata } from "next";

import { CollectionListing } from "@/components/collection-listing";
import { getNewArrivals } from "@/lib/products";

// Regenerate at most once a minute so new products and stock changes show up without a rebuild.
export const revalidate = 60;

const LIMIT = 48;

export const metadata: Metadata = {
  title: "New Arrivals",
  description: "The latest ready-to-wear, shoes, bags and accessories, newest first.",
};

export default async function NewArrivalsPage() {
  const products = await getNewArrivals(LIMIT);

  return <CollectionListing title="New Arrivals" eyebrow="Just landed" products={products} />;
}
