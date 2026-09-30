"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// One entry per admin section.
const sections = [
  { label: "Overview", href: "/admin" },
  { label: "Products", href: "/admin/products" },
  { label: "Categories", href: "/admin/categories" },
  { label: "Stock", href: "/admin/stock" },
  { label: "Orders", href: "/admin/orders" },
  { label: "Refunds", href: "/admin/refunds" },
];

function isCurrent(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="border-b">
      <ul className="container-page flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2 py-3 sm:gap-x-6">
        {sections.map((section) => (
          <li key={section.href} className="shrink-0">
            <Link
              href={section.href}
              aria-current={isCurrent(pathname, section.href) ? "page" : undefined}
              className="label link-quiet"
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
