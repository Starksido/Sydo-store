"use client";

import { createContext, use, useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

type CartCount = { count: number; setCount: (count: number) => void };

const CartCountContext = createContext<CartCount>({ count: 0, setCount: () => {} });

/**
 * Header bag count. Pages are static, so the count is fetched in the browser and refetched when
 * the signed-in user changes. Cart actions return the new count and call `setCount` directly.
 */
export function CartCountProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id;

  useEffect(() => {
    if (isPending || !userId) return;
    let cancelled = false;
    fetch("/api/cart/count", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { count: 0 }))
      .then((data: { count: number }) => !cancelled && setCount(data.count))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, isPending]);

  // Guests always see 0, including right after signing out.
  return (
    <CartCountContext value={{ count: userId ? count : 0, setCount }}>{children}</CartCountContext>
  );
}

export function useCartCount() {
  return use(CartCountContext);
}
