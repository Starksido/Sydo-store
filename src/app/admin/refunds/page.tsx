import type { Metadata } from "next";
import Link from "next/link";

import { OrderStatusBadge, REFUND_REASON_LABELS } from "@/components/admin/order-badges";
import { RefundForm } from "@/components/admin/order-forms";
import { SavedNotice } from "@/components/admin/saved-notice";
import { todayInNairobi } from "@/lib/admin/order-input";
import { listRefundsDue } from "@/lib/admin/orders";
import { formatOrderDate, formatPrice, paymentChannelLabel } from "@/lib/catalog";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../admin-metadata";
import { recordRefundAction } from "../orders/actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Refunds" });
}

export default async function AdminRefundsPage({ searchParams }: PageProps<"/admin/refunds">) {
  await requireAdmin("/admin/refunds");
  const saved = (await searchParams).saved === "1";
  const refunds = await listRefundsDue();
  const today = todayInNairobi();

  return (
    <section aria-labelledby="refunds-heading" className="container-page section">
      <h1 id="refunds-heading" className="heading-1">
        Refunds
      </h1>
      <p className="mt-3 max-w-2xl text-muted">
        Payments whose money is owed back, oldest first. Refund each one in the Paystack dashboard, then record the
        refund reference and date here. The customer sees it on their order page.
      </p>
      {saved && (
        <div className="mt-8 max-w-4xl">
          <SavedNotice>Refund recorded. The customer sees it as refunded.</SavedNotice>
        </div>
      )}

      {refunds.length === 0 ? (
        <p className="mt-8 border-y py-10 text-muted">No refunds are due.</p>
      ) : (
        <ul className="mt-8 max-w-4xl divide-y border-y">
          {refunds.map((refund) => (
            <li key={refund.id} className="space-y-3 py-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <span className="text-lg tabular-nums">{formatPrice(refund.amount)}</span>
                <Link href={`/admin/orders/${refund.order.reference}`} className="link text-sm">
                  Order {refund.order.reference}
                </Link>
              </div>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                {refund.reason && REFUND_REASON_LABELS[refund.reason]}
                <OrderStatusBadge status={refund.order.status} />
              </p>
              <p className="text-sm text-muted">
                <span className="break-all">{refund.reference}</span>
                {refund.paidAt && ` · paid ${formatOrderDate(refund.paidAt)}`}
                {refund.channel && ` · ${paymentChannelLabel(refund.channel)}`}
                {" · "}
                {refund.customer.name} <span className="break-all">({refund.customer.email})</span>
              </p>
              {refund.detail && <p className="text-sm text-muted">{refund.detail}</p>}
              <RefundForm
                action={recordRefundAction.bind(null, refund.id, refund.order.reference, "refunds")}
                today={today}
                idPrefix={`refund-${refund.id}`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
