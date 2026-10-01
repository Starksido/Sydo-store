"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import { setWishlistedAction } from "@/app/(store)/account/wishlist/actions";
import { HeartIcon } from "@/components/icons";
import { authClient } from "@/lib/auth-client";

type Props = { productId: number; slug: string };

const CLASS = "label link-quiet inline-flex cursor-pointer items-center gap-2 disabled:opacity-40";

/**
 * Save to wishlist. Product pages are static, so whether it's saved is fetched in the browser for
 * signed-in users; guests get a link to sign in and come back.
 */
export function WishlistButton({ productId, slug }: Props) {
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id;
  const [saved, setSaved] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/wishlist?productId=${productId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { saved: false }))
      .then((data: { saved: boolean }) => !cancelled && setSaved(data.saved))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, productId]);

  if (isPending) return <span className={`${CLASS} invisible`}>Save</span>;

  if (!userId) {
    return (
      <Link href={`/sign-in?next=${encodeURIComponent(`/products/${slug}`)}`} className={CLASS}>
        <HeartIcon />
        Save
      </Link>
    );
  }

  const toggle = () => {
    const next = !saved;
    setError(null);
    setSaved(next);
    startTransition(async () => {
      const result = await setWishlistedAction(productId, next);
      if (result.ok) {
        setSaved(result.saved);
      } else {
        setSaved(!next);
        setError(result.message);
      }
    });
  };

  return (
    <div>
      <button type="button" onClick={toggle} disabled={pending || saved === null} aria-pressed={!!saved} className={CLASS}>
        <HeartIcon fill={saved ? "currentColor" : "none"} />
        {saved ? "Saved" : "Save"}
      </button>
      {saved && (
        <Link href="/account/wishlist" className="link ml-4 text-sm text-muted">
          View wishlist
        </Link>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
