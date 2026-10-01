import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { WishlistItemControls } from "@/components/account/wishlist-item-controls";
import { formatPrice, stockLabel } from "@/lib/catalog";
import { requireSession } from "@/lib/session";
import { listWishlist } from "@/lib/wishlist";

export const metadata: Metadata = { title: "Wishlist" };

export default async function WishlistPage() {
  const { user } = await requireSession("/account/wishlist");
  const products = await listWishlist(user.id);

  return (
    <section aria-labelledby="wishlist-heading" className="container-prose section">
      <Link href="/account" className="eyebrow link-quiet text-muted">
        My account
      </Link>
      <h1 id="wishlist-heading" className="heading-1 mt-3">
        Wishlist
      </h1>

      {products.length === 0 ? (
        <div className="mt-10 border-y py-10">
          <p className="text-muted">Nothing saved yet. Tap Save on a product to keep it here.</p>
          <Link href="/collections/new-in" className="btn btn-secondary mt-6">
            Start shopping
          </Link>
        </div>
      ) : (
        <ul className="mt-10 divide-y border-y">
          {products.map((product) => {
            const href = `/products/${product.slug}`;
            const oneSize = product.variants.length === 1;
            return (
              <li key={product.id} className="flex gap-4 py-6 md:gap-6">
                <Link href={href} className="media-frame w-24 shrink-0 md:w-32" tabIndex={-1}>
                  <Image src={product.image} alt="" fill sizes="8rem" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
                    <h2 className="text-sm">
                      <Link href={href} className="link-quiet">
                        {product.name}
                      </Link>
                    </h2>
                    <p className="text-sm">{formatPrice(product.price)}</p>
                  </div>
                  <p className={`mt-1 text-sm ${product.stock === 0 ? "text-muted" : ""}`}>
                    {stockLabel(product.stock)}
                    {!oneSize && product.stock > 0 && (
                      <>
                        {" · "}
                        <Link href={href} className="link">
                          Choose a size
                        </Link>
                      </>
                    )}
                  </p>
                  <WishlistItemControls
                    productId={product.id}
                    name={product.name}
                    canMove={oneSize && product.stock > 0}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
