import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { CheckoutForm } from "@/components/checkout/checkout-form";
import { OrderSummary } from "@/components/checkout/order-summary";
import { getCart, reconcileCart } from "@/lib/cart";
import { discountProblemMessage, normalizeCode, previewDiscount } from "@/lib/discounts";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Checkout" };

/** The discount code from `?code=` ("Apply" in the summary), if it looks like one. */
function readCode(value: string | string[] | undefined) {
  const code = typeof value === "string" ? normalizeCode(value) : "";
  return /^[A-Z0-9-]{1,40}$/.test(code) ? code : null;
}

export default async function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  const { user } = await requireSession("/checkout");
  const code = readCode((await searchParams).code);
  await reconcileCart({ userId: user.id });
  const { lines } = await getCart({ userId: user.id });

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
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  // A preview: placeOrder checks the code again, and takes it, when the order is placed.
  const preview = code ? await previewDiscount(user.id, code, subtotal) : null;
  const applied = preview?.ok ? preview : null;

  return (
    <section aria-labelledby="checkout-heading" className="container-page section">
      <h1 id="checkout-heading" className="heading-1">
        Checkout
      </h1>

      <div className="mt-8 grid gap-y-10 md:mt-12 lg:grid-cols-12 lg:gap-x-10 xl:gap-x-16">
        <aside aria-labelledby="summary-heading" className="lg:order-last lg:col-span-5 xl:col-span-4 xl:col-start-9">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+2.5rem)]">
            <OrderSummary
              items={items}
              subtotal={subtotal}
              discount={applied?.discount ?? 0}
              discountCode={applied?.code ?? null}
              total={subtotal - (applied?.discount ?? 0)}
            >
              {excluded.length > 0 && (
                <div className="mt-6 border-t border-line-strong pt-6 text-sm text-muted">
                  <p>Not included, and kept in your bag:</p>
                  <ul className="mt-2 space-y-1">
                    {excluded.map((line) => (
                      <li key={line.id}>
                        {line.name}
                        {line.size ? `, size ${line.size}` : ""} ({line.product ? "sold out" : "no longer available"})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-6 border-t border-line-strong pt-6">
                {applied ? (
                  <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                    <span>
                      Code <span className="tracking-wide">{applied.code}</span> applied.
                    </span>
                    <Link href="/checkout" className="link">
                      Remove
                    </Link>
                  </p>
                ) : (
                  // A GET form: "Apply" reloads checkout with ?code=, which shows the new total.
                  <form action="/checkout" className="space-y-2">
                    <label htmlFor="code" className="label">
                      Discount code
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="code"
                        name="code"
                        defaultValue={code ?? ""}
                        maxLength={40}
                        autoCapitalize="characters"
                        autoComplete="off"
                        aria-invalid={preview && !preview.ok ? true : undefined}
                        aria-describedby={preview && !preview.ok ? "code-error" : undefined}
                        className="input mt-0 min-w-0 flex-1 uppercase"
                      />
                      <button type="submit" className="btn btn-secondary shrink-0">
                        Apply
                      </button>
                    </div>
                    {preview && !preview.ok && (
                      <p id="code-error" role="alert" className="field-error">
                        {discountProblemMessage(preview.problem, preview.minSubtotal)}
                      </p>
                    )}
                  </form>
                )}
              </div>
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
            discountCode={applied?.code ?? null}
          />
        </div>
      </div>
    </section>
  );
}
