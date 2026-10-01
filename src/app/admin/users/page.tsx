import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";

import { ConfirmButton } from "@/components/admin/confirm-button";
import { SavedNotice } from "@/components/admin/saved-notice";
import { listRoleChanges, listUsers } from "@/lib/admin/users";
import { formatOrderDate } from "@/lib/catalog";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../admin-metadata";
import { setUserRoleAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Users" });
}

const MAX_PAGE = 1000;

const RESULTS: Record<string, { tone: "saved" | "refused"; message: string }> = {
  added: { tone: "saved", message: "Admin role added. They can use the admin from their next page load." },
  removed: { tone: "saved", message: "Admin role removed, and they've been signed out everywhere." },
  unchanged: { tone: "saved", message: "Nothing changed: they already had that role." },
  self: { tone: "refused", message: "You can't remove your own admin role. Another admin can." },
  unverified: { tone: "refused", message: "They haven't confirmed their email address yet, so they can't be made an admin." },
  "last-admin": { tone: "refused", message: "That's the only admin, so the role can't be removed. Add another admin first." },
};

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const { user: me } = await requireAdmin("/admin/users");
  const params = await searchParams;

  const q = one(params.q).slice(0, 100);
  const admins = one(params.role) === "admin";
  const pageText = one(params.page);
  const page = Math.min(Math.max(/^\d+$/.test(pageText) ? Number(pageText) : 1, 1), MAX_PAGE);
  const result = RESULTS[one(params.result)];

  const [{ users, hasMore }, changes] = await Promise.all([listUsers({ q, admins, page }), listRoleChanges()]);

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (admins) query.set("role", "admin");
    if (target > 1) query.set("page", String(target));
    const search = query.toString();
    return search ? `/admin/users?${search}` : "/admin/users";
  };
  const filtered = Boolean(q || admins);

  return (
    <section aria-labelledby="users-heading" className="container-page section">
      <h1 id="users-heading" className="heading-1">
        Users
      </h1>
      <p className="mt-3 max-w-2xl text-muted">
        Admins can manage products, stock, orders, refunds and other admins. Only users who have confirmed their
        email address can be made admins.
      </p>

      {result && (
        <div className="mt-8">
          {result.tone === "saved" ? (
            <SavedNotice>{result.message}</SavedNotice>
          ) : (
            <p role="alert" className="border border-error p-4 text-sm text-error">
              {result.message}
            </p>
          )}
        </div>
      )}

      <Form action="/admin/users" className="mt-8 grid gap-x-6 gap-y-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="label">Search</span>
          <input type="search" name="q" defaultValue={q} maxLength={100} placeholder="Name or email" className="input" />
        </label>
        <label className="block">
          <span className="label">Role</span>
          <select name="role" defaultValue={admins ? "admin" : ""} className="input">
            <option value="">Everyone</option>
            <option value="admin">Admins</option>
          </select>
        </label>
        <div className="flex gap-3">
          <button type="submit" className="btn btn-secondary">
            Filter
          </button>
          {filtered && (
            <Link href="/admin/users" className="btn btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </Form>

      {users.length === 0 ? (
        <p className="mt-8 border-y py-10 text-muted">
          {page > 1 ? "There are no users on this page." : filtered ? "No users match these filters." : "There are no users yet."}
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="table-data">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col" className="hidden md:table-cell">
                  Joined
                </th>
                <th scope="col" className="hidden text-right sm:table-cell">
                  Orders
                </th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isAdmin = user.role === "admin";
                return (
                  <tr key={user.id}>
                    <td>
                      {user.name}
                      <span className="mt-1 block text-xs break-all text-muted">{user.email}</span>
                    </td>
                    <td className="hidden text-sm whitespace-nowrap md:table-cell">{formatOrderDate(user.createdAt)}</td>
                    <td className="hidden text-right tabular-nums sm:table-cell">
                      {user.orders > 0 ? (
                        <Link href={`/admin/orders?q=${encodeURIComponent(user.email)}`} className="link-quiet">
                          {user.orders}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-3">
                        {isAdmin ? <span className="badge badge-strong">Admin</span> : <span className="badge">Customer</span>}
                        {user.id === me.id ? (
                          <span className="text-xs text-muted">You</span>
                        ) : isAdmin ? (
                          <ConfirmButton
                            action={setUserRoleAction.bind(null, user.id, "user")}
                            label="Remove admin"
                            confirmLabel="Yes, remove"
                            warning={`${user.email} will lose access to the admin and be signed out everywhere.`}
                          />
                        ) : !user.emailVerified ? (
                          <span className="text-xs text-muted">Email not confirmed</span>
                        ) : (
                          <ConfirmButton
                            action={setUserRoleAction.bind(null, user.id, "admin")}
                            label="Make admin"
                            confirmLabel="Yes, make admin"
                            warning={`${user.email} will be able to manage products, stock, orders, refunds and other admins.`}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || hasMore) && (
        <nav aria-label="User pages" className="mt-6 flex justify-between gap-4">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn btn-secondary">
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={pageHref(page + 1)} className="btn btn-secondary">
              Older
            </Link>
          )}
        </nav>
      )}

      <div className="mt-16 border-t pt-10" role="region" aria-labelledby="changes-heading">
        <h2 id="changes-heading" className="heading-3">
          Recent role changes
        </h2>
        {changes.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet. Roles set directly in the database aren&apos;t listed.</p>
        ) : (
          <ul className="mt-6 divide-y border-y text-sm">
            {changes.map((change) => (
              <li key={change.id} className="py-3">
                <span className="break-all">{change.user.email}</span>{" "}
                {change.toRole === "admin" ? "made an admin" : "no longer an admin"}
                <span className="block text-xs text-muted">
                  by <span className="break-all">{change.changedBy.email}</span>, {formatOrderDate(change.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
