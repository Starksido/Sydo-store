"use server";

import { notFound, redirect } from "next/navigation";

import {
  parseRefund,
  parseStatusChange,
  parseTracking,
  readStatusChangeForm,
  type RefundField,
  type StatusChangeField,
  type TrackingField,
} from "@/lib/admin/order-input";
import type { FieldErrors } from "@/lib/admin/product-input";
import { recordRefund } from "@/lib/admin/orders";
import { orderStatusLabel } from "@/lib/catalog";
import { changeOrderStatus, PAYMENT_WINDOW_MINUTES, setTracking } from "@/lib/orders";
import { requireAdmin } from "@/lib/session";

import { isId, revalidateStorefront } from "../revalidate";

/** Why an order form wasn't saved, with what was submitted. React resets a form after its action. */
export type OrderFormState<F extends string> =
  | { status: "idle" }
  | { status: "error"; values: Record<F, string>; errors: FieldErrors<F>; message?: string };

const REFERENCE = /^SY-[A-Z0-9]{8}$/;

function orderUrl(reference: string, saved: string) {
  return `/admin/orders/${reference}?saved=${saved}`;
}

/** Bound to the order's id and reference by the order page. */
export async function changeOrderStatusAction(
  orderId: unknown,
  reference: unknown,
  _: OrderFormState<StatusChangeField>,
  formData: FormData,
): Promise<OrderFormState<StatusChangeField>> {
  const { user } = await requireAdmin("/admin/orders");
  if (!isId(orderId) || typeof reference !== "string" || !REFERENCE.test(reference)) notFound();

  const form = readStatusChangeForm(formData);
  const parsed = parseStatusChange(form);
  if (!parsed) notFound();
  if (!parsed.ok) return { status: "error", values: form.values, errors: parsed.errors };

  const { expected, to } = parsed.input;
  const result = await changeOrderStatus({ orderId, userId: user.id, ...parsed.input });
  if (!result.ok) {
    if (result.reason === "not-found") notFound();
    const message =
      result.reason === "payment-open"
        ? `The customer has a payment in progress, so the order can't be cancelled yet. If it isn't paid, it expires by itself ${PAYMENT_WINDOW_MINUTES} minutes after it was placed.`
        : result.reason === "not-allowed"
          ? `An order that's ${orderStatusLabel(expected).toLowerCase()} can't be marked ${orderStatusLabel(to).toLowerCase()}.`
          : `This order changed while you were looking at it${result.current ? ` (it's now ${orderStatusLabel(result.current).toLowerCase()})` : ""}. Nothing was saved: reload the page and check it.`;
    return { status: "error", values: form.values, errors: {}, message };
  }

  // A cancel puts stock back on sale.
  if (to === "cancelled") revalidateStorefront();
  redirect(orderUrl(reference, to));
}

/** Bound to the order's id and reference by the order page. */
export async function setTrackingAction(
  orderId: unknown,
  reference: unknown,
  _: OrderFormState<TrackingField>,
  formData: FormData,
): Promise<OrderFormState<TrackingField>> {
  await requireAdmin("/admin/orders");
  if (!isId(orderId) || typeof reference !== "string" || !REFERENCE.test(reference)) notFound();

  const parsed = parseTracking(formData);
  if (!parsed.ok) return { status: "error", values: parsed.values, errors: parsed.errors };
  if (!(await setTracking({ orderId, ...parsed.input }))) {
    return {
      status: "error",
      values: parsed.values,
      errors: {},
      message: "Tracking can only be set on shipped or delivered orders. Reload the page and check it.",
    };
  }
  redirect(orderUrl(reference, "tracking"));
}

/**
 * Bound to the payment's id, its order's reference and the page to go back to (the order, or the
 * refunds list) by those pages.
 */
export async function recordRefundAction(
  paymentId: unknown,
  reference: unknown,
  from: unknown,
  _: OrderFormState<RefundField>,
  formData: FormData,
): Promise<OrderFormState<RefundField>> {
  const { user } = await requireAdmin("/admin/refunds");
  if (!isId(paymentId) || typeof reference !== "string" || !REFERENCE.test(reference)) notFound();

  const parsed = parseRefund(formData);
  if (!parsed.ok) return { status: "error", values: parsed.values, errors: parsed.errors };
  if (!(await recordRefund({ paymentId, userId: user.id, ...parsed.input }))) {
    return {
      status: "error",
      values: parsed.values,
      errors: {},
      message: "This refund isn't due any more; someone may have recorded it already. Reload the page.",
    };
  }
  redirect(from === "refunds" ? "/admin/refunds?saved=1" : orderUrl(reference, "refund"));
}
