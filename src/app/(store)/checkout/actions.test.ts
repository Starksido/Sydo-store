// Runs against the test database only (see tests/test-env.ts). Paystack, the session and `after` are mocked.
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { placeOrderAction } from "@/app/(store)/checkout/actions";
import { listOrdersForUser } from "@/lib/orders";
import { requireSession } from "@/lib/session";

import { createCartLine, createProduct, createUser, getStock, resetCatalog } from "../../../../tests/fixtures";
import { getPayments } from "../../../../tests/orders";
import { mockPaystack } from "../../../../tests/paystack-mock";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

let paystack: ReturnType<typeof mockPaystack>;

beforeEach(async () => {
  await resetCatalog();
  paystack = mockPaystack();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A signed-in user with one cart line, and the checkout form for it. */
async function checkout() {
  const userId = await createUser();
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: userId, email: "buyer@example.com" },
  } as Awaited<ReturnType<typeof requireSession>>);
  const product = await createProduct(5);
  const lineId = await createCartLine(userId, product, 2);

  const form = new FormData();
  form.set("fullName", "Wanjiku Kamau");
  form.set("phone", "0712 345 678");
  form.set("county", "Nairobi");
  form.set("town", "Westlands");
  form.set("address", "Mpaka Road, Apartment 4B");
  form.set("checkoutKey", randomUUID());
  form.set("lines", JSON.stringify([{ lineId, quantity: 2 }]));
  return { userId, product, form };
}

describe("placeOrderAction", () => {
  it("places the order and sends the customer to Paystack", async () => {
    const { userId, form } = await checkout();

    await expect(placeOrderAction({ status: "idle" }, form)).rejects.toThrow("REDIRECT https://checkout.paystack.com/SY-");

    const { orders } = await listOrdersForUser(userId);
    expect(orders).toHaveLength(1);
    expect(await getPayments(orders[0].reference)).toMatchObject([{ status: "pending" }]);
  });

  it("goes to the order page, instead of failing, when payment can't be started", async () => {
    const { userId, product, form } = await checkout();
    // Anything startPayment throws on, here a missing base URL.
    vi.stubEnv("BETTER_AUTH_URL", "");

    const result = await placeOrderAction({ status: "idle" }, form);

    const { orders } = await listOrdersForUser(userId);
    expect(result).toEqual({ status: "placed", reference: orders[0].reference, count: 0 });
    expect(orders[0].status).toBe("pending_payment");
    expect(await getStock(product)).toBe(3);
    expect(paystack.requests).toEqual([]);
  });
});
