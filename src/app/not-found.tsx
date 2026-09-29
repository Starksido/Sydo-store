import type { Metadata } from "next";

import { NotFoundMessage } from "@/components/not-found-message";
import { StoreShell } from "@/components/store-shell";

export const metadata: Metadata = { title: "Page not found" };

// For URLs that match no route, and `notFound()` outside `(store)` (what non-admins see for
// `/admin`). It renders under the root layout only, so it brings the storefront shell itself.
export default function NotFound() {
  return (
    <StoreShell>
      <NotFoundMessage />
    </StoreShell>
  );
}
