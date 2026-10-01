import type { MetadataRoute } from "next";

import { appUrl } from "@/lib/app-url";

/** Crawl the storefront; keep out of the admin, account, bag, checkout, orders and API. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/account", "/cart", "/checkout", "/orders", "/api"],
    },
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
