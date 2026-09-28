import Link from "next/link";

import { NewsletterForm } from "@/components/newsletter-form";

const columns = [
  {
    title: "Client Services",
    links: [
      { label: "Contact us", href: "/client-services" },
      { label: "Shipping", href: "/client-services/shipping" },
      { label: "Returns", href: "/client-services/returns" },
      { label: "FAQs", href: "/client-services/faq" },
    ],
  },
  {
    title: "The House",
    links: [
      { label: "About Sydo", href: "/about" },
      { label: "Sustainability", href: "/sustainability" },
      { label: "Careers", href: "/careers" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of sale", href: "/terms" },
      { label: "Cookie settings", href: "/cookies" },
    ],
  },
  {
    title: "Follow",
    links: [
      { label: "Instagram", href: "https://instagram.com" },
      { label: "Pinterest", href: "https://pinterest.com" },
      { label: "TikTok", href: "https://tiktok.com" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="container-page pt-16 md:pt-20">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <p className="eyebrow text-muted">Newsletter</p>
            <h2 className="heading-2 mt-3">Sign up for Sydo updates</h2>
            <p className="mt-3 max-w-md text-muted">
              Be the first to hear about new collections, exclusive events and private sales.
            </p>
            <div className="mt-8 max-w-lg">
              <NewsletterForm />
            </div>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4 lg:col-span-7"
          >
            {columns.map((column) => (
              <div key={column.title}>
                <h3 className="label">{column.title}</h3>
                <ul className="mt-5 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="link-quiet text-sm text-muted hover:text-ink">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-16 flex flex-col gap-2 border-t py-6 text-xs text-muted sm:flex-row sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Sydo. All rights reserved.</p>
          <p>United States · English</p>
        </div>
      </div>

      <p
        aria-hidden="true"
        className="overflow-hidden text-center text-[21vw] font-medium uppercase leading-[0.8] tracking-[0.08em] select-none"
      >
        Sydo
      </p>
    </footer>
  );
}
