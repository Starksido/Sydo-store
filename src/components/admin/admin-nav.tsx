"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sections are added here as their pages are built; Orders is next.
const sections = [
  { label: "Overview", href: "/admin" },
  { label: "Products", href: "/admin/products" },
  { label: "Categories", href: "/admin/categories" },
  { label: "Stock", href: "/admin/stock" },
];

function isCurrent(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="border-b">
      <ul className="container-page flex h-12 items-center gap-5 overflow-x-auto sm:gap-6">
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
