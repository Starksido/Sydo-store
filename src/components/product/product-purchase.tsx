"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { addToCart } from "@/app/(store)/cart/actions";
import { useCartCount } from "@/components/cart/cart-count-provider";
import { stockState } from "@/lib/catalog";
import type { ProductVariant } from "@/lib/products";

type Props = {
  /** Total across sizes. */
  stock: number;
  /** The sizes, or one variant with a null label for a one-size product. */
  variants: ProductVariant[];
};

// Stock shown here can be up to a minute old (ISR); the server action checks live stock.
export function ProductPurchase({ stock, variants }: Props) {
  const sizes = variants.length === 1 && variants[0].label === null ? undefined : variants;
  const [size, setSize] = useState<ProductVariant | null>(null);
  const [needsSize, setNeedsSize] = useState(false);
  // What the last successful add was, so the message stays right if the size changes mid-request.
  const [added, setAdded] = useState<{ size: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { setCount } = useCartCount();
  const soldOut = stockState(stock) === "sold-out";

  const addToBag = () => {
    if (sizes && !size) {
      setNeedsSize(true);
      return;
    }
    setAdded(null);
    setError(null);
    // Guests are redirected to sign in by the action.
    const chosen = size ?? variants[0];
    startTransition(async () => {
      const result = await addToCart(chosen.id);
      if (result.ok) {
        setCount(result.count);
        setAdded({ size: chosen.label });
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <div className="mt-8">
      {!sizes && (
        <p className="flex items-baseline gap-3">
          <span className="label">Size</span>
          <span className="text-sm text-muted">One size</span>
        </p>
      )}
      {sizes && (
        <fieldset disabled={soldOut}>
          <legend className="label">Size</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {sizes.map((option) => (
              <label key={option.id} className="cursor-pointer has-disabled:cursor-not-allowed">
                <input
                  type="radio"
                  name="size"
                  value={option.id}
                  disabled={option.stock === 0}
                  checked={size?.id === option.id}
                  onChange={() => {
                    setSize(option);
                    setNeedsSize(false);
                    setAdded(null);
                    setError(null);
                  }}
                  className="peer sr-only"
                />
                <span className="flex h-11 min-w-12 items-center justify-center border px-3 text-sm transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:text-disabled peer-disabled:line-through hover:border-ink peer-disabled:hover:border-line">
                  {option.label}
                  {option.stock === 0 && <span className="sr-only"> (sold out)</span>}
                </span>
              </label>
            ))}
          </div>
          {needsSize && (
            <p role="alert" className="mt-3 text-sm text-error">
              Please select a size.
            </p>
          )}
        </fieldset>
      )}

      <button
        type="button"
        disabled={soldOut || pending}
        onClick={addToBag}
        className="btn btn-primary mt-6 w-full"
      >
        {soldOut ? "Sold out" : "Add to bag"}
      </button>

      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
      {soldOut && (
        <p className="mt-3 text-sm text-muted">
          This piece is currently unavailable. Our client advisors can help you find it in store.
        </p>
      )}
      <p role="status" className="mt-3 text-sm empty:hidden">
        {added && (
          <>
            Added to bag{added.size ? `, size ${added.size}` : ""}.{" "}
            <Link href="/cart" className="link">
              View bag
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
