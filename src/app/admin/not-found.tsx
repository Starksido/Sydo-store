import Link from "next/link";

// For `notFound()` in admin pages (an unknown product or category id), inside the admin shell.
// Non-admins never see it: the admin layout's own `notFound()` renders the root (store) 404.
export default function AdminNotFound() {
  return (
    <section aria-labelledby="not-found-heading" className="container-page section">
      <p className="eyebrow text-muted">404</p>
      <h1 id="not-found-heading" className="mt-3 heading-1">
        Not found
      </h1>
      <p className="mt-3 mb-10 text-muted">It may have been removed, or the link is wrong.</p>
      <Link href="/admin" className="btn btn-secondary">
        Back to overview
      </Link>
    </section>
  );
}
