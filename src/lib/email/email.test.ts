// Resend is mocked; no email leaves the test.
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatPrice } from "@/lib/catalog";
import { sendEmail, trySendEmail } from "@/lib/email/send";
import {
  orderCancelledContent,
  type OrderEmailData,
  orderPaidContent,
  orderShippedContent,
  resetPasswordContent,
  verifyEmailContent,
} from "@/lib/email/templates";

import { mockResend } from "../../../tests/resend-mock";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const email = { to: "wanjiku@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" };

describe("sendEmail", () => {
  it("posts the email to Resend with the key, sender and idempotency key", async () => {
    const resend = mockResend();
    await sendEmail({ ...email, idempotencyKey: "order-paid/SY-7K4Q9M2X" });
    expect(resend.sent).toEqual([
      {
        from: "Sydo <orders@example.com>",
        to: ["wanjiku@example.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
        text: "Hi",
        idempotencyKey: "order-paid/SY-7K4Q9M2X",
        authorization: "Bearer re_test_0000000000000000",
      },
    ]);
  });

  it("throws when Resend refuses it; trySendEmail logs instead", async () => {
    const resend = mockResend();
    resend.fail();
    await expect(sendEmail(email)).rejects.toThrow("HTTP 500");

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(trySendEmail("test-email", email)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[email] could not send test-email", expect.any(Error));
  });

  it("without a key sends nothing: quietly in tests, and refuses in production", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sendEmail(email);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "production");
    await expect(sendEmail(email)).rejects.toThrow("RESEND_API_KEY is not set");
  });
});

const order: OrderEmailData = {
  reference: "SY-7K4Q9M2X",
  subtotal: 1_140_000,
  discount: 0,
  discountCode: null,
  total: 1_140_000,
  customer: { name: "Wanjiku", email: "wanjiku@example.com" },
  items: [
    { name: "Silk <scarf>", size: null, quantity: 2, unitPrice: 520_000 },
    { name: "Wool coat", size: "M", quantity: 1, unitPrice: 100_000 },
  ],
  delivery: { name: "Wanjiku Kamau", town: "Westlands", county: "Nairobi", address: "Mpaka Road" },
  cancelReason: null,
  shippingCarrier: null,
  trackingNumber: null,
  refundDue: false,
  url: "http://localhost:3000/account/orders/SY-7K4Q9M2X",
};

describe("email templates", () => {
  it("escape what customers typed in the HTML, and keep it as typed in the text", () => {
    const content = resetPasswordContent({ name: `"><script>`, url: "http://localhost:3000/api/auth/reset-password/x?token=a&b=c" });
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&#34;&#62;&#60;script&#62;");
    expect(content.html).toContain('href="http://localhost:3000/api/auth/reset-password/x?token=a&#38;b=c"');
    expect(content.text).toContain(`Hello "><script>,`);
    expect(content.text).toContain("http://localhost:3000/api/auth/reset-password/x?token=a&b=c");
  });

  it("put the confirmation code in the subject and body", () => {
    const content = verifyEmailContent({ name: "Wanjiku", code: "482913", minutes: 10 });
    expect(content.subject).toBe("482913 is your Sydo confirmation code");
    expect(content.html).toContain(">482913</p>");
    expect(content.text).toContain("It works for 10 minutes.");
  });

  it("list the items, total and delivery address in the order confirmation", () => {
    const { subject, text, html } = orderPaidContent(order);
    expect(subject).toBe("Order SY-7K4Q9M2X confirmed");
    expect(text).toContain(`Silk <scarf> × 2: ${formatPrice(1_040_000)}`);
    expect(text).toContain(`Wool coat, M × 1: ${formatPrice(100_000)}`);
    expect(text).toContain(`Total: ${formatPrice(1_140_000)}`);
    expect(text).toContain("Delivering to Wanjiku Kamau, Mpaka Road, Westlands, Nairobi.");
    expect(html).toContain("Silk &#60;scarf&#62; × 2");
    expect(text).toContain(order.url);
  });

  it("give tracking when shipped, and the reason and refund when cancelled", () => {
    expect(orderShippedContent({ ...order, shippingCarrier: "G4S", trackingNumber: "G4S-123" }).text).toContain(
      "Order SY-7K4Q9M2X has shipped (G4S, tracking number G4S-123).",
    );
    expect(orderShippedContent(order).text).toContain("Order SY-7K4Q9M2X has shipped.");

    const cancelled = orderCancelledContent({ ...order, cancelReason: "out_of_stock", refundDue: true }).text;
    expect(cancelled).toContain("An item in your order is out of stock.");
    expect(cancelled).toContain(`We'll refund your payment of ${formatPrice(1_140_000)}`);
    expect(orderCancelledContent(order).text).not.toContain("refund");
  });
});
