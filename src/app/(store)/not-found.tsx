import type { Metadata } from "next";

import { NotFoundMessage } from "@/components/not-found-message";

export const metadata: Metadata = { title: "Page not found" };

// For `notFound()` in storefront pages (unknown product, collection or order). It renders inside
// the `(store)` layout, which already has the header and footer; without it the root not-found
// would render there too and show them twice.
export default function StoreNotFound() {
  return <NotFoundMessage />;
}
