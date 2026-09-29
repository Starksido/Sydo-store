import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { CartCountProvider } from "@/components/cart/cart-count-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Sydo | Luxury Fashion & Accessories",
    template: "%s | Sydo",
  },
  description:
    "Discover Sydo's collections of ready-to-wear, shoes, bags and accessories for women and men.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <CartCountProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
        </CartCountProvider>
        <SiteFooter />
      </body>
    </html>
  );
}
