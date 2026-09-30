// Runs against the test database only (see tests/test-env.ts). Paystack is mocked.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { products } from "@/db/schema";
import { setProductArchived } from "@/lib/admin/products";
import { confirmPayment, expireUnpaidOrders, MAX_PAYMENT_ATTEMPTS, startPayment } from "@/lib/payments";

import { createProduct, createUser, getStock, resetCatalog, setStock } from "../../tests/fixtures";
import { ageOrder, agePayments, createOrder, getOrderRow, getPayments, setOrderStatus } from "../../tests/orders";
import { mockPaystack } from "../../tests/paystack-mock";

const EMAIL = "buyer@example.com";
const PAID_AT = new Date("2026-09-29T10:15:00.000Z");

let paystack: ReturnType<typeof mockPaystack>;

beforeEach(async () => {
  await resetCatalog();
  paystack = mockPaystack();
  // Mismatches and refunds are logged on purpose.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A pending order with one started payment attempt. */
async function orderWithAttempt({ stock = 5, quantity = 2, price = 520_000 } = {}) {
  const userId = await createUser();
  const product = await createProduct(stock, price);
  const reference = await createOrder(userId, [[product, quantity]]);
  const started = await startPayment(userId, EMAIL, reference);
  if (!started.ok) throw new Error(`startPayment: ${JSON.stringify(started)}`);
  return { userId, product, reference, payment: paystack.lastReference() };
}

describe("startPayment", () => {
  it("starts a Paystack transaction for the order total from the database", async () => {
    const userId = await createUser();
    const product = await createProduct(5, 3_757_000);
    const reference = await createOrder(userId, [[product, 2]]);
    // A later price change doesn't change what the order costs.
    await db.update(products).set({ price: 100 }).where(eq(products.id, product));

    const result = await startPayment(userId, EMAIL, reference);

    const payment = paystack.lastReference();
    expect(payment).toMatch(new RegExp(`^${reference}-[2-9A-HJ-NP-Z]{8}$`));
    expect(result).toEqual({ ok: true, authorizationUrl: `https://checkout.paystack.com/${payment}` });
    expect(paystack.initialized).toEqual([
      {
        email: EMAIL,
        amount: String(2 * 3_757_000),
        currency: "KES",
        reference: payment,
        callback_url: `http://localhost:3000/orders/${reference}/payment`,
        channels: ["mobile_money", "card"],
        metadata: {
          order_id: (await getOrderRow(reference)).id,
          order_reference: reference,
          cancel_action: `http://localhost:3000/orders/${reference}`,
        },
      },
    ]);
    expect(await getPayments(reference)).toMatchObject([
      { reference: payment, status: "pending", amount: 2 * 3_757_000, paystackId: null },
    ]);
  });

  it("uses a new reference for every attempt", async () => {
    const { userId, reference } = await orderWithAttempt();
    await startPayment(userId, EMAIL, reference);

    const attempts = await getPayments(reference);
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((a) => a.reference)).size).toBe(2);
    expect(paystack.initialized.map((b) => b.reference)).toEqual(attempts.map((a) => a.reference));
  });

  it(`refuses a new attempt once the order has started ${MAX_PAYMENT_ATTEMPTS}`, async () => {
    const { userId, reference } = await orderWithAttempt();
    for (let i = 1; i < MAX_PAYMENT_ATTEMPTS; i++) {
      expect((await startPayment(userId, EMAIL, reference)).ok).toBe(true);
    }
    const initialized = paystack.initialized.length;

    expect(await startPayment(userId, EMAIL, reference)).toEqual({ ok: false, reason: "too-many-attempts" });
    expect(await getPayments(reference)).toHaveLength(MAX_PAYMENT_ATTEMPTS);
    expect(paystack.initialized).toHaveLength(initialized);
  });

  it("keeps the attempt, marked failed, when Paystack can't start it", async () => {
    const userId = await createUser();
    const reference = await createOrder(userId, [[await createProduct(5), 1]]);
    paystack.failInitialize();

    expect(await startPayment(userId, EMAIL, reference)).toEqual({ ok: false, reason: "unavailable" });
    expect(await getPayments(reference)).toMatchObject([{ reference: paystack.lastReference(), status: "failed" }]);
    expect((await getOrderRow(reference)).status).toBe("pending_payment");
  });

  it("refuses other users' orders, and orders that aren't awaiting payment or are past their window", async () => {
    const userId = await createUser();
    const otherId = await createUser();
    const product = await createProduct(10);
    const paid = await createOrder(userId, [[product, 1]]);
    await setOrderStatus(paid, "paid");
    const expired = await createOrder(userId, [[product, 1]]);
    await setOrderStatus(expired, "expired");
    const late = await createOrder(userId, [[product, 1]]);
    await ageOrder(late, 61);
    const others = await createOrder(otherId, [[product, 1]]);

    expect(await startPayment(userId, EMAIL, others)).toEqual({ ok: false, reason: "not-found" });
    expect(await startPayment(userId, EMAIL, "SY-NOTREAL2")).toEqual({ ok: false, reason: "not-found" });
    for (const reference of [paid, expired, late]) {
      expect(await startPayment(userId, EMAIL, reference)).toEqual({ ok: false, reason: "not-payable" });
      expect(await getPayments(reference)).toEqual([]);
    }
    expect(paystack.requests).toEqual([]);
  });
});

describe("confirmPayment", () => {
  it("marks the order paid once Paystack verifies the payment", async () => {
    const { reference, payment } = await orderWithAttempt();
    paystack.settle(payment, { id: 555, channel: "card" });

    expect(await confirmPayment(payment)).toEqual({ outcome: "paid", orderReference: reference });
    expect(await getOrderRow(reference)).toMatchObject({ status: "paid", paymentReference: payment, paidAt: PAID_AT });
    expect(await getPayments(reference)).toMatchObject([
      { reference: payment, status: "success", paystackId: 555, channel: "card", paidAt: PAID_AT },
    ]);
  });

  it("changes nothing the second time", async () => {
    const { reference, product, payment } = await orderWithAttempt({ stock: 5, quantity: 2 });
    paystack.settle(payment);

    expect((await confirmPayment(payment)).outcome).toBe("paid");
    const after = await getPayments(reference);
    expect((await confirmPayment(payment)).outcome).toBe("already-paid");

    expect(await getPayments(reference)).toEqual(after);
    expect(await getOrderRow(reference)).toMatchObject({ status: "paid", paymentReference: payment });
    expect(await getStock(product)).toBe(3);
  });

  it("pays once when the webhook and the customer's return arrive together", async () => {
    const { reference, payment } = await orderWithAttempt();
    paystack.settle(payment);

    const results = await Promise.all([confirmPayment(payment), confirmPayment(payment), confirmPayment(payment)]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["already-paid", "already-paid", "paid"]);
    expect(await getOrderRow(reference)).toMatchObject({ status: "paid", paymentReference: payment });
  });

  it("doesn't pay when Paystack's record doesn't match the order", async () => {
    const { reference, payment } = await orderWithAttempt();
    const { id: orderId, total } = await getOrderRow(reference);

    for (const overrides of [
      { amount: total - 100 },
      { amount: total + 100 },
      { currency: "NGN" },
      { metadata: { order_id: orderId + 1 } },
      { metadata: {} },
      { reference: `${reference}-ZZZZZZZZ` },
    ]) {
      paystack.settle(payment, overrides);
      expect(await confirmPayment(payment)).toEqual({ outcome: "mismatch", orderReference: reference });
    }
    expect(await getOrderRow(reference)).toMatchObject({ status: "pending_payment", paymentReference: null });
    expect(await getPayments(reference)).toMatchObject([{ status: "pending" }]);
  });

  it("ignores references it didn't issue, without asking Paystack", async () => {
    expect(await confirmPayment("SY-NOTREAL2-AAAAAAAA")).toEqual({ outcome: "unknown-reference" });
    expect(paystack.requests).toEqual([]);
  });

  it("records failed and abandoned payments and leaves the order awaiting payment", async () => {
    const { userId, reference, payment: failed } = await orderWithAttempt();
    await startPayment(userId, EMAIL, reference);
    const abandoned = paystack.lastReference();
    await startPayment(userId, EMAIL, reference);
    const unknown = paystack.lastReference();
    await startPayment(userId, EMAIL, reference);
    const ongoing = paystack.lastReference();
    paystack.settle(failed, { status: "failed" });
    paystack.settle(abandoned, { status: "abandoned" });
    paystack.setVerify(unknown, "not-found");
    paystack.settle(ongoing, { status: "ongoing" });

    expect((await confirmPayment(failed)).outcome).toBe("failed");
    expect((await confirmPayment(abandoned)).outcome).toBe("failed");
    expect((await confirmPayment(unknown)).outcome).toBe("failed");
    expect((await confirmPayment(ongoing)).outcome).toBe("pending");

    expect((await getPayments(reference)).map((p) => p.status)).toEqual(["failed", "abandoned", "failed", "pending"]);
    expect((await getOrderRow(reference)).status).toBe("pending_payment");
  });

  it("throws, changing nothing, when Paystack can't be reached", async () => {
    const { reference, payment } = await orderWithAttempt();
    paystack.setVerify(payment, "error");

    await expect(confirmPayment(payment)).rejects.toThrow("Paystack verify failed");
    expect((await getOrderRow(reference)).status).toBe("pending_payment");
    expect(await getPayments(reference)).toMatchObject([{ status: "pending" }]);
  });

  it("flags a second successful payment for a refund and keeps the first", async () => {
    const { userId, reference, payment: first } = await orderWithAttempt();
    await startPayment(userId, EMAIL, reference);
    const second = paystack.lastReference();
    paystack.settle(first);
    paystack.settle(second);

    expect((await confirmPayment(first)).outcome).toBe("paid");
    expect((await confirmPayment(second)).outcome).toBe("needs-refund");
    expect((await confirmPayment(second)).outcome).toBe("needs-refund");

    expect((await getOrderRow(reference)).paymentReference).toBe(first);
    // Both succeeded; the one that isn't the order's payment_reference is the refund.
    expect((await getPayments(reference)).map((p) => p.status)).toEqual(["success", "success"]);
  });

  describe("a payment that succeeds after the order expired", () => {
    async function expiredOrder() {
      const order = await orderWithAttempt({ stock: 5, quantity: 2 });
      await ageOrder(order.reference, 120);
      await agePayments(order.reference, 90);
      // Still open on Paystack when the sweep checks, so the sweep expires the order.
      paystack.settle(order.payment, { status: "ongoing" });
      expect(await expireUnpaidOrders()).toEqual([order.reference]);
      expect(await getStock(order.product)).toBe(5);
      paystack.settle(order.payment);
      return order;
    }

    it("reinstates the order when the stock is still there", async () => {
      const { reference, product, payment } = await expiredOrder();

      expect((await confirmPayment(payment)).outcome).toBe("paid");
      expect(await getOrderRow(reference)).toMatchObject({ status: "paid", paymentReference: payment });
      expect(await getStock(product)).toBe(3);

      expect((await confirmPayment(payment)).outcome).toBe("already-paid");
      expect(await getStock(product)).toBe(3);
    });

    it("reinstates it even when a product in it was archived since", async () => {
      const { reference, product, payment } = await expiredOrder();
      await setProductArchived(product, true);

      expect((await confirmPayment(payment)).outcome).toBe("paid");
      expect(await getOrderRow(reference)).toMatchObject({ status: "paid", paymentReference: payment });
      expect(await getStock(product)).toBe(3);
    });

    it("flags it for a refund, changing no stock, when the items have sold since", async () => {
      const { reference, product, payment } = await expiredOrder();
      await setStock(product, 1);

      expect((await confirmPayment(payment)).outcome).toBe("needs-refund");
      expect(await getOrderRow(reference)).toMatchObject({ status: "expired", paymentReference: null });
      expect(await getStock(product)).toBe(1);
      expect(await getPayments(reference)).toMatchObject([{ reference: payment, status: "success" }]);
    });
  });
});

describe("expireUnpaidOrders", () => {
  it("expires orders unpaid after 60 minutes and returns their stock, across sizes", async () => {
    const userId = await createUser();
    const coat = await createProduct(5);
    const scarf = await createProduct(4);
    const old = await createOrder(userId, [
      [coat, 1, "M"],
      [coat, 2, "L"],
      [scarf, 1],
    ]);
    const recent = await createOrder(userId, [[scarf, 1]]);
    const paid = await createOrder(userId, [[scarf, 1]]);
    await ageOrder(old, 61);
    await ageOrder(paid, 120);
    await setOrderStatus(paid, "paid");
    expect([await getStock(coat), await getStock(scarf)]).toEqual([2, 1]);

    expect(await expireUnpaidOrders()).toEqual([old]);

    expect((await getOrderRow(old)).status).toBe("expired");
    expect((await getOrderRow(recent)).status).toBe("pending_payment");
    expect((await getOrderRow(paid)).status).toBe("paid");
    expect([await getStock(coat), await getStock(scarf)]).toEqual([5, 2]);
    expect(await expireUnpaidOrders()).toEqual([]);
    expect([await getStock(coat), await getStock(scarf)]).toEqual([5, 2]);
  });

  it("returns what stock it can when a product was deleted", async () => {
    const userId = await createUser();
    const kept = await createProduct(3);
    const deleted = await createProduct(3);
    const reference = await createOrder(userId, [
      [kept, 1],
      [deleted, 1],
    ]);
    await db.delete(products).where(eq(products.id, deleted));
    await ageOrder(reference, 61);

    expect(await expireUnpaidOrders()).toEqual([reference]);
    expect(await getStock(kept)).toBe(3);
  });

  it("waits 30 minutes after a payment was started, in case the customer is still paying", async () => {
    const { reference, product, payment } = await orderWithAttempt({ stock: 5, quantity: 2 });
    await ageOrder(reference, 70);
    paystack.settle(payment, { status: "ongoing" });

    expect(await expireUnpaidOrders()).toEqual([]);
    expect((await getOrderRow(reference)).status).toBe("pending_payment");

    await agePayments(reference, 31);
    expect(await expireUnpaidOrders()).toEqual([reference]);
    expect(await getStock(product)).toBe(5);
    expect(paystack.verifyCount(payment)).toBe(2);
  });

  it("pays, instead of expiring, an order whose payment went through without a webhook", async () => {
    const { reference, product, payment } = await orderWithAttempt({ stock: 5, quantity: 2 });
    await ageOrder(reference, 120);
    await agePayments(reference, 90);
    paystack.settle(payment);

    expect(await expireUnpaidOrders()).toEqual([]);
    expect(await getOrderRow(reference)).toMatchObject({ status: "paid", paymentReference: payment });
    expect(await getStock(product)).toBe(3);
  });

  it("leaves an order it can't check with Paystack for the next run", async () => {
    const { reference, payment } = await orderWithAttempt();
    await ageOrder(reference, 120);
    await agePayments(reference, 90);
    paystack.setVerify(payment, "error");

    expect(await expireUnpaidOrders()).toEqual([]);
    expect((await getOrderRow(reference)).status).toBe("pending_payment");

    paystack.settle(payment, { status: "abandoned" });
    expect(await expireUnpaidOrders()).toEqual([reference]);
  });

  it("doesn't expire an order whose open attempts it didn't get to check", async () => {
    const { userId, reference, product } = await orderWithAttempt({ stock: 5, quantity: 2 });
    await startPayment(userId, EMAIL, reference);
    const [first, second] = (await getPayments(reference)).map((p) => p.reference);
    await ageOrder(reference, 120);
    await agePayments(reference, 90);
    paystack.settle(first, { status: "ongoing" });
    paystack.settle(second, { status: "ongoing" });

    // Only the first attempt fits in this run, so the second is still unchecked.
    expect(await expireUnpaidOrders({ limit: 1 })).toEqual([]);
    expect((await getOrderRow(reference)).status).toBe("pending_payment");
    expect([paystack.verifyCount(first), paystack.verifyCount(second)]).toEqual([1, 0]);

    expect(await expireUnpaidOrders()).toEqual([reference]);
    expect(await getStock(product)).toBe(5);
  });

  it("returns the stock once when two sweeps run at the same time", async () => {
    const userId = await createUser();
    const product = await createProduct(6);
    const references = [await createOrder(userId, [[product, 2]]), await createOrder(userId, [[product, 3]])];
    for (const reference of references) await ageOrder(reference, 61);
    expect(await getStock(product)).toBe(1);

    const [first, second] = await Promise.all([expireUnpaidOrders(), expireUnpaidOrders()]);

    expect([...first, ...second].sort()).toEqual([...references].sort());
    expect(await getStock(product)).toBe(6);
  });
});
