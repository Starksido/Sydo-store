// Runs against the test database only (see tests/test-env.ts).
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { categories, products, productVariants } from "@/db/schema";
import { seedCatalog } from "@/db/seed";

import { resetCatalog } from "../../tests/fixtures";

beforeEach(resetCatalog);

describe("seedCatalog", () => {
  it("adds products with their sizes and stock", async () => {
    await seedCatalog();

    const jacket = await db.query.products.findFirst({
      where: eq(products.slug, "biker-jacket-black-leather"),
      with: { variants: { columns: { label: true, stock: true }, orderBy: [asc(productVariants.position)] } },
    });
    expect(jacket!.variants).toEqual([
      { label: "46", stock: 2 },
      { label: "48", stock: 2 },
      { label: "50", stock: 1 },
      { label: "52", stock: 0 },
      { label: "54", stock: 1 },
    ]);
    const poncho = await db.query.products.findFirst({
      where: eq(products.slug, "crochet-cotton-poncho"),
      with: { variants: { columns: { label: true, stock: true } } },
    });
    expect(poncho!.variants).toEqual([{ label: null, stock: 0 }]);
    // Every product has at least one variant.
    expect(await db.$count(productVariants)).toBeGreaterThan(await db.$count(products));
  });

  it("adds only what's missing and never overwrites edits", async () => {
    const first = await seedCatalog();
    expect(first.categories).toBeGreaterThan(0);
    expect(first.products).toBeGreaterThan(0);

    const [product] = await db.select().from(products).limit(1);
    await db.update(products).set({ name: "Edited name", price: 100 }).where(eq(products.id, product.id));
    await db.update(productVariants).set({ stock: 1 }).where(eq(productVariants.productId, product.id));
    await db.update(categories).set({ name: "Edited category" }).where(eq(categories.id, product.categoryId));
    const [other] = await db.select().from(products).where(eq(products.id, product.id + 1));
    await db.delete(products).where(eq(products.id, other.id));

    expect(await seedCatalog()).toEqual({ categories: 0, products: 1 });

    expect((await db.select().from(products).where(eq(products.id, product.id)))[0]).toMatchObject({
      name: "Edited name",
      price: 100,
    });
    const edited = await db.select().from(productVariants).where(eq(productVariants.productId, product.id));
    expect(edited.every((variant) => variant.stock === 1)).toBe(true);
    expect((await db.select().from(categories).where(eq(categories.id, product.categoryId)))[0].name).toBe(
      "Edited category",
    );
    // The deleted one was added back.
    const [readded] = await db.select().from(products).where(eq(products.slug, other.slug));
    expect(readded).toMatchObject({ name: other.name, categoryId: other.categoryId });
    expect(await db.$count(productVariants, eq(productVariants.productId, readded.id))).toBeGreaterThan(0);
    expect(await db.$count(products)).toBe(first.products);
  });
});
