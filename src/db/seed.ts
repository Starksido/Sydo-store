// Loads the sample catalog into the database. Safe to re-run: it only adds categories and products
// whose slug is missing, and never changes existing ones (admins may have edited them).
// Run with: npm run db:seed
import { inArray, sql } from "drizzle-orm";

import { unsplash } from "../lib/catalog";
import { db } from "./index";
import { categories, products } from "./schema";

type SeedCategory = typeof categories.$inferInsert;
type SeedProduct = Omit<typeof products.$inferInsert, "categoryId" | "createdAt"> & {
  category: string;
} & (
    | { /** One-size item. */ stock: number; sizes?: never }
    | { /** Label and stock of each size, in display order. */ sizes: [label: string, stock: number][]; stock?: never }
  );

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

// Newest first: this order becomes the New Arrivals order.
const seedProducts: SeedProduct[] = [
  {
    slug: "biker-jacket-black-leather",
    sku: "SY-M-24018",
    name: "Biker jacket in black leather",
    category: "men",
    price: 37_570_000,
    sizes: [
      ["46", 2],
      ["48", 2],
      ["50", 1],
      ["52", 0],
      ["54", 1],
    ],
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
    sizes: [
      ["XS", 0],
      ["S", 1],
      ["M", 1],
      ["L", 0],
      ["XL", 0],
    ],
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
    sizes: [
      ["XS", 2],
      ["S", 3],
      ["M", 3],
      ["L", 2],
      ["XL", 2],
    ],
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
    sizes: [
      ["36", 0],
      ["37", 1],
      ["38", 2],
      ["39", 1],
      ["40", 1],
    ],
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
    sizes: [
      ["40", 1],
      ["41", 2],
      ["42", 2],
      ["43", 2],
      ["44", 1],
      ["45", 1],
    ],
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

/**
 * Adds the missing sample categories, and the missing products with their sizes (variants). Returns
 * how many categories and products it added.
 */
export async function seedCatalog() {
  const addedCategories = await db
    .insert(categories)
    .values(seedCategories)
    .onConflictDoNothing({ target: categories.slug })
    .returning({ id: categories.id });
  const categoryRows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(inArray(categories.slug, seedCategories.map((category) => category.slug)));
  const categoryIds = new Map(categoryRows.map((row) => [row.slug, row.id]));

  // One hour apart, newest first, for a stable New Arrivals order.
  const newest = Date.UTC(2026, 8, 1);
  const productRows: (typeof products.$inferInsert)[] = [];
  const variantRows: { slug: string; label: string | null; stock: number; position: number }[] = [];
  for (const [index, { category, stock, sizes, ...product }] of seedProducts.entries()) {
    const categoryId = categoryIds.get(category);
    if (!categoryId) throw new Error(`Unknown category "${category}" for ${product.slug}`);
    productRows.push({ ...product, categoryId, createdAt: new Date(newest - index * 60 * 60 * 1000) });
    if (sizes) {
      for (const [position, [label, sizeStock]] of sizes.entries()) {
        variantRows.push({ slug: product.slug, label, stock: sizeStock, position });
      }
    } else {
      variantRows.push({ slug: product.slug, label: null, stock, position: 0 });
    }
  }
  // One statement, so a product is never added without its sizes.
  const { rows: addedProducts } = await db.execute<{ id: number }>(sql`
    with added as (
      ${db
        .insert(products)
        .values(productRows)
        .onConflictDoNothing({ target: products.slug })
        .returning({ id: products.id, slug: products.slug })
        .getSQL()}
    ),
    variants as (
      insert into product_variants (product_id, label, stock, position)
      select a.id, v.label, v.stock, v.position
      from added a
      join jsonb_to_recordset(${JSON.stringify(variantRows)}::jsonb) as v(slug text, label text, stock int, position int)
        on v.slug = a.slug
      returning id
    )
    select id from added
  `);

  return { categories: addedCategories.length, products: addedProducts.length };
}

// Runs only as a script (`npm run db:seed`), not when a test imports `seedCatalog`.
if (process.argv[1]?.replaceAll("\\", "/").endsWith("src/db/seed.ts")) {
  seedCatalog()
    .then((added) => console.log(`Added ${added.categories} categories and ${added.products} products.`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
