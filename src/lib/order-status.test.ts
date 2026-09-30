// Runs against the test database only (see tests/test-env.ts). Paystack is mocked.
import { Pool } from "@neondatabase/serverless";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { orderEvents, orders } from "@/db/schema";
import { changeOrderStatus, setTracking } from "@/lib/orders";
import { confirmPayment, expireUnpaidOrders, startPayment } from "@/lib/payments";

import { createProduct, createUser, getStock, resetCatalog } from "../../tests/fixtures";
import { ageOrder, agePayments, createOrder, getOrderRow, getPayments } from "../../tests/orders";
import { mockPaystack } from "../../tests/paystack-mock";

/** Resolves once at least one session in this database is waiting on a lock. */
async function waitForLockWait(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await db.execute<{ waiting: number }>(sql`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `);
    if (rows[0].waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("No session started waiting on the row lock");
}

let paystack: ReturnType<typeof mockPaystack>;

beforeEach(async () => {
  await resetCatalog();
  paystack = mockPaystack();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An unpaid order for 2 of a product that had 5, and an admin. */
async function unpaidOrder() {
  const customer = await createUser();
  const admin = await createUser();
  const product = await createProduct(5);
  const reference = await createOrder(customer, [[product, 2]]);
  const { id: orderId } = await getOrderRow(reference);
  return { customer, admin, product, reference, orderId };
}

/** The same, paid through Paystack. */
async function paidOrder() {
  const order = await unpaidOrder();
  const started = await startPayment(order.customer, "buyer@example.com", order.reference);
  if (!started.ok) throw new Error("startPayment failed");
  const payment = paystack.lastReference();
  paystack.settle(payment);
  expect((await confirmPayment(payment)).outcome).toBe("paid");
  return { ...order, payment };
}

async function events(orderId: number) {
  return db
    .select({
      userId: orderEvents.userId,
      fromStatus: orderEvents.fromStatus,
      toStatus: orderEvents.toStatus,
      note: orderEvents.note,
    })
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.id));
}

async function orderRow(orderId: number) {
  const [row] = await db
    .select({
      status: orders.status,
      cancelReason: orders.cancelReason,
      shippingCarrier: orders.shippingCarrier,
      trackingNumber: orders.trackingNumber,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  return row;
}

describe("changeOrderStatus", () => {
  it("moves a paid order through processing, shipped (with tracking) and delivered, recording each step", async () => {
    const { orderId, admin } = await paidOrder();

    expect(await changeOrderStatus({ orderId, expected: "paid", to: "processing", userId: admin })).toEqual({ ok: true });
    expect(
      await changeOrderStatus({
        orderId,
        expected: "processing",
        to: "shipped",
        carrier: "G4S",
        trackingNumber: "G4S-123",
        note: "Two boxes",
        userId: admin,
      }),
    ).toEqual({ ok: true });
    expect(await changeOrderStatus({ orderId, expected: "shipped", to: "delivered", userId: admin })).toEqual({ ok: true });

    expect(await orderRow(orderId)).toEqual({
      status: "delivered",
      cancelReason: null,
      shippingCarrier: "G4S",
      trackingNumber: "G4S-123",
    });
    expect(await events(orderId)).toEqual([
      { userId: null, fromStatus: "pending_payment", toStatus: "paid", note: null },
      { userId: admin, fromStatus: "paid", toStatus: "processing", note: null },
      { userId: admin, fromStatus: "processing", toStatus: "shipped", note: "Two boxes" },
      { userId: admin, fromStatus: "shipped", toStatus: "delivered", note: null },
    ]);
  });

  it("refuses changes that skip, go back, or leave shipped, delivered or cancelled orders", async () => {
    const { orderId, admin } = await paidOrder();
    const refused = { ok: false, reason: "not-allowed" };
    const meta = { orderId, userId: admin };

    expect(await changeOrderStatus({ ...meta, expected: "paid", to: "shipped" })).toEqual(refused);
    expect(await changeOrderStatus({ ...meta, expected: "processing", to: "paid" })).toEqual(refused);
    expect(await changeOrderStatus({ ...meta, expected: "pending_payment", to: "processing" })).toEqual(refused);
    for (const expected of ["shipped", "delivered", "expired"] as const) {
      expect(await changeOrderStatus({ ...meta, expected, to: "cancelled", cancelReason: "other" })).toEqual(refused);
    }
    expect(await changeOrderStatus({ ...meta, expected: "cancelled", to: "processing" })).toEqual(refused);
    expect(await orderRow(orderId)).toMatchObject({ status: "paid" });
  });

  it("refuses a stale change, reporting the current status", async () => {
    const { orderId, admin } = await paidOrder();
    await changeOrderStatus({ orderId, expected: "paid", to: "processing", userId: admin });

    expect(await changeOrderStatus({ orderId, expected: "paid", to: "processing", userId: admin })).toEqual({
      ok: false,
      reason: "stale",
      current: "processing",
    });
    expect(await changeOrderStatus({ orderId: 999_999, expected: "paid", to: "processing", userId: admin })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await events(orderId)).toHaveLength(2);
  });

  it("cancels an unpaid order and returns its stock, but not while a payment attempt is open", async () => {
    const { orderId, admin, customer, reference, product } = await unpaidOrder();
    expect(await getStock(product)).toBe(3);
    const cancel = { orderId, expected: "pending_payment" as const, to: "cancelled" as const, userId: admin };

    await startPayment(customer, "buyer@example.com", reference);
    expect(await changeOrderStatus({ ...cancel, cancelReason: "customer_request" })).toEqual({
      ok: false,
      reason: "payment-open",
      current: "pending_payment",
    });
    expect(await getStock(product)).toBe(3);

    // The customer gave up on Paystack's page.
    paystack.settle(paystack.lastReference(), { status: "abandoned" });
    await confirmPayment(paystack.lastReference());

    expect(await changeOrderStatus({ ...cancel, cancelReason: "customer_request", note: "Phoned in" })).toEqual({
      ok: true,
    });
    expect(await orderRow(orderId)).toMatchObject({ status: "cancelled", cancelReason: "customer_request" });
    expect(await getStock(product)).toBe(5);
    expect(await events(orderId)).toEqual([
      { userId: admin, fromStatus: "pending_payment", toStatus: "cancelled", note: "Phoned in" },
    ]);
    // A cancelled order can't be paid for any more.
    expect(await startPayment(customer, "buyer@example.com", reference)).toEqual({ ok: false, reason: "not-payable" });
  });

  it("cancels a paid or processing order, returning the stock and marking the payment's refund due", async () => {
    for (const status of ["paid", "processing"] as const) {
      await resetCatalog();
      const { orderId, admin, product, reference, payment } = await paidOrder();
      if (status === "processing") await changeOrderStatus({ orderId, expected: "paid", to: "processing", userId: admin });

      expect(
        await changeOrderStatus({ orderId, expected: status, to: "cancelled", cancelReason: "out_of_stock", userId: admin }),
      ).toEqual({ ok: true });
      expect(await getStock(product)).toBe(5);
      expect(await getPayments(reference)).toMatchObject([
        { reference: payment, status: "success", refundStatus: "due", refundReason: "order_cancelled" },
      ]);
    }
  });

  it("rejects invalid input", async () => {
    const { orderId, admin } = await paidOrder();
    const base = { orderId, expected: "paid" as const, to: "processing" as const, userId: admin };
    for (const bad of [
      { ...base, orderId: 0 },
      { ...base, to: "lost" as "paid" },
      { ...base, cancelReason: "other" as const },
      { ...base, to: "cancelled" as const },
      { ...base, to: "cancelled" as const, cancelReason: "bored" as "other" },
      { ...base, carrier: "G4S" },
      { ...base, note: "x".repeat(501) },
      { ...base, userId: "" },
      { ...base, expected: "processing" as const, to: "shipped" as const, trackingNumber: "x".repeat(101) },
    ]) {
      await expect(changeOrderStatus(bad), JSON.stringify(bad).slice(0, 80)).rejects.toThrow(/^changeOrderStatus:/);
    }
  });
});

describe("changeOrderStatus under concurrency", () => {
  it("lets exactly one of a cancel and a late-arriving payment win, and returns the stock once", async () => {
    for (let run = 0; run < 3; run++) {
      await resetCatalog();
      const { orderId, admin, customer, reference, product } = await unpaidOrder();
      await startPayment(customer, "buyer@example.com", reference);
      const payment = paystack.lastReference();
      // The attempt is already closed on our side (e.g. marked failed), but Paystack then reports success.
      await db.execute(`update payments set status = 'failed' where reference = '${payment}'`);
      paystack.settle(payment);

      const [cancel, confirmed] = await Promise.all([
        changeOrderStatus({ orderId, expected: "pending_payment", to: "cancelled", cancelReason: "other", userId: admin }),
        confirmPayment(payment),
      ]);

      const { status } = await orderRow(orderId);
      if (cancel.ok) {
        expect(status).toBe("cancelled");
        expect(confirmed.outcome).toBe("needs-refund");
        expect(await getStock(product)).toBe(5);
        expect(await getPayments(reference)).toMatchObject([{ refundStatus: "due", refundReason: "order_unavailable" }]);
      } else {
        expect(cancel).toMatchObject({ reason: "stale", current: "paid" });
        expect(status).toBe("paid");
        expect(await getStock(product)).toBe(3);
      }
    }
  });

  it("never both cancels and starts a payment", async () => {
    for (let run = 0; run < 3; run++) {
      await resetCatalog();
      const { orderId, admin, customer, reference } = await unpaidOrder();

      const [cancel, started] = await Promise.all([
        changeOrderStatus({ orderId, expected: "pending_payment", to: "cancelled", cancelReason: "other", userId: admin }),
        startPayment(customer, "buyer@example.com", reference),
      ]);

      expect(cancel.ok && started.ok).toBe(false);
      if (cancel.ok) expect(started).toEqual({ ok: false, reason: "not-payable" });
      else expect(["payment-open", "stale"]).toContain(cancel.reason);
    }
  });

  it("returns the stock once when a cancel races the expiry sweep", async () => {
    for (let run = 0; run < 3; run++) {
      await resetCatalog();
      const { orderId, admin, reference, product } = await unpaidOrder();
      await ageOrder(reference, 61);

      const [cancel, expired] = await Promise.all([
        changeOrderStatus({ orderId, expected: "pending_payment", to: "cancelled", cancelReason: "other", userId: admin }),
        expireUnpaidOrders(),
      ]);

      expect(cancel.ok).toBe(expired.length === 0);
      expect(await getStock(product)).toBe(5);
      expect((await orderRow(orderId)).status).toBe(cancel.ok ? "cancelled" : "expired");
      expect(await events(orderId)).toHaveLength(1);
    }
  });
});

describe("changeOrderStatus while another transaction holds the order", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  it("refuses a cancel when a payment attempt was started while it waited for the lock", async () => {
    const { orderId, admin, product } = await unpaidOrder();
    // What startPayment does: lock the order, add a pending attempt, touch the order row.
    const other = await pool.connect();
    try {
      await other.query("begin");
      await other.query("select id from orders where id = $1 for update", [orderId]);
      await other.query("insert into payments (order_id, reference, amount) select id, reference || '-HELD', total from orders where id = $1", [orderId]);
      await other.query("update orders set updated_at = now() where id = $1", [orderId]);

      const cancel = changeOrderStatus({ orderId, expected: "pending_payment", to: "cancelled", cancelReason: "other", userId: admin });
      await waitForLockWait();
      await other.query("commit");

      await expect(cancel).resolves.toEqual({ ok: false, reason: "stale", current: "pending_payment" });
    } finally {
      other.release();
    }
    expect((await orderRow(orderId)).status).toBe("pending_payment");
    expect(await getStock(product)).toBe(3);

    // Retried, it sees the open attempt.
    expect(
      await changeOrderStatus({ orderId, expected: "pending_payment", to: "cancelled", cancelReason: "other", userId: admin }),
    ).toMatchObject({ ok: false, reason: "payment-open" });
  });
});

describe("recorded by the system", () => {
  it("logs expiry, and a late payment reinstating the order, with no user", async () => {
    const { orderId, customer, reference } = await unpaidOrder();
    await startPayment(customer, "buyer@example.com", reference);
    const payment = paystack.lastReference();
    await ageOrder(reference, 120);
    await agePayments(reference, 90);
    paystack.settle(payment, { status: "ongoing" });
    expect(await expireUnpaidOrders()).toEqual([reference]);
    paystack.settle(payment);
    expect((await confirmPayment(payment)).outcome).toBe("paid");

    expect(await events(orderId)).toEqual([
      { userId: null, fromStatus: "pending_payment", toStatus: "expired", note: null },
      { userId: null, fromStatus: "expired", toStatus: "paid", note: null },
    ]);
  });

  it("marks a second successful payment for an order already paid as a duplicate to refund, once", async () => {
    const { customer, reference, payment } = await paidOrder();
    await db.update(orders).set({ status: "pending_payment", paymentReference: null }).where(eq(orders.reference, reference));
    await startPayment(customer, "buyer@example.com", reference);
    const second = paystack.lastReference();
    await db.update(orders).set({ status: "paid", paymentReference: payment }).where(eq(orders.reference, reference));
    paystack.settle(second);

    expect((await confirmPayment(second)).outcome).toBe("needs-refund");
    expect((await confirmPayment(second)).outcome).toBe("needs-refund");
    expect(await getPayments(reference)).toMatchObject([
      { reference: payment, refundStatus: null },
      { reference: second, status: "success", refundStatus: "due", refundReason: "duplicate_payment" },
    ]);
  });
});

describe("setTracking", () => {
  it("corrects tracking on shipped and delivered orders only", async () => {
    const { orderId, admin } = await paidOrder();
    expect(await setTracking({ orderId, carrier: "DHL", trackingNumber: null })).toBe(false);

    await changeOrderStatus({ orderId, expected: "paid", to: "processing", userId: admin });
    await changeOrderStatus({ orderId, expected: "processing", to: "shipped", userId: admin });
    expect(await setTracking({ orderId, carrier: "DHL", trackingNumber: "JD01" })).toBe(true);
    expect(await orderRow(orderId)).toMatchObject({ shippingCarrier: "DHL", trackingNumber: "JD01" });
    await expect(setTracking({ orderId, carrier: "x".repeat(101), trackingNumber: null })).rejects.toThrow();
  });
});
