// Runs against the test database only (see tests/test-env.ts).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { products } from "@/db/schema";
import { createCategory, getAdminCategory, listAdminCategories, updateCategory } from "@/lib/admin/categories";
import type { ProductInput } from "@/lib/admin/product-input";
import {
  countAdminProducts,
  createProduct,
  escapeLike,
  getAdminProduct,
  listAdminProducts,
  setProductArchived,
  updateProduct,
} from "@/lib/admin/products";

import { createCategory as createCategoryFixture, getStock, resetCatalog, setStock } from "../../../tests/fixtures";

const IMAGE = "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=1200";

beforeEach(resetCatalog);

function input(categoryId: number, overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: "Floral silk wrap dress",
    slug: "floral-silk-wrap-dress",
    sku: "SY-W-24102",
    categoryId,
    description: "A fluid midi wrap dress.",
    price: 31_850_000,
    sizes: [{ label: "S", available: true }],
    image: IMAGE,
    altImage: null,
    gallery: [],
    details: ["100% silk"],
    badge: null,
    ...overrides,
  };
}

async function created(result: Awaited<ReturnType<typeof createProduct>>) {
  if (!result.ok) throw new Error(`createProduct: ${JSON.stringify(result.errors)}`);
  return result.id;
}

describe("createProduct / updateProduct", () => {
  it("creates a product with no stock, on sale", async () => {
    const categoryId = await createCategoryFixture();
    const id = await created(await createProduct(input(categoryId)));

    expect(await getAdminProduct(id)).toMatchObject({
      ...input(categoryId),
      stock: 0,
      archivedAt: null,
      category: { name: expect.any(String) },
    });
  });

  it("updates every field but stock", async () => {
    const [a, b] = [await createCategoryFixture(), await createCategoryFixture()];
    const id = await created(await createProduct(input(a)));
    await setStock(id, 7);

    const changes = input(b, {
      name: "Renamed",
      slug: "renamed",
      sku: "SY-NEW-1",
      price: 100,
      sizes: null,
      altImage: IMAGE,
      gallery: [IMAGE],
      details: [],
      badge: "Sale",
    });
    expect(await updateProduct(id, changes)).toEqual({ ok: true, id });
    expect(await getAdminProduct(id)).toMatchObject({ ...changes, stock: 7 });
    expect(await getStock(id)).toBe(7);
  });

  it("reports a missing product", async () => {
    expect(await updateProduct(999_999, input(await createCategoryFixture()))).toBeUndefined();
  });

  it("turns a duplicate slug or SKU, or a missing category, into an error on that field", async () => {
    const categoryId = await createCategoryFixture();
    const first = await created(await createProduct(input(categoryId)));
    const second = await created(await createProduct(input(categoryId, { slug: "other", sku: "SY-OTHER" })));

    expect(await createProduct(input(categoryId, { sku: "SY-UNIQUE" }))).toEqual({
      ok: false,
      errors: { slug: "Another product already uses this slug." },
    });
    expect(await createProduct(input(categoryId, { slug: "unique" }))).toEqual({
      ok: false,
      errors: { sku: "Another product already uses this SKU." },
    });
    expect(await updateProduct(second, input(categoryId, { sku: "SY-OTHER" }))).toEqual({
      ok: false,
      errors: { slug: "Another product already uses this slug." },
    });
    expect(await createProduct(input(999_999, { slug: "x", sku: "X" }))).toEqual({
      ok: false,
      errors: { categoryId: "That category no longer exists. Choose another." },
    });
    // A product can keep its own slug and SKU.
    expect(await updateProduct(first, input(categoryId, { name: "Same keys" }))).toEqual({ ok: true, id: first });
  });
});

describe("setProductArchived", () => {
  it("archives and unarchives, keeping the first archive time", async () => {
    const id = await created(await createProduct(input(await createCategoryFixture())));

    expect(await setProductArchived(id, true)).toBe(true);
    const { archivedAt } = (await getAdminProduct(id))!;
    expect(archivedAt).toBeInstanceOf(Date);
    await setProductArchived(id, true);
    expect((await getAdminProduct(id))!.archivedAt).toEqual(archivedAt);

    expect(await setProductArchived(id, false)).toBe(true);
    expect((await getAdminProduct(id))!.archivedAt).toBeNull();
    expect(await setProductArchived(999_999, true)).toBe(false);
  });
});

describe("listAdminProducts", () => {
  async function catalog() {
    const [dresses, bags] = [await createCategoryFixture("Dresses"), await createCategoryFixture("Bags")];
    const dress = await created(await createProduct(input(dresses)));
    const bag = await created(await createProduct(input(bags, { name: "Leather tote", slug: "tote", sku: "SY-B-100" })));
    const old = await created(
      await createProduct(input(bags, { name: "100% wool scarf", slug: "scarf", sku: "SY_A_1" })),
    );
    await setProductArchived(old, true);
    // Oldest first: created_at orders the list.
    for (const [index, id] of [old, bag, dress].entries()) {
      await db.update(products).set({ createdAt: new Date(Date.UTC(2026, 0, index + 1)) }).where(eq(products.id, id));
    }
    return { dresses, bags, dress, bag, old };
  }

  const ids = (result: Awaited<ReturnType<typeof listAdminProducts>>) => result.products.map((p) => p.id);

  it("lists products on sale, newest first, by default", async () => {
    const { dress, bag } = await catalog();
    const result = await listAdminProducts();
    expect(ids(result)).toEqual([dress, bag]);
    expect(result.products[0]).toMatchObject({ category: { name: "Dresses" }, stock: 0, archivedAt: null });
  });

  it("filters by status, category and name or SKU", async () => {
    const { bags, dress, bag, old } = await catalog();
    expect(ids(await listAdminProducts({ status: "archived" }))).toEqual([old]);
    expect(ids(await listAdminProducts({ status: "all" }))).toEqual([dress, bag, old]);
    expect(ids(await listAdminProducts({ status: "all", categoryId: bags }))).toEqual([bag, old]);
    expect(ids(await listAdminProducts({ q: "TOTE" }))).toEqual([bag]);
    expect(ids(await listAdminProducts({ q: "sy-w-24" }))).toEqual([dress]);
  });

  it("matches % and _ literally", async () => {
    const { old } = await catalog();
    expect(ids(await listAdminProducts({ status: "all", q: "100%" }))).toEqual([old]);
    expect(ids(await listAdminProducts({ status: "all", q: "_A_" }))).toEqual([old]);
    expect(ids(await listAdminProducts({ status: "all", q: "%" }))).toEqual([old]);
    expect(escapeLike("a\\b%c_")).toBe("a\\\\b\\%c\\_");
  });

  it("pages", async () => {
    const { dress, bag, old } = await catalog();
    expect(await listAdminProducts({ status: "all", pageSize: 2 })).toMatchObject({ hasMore: true });
    expect(ids(await listAdminProducts({ status: "all", pageSize: 2 }))).toEqual([dress, bag]);
    const last = await listAdminProducts({ status: "all", pageSize: 2, page: 2 });
    expect([ids(last), last.hasMore]).toEqual([[old], false]);
  });

  it("counts products on sale and archived", async () => {
    await catalog();
    expect(await countAdminProducts()).toEqual({ active: 2, archived: 1 });
  });
});

describe("categories", () => {
  const category = { name: "Evening", slug: "evening", image: IMAGE, position: 5 };

  it("creates, updates and lists them with product counts", async () => {
    const result = await createCategory(category);
    if (!result.ok) throw new Error("createCategory failed");
    const id = result.id;
    await created(await createProduct(input(id)));
    await setProductArchived(await created(await createProduct(input(id, { slug: "second", sku: "SY-2" }))), true);

    expect(await updateCategory(id, { ...category, name: "Evening wear", image: null })).toEqual({ ok: true, id });
    expect(await getAdminCategory(id)).toMatchObject({ name: "Evening wear", image: null, position: 5 });
    expect(await listAdminCategories()).toEqual([
      expect.objectContaining({ id, name: "Evening wear", activeProducts: 1, archivedProducts: 1 }),
    ]);
  });

  it("refuses a duplicate slug, and reports a missing category", async () => {
    await createCategory(category);
    const other = await createCategory({ ...category, slug: "other" });
    if (!other.ok) throw new Error("createCategory failed");

    const taken = { ok: false, errors: { slug: "Another category already uses this slug." } };
    expect(await createCategory(category)).toEqual(taken);
    expect(await updateCategory(other.id, category)).toEqual(taken);
    expect(await updateCategory(999_999, category)).toBeUndefined();
  });

  it("lists categories without products, in position order", async () => {
    await createCategory({ ...category, slug: "later", position: 9 });
    await createCategory({ ...category, slug: "first", position: 1 });
    expect((await listAdminCategories()).map((c) => [c.slug, c.activeProducts, c.archivedProducts])).toEqual([
      ["first", 0, 0],
      ["later", 0, 0],
    ]);
  });
});
