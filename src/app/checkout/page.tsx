import type { Metadata } from "next";
import Link from "next/link";

import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Checkout" };

// Placeholder: there is no cart or order flow yet, only the signed-in gate.
export default async function CheckoutPage() {
  await requireSession("/checkout");

  return (
    <section aria-labelledby="checkout-heading" className="container-prose section text-center">
      <h1 id="checkout-heading" className="heading-1">
        Checkout
      </h1>
      <p className="mt-4 text-muted">Online checkout is coming soon.</p>
      <Link href="/" className="btn btn-secondary mt-8">
        Continue shopping
      </Link>
    </section>
  );
}
