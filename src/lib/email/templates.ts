// Email content: plain functions returning a subject, HTML and plain text. Monochrome like the
// store, with inline styles because mail clients drop stylesheets. Every value from the database or
// a user goes through `escape` in HTML.
import { CANCEL_REASONS, type CancelReason, formatCalendarDate, formatPrice } from "@/lib/catalog";

export type EmailContent = { subject: string; html: string; text: string };

const STORE = "Sydo";

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

type Block =
  | { p: string }
  | { button: { label: string; href: string } }
  | { rows: [string, string][] }
  | { small: string };

/** Lays out blocks of text as a simple one-column email, and the same content as plain text. */
function compose(subject: string, heading: string, blocks: Block[]): EmailContent {
  const html: string[] = [];
  const text: string[] = [heading.toUpperCase(), ""];
  for (const block of blocks) {
    if ("p" in block) {
      html.push(`<p style="margin:0 0 16px">${escape(block.p)}</p>`);
      text.push(block.p, "");
    } else if ("button" in block) {
      html.push(
        `<p style="margin:24px 0"><a href="${escape(block.button.href)}" style="display:inline-block;background:#111;color:#fff;padding:14px 24px;text-decoration:none;font-size:12px;letter-spacing:.12em;text-transform:uppercase">${escape(block.button.label)}</a></p>`,
      );
      text.push(`${block.button.label}: ${block.button.href}`, "");
    } else if ("rows" in block) {
      const rows = block.rows
        .map(
          ([left, right]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e5e5">${escape(left)}</td><td style="padding:8px 0 8px 16px;border-bottom:1px solid #e5e5e5;text-align:right;white-space:nowrap">${escape(right)}</td></tr>`,
        )
        .join("");
      html.push(`<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px">${rows}</table>`);
      text.push(...block.rows.map(([left, right]) => `${left}: ${right}`), "");
    } else {
      html.push(`<p style="margin:24px 0 0;font-size:12px;color:#6b6b6b">${escape(block.small)}</p>`);
      text.push(block.small, "");
    }
  }
  text.push(`— ${STORE}`);

  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;background:#fff"><div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111"><p style="margin:0 0 32px;font-size:12px;letter-spacing:.2em;text-transform:uppercase">${STORE}</p><h1 style="margin:0 0 24px;font-size:22px;font-weight:normal">${escape(heading)}</h1>${html.join("")}</div></body></html>`,
    text: text.join("\n"),
  };
}

function greeting(name: string) {
  return `Hello ${name.trim() || "there"},`;
}

export function verifyEmailContent({ name, url }: { name: string; url: string }) {
  return compose(`Confirm your email for ${STORE}`, "Confirm your email", [
    { p: greeting(name) },
    { p: "Confirm your email address to finish creating your account. The link works for one hour." },
    { button: { label: "Confirm email", href: url } },
    { small: "If you didn't create an account, you can ignore this email." },
  ]);
}

export function resetPasswordContent({ name, url }: { name: string; url: string }) {
  return compose(`Reset your ${STORE} password`, "Reset your password", [
    { p: greeting(name) },
    { p: "Use the link below to choose a new password. It works for one hour, and only once." },
    { button: { label: "Choose a new password", href: url } },
    { small: "If you didn't ask to reset your password, you can ignore this email; your password stays the same." },
  ]);
}

/** Sent to an account's owner when someone tries to sign up with its email address. */
export function existingAccountContent({ name, signInUrl, resetUrl }: { name: string; signInUrl: string; resetUrl: string }) {
  return compose(`You already have a ${STORE} account`, "You already have an account", [
    { p: greeting(name) },
    { p: "Someone tried to create an account with this email address, but you already have one." },
    { button: { label: "Sign in", href: signInUrl } },
    { p: `Forgotten your password? You can choose a new one: ${resetUrl}` },
    { small: "If this wasn't you, you can ignore this email. Nothing has changed." },
  ]);
}

export type OrderEmailData = {
  reference: string;
  subtotal: number;
  /** Taken off by a discount code; 0 for none. */
  discount: number;
  discountCode: string | null;
  total: number;
  customer: { name: string; email: string };
  items: { name: string; size: string | null; quantity: number; unitPrice: number }[];
  delivery: { name: string; town: string; county: string; address: string };
  cancelReason: CancelReason | null;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  /** The payment that paid for the order has a refund due (after a cancel). */
  refundDue: boolean;
  /** The order's page on the store. */
  url: string;
};

function itemRows(order: OrderEmailData): [string, string][] {
  return [
    ...order.items.map((item): [string, string] => [
      `${item.name}${item.size ? `, ${item.size}` : ""} × ${item.quantity}`,
      formatPrice(item.unitPrice * item.quantity),
    ]),
    ...(order.discount > 0
      ? [
          ["Subtotal", formatPrice(order.subtotal)] as [string, string],
          [`Discount${order.discountCode ? ` (${order.discountCode})` : ""}`, `−${formatPrice(order.discount)}`] as [string, string],
        ]
      : []),
    ["Total", formatPrice(order.total)],
  ];
}

export function orderPaidContent(order: OrderEmailData) {
  const { delivery } = order;
  return compose(`Order ${order.reference} confirmed`, "Thank you for your order", [
    { p: greeting(order.customer.name) },
    { p: `We've received your payment for order ${order.reference}. We'll email you again when it ships.` },
    { rows: itemRows(order) },
    { p: `Delivering to ${delivery.name}, ${delivery.address}, ${delivery.town}, ${delivery.county}.` },
    { button: { label: "View your order", href: order.url } },
  ]);
}

export function orderShippedContent(order: OrderEmailData) {
  const tracking = [order.shippingCarrier, order.trackingNumber && `tracking number ${order.trackingNumber}`]
    .filter(Boolean)
    .join(", ");
  return compose(`Order ${order.reference} has shipped`, "Your order is on its way", [
    { p: greeting(order.customer.name) },
    { p: `Order ${order.reference} has shipped${tracking ? ` (${tracking})` : ""}.` },
    { rows: itemRows(order) },
    { button: { label: "View your order", href: order.url } },
  ]);
}

export function orderCancelledContent(order: OrderEmailData) {
  const reason = order.cancelReason ? CANCEL_REASONS[order.cancelReason].customer : null;
  return compose(`Order ${order.reference} cancelled`, "Your order has been cancelled", [
    { p: greeting(order.customer.name) },
    { p: `Order ${order.reference} has been cancelled.${reason ? ` ${reason}` : ""}` },
    ...(order.refundDue
      ? [{ p: `We'll refund your payment of ${formatPrice(order.total)}, and email you when it's done.` }]
      : []),
    { button: { label: "View your order", href: order.url } },
  ]);
}

export function refundRecordedContent(order: OrderEmailData, refund: { amount: number; refundedOn: string }) {
  return compose(`Refund for order ${order.reference}`, "Your refund is on its way", [
    { p: greeting(order.customer.name) },
    {
      p: `We refunded ${formatPrice(refund.amount)} for order ${order.reference} on ${formatCalendarDate(refund.refundedOn)}. It goes back to the M-Pesa number or card you paid with; card refunds can take a few working days to appear.`,
    },
    { button: { label: "View your order", href: order.url } },
  ]);
}
