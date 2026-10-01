// A fake Resend API for tests. Stubs `fetch` for api.resend.com only and passes every other request
// through (the database driver and the Paystack mock use fetch too, so set this up after
// `mockPaystack()` when a test uses both). Sets fake RESEND_API_KEY and EMAIL_FROM while active.
// Call `vi.unstubAllGlobals()` and `vi.unstubAllEnvs()` after each test.
import { vi } from "vitest";

export type SentEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string | null;
  authorization: string | null;
};

export function mockResend() {
  const realFetch = globalThis.fetch;
  const sent: SentEmail[] = [];
  let reply: "ok" | "error" = "ok";

  vi.stubEnv("RESEND_API_KEY", "re_test_0000000000000000");
  vi.stubEnv("EMAIL_FROM", "Sydo <orders@example.com>");

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.resend.com") return realFetch(input, init);
    if (init?.method !== "POST" || url.pathname !== "/emails") {
      throw new Error(`resend-mock: unexpected ${init?.method ?? "GET"} ${url.pathname}`);
    }
    if (reply === "error") return Response.json({ message: "Internal error" }, { status: 500 });

    const headers = new Headers(init.headers);
    sent.push({
      ...JSON.parse(String(init.body)),
      idempotencyKey: headers.get("idempotency-key"),
      authorization: headers.get("authorization"),
    });
    return Response.json({ id: `email-${sent.length}` });
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    sent,
    /** Emails sent to `address`. */
    to(address: string) {
      return sent.filter((email) => email.to.includes(address));
    },
    /** Resend answers every later request with a 500. */
    fail() {
      reply = "error";
    },
    /**
     * Waits until `count` emails have been sent: emails triggered by a request are sent in the
     * background, after the response.
     */
    async waitFor(count: number) {
      await vi.waitFor(() => {
        if (sent.length < count) throw new Error(`resend-mock: ${sent.length} of ${count} emails sent`);
      });
      return sent;
    },
  };
}

/** The first link in `text` whose path contains `path`. */
export function linkIn(text: string, path: string) {
  const link = text.match(/https?:\/\/\S+/g)?.find((url) => url.includes(path));
  if (!link) throw new Error(`resend-mock: no ${path} link in the email`);
  return link;
}
