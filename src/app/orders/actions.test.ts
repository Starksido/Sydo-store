// Runs against the test database only (see tests/test-env.ts). Paystack and the session are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { payOrderAction } from "@/app/orders/actions";
import { requireSession } from "@/lib/session";

import { createProduct, createUser, resetCatalog } from "../../../tests/fixtures";
import { createOrder, setOrderStatus } from "../../../tests/orders";
import { mockPaystack } from "../../../tests/paystack-mock";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
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
  vi.restoreAllMocks();
});

async function signedInWithOrder() {
  const userId = await createUser();
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: userId, email: "buyer@example.com" },
  } as Awaited<ReturnType<typeof requireSession>>);
  return { userId, reference: await createOrder(userId, [[await createProduct(5), 1]]) };
}

describe("payOrderAction", () => {
  it("redirects the customer to Paystack's checkout", async () => {
    const { reference } = await signedInWithOrder();

    await expect(payOrderAction(reference)).rejects.toThrow(
      `REDIRECT https://checkout.paystack.com/${reference}-`,
    );
    expect(paystack.initialized).toMatchObject([{ email: "buyer@example.com" }]);
  });

  it("explains when payment can't be started", async () => {
    const { reference } = await signedInWithOrder();
    paystack.failInitialize();
    expect(await payOrderAction(reference)).toEqual({
      status: "error",
      message: "We couldn't reach our payment provider. Please try again in a moment.",
    });

    await setOrderStatus(reference, "paid");
    expect(await payOrderAction(reference)).toMatchObject({ status: "error" });
  });

  it("rejects a malformed reference before checking anything", async () => {
    await signedInWithOrder();
    vi.mocked(requireSession).mockClear();

    for (const reference of ["../etc", "", 42 as unknown as string]) {
      expect(await payOrderAction(reference)).toMatchObject({ status: "error" });
    }
    expect(requireSession).not.toHaveBeenCalled();
  });
});
