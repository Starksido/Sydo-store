"use server";

import { redirect } from "next/navigation";

import { startPayment } from "@/lib/payments";
import { requireSession } from "@/lib/session";

export type PayOrderState = { status: "idle" } | { status: "error"; message: string };

/**
 * Starts a new Paystack payment for the user's pending order and redirects to Paystack. Used with
 * `useActionState`, bound to the order reference; the previous state isn't needed.
 */
export async function payOrderAction(reference: string): Promise<PayOrderState> {
  // Bound arguments come from the browser too, so check the shape before using it.
  if (typeof reference !== "string" || !/^SY-[A-Z0-9]{1,20}$/.test(reference)) {
    return { status: "error", message: "This order can't be paid." };
  }
  const { user } = await requireSession(`/orders/${reference}`);

  const payment = await startPayment(user.id, user.email, reference);
  if (payment.ok) redirect(payment.authorizationUrl);
  return {
    status: "error",
    message:
      payment.reason === "unavailable"
        ? "We couldn't reach our payment provider. Please try again in a moment."
        : "This order can no longer be paid. Refresh the page to see its status.",
  };
}
