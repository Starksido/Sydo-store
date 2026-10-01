import type { Metadata } from "next";
import Link from "next/link";

import { SavedNotice } from "@/components/admin/saved-notice";
import { Stars } from "@/components/reviews/stars";
import { formatOrderDate } from "@/lib/catalog";
import { listAdminReviews } from "@/lib/reviews";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../admin-metadata";
import { setReviewHiddenAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Reviews" });
}

const SAVED_MESSAGES: Record<string, string> = {
  hidden: "Review hidden. The product page drops it, and its average, within a minute.",
  shown: "Review shown again on the product page.",
};

const MAX_PAGE = 1000;

export default async function AdminReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requireAdmin("/admin/reviews");
  const params = await searchParams;
  const page =
    typeof params.page === "string" && /^\d{1,4}$/.test(params.page)
      ? Math.min(Math.max(Number(params.page), 1), MAX_PAGE)
      : 1;
  const saved = typeof params.saved === "string" ? SAVED_MESSAGES[params.saved] : undefined;
  const { reviews, hasMore } = await listAdminReviews({ page });

  return (
    <section aria-labelledby="reviews-heading" className="container-page section">
      <h1 id="reviews-heading" className="heading-1">
        Reviews
      </h1>
      <p className="mt-3 max-w-2xl text-muted">
        Newest first. Only customers with a delivered order can review, and reviews are published straight away. Hide
        one to take it off the product page; it stays here and can be shown again.
      </p>
      {saved && (
        <div className="mt-8 max-w-4xl">
          <SavedNotice>{saved}</SavedNotice>
        </div>
      )}

      {reviews.length === 0 ? (
        <p className="mt-8 border-y py-10 text-muted">{page > 1 ? "No reviews on this page." : "No reviews yet."}</p>
      ) : (
        <ul className="mt-8 max-w-4xl divide-y border-y">
          {reviews.map((review) => (
            <li key={review.id} id={`review-${review.id}`} className="scroll-mt-header space-y-2 py-6">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <span className="flex items-center gap-3">
                  <Stars rating={review.rating} className="text-sm" />
                  {review.hiddenAt && <span className="badge badge-error">Hidden</span>}
                </span>
                <Link href={`/admin/products/${review.product.id}`} className="link text-sm">
                  {review.product.name}
                </Link>
              </div>
              <h2 className="text-sm">{review.title}</h2>
              {review.body && <p className="text-sm break-words whitespace-pre-line text-muted">{review.body}</p>}
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-1">
                <p className="text-xs text-muted">
                  {review.author.name} · <span className="break-all">{review.author.email}</span> ·{" "}
                  {formatOrderDate(review.createdAt)}
                </p>
                <form action={setReviewHiddenAction.bind(null, review.id, !review.hiddenAt, page)}>
                  <button type="submit" className="btn btn-secondary btn-sm">
                    {review.hiddenAt ? "Show" : "Hide"}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || hasMore) && (
        <nav aria-label="Review pages" className="mt-6 flex max-w-4xl justify-between gap-4">
          {page > 1 ? (
            <Link href={page === 2 ? "/admin/reviews" : `/admin/reviews?page=${page - 1}`} className="btn btn-secondary">
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={`/admin/reviews?page=${page + 1}`} className="btn btn-secondary">
              Older
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
