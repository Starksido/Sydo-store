// Runs against the test database only (see tests/test-env.ts). Paystack is mocked: discount codes at
// checkout (each rule, rounding, the cap, a race for the last use) and giving a use back on expiry.
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { discountCodes, orders } from "@/db/schema";
import { parseDiscountInput, toNairobiInput, type DiscountFormValues } from "@/lib/admin/discount-input";
import { formatPrice } from "@/lib/catalog";
import { deleteDiscountCode, discountAmount, previewDiscount } from "@/lib/discounts";
import { orderPaidContent, type OrderEmailData } from "@/lib/email/templates";
import { placeOrder } from "@/lib/orders";
import { confirmPayment, expireUnpaidOrders, startPayment } from "@/lib/payments";

import { createCartLine, createProduct, createUser, getCartQuantities, getStock, resetCatalog } from "../../tests/fixtures";
import { ageOrder, agePayments, delivery, getOrderRow } from "../../tests/orders";
import { mockPaystack } from "../../tests/paystack-mock";

let paystack: ReturnType<typeof mockPaystack>;

beforeEach(async () => {
  await resetCatalog();
  paystack = mockPaystack();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function createCode(values: Partial<typeof discountCodes.$inferInsert> = {}) {
  const [row] = await db
    .insert(discountCodes)
    .values({ code: "SAVE10", kind: "percent", value: 10, ...values })
    .returning({ id: discountCodes.id });
  return row.id;
}

async function redemptions(id: number) {
  const [row] = await db.select({ n: discountCodes.redemptions }).from(discountCodes).where(eq(discountCodes.id, id));
  return row.n;
}

/** Orders `quantity` of a product for the user, with `code`, from a bag holding only that. */
async function order(userId: string, productId: number, quantity: number, code: string | null) {
  await db.execute(sql`delete from cart_items where cart_id in (select id from carts where user_id = ${userId})`);
  const lineId = await createCartLine(userId, productId, quantity);
  return placeOrder(userId, { checkoutKey: randomUUID(), lines: [{ lineId, quantity }], delivery, discountCode: code });
}

async function orderRow(reference: string) {
  const [row] = await db
    .select({
      subtotal: orders.subtotal,
      discount: orders.discount,
      total: orders.total,
      discountCodeId: orders.discountCodeId,
      discountCode: orders.discountCode,
    })
    .from(orders)
    .where(eq(orders.reference, reference));
  return row;
}

function referenceOf(result: Awaited<ReturnType<typeof placeOrder>>) {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.reference;
}

describe("discountAmount", () => {
  it("rounds percentages down to a whole shilling and keeps the total at KES 1 or more", () => {
    expect(discountAmount("percent", 10, 123_400)).toBe(12_300); // 123.40 → 123
    expect(discountAmount("percent", 15, 99_900)).toBe(14_900); // 149.85 → 149
    expect(discountAmount("fixed", 50_000, 120_000)).toBe(50_000);
    expect(discountAmount("fixed", 50_000, 30_000)).toBe(29_900);
    expect(discountAmount("percent", 100, 30_000)).toBe(29_900);
    expect(discountAmount("percent", 50, 100)).toBe(0);
  });
});

describe("placeOrder with a discount code", () => {
  it("takes the discount and a use, copying the code onto the order", async () => {
    const userId = await createUser();
    const product = await createProduct(5, 123_400);
    const id = await createCode();

    const reference = referenceOf(await order(userId, product, 1, " save10 "));

    expect(await orderRow(reference)).toEqual({
      subtotal: 123_400,
      discount: 12_300,
      total: 111_100,
      discountCodeId: id,
      discountCode: "SAVE10",
    });
    expect(await redemptions(id)).toBe(1);
  });

  it("caps a fixed discount so the order still costs KES 1", async () => {
    const userId = await createUser();
    const product = await createProduct(5, 30_000);
    await createCode({ code: "BIG", kind: "fixed", value: 100_000 });

    const reference = referenceOf(await order(userId, product, 1, "BIG"));
    expect(await orderRow(reference)).toMatchObject({ subtotal: 30_000, discount: 29_900, total: 100 });
  });

  it("refuses, ordering nothing, when the code doesn't apply", async () => {
    const product = await createProduct(5, 100_000);
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    const cases: [string, Partial<typeof discountCodes.$inferInsert> | null, string][] = [
      ["NOPE", null, "invalid"],
      ["OFF", { active: false }, "invalid"],
      ["SOON", { startsAt: future }, "not-started"],
      ["OVER", { endsAt: past }, "ended"],
      ["GONE", { maxRedemptions: 2, redemptions: 2 }, "used-up"],
      ["BIGSPEND", { minSubtotal: 200_000 }, "minimum"],
    ];
    for (const [code, values, problem] of cases) {
      if (values) await createCode({ code, ...values });
      const userId = await createUser();
      const result = await order(userId, product, 1, code);
      expect(result, code).toMatchObject({ ok: false, reason: "discount", problem });
      expect(Object.values(await getCartQuantities(userId)), code).toEqual([1]);
    }
    expect(await getStock(product)).toBe(5);
    expect(await db.$count(orders)).toBe(0);
    expect(await db.select({ n: discountCodes.redemptions }).from(discountCodes).where(eq(discountCodes.code, "GONE"))).toEqual([
      { n: 2 },
    ]);
    expect(await order(await createUser(), product, 1, "BIGSPEND")).toMatchObject({ minSubtotal: 200_000 });
  });

  it("lets a customer use a once-per-customer code once, unless that order expired", async () => {
    const userId = await createUser();
    const product = await createProduct(10, 100_000);
    const id = await createCode({ code: "ONCE", oncePerCustomer: true });

    const first = referenceOf(await order(userId, product, 1, "ONCE"));
    expect(await order(userId, product, 1, "ONCE")).toMatchObject({ ok: false, problem: "already-used" });
    expect(await previewDiscount(userId, "once", 100_000)).toMatchObject({ ok: false, problem: "already-used" });
    // Someone else can still use it.
    referenceOf(await order(await createUser(), product, 1, "ONCE"));

    await ageOrder(first, 61);
    expect(await expireUnpaidOrders()).toEqual([first]);
    expect(await redemptions(id)).toBe(1);
    referenceOf(await order(userId, product, 1, "ONCE"));
    expect(await redemptions(id)).toBe(2);
  });

  it("gives the last use to exactly one of two customers checking out at once", async () => {
    const product = await createProduct(10, 100_000);
    const id = await createCode({ code: "LAST", maxRedemptions: 1 });
    const [a, b] = [await createUser(), await createUser()];
    const [lineA, lineB] = [await createCartLine(a, product, 1), await createCartLine(b, product, 1)];

    const results = await Promise.all(
      [
        [a, lineA],
        [b, lineB],
      ].map(([userId, lineId]) =>
        placeOrder(userId as string, {
          checkoutKey: randomUUID(),
          lines: [{ lineId: lineId as number, quantity: 1 }],
          delivery,
          discountCode: "LAST",
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([{ reason: "discount", problem: "used-up" }]);
    expect(await redemptions(id)).toBe(1);
    expect(await getStock(product)).toBe(9);
  });

  it("orders without a code as before, and keeps total = subtotal - discount at the database", async () => {
    const userId = await createUser();
    const product = await createProduct(5, 100_000);
    const reference = referenceOf(await order(userId, product, 2, null));
    expect(await orderRow(reference)).toEqual({
      subtotal: 200_000,
      discount: 0,
      total: 200_000,
      discountCodeId: null,
      discountCode: null,
    });

    const error = await db
      .execute(sql`update orders set discount = 100 where reference = ${reference}`)
      .catch((e: unknown) => e);
    expect((error as { cause?: { code?: string } }).cause?.code).toBe("23514");
  });
});

describe("giving a use back", () => {
  it("happens when an unpaid order expires, and a late payment takes it again", async () => {
    const userId = await createUser();
    const product = await createProduct(5, 100_000);
    const id = await createCode({ code: "BACK", maxRedemptions: 1 });
    const reference = referenceOf(await order(userId, product, 1, "BACK"));
    expect(await redemptions(id)).toBe(1);

    const started = await startPayment(userId, "buyer@example.com", reference);
    if (!started.ok) throw new Error(JSON.stringify(started));
    const payment = paystack.lastReference();
    await ageOrder(reference, 120);
    await agePayments(reference, 90);
    paystack.settle(payment, { status: "ongoing" });
    expect(await expireUnpaidOrders()).toEqual([reference]);
    expect(await redemptions(id)).toBe(0);

    paystack.settle(payment);
    expect((await confirmPayment(payment)).outcome).toBe("paid");
    expect((await getOrderRow(reference)).status).toBe("paid");
    expect(await redemptions(id)).toBe(1);
  });

  it("doesn't happen when a paid order is cancelled", async () => {
    const userId = await createUser();
    const product = await createProduct(5, 100_000);
    const id = await createCode({ code: "KEEP" });
    const reference = referenceOf(await order(userId, product, 1, "KEEP"));
    await db.update(orders).set({ status: "cancelled", cancelReason: "other" }).where(eq(orders.reference, reference));
    expect(await redemptions(id)).toBe(1);
  });
});

describe("previewDiscount", () => {
  it("matches what placeOrder takes", async () => {
    const userId = await createUser();
    await createCode();
    expect(await previewDiscount(userId, "save10", 123_400)).toEqual({ ok: true, code: "SAVE10", discount: 12_300 });
    expect(await previewDiscount(userId, "nope", 123_400)).toEqual({ ok: false, problem: "invalid", minSubtotal: 0 });
  });
});

describe("deleteDiscountCode", () => {
  it("deletes only codes no order used", async () => {
    const unused = await createCode({ code: "UNUSED" });
    const used = await createCode({ code: "USED" });
    referenceOf(await order(await createUser(), await createProduct(5, 100_000), 1, "USED"));

    expect(await deleteDiscountCode(used)).toEqual({ ok: false, reason: "used" });
    expect(await deleteDiscountCode(unused)).toEqual({ ok: true });
    expect(await deleteDiscountCode(unused)).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("parseDiscountInput", () => {
  const base: DiscountFormValues = {
    code: " welcome10 ",
    kind: "percent",
    value: "10",
    minSubtotal: "",
    startsAt: "",
    endsAt: "",
    maxRedemptions: "",
    oncePerCustomer: false,
    active: true,
  };

  it("stores codes upper-case, amounts in cents and times in Nairobi time", () => {
    expect(
      parseDiscountInput({ ...base, kind: "fixed", value: "500", minSubtotal: "2,000", startsAt: "2026-12-01T09:00" }),
    ).toEqual({
      ok: true,
      input: {
        code: "WELCOME10",
        kind: "fixed",
        value: 50_000,
        minSubtotal: 200_000,
        startsAt: new Date("2026-12-01T06:00:00Z"),
        endsAt: null,
        maxRedemptions: null,
        oncePerCustomer: false,
        active: true,
      },
    });
    expect(toNairobiInput(new Date("2026-12-01T06:00:00Z"))).toBe("2026-12-01T09:00");
  });

  it("refuses bad codes, amounts, windows and limits", () => {
    const errors = (values: Partial<DiscountFormValues>) => {
      const result = parseDiscountInput({ ...base, ...values });
      return result.ok ? {} : result.errors;
    };
    expect(errors({ code: "a b" })).toHaveProperty("code");
    expect(errors({ value: "101" })).toHaveProperty("value");
    expect(errors({ kind: "fixed", value: "12.50" })).toHaveProperty("value");
    expect(errors({ kind: "other" })).toHaveProperty("kind");
    expect(errors({ startsAt: "2026-12-02T09:00", endsAt: "2026-12-01T09:00" })).toHaveProperty("endsAt");
    expect(errors({ maxRedemptions: "0" })).toHaveProperty("maxRedemptions");
  });
});

describe("order emails", () => {
  it("show the subtotal and discount when there is one", () => {
    const order: OrderEmailData = {
      reference: "SY-7K4Q9M2X",
      subtotal: 200_000,
      discount: 20_000,
      discountCode: "SAVE10",
      total: 180_000,
      customer: { name: "Wanjiku", email: "wanjiku@example.com" },
      items: [{ name: "Scarf", size: null, quantity: 2, unitPrice: 100_000 }],
      delivery: { name: "Wanjiku", town: "Westlands", county: "Nairobi", address: "Mpaka Road" },
      cancelReason: null,
      shippingCarrier: null,
      trackingNumber: null,
      refundDue: false,
      url: "http://localhost:3000/account/orders/SY-7K4Q9M2X",
    };
    const { text } = orderPaidContent(order);
    expect(text).toContain(`Subtotal: ${formatPrice(200_000)}`);
    expect(text).toContain(`Discount (SAVE10): −${formatPrice(20_000)}`);
    expect(text).toContain(`Total: ${formatPrice(180_000)}`);
  });
});
