// Loads the sample catalog into the database. Safe to re-run: rows are upserted by slug.
// Run with: npm run db:seed
import { unsplash } from "../lib/catalog";
import { db } from "./index";
import { categories, products, type ProductSize } from "./schema";

type SeedCategory = typeof categories.$inferInsert;
type SeedProduct = Omit<typeof products.$inferInsert, "categoryId" | "createdAt"> & {
  category: string;
};

const seedCategories: SeedCategory[] = [
  { slug: "women", name: "Women", position: 0, image: unsplash("1595777457583-95e059d581b8", 900) },
  { slug: "men", name: "Men", position: 1, image: unsplash("1617137968427-85924c800a22", 900) },
  { slug: "bags", name: "Bags", position: 2, image: unsplash("1553062407-98eeb64c6a62", 900) },
  {
    slug: "accessories",
    name: "Accessories",
    position: 3,
    image: unsplash("1511499767150-a48a237f0083", 900),
  },
  // No tile image yet, so it stays out of the home category grid.
  { slug: "shoes", name: "Shoes", position: 4, image: null },
];

const apparelSizes = (unavailable: string[] = []): ProductSize[] =>
  ["XS", "S", "M", "L", "XL"].map((label) => ({ label, available: !unavailable.includes(label) }));

// Newest first: this order becomes the New Arrivals order.
const seedProducts: SeedProduct[] = [
  {
    slug: "biker-jacket-black-leather",
    sku: "SY-M-24018",
    name: "Biker jacket in black leather",
    category: "men",
    price: 37_570_000,
    stock: 6,
    sizes: ["46", "48", "50", "52", "54"].map((label) => ({ label, available: label !== "52" })),
    image: unsplash("1520975954732-35dd22299614", 1200),
    altImage: unsplash("1551028719-00167b16eac5", 1200, { x: 0.45, y: 0.75, zoom: 1.5 }),
    gallery: [
      unsplash("1520975954732-35dd22299614", 1200, { x: 0.45, y: 0.4, zoom: 2.2 }),
      unsplash("1551028719-00167b16eac5", 1200, { x: 0.3, y: 0.8, zoom: 2.4 }),
    ],
    description:
      "A classic biker silhouette cut from supple lambskin leather, with an asymmetric zip front, notched lapels and a belted hem. Broken in from the first wear.",
    details: [
      "100% lambskin leather",
      "Lining: 100% cupro",
      "Asymmetric zip closure",
      "Three zip pockets",
      "Made in Italy",
    ],
    badge: "New",
  },
  {
    slug: "floral-silk-wrap-dress",
    sku: "SY-W-24102",
    name: "Floral silk wrap dress",
    category: "women",
    price: 31_850_000,
    stock: 2,
    sizes: apparelSizes(["XS", "XL"]),
    image: unsplash("1496747611176-843222e1e57c", 1200),
    gallery: [
      unsplash("1496747611176-843222e1e57c", 1200, { x: 0.35, y: 0.3, zoom: 2 }),
      unsplash("1496747611176-843222e1e57c", 1200, { x: 0.55, y: 0.75, zoom: 2.2 }),
    ],
    description:
      "A fluid midi wrap dress in printed silk crêpe de chine. The rose print is placed by hand so no two dresses are exactly alike.",
    details: [
      "100% silk",
      "Wrap front with self-tie waist",
      "Short flutter sleeves",
      "Midi length",
      "Dry clean only",
    ],
  },
  {
    slug: "crochet-cotton-poncho",
    sku: "SY-W-24117",
    name: "Crochet cotton poncho",
    category: "women",
    price: 15_340_000,
    stock: 0,
    image: unsplash("1434389677669-e08b4cac3105", 1200),
    gallery: [unsplash("1434389677669-e08b4cac3105", 1200, { x: 0.5, y: 0.7, zoom: 2.2 })],
    description:
      "An open-work poncho hand-crocheted in organic cotton, finished with a knotted fringe hem. Light enough to layer over summer tailoring.",
    details: ["100% organic cotton", "Hand-crocheted", "Fringed hem", "Hand wash cold"],
  },
  {
    slug: "satin-jogger-trousers",
    sku: "SY-W-24133",
    name: "Satin jogger trousers",
    category: "women",
    price: 12_740_000,
    stock: 12,
    sizes: apparelSizes(),
    image: unsplash("1594633312681-425c7b97ccd1", 1200),
    gallery: [
      unsplash("1594633312681-425c7b97ccd1", 1200, { x: 0.4, y: 0.22, zoom: 2.2 }),
      unsplash("1594633312681-425c7b97ccd1", 1200, { x: 0.5, y: 0.82, zoom: 2 }),
    ],
    description:
      "Relaxed jogger trousers in fluid duchess satin, with an elasticated waist, patch pockets and gathered cuffs. Dress them up or down.",
    details: [
      "70% acetate, 30% viscose",
      "Elasticated waistband",
      "Front patch pockets",
      "Elasticated cuffs",
      "Dry clean only",
    ],
    badge: "New",
  },
  {
    slug: "floral-satin-pump",
    sku: "SY-S-24205",
    name: "Floral satin pump",
    category: "shoes",
    price: 11_640_000,
    stock: 5,
    sizes: ["36", "37", "38", "39", "40"].map((label) => ({ label, available: label !== "36" })),
    image: unsplash("1543163521-1bf539c55dd2", 1200),
    gallery: [unsplash("1543163521-1bf539c55dd2", 1200, { x: 0.45, y: 0.7, zoom: 2 })],
    description:
      "A pointed-toe pump in printed satin on a slim 100mm heel. The botanical print wraps from the vamp to the heel counter.",
    details: [
      "Upper: 100% silk satin",
      "Leather lining and sole",
      "Heel height: 100mm",
      "Made in Italy",
    ],
  },
  {
    slug: "colour-block-trainer",
    sku: "SY-S-24219",
    name: "Colour-block trainer",
    category: "shoes",
    price: 10_270_000,
    stock: 9,
    sizes: ["40", "41", "42", "43", "44", "45"].map((label) => ({ label, available: true })),
    image: unsplash("1560769629-975ec94e6a86", 1200),
    gallery: [unsplash("1560769629-975ec94e6a86", 1200, { x: 0.65, y: 0.6, zoom: 2 })],
    description:
      "A chunky runner-inspired trainer in panelled suede, mesh and leather, set on a sculpted rubber sole.",
    details: [
      "Suede, mesh and calfskin upper",
      "Rubber sole",
      "Contrast laces",
      "Removable leather insole",
    ],
  },
  {
    slug: "round-metal-sunglasses",
    sku: "SY-A-24307",
    name: "Round metal sunglasses",
    category: "accessories",
    price: 5_980_000,
    stock: 15,
    image: unsplash("1511499767150-a48a237f0083", 1200),
    gallery: [unsplash("1511499767150-a48a237f0083", 1200, { x: 0.35, y: 0.45, zoom: 2 })],
    description:
      "Lightweight round sunglasses with a fine gold-tone metal frame and bottle-green lenses.",
    details: [
      "Gold-tone metal frame",
      "Green mineral glass lenses",
      "100% UV protection",
      "Includes leather case",
    ],
  },
  {
    slug: "minimal-leather-strap-watch",
    sku: "SY-A-24311",
    name: "Minimal leather-strap watch",
    category: "accessories",
    price: 17_160_000,
    stock: 2,
    image: unsplash("1524592094714-0f0654e20314", 1200),
    gallery: [unsplash("1524592094714-0f0654e20314", 1200, { x: 0.5, y: 0.5, zoom: 2 })],
    description:
      "A pared-back dress watch with a rose-gold-tone case, a clean white dial and a soft taupe leather strap. Produced in a limited run.",
    details: [
      "36mm stainless steel case",
      "Swiss quartz movement",
      "Sapphire crystal",
      "Calfskin leather strap",
      "Water resistant to 30m",
    ],
    badge: "Limited",
  },
];

async function seed() {
  const categoryIds = new Map<string, number>();
  for (const category of seedCategories) {
    const { slug, ...rest } = category;
    const [row] = await db
      .insert(categories)
      .values(category)
      .onConflictDoUpdate({ target: categories.slug, set: rest })
      .returning({ id: categories.id });
    categoryIds.set(slug, row.id);
  }

  // One hour apart, newest first, so re-seeding keeps a stable New Arrivals order.
  const newest = Date.UTC(2026, 8, 1);
  for (const [index, product] of seedProducts.entries()) {
    const { category, slug, ...rest } = product;
    const categoryId = categoryIds.get(category);
    if (!categoryId) throw new Error(`Unknown category "${category}" for ${slug}`);
    const values = {
      ...rest,
      sizes: rest.sizes ?? null,
      altImage: rest.altImage ?? null,
      badge: rest.badge ?? null,
      categoryId,
      createdAt: new Date(newest - index * 60 * 60 * 1000),
    };
    await db
      .insert(products)
      .values({ slug, ...values })
      .onConflictDoUpdate({ target: products.slug, set: values });
  }

  console.log(`Seeded ${categoryIds.size} categories and ${seedProducts.length} products.`);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
