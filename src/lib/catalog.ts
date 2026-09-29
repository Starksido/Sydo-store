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
