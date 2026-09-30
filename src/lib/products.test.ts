// Runs against the test database only (see tests/test-env.ts).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { products } from "@/db/schema";
import { setProductArchived } from "@/lib/admin/products";
import {
  getCategoryProducts,
  getNewArrivals,
  getProductBySlug,
  getProductSlugs,
  getRelatedProducts,
} from "@/lib/products";

import { createProduct, resetCatalog } from "../../tests/fixtures";

beforeEach(resetCatalog);

async function slugAndCategory(id: number) {
  const [row] = await db
    .select({ slug: products.slug, categoryId: products.categoryId })
    .from(products)
    .where(eq(products.id, id));
  return row;
}

describe("archived products", () => {
  it("are left out of every storefront query, and come back when unarchived", async () => {
    const shown = await createProduct(5);
    const archived = await createProduct(5);
    const { slug, categoryId } = await slugAndCategory(archived);
    // Put both in one category, so the archived one would otherwise be related.
    await db.update(products).set({ categoryId }).where(eq(products.id, shown));
    await setProductArchived(archived, true);

    const shownProduct = (await getProductBySlug((await slugAndCategory(shown)).slug))!;
    expect(await getProductBySlug(slug)).toBeUndefined();
    expect(await getProductSlugs()).toEqual([shownProduct.slug]);
    expect((await getNewArrivals()).map((p) => p.id)).toEqual([shown]);
    expect((await getCategoryProducts(categoryId)).map((p) => p.id)).toEqual([shown]);
    expect(await getRelatedProducts(shownProduct)).toEqual([]);

    await setProductArchived(archived, false);
    expect((await getProductBySlug(slug))?.id).toBe(archived);
    expect((await getRelatedProducts(shownProduct)).map((p) => p.id)).toEqual([archived]);
  });
});
