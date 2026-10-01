import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { appUrl } from "@/lib/app-url";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute URLs for Open Graph images and canonical links, from configuration (not the request).
  metadataBase: new URL(appUrl()),
  title: {
    default: "Sydo | Luxury Fashion & Accessories",
    template: "%s | Sydo",
  },
  description:
    "Discover Sydo's collections of ready-to-wear, shoes, bags and accessories for women and men.",
};

// The storefront's header and footer are in `(store)/layout.tsx`, so other areas (the admin) can
// have their own.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
