import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { CartLineControls } from "@/components/cart/cart-line-controls";
import { formatPrice } from "@/lib/catalog";
import { getCart, reconcileCart, type CartLine } from "@/lib/cart";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Shopping bag" };

function lineNotice(line: CartLine, adjusted: boolean) {
  if (!line.product) return "No longer available.";
  if (line.available === 0) {
    // Stock left but none for this line: the product's other sizes in the bag hold all of it.
    return line.product.stock > 0 ? "Already in your bag in another size." : "Sold out.";
  }
  if (adjusted) return `Only ${line.available} available. Quantity updated.`;
  // Stock changed between the update and the read; the next visit updates the quantity.
  if (line.available < line.quantity) return `Only ${line.available} available.`;
  return null;
}

export default async function CartPage() {
  const { user } = await requireSession("/cart");
  const adjusted = await reconcileCart(user.id);
  const { lines, count, subtotal } = await getCart(user.id);

  if (lines.length === 0) {
    return (
      <section aria-labelledby="cart-heading" className="container-prose section text-center">
        <h1 id="cart-heading" className="heading-1">
          Shopping bag
        </h1>
        <p className="mt-4 text-muted">Your shopping bag is empty.</p>
        <Link href="/collections/new-in" className="btn btn-secondary mt-8">
          Continue shopping
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="cart-heading" className="container-page section">
      <h1 id="cart-heading" className="heading-1">
        Shopping bag
      </h1>
      <p className="mt-2 text-sm text-muted">
        {count} {count === 1 ? "item" : "items"}
      </p>

      <div className="mt-8 grid gap-y-10 md:mt-12 lg:grid-cols-12 lg:gap-x-10 xl:gap-x-16">
        <ul className="divide-y border-y lg:col-span-8">
          {lines.map((line) => {
            const notice = lineNotice(line, adjusted.has(line.id));
            const { product } = line;
            const href = product && `/products/${product.slug}`;
            return (
              <li key={line.id} className="flex gap-4 py-6 md:gap-6">
                {product && href ? (
                  <Link href={href} className="media-frame w-24 shrink-0 md:w-32" tabIndex={-1}>
                    <Image src={product.image} alt="" fill sizes="8rem" />
                  </Link>
                ) : (
                  <div aria-hidden="true" className="media-frame w-24 shrink-0 md:w-32" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
                    <h2 className="text-sm">
                      {href ? (
                        <Link href={href} className="link-quiet">
                          {line.name}
                        </Link>
                      ) : (
                        <span className="text-muted">{line.name}</span>
                      )}
                    </h2>
                    <p className="text-sm">
                      {line.available > 0 ? formatPrice(line.lineTotal) : <span className="text-muted">—</span>}
                    </p>
                  </div>
                  <dl className="mt-1 space-y-0.5 text-sm text-muted">
                    <div className="flex gap-2">
                      <dt>Size</dt>
                      <dd>{line.size ?? "One size"}</dd>
                    </div>
                    {product && (
                      <div className="flex gap-2">
                        <dt>Price</dt>
                        <dd>{formatPrice(product.price)}</dd>
                      </div>
                    )}
                  </dl>
                  {notice && <p className="mt-2 text-sm text-error">{notice}</p>}
                  <CartLineControls
                    lineId={line.id}
                    name={line.name}
                    quantity={line.available}
                    maxQuantity={line.maxQuantity}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <aside aria-labelledby="summary-heading" className="lg:col-span-4">
          <div className="bg-surface p-6 lg:sticky lg:top-[calc(var(--header-h)+2.5rem)]">
            <h2 id="summary-heading" className="label">
              Order summary
            </h2>
            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between gap-6">
                <dt>Subtotal</dt>
                <dd>{formatPrice(subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt>Shipping</dt>
                <dd>Complimentary</dd>
              </div>
            </dl>
            <div className="mt-6 border-t border-line-strong pt-6">
              {count > 0 ? (
                <Link href="/checkout" className="btn btn-primary w-full">
                  Checkout
                </Link>
              ) : (
                <p className="text-sm text-muted">Nothing in your bag is available to order right now.</p>
              )}
              <Link href="/collections/new-in" className="btn btn-secondary mt-3 w-full">
                Continue shopping
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
