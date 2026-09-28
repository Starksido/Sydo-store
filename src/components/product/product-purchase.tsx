"use client";

import { useState } from "react";

import { stockState } from "@/lib/catalog";
import type { ProductSize } from "@/lib/products";

type Props = {
  stock: number;
  sizes?: ProductSize[];
};

// Placeholder purchase controls: there is no cart yet, so "Add to bag" only confirms on screen.
export function ProductPurchase({ stock, sizes }: Props) {
  const [size, setSize] = useState<string | null>(null);
  const [needsSize, setNeedsSize] = useState(false);
  const [added, setAdded] = useState(false);
  const soldOut = stockState(stock) === "sold-out";

  const addToBag = () => {
    if (sizes && !size) {
      setNeedsSize(true);
      return;
    }
    setAdded(true);
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
              <label key={option.label} className="cursor-pointer has-disabled:cursor-not-allowed">
                <input
                  type="radio"
                  name="size"
                  value={option.label}
                  disabled={!option.available}
                  checked={size === option.label}
                  onChange={() => {
                    setSize(option.label);
                    setNeedsSize(false);
                    setAdded(false);
                  }}
                  className="peer sr-only"
                />
                <span className="flex h-11 min-w-12 items-center justify-center border px-3 text-sm transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:text-disabled peer-disabled:line-through hover:border-ink peer-disabled:hover:border-line">
                  {option.label}
                  {!option.available && <span className="sr-only"> (unavailable)</span>}
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
        disabled={soldOut}
        onClick={addToBag}
        className="btn btn-primary mt-6 w-full"
      >
        {soldOut ? "Sold out" : "Add to bag"}
      </button>

      {soldOut && (
        <p className="mt-3 text-sm text-muted">
          This piece is currently unavailable. Our client advisors can help you find it in store.
        </p>
      )}
      <p role="status" className="mt-3 text-sm empty:hidden">
        {added ? `Added to bag${size ? `, size ${size}` : ""}.` : ""}
      </p>
    </div>
  );
}
