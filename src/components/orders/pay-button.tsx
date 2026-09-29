"use client";

import { useActionState } from "react";

import { payOrderAction, type PayOrderState } from "@/app/(store)/orders/actions";

/** Starts a Paystack payment for a pending order; the action redirects to Paystack's checkout. */
export function PayButton({ reference, label }: { reference: string; label: string }) {
  const [state, submit, pending] = useActionState<PayOrderState>(payOrderAction.bind(null, reference), {
    status: "idle",
  });

  return (
    <form action={submit}>
      <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Redirecting to payment…" : label}
      </button>
      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-error">
          {state.message}
        </p>
      )}
    </form>
  );
}
