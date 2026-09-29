import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { CheckoutForm } from "@/components/checkout/checkout-form";
import { OrderSummary } from "@/components/checkout/order-summary";
import { getCart, reconcileCart } from "@/lib/cart";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const { user } = await requireSession("/checkout");
  await reconcileCart(user.id);
  const { lines } = await getCart(user.id);

  // Sold-out and removed lines stay in the bag but aren't ordered. What's listed here is exactly
  // what the form submits, at the saved quantities.
  const orderable = lines.filter((line) => line.product && line.available > 0);
  const excluded = lines.filter((line) => !line.product || line.available === 0);

  if (orderable.length === 0) {
    return (
      <section aria-labelledby="checkout-heading" className="container-prose section text-center">
        <h1 id="checkout-heading" className="heading-1">
          Checkout
        </h1>
        <p className="mt-4 text-muted">
          {lines.length > 0
            ? "Nothing in your shopping bag is available to order right now."
            : "Your shopping bag is empty."}
        </p>
        <Link href={lines.length > 0 ? "/cart" : "/collections/new-in"} className="btn btn-secondary mt-8">
          {lines.length > 0 ? "Review your bag" : "Continue shopping"}
        </Link>
      </section>
    );
  }

  const items = orderable.map((line) => ({
    id: line.id,
    name: line.name,
    size: line.size,
    quantity: line.quantity,
    unitPrice: line.product!.price,
  }));
  const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  return (
    <section aria-labelledby="checkout-heading" className="container-page section">
      <h1 id="checkout-heading" className="heading-1">
        Checkout
      </h1>

      <div className="mt-8 grid gap-y-10 md:mt-12 lg:grid-cols-12 lg:gap-x-10 xl:gap-x-16">
        <aside aria-labelledby="summary-heading" className="lg:order-last lg:col-span-5 xl:col-span-4 xl:col-start-9">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+2.5rem)]">
            <OrderSummary items={items} total={total}>
              {excluded.length > 0 && (
                <div className="mt-6 border-t border-line-strong pt-6 text-sm text-muted">
                  <p>Not included, and kept in your bag:</p>
                  <ul className="mt-2 space-y-1">
                    {excluded.map((line) => (
                      <li key={line.id}>
                        {line.name} (
                        {!line.product
                          ? "no longer available"
                          : line.product.stock > 0
                            ? "already in your bag in another size"
                            : "sold out"}
                        )
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link href="/cart" className="link-quiet label mt-6 inline-block">
                Edit bag
              </Link>
            </OrderSummary>
          </div>
        </aside>

        <div className="lg:col-span-7">
          <CheckoutForm
            checkoutKey={randomUUID()}
            lines={orderable.map((line) => ({ lineId: line.id, quantity: line.quantity }))}
            defaultName={user.name}
          />
        </div>
      </div>
    </section>
  );
}
