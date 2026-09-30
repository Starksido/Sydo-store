"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sections are added here as their pages are built: Stock, then Orders.
const sections = [
  { label: "Overview", href: "/admin" },
  { label: "Products", href: "/admin/products" },
  { label: "Categories", href: "/admin/categories" },
];

function isCurrent(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="border-b">
      <ul className="container-page flex h-12 items-center gap-6 overflow-x-auto">
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
