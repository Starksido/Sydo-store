import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmButton } from "@/components/admin/confirm-button";
import { DiscountForm } from "@/components/admin/discount-form";
import { SavedNotice } from "@/components/admin/saved-notice";
import { discountFormValues } from "@/lib/admin/discount-input";
import { getDiscountCode } from "@/lib/discounts";
import { requireAdmin } from "@/lib/session";

import { adminMetadata } from "../../admin-metadata";
import { deleteDiscountAction, updateDiscountAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Edit discount code" });
}

export default async function EditDiscountPage({ params, searchParams }: PageProps<"/admin/discounts/[id]">) {
  await requireAdmin("/admin/discounts");
  const { id: idText } = await params;
  const id = /^\d{1,9}$/.test(idText) ? Number(idText) : 0;
  const code = id ? await getDiscountCode(id) : undefined;
  if (!code) notFound();

  const saved = (await searchParams).saved === "1";
  const initial = discountFormValues(code);

  return (
    <section aria-labelledby="discount-heading" className="container-page section">
      <div className="max-w-3xl">
        <Link href="/admin/discounts" className="eyebrow link-quiet text-muted">
          Discounts
        </Link>
        <h1 id="discount-heading" className="mt-3 heading-1 tracking-wide">
          {code.code}
        </h1>
        <p className="mt-3 text-sm text-muted">
          Used by {code.redemptions} {code.redemptions === 1 ? "order" : "orders"}
          {code.maxRedemptions !== null && ` of ${code.maxRedemptions}`}. Changes apply to new orders only.
        </p>

        {saved && (
          <div className="mt-8">
            <SavedNotice>Saved. Checkout uses the new settings right away.</SavedNotice>
          </div>
        )}

        <div className="mt-10">
          <DiscountForm
            // Remount after each save so every field shows what was stored.
            key={JSON.stringify(initial)}
            action={updateDiscountAction.bind(null, code.id)}
            initial={initial}
            submitLabel="Save changes"
          />
        </div>

        <div id="delete" className="mt-16 scroll-mt-header border-t pt-10" role="region" aria-labelledby="delete-heading">
          <h2 id="delete-heading" className="heading-3">
            Delete
          </h2>
          {code.used ? (
            <p className="mt-2 text-sm text-muted">
              Orders have used this code, so it can&apos;t be deleted. Untick &ldquo;Active&rdquo; above to stop
              customers using it.
            </p>
          ) : (
            <>
              <p className="mt-2 mb-6 text-sm text-muted">No order has used this code, so it can be deleted.</p>
              <ConfirmButton
                action={deleteDiscountAction.bind(null, code.id)}
                label="Delete code"
                confirmLabel="Yes, delete it"
                warning={`${code.code} will be deleted. This can't be undone.`}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
