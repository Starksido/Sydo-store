import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrderDetail } from "@/components/orders/order-detail";
import { inBackground } from "@/lib/background";
import { notifyOrderPaid } from "@/lib/email/order-emails";
import { getOrderForUser } from "@/lib/orders";
import { confirmPayment, getPaymentForUser, type ConfirmPaymentOutcome } from "@/lib/payments";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Payment" };

function PaymentNotice({ outcome, retryHref }: { outcome: ConfirmPaymentOutcome | "error"; retryHref: string }) {
  const checkAgain = (
    <Link href={retryHref} className="link mt-3 inline-block">
      Check again
    </Link>
  );
  let tone = "border-ink";
  let body: React.ReactNode;
  switch (outcome) {
    case "paid":
    case "already-paid":
      body = <p>Payment received. We&apos;ll be in touch when your order ships.</p>;
      break;
    case "pending":
      body = (
        <>
          <p>
            We&apos;re waiting for confirmation of your payment. If you&apos;re paying with M-Pesa, approve the prompt on
            your phone, then check again.
          </p>
          {checkAgain}
        </>
      );
      break;
    case "failed":
      tone = "border-error text-error";
      body = <p>Your payment didn&apos;t go through and you haven&apos;t been charged.</p>;
      break;
    case "needs-refund":
      tone = "border-error text-error";
      body = (
        <p>
          We received your payment, but this order could no longer be completed, so we&apos;ll refund you. Contact
          Client Services if you have any questions.
        </p>
      );
      break;
    default:
      body = (
        <>
          <p>We couldn&apos;t confirm your payment yet. If you were charged, it will show here once confirmed.</p>
          {checkAgain}
        </>
      );
  }
  return (
    <div role="status" className={`mb-8 border p-4 text-sm ${tone}`}>
      {body}
    </div>
  );
}

/**
 * Where Paystack sends the customer back to, with `?reference=`. The redirect itself proves
 * nothing: the payment is re-verified with Paystack's API before any result is shown.
 */
export default async function PaymentCallbackPage({ params, searchParams }: PageProps<"/orders/[reference]/payment">) {
  const { reference } = await params;
  const query = await searchParams;
  const paymentReference = [query.reference, query.trxref].find((value) => typeof value === "string") as
    | string
    | undefined;
  const orderPath = `/orders/${encodeURIComponent(reference)}`;
  const selfPath = `${orderPath}/payment${paymentReference ? `?reference=${encodeURIComponent(paymentReference)}` : ""}`;

  const { user } = await requireSession(selfPath);
  if (!paymentReference) redirect(orderPath);
  // Only the order's owner, and only for an attempt on this order; anyone else gets a 404.
  if (!(await getPaymentForUser(user.id, reference, paymentReference))) notFound();

  let outcome: ConfirmPaymentOutcome | "error";
  try {
    let orderReference: string | undefined;
    ({ outcome, orderReference } = await confirmPayment(paymentReference));
    if (outcome === "paid" && orderReference) inBackground(notifyOrderPaid(orderReference));
  } catch (error) {
    console.error(`[payments] could not confirm ${paymentReference} on return from Paystack`, error);
    outcome = "error";
  }

  const order = await getOrderForUser(user.id, reference);
  if (!order) notFound();
  return (
    <OrderDetail
      order={order}
      variant="confirmation"
      notice={<PaymentNotice outcome={outcome} retryHref={selfPath} />}
    />
  );
}
