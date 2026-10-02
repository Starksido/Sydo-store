import type { Metadata } from "next";
import Link from "next/link";

import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { orderStatusText } from "@/components/orders/order-status";
import { hasPassword } from "@/lib/account";
import { formatOrderDate, formatPrice } from "@/lib/catalog";
import { listOrdersForUser } from "@/lib/orders";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "My account" };

const MAX_PAGE = 1000;

function parsePage(value: string | string[] | undefined) {
  const page = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 1;
  return Math.min(Math.max(page, 1), MAX_PAGE);
}

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const { user } = await requireSession("/account");
  const page = parsePage((await searchParams).page);
  const [{ orders, hasMore }, passwordSet] = await Promise.all([
    listOrdersForUser(user.id, { page }),
    hasPassword(user.id),
  ]);

  return (
    <section aria-labelledby="account-heading" className="container-prose section">
      <h1 id="account-heading" className="heading-1">
        My account
      </h1>
      <dl className="mt-10 divide-y border-y">
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
          <dt className="label text-muted">Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
          <dt className="label text-muted">Email</dt>
          <dd className="break-all">{user.email}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
          <dt className="label text-muted">Wishlist</dt>
          <dd>
            <Link href="/account/wishlist" className="link">
              View saved pieces
            </Link>
          </dd>
        </div>
      </dl>

      <div className="mt-16" aria-labelledby="orders-heading" role="region">
        <h2 id="orders-heading" className="heading-2">
          Order history
        </h2>
        {orders.length === 0 ? (
          <div className="mt-6 border-y py-10">
            <p className="text-muted">
              {page > 1 ? "There are no orders on this page." : "You haven't placed any orders yet."}
            </p>
            <Link href={page > 1 ? "/account" : "/collections/new-in"} className="btn btn-secondary mt-6">
              {page > 1 ? "Back to latest orders" : "Start shopping"}
            </Link>
          </div>
        ) : (
          <ul className="mt-6 divide-y border-y">
            {orders.map((order) => (
              <li key={order.reference}>
                <Link
                  href={`/account/orders/${order.reference}`}
                  className="grid gap-x-6 gap-y-1 py-4 md:grid-cols-[1fr_1.5fr_1fr_auto] md:items-baseline"
                >
                  <span>{order.reference}</span>
                  <span className="text-sm text-muted">{formatOrderDate(order.createdAt)}</span>
                  <span className="text-sm">{orderStatusText(order)}</span>
                  <span className="md:text-right">{formatPrice(order.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {(page > 1 || hasMore) && orders.length > 0 && (
          <nav aria-label="Order history pages" className="mt-6 flex justify-between gap-4">
            {page > 1 ? (
              <Link href={page === 2 ? "/account" : `/account?page=${page - 1}`} className="btn btn-secondary">
                Newer orders
              </Link>
            ) : (
              <span />
            )}
            {hasMore && (
              <Link href={`/account?page=${page + 1}`} className="btn btn-secondary">
                Older orders
              </Link>
            )}
          </nav>
        )}
      </div>

      <div className="mt-16" aria-labelledby="password-heading" role="region">
        <h2 id="password-heading" className="heading-2">
          Password
        </h2>
        <div className="mt-6">
          {passwordSet ? (
            <ChangePasswordForm />
          ) : (
            // Signed up with Google: no password yet. A reset link sets one (and signs out elsewhere).
            <p className="max-w-sm text-muted">
              You sign in with Google, so there&apos;s no password on your account. To be able to sign in with
              your email and a password as well,{" "}
              <Link href="/forgot-password" className="link text-ink">
                set a password
              </Link>
              : we&apos;ll email you a link.
            </p>
          )}
        </div>
      </div>

      <div className="mt-16 flex flex-wrap gap-4">
        {user.role === "admin" && (
          <Link href="/admin" className="btn btn-primary">
            Admin
          </Link>
        )}
        <SignOutButton />
      </div>
    </section>
  );
}
