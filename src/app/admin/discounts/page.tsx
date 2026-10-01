import type { Metadata } from "next";
import Link from "next/link";

import { SavedNotice } from "@/components/admin/saved-notice";
import { formatOrderDate, formatPrice } from "@/lib/catalog";
import { listDiscountCodes, type DiscountCodeListItem } from "@/lib/discounts";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../admin-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Discounts" });
}

function amount(code: DiscountCodeListItem) {
  return code.kind === "percent" ? `${code.value}% off` : `${formatPrice(code.value)} off`;
}

/** Whether customers can use it right now, and if not, why. */
function status(code: DiscountCodeListItem, now: Date) {
  if (!code.active) return { label: "Inactive", className: "badge" };
  if (code.endsAt && code.endsAt <= now) return { label: "Ended", className: "badge" };
  if (code.startsAt && code.startsAt > now) return { label: "Scheduled", className: "badge" };
  if (code.maxRedemptions !== null && code.redemptions >= code.maxRedemptions) {
    return { label: "Used up", className: "badge" };
  }
  return { label: "Live", className: "badge badge-success" };
}

export default async function AdminDiscountsPage({ searchParams }: PageProps<"/admin/discounts">) {
  await requireAdmin("/admin/discounts");
  const codes = await listDiscountCodes();
  const deleted = (await searchParams).saved === "deleted";
  const now = new Date();

  return (
    <section aria-labelledby="discounts-heading" className="container-page section">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 id="discounts-heading" className="heading-1">
          Discounts
        </h1>
        <Link href="/admin/discounts/new" className="btn btn-primary">
          New code
        </Link>
      </div>
      <p className="mt-3 max-w-2xl text-muted">
        Codes customers enter at checkout. A code that an order has used can&apos;t be deleted, only made inactive.
      </p>
      {deleted && (
        <div className="mt-8">
          <SavedNotice>Code deleted.</SavedNotice>
        </div>
      )}

      {codes.length === 0 ? (
        <p className="mt-8 border-y py-10 text-muted">No discount codes yet.</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="table-data">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Discount</th>
                <th scope="col" className="hidden md:table-cell">
                  Window
                </th>
                <th scope="col" className="text-right">
                  Uses
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => {
                const { label, className } = status(code, now);
                return (
                  <tr key={code.id}>
                    <td>
                      <Link href={`/admin/discounts/${code.id}`} className="link-quiet tracking-wide">
                        {code.code}
                      </Link>
                    </td>
                    <td className="text-sm">
                      {amount(code)}
                      {code.minSubtotal > 0 && (
                        <span className="mt-1 block text-xs text-muted">over {formatPrice(code.minSubtotal)}</span>
                      )}
                      {code.oncePerCustomer && <span className="mt-1 block text-xs text-muted">once per customer</span>}
                    </td>
                    <td className="hidden text-sm text-muted md:table-cell">
                      {code.startsAt || code.endsAt ? (
                        <>
                          {code.startsAt ? formatOrderDate(code.startsAt) : "Now"} –{" "}
                          {code.endsAt ? formatOrderDate(code.endsAt) : "no end"}
                        </>
                      ) : (
                        "Always"
                      )}
                    </td>
                    <td className="text-right text-sm tabular-nums">
                      {code.redemptions}
                      {code.maxRedemptions !== null && ` / ${code.maxRedemptions}`}
                    </td>
                    <td>
                      <span className={className}>{label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
