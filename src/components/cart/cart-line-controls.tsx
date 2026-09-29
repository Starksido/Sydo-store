"use client";

import { useState, useTransition } from "react";

import { removeFromCart, updateCartItem } from "@/app/(store)/cart/actions";
import { useCartCount } from "@/components/cart/cart-count-provider";

const MAX_OPTIONS = 10;

type Props = {
  lineId: number;
  name: string;
  /** Current fulfillable quantity; 0 means sold out. */
  quantity: number;
  maxQuantity: number;
};

export function CartLineControls({ lineId, name, quantity, maxQuantity }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { setCount } = useCartCount();
  const options = Math.min(Math.max(maxQuantity, quantity), MAX_OPTIONS);

  const run = (action: () => ReturnType<typeof removeFromCart>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) setCount(result.count);
      else setError(result.message);
    });
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {quantity > 0 && (
          <label className="flex items-center gap-3">
            <span className="label text-muted">Qty</span>
            <select
              value={quantity}
              disabled={pending}
              onChange={(event) => {
                const next = Number(event.target.value);
                run(() => updateCartItem(lineId, next));
              }}
              aria-label={`Quantity, ${name}`}
              className="h-10 min-w-16 border border-line-strong bg-paper px-3 text-sm disabled:opacity-40"
            >
              {Array.from({ length: options }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => removeFromCart(lineId))}
          aria-label={`Remove ${name}`}
          className="label link-quiet cursor-pointer disabled:opacity-40"
        >
          Remove
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
