// Runs against the test database only (see tests/test-env.ts). Paystack is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startPayment } from "@/lib/payments";

import { createProduct, createUser, getStock, resetCatalog } from "../../../../../tests/fixtures";
import { createOrder, getOrderRow, getPayments } from "../../../../../tests/orders";
import { mockPaystack, signPaystack } from "../../../../../tests/paystack-mock";
import { POST } from "./route";

let paystack: ReturnType<typeof mockPaystack>;

beforeEach(async () => {
  await resetCatalog();
  paystack = mockPaystack();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function deliver(body: string, signature: string | null = signPaystack(body)) {
  return POST(
    new Request("http://localhost:3000/api/webhooks/paystack", {
      method: "POST",
      headers: signature === null ? {} : { "x-paystack-signature": signature },
      body,
    }),
  );
}

/** A charge.success event as Paystack sends it. Its contents aren't trusted by the route. */
function chargeSuccess(reference: string, data: Record<string, unknown> = {}) {
  return JSON.stringify({ event: "charge.success", data: { reference, status: "success", ...data } });
}

async function pendingPayment() {
  const userId = await createUser();
  const product = await createProduct(5, 520_000);
  const reference = await createOrder(userId, [[product, 2]]);
  await startPayment(userId, "buyer@example.com", reference);
  return { reference, product, payment: paystack.lastReference() };
}

describe("POST /api/webhooks/paystack", () => {
  it("rejects events without a valid signature, before doing anything", async () => {
    const { reference, payment } = await pendingPayment();
    paystack.settle(payment);
    const body = chargeSuccess(payment);

    for (const signature of [null, "", signPaystack(body, "sk_test_wrong"), signPaystack(`${body}\n`)]) {
      expect((await deliver(body, signature)).status).toBe(401);
    }
    expect(paystack.verifyCount(payment)).toBe(0);
    expect((await getOrderRow(reference)).status).toBe("pending_payment");
  });

  it("marks the order paid for a verified charge.success", async () => {
    const { reference, payment } = await pendingPayment();
    paystack.settle(payment);

    const response = await deliver(chargeSuccess(payment));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "paid" });
    expect(await getOrderRow(reference)).toMatchObject({ status: "paid", paymentReference: payment });
  });

  it("is safe to receive the same event twice", async () => {
    const { reference, product, payment } = await pendingPayment();
    paystack.settle(payment);
    const body = chargeSuccess(payment);

    const first = await deliver(body);
    const payments = await getPayments(reference);
    const second = await deliver(body);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await second.json()).toEqual({ outcome: "already-paid" });
    expect(await getPayments(reference)).toEqual(payments);
    expect(await getStock(product)).toBe(3);
  });

  it("trusts Paystack's verify API, not the event body", async () => {
    const { reference, payment } = await pendingPayment();
    const { total } = await getOrderRow(reference);
    // The event claims success for the full amount; Paystack's own record says otherwise.
    paystack.settle(payment, { amount: total - 100 });
    const mismatch = await deliver(chargeSuccess(payment, { amount: total, currency: "KES" }));
    expect(mismatch.status).toBe(200);
    expect(await mismatch.json()).toEqual({ outcome: "mismatch" });

    paystack.settle(payment, { status: "abandoned" });
    const abandoned = await deliver(chargeSuccess(payment, { amount: total }));
    expect(await abandoned.json()).toEqual({ outcome: "failed" });

    expect((await getOrderRow(reference)).status).toBe("pending_payment");
  });

  it("acknowledges references it didn't issue and other events without acting on them", async () => {
    const unknown = await deliver(chargeSuccess("SY-NOTREAL2-AAAAAAAA"));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ outcome: "unknown-reference" });

    const { reference, payment } = await pendingPayment();
    const other = await deliver(JSON.stringify({ event: "charge.failed", data: { reference: payment } }));
    expect(other.status).toBe(200);
    expect(paystack.verifyCount(payment)).toBe(0);
    expect((await getOrderRow(reference)).status).toBe("pending_payment");
  });

  it("answers 500 when Paystack can't be reached, so the event is retried", async () => {
    const { reference, payment } = await pendingPayment();
    const body = chargeSuccess(payment);
    paystack.setVerify(payment, "error");

    expect((await deliver(body)).status).toBe(500);
    expect((await getOrderRow(reference)).status).toBe("pending_payment");

    paystack.settle(payment);
    expect((await deliver(body)).status).toBe(200);
    expect((await getOrderRow(reference)).status).toBe("paid");
  });

  it("rejects a signed body that isn't a usable event", async () => {
    expect((await deliver("not json")).status).toBe(400);
    expect((await deliver(JSON.stringify({ event: "charge.success", data: {} }))).status).toBe(400);
  });
});
