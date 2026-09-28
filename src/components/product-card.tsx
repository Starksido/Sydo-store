import Image from "next/image";
import Link from "next/link";

import { formatPrice, stockState } from "@/lib/catalog";
import type { Product } from "@/lib/products";

const sizes = "(width >= 80rem) 25vw, (width >= 48rem) 33vw, 50vw";

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <div className="media-frame">
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes={sizes}
          className={
            product.altImage
              ? "transition-opacity duration-500 group-hover:opacity-0"
              : "transition-transform duration-700 ease-out-soft group-hover:scale-[1.03]"
          }
        />
        {product.altImage && (
          <Image
            src={product.altImage}
            alt=""
            fill
            sizes={sizes}
            className="opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          />
        )}
        {product.badge && (
          <span className="eyebrow absolute top-3 left-3 bg-paper px-2 py-1">{product.badge}</span>
        )}
      </div>
      <div className="mt-3 space-y-1 pr-2">
        <h3 className="text-sm">{product.name}</h3>
        <p className="text-sm text-muted">
          {formatPrice(product.price)}
          {stockState(product.stock) === "sold-out" && <span> · Sold out</span>}
        </p>
      </div>
    </Link>
  );
}
