"use client";

import { useState, useTransition } from "react";

import { moveToBagAction, setWishlistedAction } from "@/app/(store)/account/wishlist/actions";
import { useCartCount } from "@/components/cart/cart-count-provider";

type Props = {
  productId: number;
  name: string;
  /** Sold in one size with stock left, so it can go straight to the bag. */
  canMove: boolean;
};

export function WishlistItemControls({ productId, name, canMove }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { setCount } = useCartCount();

  const move = () => {
    setError(null);
    startTransition(async () => {
      const result = await moveToBagAction(productId);
      if (result.ok) setCount(result.count);
      else setError(result.message);
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const result = await setWishlistedAction(productId, false);
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {canMove && (
          <button type="button" disabled={pending} onClick={move} className="btn btn-primary btn-sm">
            Move to bag
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={remove}
          aria-label={`Remove ${name} from wishlist`}
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
