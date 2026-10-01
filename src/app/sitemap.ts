import type { MetadataRoute } from "next";

import { appUrl } from "@/lib/app-url";
import { categoryHref } from "@/lib/catalog";
import { getCategorySlugs, getProductSlugs } from "@/lib/products";

// Rebuilt at most hourly, like the catalog it lists.
export const revalidate = 3600;

/** The home page, New In, every category and every product on sale. No account or admin pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl();
  const [categories, products] = await Promise.all([getCategorySlugs(), getProductSlugs()]);
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/collections/new-in`, changeFrequency: "daily", priority: 0.8 },
    ...categories.map((slug) => ({ url: `${base}${categoryHref(slug)}`, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...products.map((slug) => ({ url: `${base}/products/${slug}`, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
