"use client";

import { useState, useTransition } from "react";

import type { ReviewListItem } from "@/lib/reviews";

import { ReviewItem } from "./review-item";

type ApiReview = Omit<ReviewListItem, "createdAt"> & { createdAt: string };

/** Loads further pages of reviews below the first, which the static page renders itself. */
export function MoreReviews({ productId }: { productId: number }) {
  const [reviews, setReviews] = useState<ApiReview[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = () => {
    setError(false);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/reviews?productId=${productId}&page=${page + 1}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { reviews: ApiReview[]; hasMore: boolean };
        setReviews((current) => [...current, ...data.reviews]);
        setHasMore(data.hasMore);
        setPage((current) => current + 1);
      } catch {
        setError(true);
      }
    });
  };

  return (
    <>
      {reviews.length > 0 && (
        <ul className="divide-y border-b">
          {reviews.map((review) => (
            <ReviewItem key={review.id} review={review} />
          ))}
        </ul>
      )}
      {hasMore && (
        <button type="button" onClick={load} disabled={pending} className="btn btn-secondary mt-6">
          {pending ? "Loading…" : "More reviews"}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          Reviews couldn&apos;t be loaded. Try again.
        </p>
      )}
    </>
  );
}
