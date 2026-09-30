import { revalidatePath } from "next/cache";

/**
 * Refreshes the storefront pages a product or category change can show up on: the home page, New
 * Arrivals, every collection and every product page (related products and breadcrumbs included).
 * They're ISR pages, so each one regenerates on its next visit.
 */
export function revalidateStorefront() {
  revalidatePath("/");
  revalidatePath("/collections/new-in");
  revalidatePath("/collections/[slug]", "page");
  revalidatePath("/products/[slug]", "page");
}

export function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
