import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeTransaction, isValidSignature, verifyTransaction } from "@/lib/paystack";

import { mockPaystack, signPaystack } from "../../tests/paystack-mock";

const KEY = process.env.PAYSTACK_SECRET_KEY!;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isValidSignature", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "SY-AAAA2222-BBBB3333" } });

  it("accepts the HMAC-SHA512 of the raw body made with the secret key", () => {
    expect(isValidSignature(body, signPaystack(body))).toBe(true);
  });

  it("rejects a changed body, another key, a missing header and a malformed one", () => {
    expect(isValidSignature(`${body} `, signPaystack(body))).toBe(false);
    expect(isValidSignature(body, signPaystack(body, "sk_test_someoneelse"))).toBe(false);
    expect(isValidSignature(body, null)).toBe(false);
    expect(isValidSignature(body, "")).toBe(false);
    expect(isValidSignature(body, signPaystack(body).slice(0, 64))).toBe(false);
    expect(isValidSignature(body, signPaystack(body).toUpperCase())).toBe(false);
  });
});

describe("secret key", () => {
  it("refuses to run without a key or with a live key", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(() => isValidSignature("{}", "x")).toThrow("PAYSTACK_SECRET_KEY is not set");

    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_live_abc123");
    mockPaystack();
    await expect(verifyTransaction("SY-AAAA2222-BBBB3333")).rejects.toThrow("test secret key");
  });

  it("takes a live key only with PAYSTACK_MODE=live, in production, on https", async () => {
    mockPaystack();
    const verify = () => verifyTransaction("SY-AAAA2222-BBBB3333");
    vi.stubEnv("PAYSTACK_MODE", "live");

    // Live mode refuses a test key, so a live site can't take test payments.
    await expect(verify()).rejects.toThrow("must be a live secret key");

    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_live_abc123");
    await expect(verify()).rejects.toThrow("only used in a production build"); // NODE_ENV is "test"

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "http://shop.example.com");
    await expect(verify()).rejects.toThrow("https://");

    // Past the key check: the request reaches (the mock of) Paystack.
    vi.stubEnv("BETTER_AUTH_URL", "https://shop.example.com");
    await expect(verify()).rejects.toThrow("paystack-mock: no verify reply");
  });
});

describe("initializeTransaction", () => {
  it("sends the amount in cents, KES, the channels and stringified metadata with the secret key", async () => {
    const paystack = mockPaystack();

    const result = await initializeTransaction({
      email: "buyer@example.com",
      amount: 37_570_000,
      reference: "SY-AAAA2222-BBBB3333",
      callbackUrl: "http://localhost:3000/orders/SY-AAAA2222/payment",
      metadata: { order_id: 7 },
    });

    expect(result).toEqual({ authorizationUrl: "https://checkout.paystack.com/SY-AAAA2222-BBBB3333" });
    expect(paystack.requests).toEqual([
      { method: "POST", path: "/transaction/initialize", authorization: `Bearer ${KEY}` },
    ]);
    expect(paystack.initialized).toEqual([
      {
        email: "buyer@example.com",
        amount: "37570000",
        currency: "KES",
        reference: "SY-AAAA2222-BBBB3333",
        callback_url: "http://localhost:3000/orders/SY-AAAA2222/payment",
        channels: ["mobile_money", "card"],
        metadata: { order_id: 7 },
      },
    ]);
  });

  it("throws when Paystack refuses", async () => {
    const paystack = mockPaystack();
    paystack.failInitialize();
    await expect(
      initializeTransaction({
        email: "buyer@example.com",
        amount: 1000,
        reference: "SY-AAAA2222-BBBB3333",
        callbackUrl: "http://localhost:3000/",
        metadata: {},
      }),
    ).rejects.toThrow("Paystack initialize failed (500)");
  });
});

describe("verifyTransaction", () => {
  const data = {
    id: 42,
    status: "success",
    reference: "SY-AAAA2222-BBBB3333",
    amount: 520_000,
    currency: "KES",
    channel: "card",
    paid_at: "2026-09-29T10:15:00.000Z",
    metadata: JSON.stringify({ order_id: 7 }),
  };

  it("returns the transaction, parsing metadata sent back as a string", async () => {
    const paystack = mockPaystack();
    paystack.setVerify(data.reference, { data });

    await expect(verifyTransaction(data.reference)).resolves.toEqual({
      id: 42,
      status: "success",
      reference: data.reference,
      amount: 520_000,
      currency: "KES",
      channel: "card",
      paidAt: new Date(data.paid_at),
      metadata: { order_id: 7 },
    });
    expect(paystack.requests[0]).toEqual({
      method: "GET",
      path: `/transaction/verify/${data.reference}`,
      authorization: `Bearer ${KEY}`,
    });
  });

  it("returns null for a reference Paystack doesn't know, and throws on other failures", async () => {
    const paystack = mockPaystack();
    paystack.setVerify("SY-UNKNOWN2-XXXXXXXX", "not-found");
    paystack.setVerify("SY-DOWNDOWN-XXXXXXXX", "error");

    await expect(verifyTransaction("SY-UNKNOWN2-XXXXXXXX")).resolves.toBeNull();
    await expect(verifyTransaction("SY-DOWNDOWN-XXXXXXXX")).rejects.toThrow("Paystack verify failed (502)");
  });
});
