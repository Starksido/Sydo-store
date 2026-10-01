import type { Metadata } from "next";
import Link from "next/link";

import { listAdminCategories } from "@/lib/admin/categories";
import { countOrderWork } from "@/lib/admin/orders";
import { countAdminProducts, countLowStockVariants } from "@/lib/admin/products";
import { LOW_STOCK_THRESHOLD } from "@/lib/catalog";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "./admin-metadata";

// Absolute title because the layout's "%s | Sydo Admin" template only applies below this segment.
export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: { absolute: "Overview | Sydo Admin" } });
}

export default async function AdminOverviewPage() {
  const { user } = await requireAdmin("/admin");
  const [productCounts, lowStock, categories, orderWork] = await Promise.all([
    countAdminProducts(),
    countLowStockVariants(),
    listAdminCategories(),
    countOrderWork(),
  ]);

  const orderSections: Section[] = [
    {
      href: "/admin/orders?status=to-fulfil",
      title: "Orders",
      stats: [{ label: "To fulfil", value: orderWork.toFulfil }],
    },
    { href: "/admin/refunds", title: "Refunds", stats: [{ label: "Due", value: orderWork.refundsDue }] },
  ];
  const catalogSections: Section[] = [
    {
      href: "/admin/products",
      title: "Products",
      stats: [
        { label: "On sale", value: productCounts.active },
        { label: "Archived", value: productCounts.archived },
      ],
    },
    {
      href: "/admin/stock",
      title: "Stock",
      stats: [
        { label: "Sizes sold out", value: lowStock.soldOut },
        { label: `Sizes with 1–${LOW_STOCK_THRESHOLD} left`, value: lowStock.low },
      ],
    },
    { href: "/admin/categories", title: "Categories", stats: [{ label: "Total", value: categories.length }] },
  ];

  return (
    <section aria-labelledby="admin-heading" className="container-page section">
      <h1 id="admin-heading" className="heading-1">
        Overview
      </h1>
      <p className="mt-3 text-muted">
        Signed in as <span className="break-all text-ink">{user.email}</span>.
      </p>

      <SectionGrid sections={orderSections} className="mt-10 sm:grid-cols-2" />
      <SectionGrid sections={catalogSections} className="mt-6 sm:grid-cols-3" />
    </section>
  );
}

type Section = { href: string; title: string; stats: { label: string; value: number }[] };

function SectionGrid({ sections, className }: { sections: Section[]; className: string }) {
  return (
    <ul className={`grid gap-px border bg-line ${className}`}>
      {sections.map((section) => (
        <li key={section.href} className="bg-paper">
          <Link href={section.href} className="group block p-6">
            <h2 className="heading-3">
              <span className="link-quiet group-hover:decoration-current">{section.title}</span>
            </h2>
            <dl className="mt-4 flex gap-8">
              {section.stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="eyebrow text-muted">{stat.label}</dt>
                  <dd className="mt-1 text-xl tabular-nums">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}
