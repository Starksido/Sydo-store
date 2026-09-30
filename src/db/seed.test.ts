// Runs against the test database only (see tests/test-env.ts).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { seedCatalog } from "@/db/seed";

import { resetCatalog } from "../../tests/fixtures";

beforeEach(resetCatalog);

describe("seedCatalog", () => {
  it("adds only what's missing and never overwrites edits", async () => {
    const first = await seedCatalog();
    expect(first.categories).toBeGreaterThan(0);
    expect(first.products).toBeGreaterThan(0);

    const [product] = await db.select().from(products).limit(1);
    await db.update(products).set({ name: "Edited name", price: 100, stock: 1 }).where(eq(products.id, product.id));
    await db.update(categories).set({ name: "Edited category" }).where(eq(categories.id, product.categoryId));
    const [other] = await db.select().from(products).where(eq(products.id, product.id + 1));
    await db.delete(products).where(eq(products.id, other.id));

    expect(await seedCatalog()).toEqual({ categories: 0, products: 1 });

    expect((await db.select().from(products).where(eq(products.id, product.id)))[0]).toMatchObject({
      name: "Edited name",
      price: 100,
      stock: 1,
    });
    expect((await db.select().from(categories).where(eq(categories.id, product.categoryId)))[0].name).toBe(
      "Edited category",
    );
    // The deleted one was added back.
    const [readded] = await db.select().from(products).where(eq(products.slug, other.slug));
    expect(readded).toMatchObject({ name: other.name, categoryId: other.categoryId });
    expect(await db.$count(products)).toBe(first.products);
  });
});
