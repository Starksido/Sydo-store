// Runs against the test database only (see tests/test-env.ts). Paystack is mocked.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { orders, payments, user } from "@/db/schema";
import { countOrderWork, getAdminOrder, listAdminOrders, listRefundsDue, recordRefund } from "@/lib/admin/orders";
import { changeOrderStatus, getOrderForUser } from "@/lib/orders";
import { confirmPayment, startPayment } from "@/lib/payments";

import { createProduct, createUser, resetCatalog } from "../../../tests/fixtures";
import { createOrder, getOrderRow } from "../../../tests/orders";
import { mockPaystack } from "../../../tests/paystack-mock";

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

async function customer(name: string, email: string) {
  const id = await createUser();
  await db.update(user).set({ name, email }).where(eq(user.id, id));
  return id;
}

async function placeAndPay(userId: string) {
  const reference = await createOrder(userId, [[await createProduct(5), 1]]);
  await startPayment(userId, "buyer@example.com", reference);
  const payment = paystack.lastReference();
  paystack.settle(payment);
  await confirmPayment(payment);
  return reference;
}

/** Three orders, oldest first: Wanjiku's unpaid one, then her paid one, then Otieno's cancelled paid one. */
async function orderBook() {
  const wanjiku = await customer("Wanjiku Kamau", "wanjiku@example.com");
  const otieno = await customer("Otieno Ouma", "otieno@example.com");
  const admin = await createUser();
  const unpaid = await createOrder(wanjiku, [[await createProduct(5), 1]]);
  const paid = await placeAndPay(wanjiku);
  const cancelled = await placeAndPay(otieno);
  const { id } = await getOrderRow(cancelled);
  await changeOrderStatus({ orderId: id, expected: "paid", to: "cancelled", cancelReason: "out_of_stock", userId: admin });
  // Distinct times, oldest first.
  for (const [index, reference] of [unpaid, paid, cancelled].entries()) {
    await db.update(orders).set({ createdAt: new Date(Date.UTC(2026, 8, index + 1)) }).where(eq(orders.reference, reference));
  }
  return { wanjiku, otieno, admin, unpaid, paid, cancelled };
}

const references = (result: Awaited<ReturnType<typeof listAdminOrders>>) => result.orders.map((o) => o.reference);

describe("listAdminOrders", () => {
  it("lists every order newest first, with the customer and whether a refund is due", async () => {
    const { unpaid, paid, cancelled } = await orderBook();
    const result = await listAdminOrders();
    expect(references(result)).toEqual([cancelled, paid, unpaid]);
    expect(result.orders[0]).toMatchObject({
      status: "cancelled",
      refundDue: true,
      customer: { name: "Otieno Ouma", email: "otieno@example.com" },
    });
    expect(result.orders[1].refundDue).toBe(false);
  });

  it("filters by status, to-fulfil and refund due", async () => {
    const { unpaid, paid, cancelled } = await orderBook();
    expect(references(await listAdminOrders({ status: "pending_payment" }))).toEqual([unpaid]);
    expect(references(await listAdminOrders({ status: "to-fulfil" }))).toEqual([paid]);
    expect(references(await listAdminOrders({ refund: true }))).toEqual([cancelled]);
  });

  it("searches reference, name, email and phone, typed any way", async () => {
    const { unpaid, paid, cancelled } = await orderBook();
    expect(references(await listAdminOrders({ q: paid.toLowerCase() }))).toEqual([paid]);
    expect(references(await listAdminOrders({ q: "otieno" }))).toEqual([cancelled]);
    expect(references(await listAdminOrders({ q: "WANJIKU@" }))).toEqual([paid, unpaid]);
    // The test delivery phone is +254712345678.
    for (const q of ["0712 345 678", "+254712345678", "712345678"]) {
      expect(references(await listAdminOrders({ q })), q).toHaveLength(3);
    }
    expect(references(await listAdminOrders({ q: "%" }))).toEqual([]);
  });

  it("pages", async () => {
    const { unpaid, paid, cancelled } = await orderBook();
    const first = await listAdminOrders({ pageSize: 2 });
    expect([references(first), first.hasMore]).toEqual([[cancelled, paid], true]);
    const last = await listAdminOrders({ pageSize: 2, page: 2 });
    expect([references(last), last.hasMore]).toEqual([[unpaid], false]);
  });
});

describe("getAdminOrder", () => {
  it("has the items, customer, every payment and the timeline", async () => {
    const { cancelled } = await orderBook();
    const order = (await getAdminOrder(cancelled))!;
    expect(order).toMatchObject({
      status: "cancelled",
      cancelReason: "out_of_stock",
      customer: { name: "Otieno Ouma" },
      items: [expect.objectContaining({ quantity: 1 })],
      payments: [expect.objectContaining({ status: "success", refundStatus: "due", refundReason: "order_cancelled" })],
    });
    expect(order.events.map((e) => [e.fromStatus, e.toStatus, e.by])).toEqual([
      ["pending_payment", "paid", null],
      ["paid", "cancelled", expect.any(String)],
    ]);
    expect(await getAdminOrder("SY-NOPE0000")).toBeUndefined();
  });
});

describe("refunds", () => {
  it("lists refunds due, records one once, and shows it to the customer", async () => {
    const { cancelled, otieno, admin } = await orderBook();
    const [due] = await listRefundsDue();
    expect(due).toMatchObject({ reason: "order_cancelled", order: { reference: cancelled }, customer: { name: "Otieno Ouma" } });
    expect((await getOrderForUser(otieno, cancelled))!.refunds).toEqual([
      { amount: expect.any(Number), status: "due", refundedOn: null },
    ]);
    expect(await countOrderWork()).toEqual({ toFulfil: 1, refundsDue: 1 });

    const record = { paymentId: due.id, refundReference: "RF_1", refundedOn: "2026-10-01", userId: admin };
    expect(await recordRefund(record)).toBe(true);
    expect(await recordRefund({ ...record, refundReference: "RF_2" })).toBe(false);

    const [payment] = await db.select().from(payments).where(eq(payments.id, due.id));
    expect(payment).toMatchObject({
      refundStatus: "refunded",
      refundReference: "RF_1",
      refundedOn: "2026-10-01",
      refundRecordedBy: admin,
      refundRecordedAt: expect.any(Date),
    });
    expect(await listRefundsDue()).toEqual([]);
    expect((await getOrderForUser(otieno, cancelled))!.refunds).toMatchObject([
      { status: "refunded", refundedOn: "2026-10-01" },
    ]);
  });

  it("rejects invalid input", async () => {
    const base = { paymentId: 1, refundReference: "RF", refundedOn: "2026-10-01", userId: "admin" };
    for (const bad of [
      { ...base, paymentId: 0 },
      { ...base, refundReference: "" },
      { ...base, refundedOn: "1 October" },
      { ...base, userId: "" },
    ]) {
      await expect(recordRefund(bad)).rejects.toThrow(/^recordRefund:/);
    }
  });
});
