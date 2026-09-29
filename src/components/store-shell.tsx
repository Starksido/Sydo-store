import { CartCountProvider } from "@/components/cart/cart-count-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * The storefront's header, main area and footer. Used by the `(store)` layout and by the root
 * not-found page, which renders outside that layout.
 */
export function StoreShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CartCountProvider>
        <SiteHeader />
        <main className="flex-1">{children}</main>
      </CartCountProvider>
      <SiteFooter />
    </>
  );
}
