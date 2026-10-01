import { formatOrderDate } from "@/lib/catalog";
import type { ReviewListItem } from "@/lib/reviews";

import { Stars } from "./stars";

/** One review. `createdAt` may arrive as a string from the reviews API. */
export function ReviewItem({ review }: { review: Omit<ReviewListItem, "createdAt"> & { createdAt: Date | string } }) {
  return (
    <li className="py-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <Stars rating={review.rating} className="text-sm" />
        <span className="text-xs text-muted">
          {review.author} · Verified buyer · {formatOrderDate(new Date(review.createdAt))}
        </span>
      </div>
      <h3 className="mt-2 text-sm">{review.title}</h3>
      {review.body && <p className="mt-2 text-sm whitespace-pre-line text-muted">{review.body}</p>}
    </li>
  );
}
