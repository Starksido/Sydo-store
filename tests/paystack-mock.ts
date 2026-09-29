// A fake Paystack API for tests. Stubs `fetch` for api.paystack.co only: the database driver also
// uses fetch, so every other request passes through. A Paystack request the test didn't set up
// fails loudly instead of reaching the network. Call `vi.unstubAllGlobals()` after each test.
import { createHmac } from "node:crypto";

import { vi } from "vitest";

type InitializeBody = {
  email: string;
  amount: string;
  currency: string;
  reference: string;
  callback_url: string;
  channels: string[];
  /** Parsed from the stringified JSON Paystack receives. */
  metadata: Record<string, unknown>;
};

export type VerifyData = {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  channel: string | null;
  paid_at: string | null;
  metadata: unknown;
};

type VerifyReply = { data: VerifyData } | "not-found" | "error";

export function mockPaystack() {
  const realFetch = globalThis.fetch;
  const initialized: InitializeBody[] = [];
  const requests: { method: string; path: string; authorization: string | null }[] = [];
  const verifyReplies = new Map<string, VerifyReply>();
  const verifyCalls = new Map<string, number>();
  let initializeReply: "ok" | "error" = "ok";
  let nextId = 1000;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.paystack.co") return realFetch(input, init);

    const method = init?.method ?? "GET";
    const authorization = new Headers(init?.headers).get("authorization");
    requests.push({ method, path: url.pathname, authorization });

    if (method === "POST" && url.pathname === "/transaction/initialize") {
      const body = JSON.parse(String(init?.body));
      initialized.push({ ...body, metadata: JSON.parse(body.metadata) });
      if (initializeReply === "error") {
        return Response.json({ status: false, message: "Something went wrong" }, { status: 500 });
      }
      return Response.json({
        status: true,
        message: "Authorization URL created",
        data: {
          authorization_url: `https://checkout.paystack.com/${body.reference}`,
          access_code: `access-${body.reference}`,
          reference: body.reference,
        },
      });
    }

    const verify = url.pathname.match(/^\/transaction\/verify\/(.+)$/);
    if (method === "GET" && verify) {
      const reference = decodeURIComponent(verify[1]);
      verifyCalls.set(reference, (verifyCalls.get(reference) ?? 0) + 1);
      const reply = verifyReplies.get(reference);
      if (!reply) throw new Error(`paystack-mock: no verify reply set up for ${reference}`);
      if (reply === "not-found") {
        return Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 });
      }
      if (reply === "error") return Response.json({ status: false, message: "Server error" }, { status: 502 });
      return Response.json({ status: true, message: "Verification successful", data: reply.data });
    }

    throw new Error(`paystack-mock: unexpected ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  /** What Paystack would report for an initialized transaction, with `overrides`. */
  function transactionFor(reference: string, overrides: Partial<VerifyData> = {}): VerifyData {
    const body = initialized.find((b) => b.reference === reference);
    if (!body) throw new Error(`paystack-mock: ${reference} was never initialized`);
    return {
      id: nextId++,
      status: "success",
      reference,
      amount: Number(body.amount),
      currency: body.currency,
      channel: "mobile_money",
      paid_at: "2026-09-29T10:15:00.000Z",
      metadata: body.metadata,
      ...overrides,
    };
  }

  return {
    initialized,
    requests,
    /** The reference of the latest initialized transaction. */
    lastReference() {
      const last = initialized.at(-1);
      if (!last) throw new Error("paystack-mock: nothing initialized");
      return last.reference;
    },
    failInitialize() {
      initializeReply = "error";
    },
    /** Verify reports the transaction with this status (default success), as initialized. */
    settle(reference: string, overrides: Partial<VerifyData> = {}) {
      verifyReplies.set(reference, { data: transactionFor(reference, overrides) });
    },
    /** Verify answers with exactly this data. */
    setVerify(reference: string, reply: VerifyReply) {
      verifyReplies.set(reference, reply);
    },
    verifyCount(reference: string) {
      return verifyCalls.get(reference) ?? 0;
    },
  };
}

/** The x-paystack-signature Paystack would send for `body`, signed with the test secret key. */
export function signPaystack(body: string, key = process.env.PAYSTACK_SECRET_KEY!) {
  return createHmac("sha512", key).update(body).digest("hex");
}
