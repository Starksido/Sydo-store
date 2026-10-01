import type { ReviewListItem } from "@/lib/reviews";

import { MoreReviews } from "./more-reviews";
import { ReviewFormSlot } from "./review-form";
import { ReviewItem } from "./review-item";
import { Stars } from "./stars";

type Props = {
  productId: number;
  slug: string;
  summary: { count: number; average: number | null };
  /** The first page of visible reviews; later pages load in the browser. */
  reviews: ReviewListItem[];
  hasMore: boolean;
};

/** The product page's reviews: average, count, the reviews, and the form for verified buyers. */
export function ProductReviews({ productId, slug, summary, reviews, hasMore }: Props) {
  return (
    <section aria-labelledby="reviews-heading" className="container-page section border-t">
      <div className="max-w-3xl">
        <h2 id="reviews-heading" className="heading-3 scroll-mt-header">
          Reviews
        </h2>
        {summary.average !== null ? (
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <Stars rating={summary.average} />
            <span>
              {summary.average.toFixed(1)} out of 5 · {summary.count} {summary.count === 1 ? "review" : "reviews"}
            </span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">No reviews yet. Customers can review a piece once it&apos;s delivered.</p>
        )}

        {reviews.length > 0 && (
          <>
            <ul className="mt-6 divide-y border-y">
              {reviews.map((review) => (
                <ReviewItem key={review.id} review={review} />
              ))}
            </ul>
            {hasMore && <MoreReviews productId={productId} />}
          </>
        )}

        <ReviewFormSlot productId={productId} slug={slug} />
      </div>
    </section>
  );
}
