import { inBackground } from "@/lib/background";
import { notifyOrderPaid } from "@/lib/email/order-emails";
import { confirmPayment } from "@/lib/payments";
import { isValidSignature } from "@/lib/paystack";

/**
 * Paystack webhook. Only `charge.success` is acted on, and even then the event body isn't trusted:
 * `confirmPayment` re-verifies the transaction with Paystack's API and checks the amount, currency
 * and order before marking anything paid, and does nothing the second time for the same event.
 * Answers 200 once an event is handled or deliberately ignored, and 500 when it couldn't be
 * processed, so Paystack retries it.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (!isValidSignature(body, request.headers.get("x-paystack-signature"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event: { event?: unknown; data?: { reference?: unknown } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.event !== "charge.success") return new Response(null, { status: 200 });
  const reference = event.data?.reference;
  if (typeof reference !== "string" || reference.length === 0) {
    return new Response("Missing reference", { status: 400 });
  }

  try {
    const { outcome, orderReference } = await confirmPayment(reference);
    if (outcome === "paid" && orderReference) inBackground(notifyOrderPaid(orderReference));
    return Response.json({ outcome });
  } catch (error) {
    console.error(`[paystack webhook] could not process ${reference}`, error);
    return new Response("Could not process event", { status: 500 });
  }
}
