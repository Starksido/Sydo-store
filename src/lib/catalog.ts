// Static storefront content and display helpers. Products and categories live in the database (see @/lib/products).

export type Collection = {
  slug: string;
  eyebrow: string;
  title: string;
  href: string;
  image: string;
};

type Focus = { x: number; y: number; zoom: number };

/** Unsplash image URL. Pass `focus` for a 3:4 close-up crop around a point (0–1). */
export function unsplash(id: string, width = 1600, focus?: Focus) {
  const url = `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=80`;
  if (!focus) return url;
  const height = Math.round((width * 4) / 3);
  return `${url}&h=${height}&crop=focalpoint&fp-x=${focus.x}&fp-y=${focus.y}&fp-z=${focus.zoom}`;
}

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  currencyDisplay: "code",
  maximumFractionDigits: 0,
});

/** KES cents as e.g. "KES 375,700". */
export function formatPrice(cents: number) {
  return currency.format(cents / 100);
}

const ORDER_STATUS_LABELS = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  expired: "Expired",
} as const;

const PAYMENT_CHANNEL_LABELS: Record<string, string> = { mobile_money: "M-Pesa", card: "Card" };

/** Paystack channel as shown to customers, e.g. "M-Pesa". */
export function paymentChannelLabel(channel: string | null) {
  return channel ? (PAYMENT_CHANNEL_LABELS[channel] ?? channel.replaceAll("_", " ")) : null;
}

const paymentTime = new Intl.DateTimeFormat("en-KE", { timeStyle: "short", timeZone: "Africa/Nairobi" });

/** Time of day in Nairobi, e.g. "2:30 pm". */
export function formatPaymentTime(date: Date) {
  return paymentTime.format(date);
}

export function orderStatusLabel(status: keyof typeof ORDER_STATUS_LABELS) {
  return ORDER_STATUS_LABELS[status];
}

const orderDate = new Intl.DateTimeFormat("en-KE", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Nairobi" });

export function formatOrderDate(date: Date) {
  return orderDate.format(date);
}

/** Why an order was cancelled: the admin's choice, and the sentence the customer reads. */
export const CANCEL_REASONS = {
  out_of_stock: { label: "Out of stock", customer: "An item in your order is out of stock." },
  payment_issue: { label: "Payment issue", customer: "There was a problem with the payment." },
  customer_request: { label: "Customer's request", customer: "Cancelled at your request." },
  other: { label: "Other", customer: "Please contact Client Services if you have any questions." },
} as const;

export type CancelReason = keyof typeof CANCEL_REASONS;

const calendarDate = new Intl.DateTimeFormat("en-KE", { dateStyle: "long", timeZone: "UTC" });

/** A date without a time, stored as "2026-10-02", e.g. "2 October 2026". */
export function formatCalendarDate(date: string) {
  return calendarDate.format(new Date(`${date}T00:00:00Z`));
}

/** A refund as customers read it: "Refund pending" or "Refunded on 2 October 2026". */
export function refundText(refund: { status: "due" | "refunded"; refundedOn: string | null }) {
  return refund.status === "refunded" && refund.refundedOn
    ? `Refunded on ${formatCalendarDate(refund.refundedOn)}`
    : "Refund pending";
}

export const LOW_STOCK_THRESHOLD = 3;

export type StockState = "in-stock" | "low-stock" | "sold-out";

export function stockState(stock: number): StockState {
  if (stock <= 0) return "sold-out";
  if (stock <= LOW_STOCK_THRESHOLD) return "low-stock";
  return "in-stock";
}

export function stockLabel(stock: number) {
  const state = stockState(stock);
  if (state === "sold-out") return "Sold out";
  if (state === "low-stock") return `Only ${stock} left`;
  return "In stock";
}

export function categoryHref(slug: string) {
  return `/collections/${slug}`;
}

export const hero = {
  eyebrow: "Autumn–Winter 2026",
  title: "The Quiet Season",
  body: "Soft tailoring, sculpted outerwear and pieces made to be worn for years.",
  image: unsplash("1539109136881-3be0616acf4b", 2400),
  imageAlt: "Woman in a pale blue wool coat standing in a city square",
  primary: { label: "Shop women", href: "/collections/women" },
  secondary: { label: "Shop men", href: "/collections/men" },
};

export const featuredCollections: Collection[] = [
  {
    slug: "evening",
    eyebrow: "Women",
    title: "Evening Edit",
    href: "/collections/evening",
    image: unsplash("1566174053879-31528523f8ae"),
  },
  {
    slug: "outerwear",
    eyebrow: "Men",
    title: "Leather & Outerwear",
    href: "/collections/outerwear",
    image: unsplash("1487222477894-8943e31ef7b2"),
  },
];

export const campaign = {
  eyebrow: "The Campaign",
  title: "Made for the Night",
  body: "Hand-embellished sequins, pleated chiffon and a deep garnet palette. The new evening collection is available now in stores and online.",
  cta: { label: "Discover the collection", href: "/collections/evening" },
  image: unsplash("1550614000-4895a10e1bfd", 1800),
  imageAlt: "Two women in garnet sequinned dresses outdoors",
};

export const services = [
  {
    title: "Complimentary Shipping",
    body: "Free standard delivery on every order.",
  },
  {
    title: "Easy Returns",
    body: "Return or exchange within 30 days.",
  },
  {
    title: "Gift Wrapping",
    body: "Every order arrives in signature packaging.",
  },
  {
    title: "Client Services",
    body: "Our advisors are available seven days a week.",
  },
];

export const primaryNav = [
  { label: "New In", href: "/collections/new-in" },
  { label: "Women", href: "/collections/women" },
  { label: "Men", href: "/collections/men" },
  { label: "Bags", href: "/collections/bags" },
  { label: "Shoes", href: "/collections/shoes" },
  { label: "Accessories", href: "/collections/accessories" },
];
