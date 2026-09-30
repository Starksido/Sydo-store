import type { Metadata } from "next";
import Link from "next/link";

/** The 404 page's metadata, shared by both not-found pages and the admin's (see `adminMetadata`). */
export const notFoundMetadata: Metadata = { title: "Page not found" };

/** The 404 page's content, shared by the root and `(store)` not-found pages. */
export function NotFoundMessage() {
  return (
    <section aria-labelledby="not-found-heading" className="container-prose section">
      <div className="mx-auto max-w-sm">
        <p className="eyebrow text-muted">404</p>
        <h1 id="not-found-heading" className="mt-3 heading-1">
          Page not found
        </h1>
        <p className="mt-3 mb-10 text-muted">The page you were looking for doesn&apos;t exist or has moved.</p>
        <Link href="/" className="btn btn-primary w-full">
          Continue shopping
        </Link>
      </div>
    </section>
  );
}
