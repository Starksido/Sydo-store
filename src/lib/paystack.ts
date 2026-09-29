// Paystack API client. Server-only: it uses the secret key. No database access; see @/lib/payments.
// Test mode only for now: the key must be a `sk_test_` key, so going live is a deliberate change.
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.paystack.co";

/** Read on use, not at import, so building the app doesn't need the key. */
function secretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set.");
  if (!/^sk_test_\w+$/.test(key)) {
    throw new Error("PAYSTACK_SECRET_KEY must be a Paystack test secret key (sk_test_…).");
  }
  return key;
}

/** Transaction statuses Paystack's verify endpoint reports. Only "success" means paid. */
export type PaystackTransactionStatus =
  | "success"
  | "failed"
  | "abandoned"
  | "reversed"
  | "ongoing"
  | "pending"
  | "processing"
  | "queued";

export type PaystackTransaction = {
  id: number;
  status: PaystackTransactionStatus;
  reference: string;
  /** In the currency's subunit (cents for KES). */
  amount: number;
  currency: string;
  channel: string | null;
  paidAt: Date | null;
  metadata: Record<string, unknown>;
};

async function request<T>(method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  return { response, json };
}

/**
 * Starts a hosted-checkout transaction and returns the URL to send the customer to.
 * `amount` is in KES cents. Throws if Paystack refuses it.
 */
export async function initializeTransaction({
  email,
  amount,
  reference,
  callbackUrl,
  metadata,
}: {
  email: string;
  amount: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}) {
  const { response, json } = await request<{ authorization_url?: string }>("POST", "/transaction/initialize", {
    email,
    amount: String(amount),
    currency: "KES",
    reference,
    callback_url: callbackUrl,
    channels: ["mobile_money", "card"],
    metadata: JSON.stringify(metadata),
  });
  const url = json?.data?.authorization_url;
  if (!response.ok || json?.status !== true || typeof url !== "string") {
    throw new Error(`Paystack initialize failed (${response.status}): ${json?.message ?? "no message"}`);
  }
  return { authorizationUrl: url };
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseMetadata(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The transaction as Paystack has it, or null if Paystack doesn't know the reference (it answers
 * 400 for those). Throws on any other failure, so callers can retry later.
 */
export async function verifyTransaction(reference: string): Promise<PaystackTransaction | null> {
  const { response, json } = await request<{
    id: number;
    status: PaystackTransactionStatus;
    reference: string;
    amount: number;
    currency: string;
    channel?: string | null;
    paid_at?: string | null;
    metadata?: unknown;
  }>("GET", `/transaction/verify/${encodeURIComponent(reference)}`);

  if (response.status === 400 || response.status === 404) return null;
  const data = json?.data;
  if (!response.ok || json?.status !== true || !data) {
    throw new Error(`Paystack verify failed (${response.status}): ${json?.message ?? "no message"}`);
  }
  return {
    id: data.id,
    status: data.status,
    reference: data.reference,
    amount: data.amount,
    currency: data.currency,
    channel: data.channel ?? null,
    paidAt: data.paid_at ? new Date(data.paid_at) : null,
    metadata: parseMetadata(data.metadata),
  };
}

/** Whether `signature` (the x-paystack-signature header) is the HMAC-SHA512 of the raw body. */
export function isValidSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha512", secretKey()).update(rawBody).digest("hex"));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
