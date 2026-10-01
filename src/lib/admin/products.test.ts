// Runs against the test database only (see tests/test-env.ts).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { cartItems, products, productVariants, stockAdjustments } from "@/db/schema";
import {
  createCategory,
  deleteCategory,
  getAdminCategory,
  listAdminCategories,
  updateCategory,
} from "@/lib/admin/categories";
import type { ProductInput } from "@/lib/admin/product-input";
import {
  countAdminProducts,
  countLowStockVariants,
  createProduct,
  deleteProduct,
  escapeLike,
  getAdminProduct,
  isProductOrdered,
  listAdminProducts,
  listLowStockVariants,
  setProductArchived,
  updateProduct,
} from "@/lib/admin/products";

import { linkedCategorySlugs } from "@/lib/catalog";
import { adjustStock } from "@/lib/stock";

import {
  createCartLine,
  createCategory as createCategoryFixture,
  createProduct as createProductFixture,
  createUser,
  getStock,
  getVariantId,
  getVariantStock,
  resetCatalog,
  setStock,
} from "../../../tests/fixtures";
import { createOrder } from "../../../tests/orders";

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
    sizes: [{ id: null, label: "S" }],
    image: IMAGE,
    altImage: null,
    gallery: [],
    details: ["100% silk"],
    badge: null,
    ...overrides,
  };
}

/** A size row for a new size. */
function newSize(label: string) {
  return { id: null, label };
}

async function created(result: Awaited<ReturnType<typeof createProduct>>) {
  if (!result.ok) throw new Error(`createProduct: ${JSON.stringify(result.errors)}`);
  return result.id;
}

describe("createProduct / updateProduct", () => {
  it("creates a product and its sizes with no stock, on sale", async () => {
    const categoryId = await createCategoryFixture();
    const { sizes, ...fields } = input(categoryId, { sizes: [newSize("S"), newSize("M")] });
    const id = await created(await createProduct({ ...fields, sizes }));

    expect(await getAdminProduct(id)).toMatchObject({
      ...fields,
      variants: [
        { label: "S", stock: 0 },
        { label: "M", stock: 0 },
      ],
      stock: 0,
      archivedAt: null,
      category: { name: expect.any(String) },
    });
  });

  it("creates a one-size product as one variant with a null label", async () => {
    const id = await created(await createProduct(input(await createCategoryFixture(), { sizes: [] })));
    expect((await getAdminProduct(id))!.variants).toEqual([{ id: expect.any(Number), label: null, stock: 0 }]);
  });

  it("updates every field but stock", async () => {
    const [a, b] = [await createCategoryFixture(), await createCategoryFixture()];
    const id = await created(await createProduct(input(a, { sizes: [] })));
    await setStock(id, 7);

    const { sizes, ...changes } = input(b, {
      sizes: [],
      name: "Renamed",
      slug: "renamed",
      sku: "SY-NEW-1",
      price: 100,
      altImage: IMAGE,
      gallery: [IMAGE],
      details: [],
      badge: "Sale",
    });
    expect(await updateProduct(id, { ...changes, sizes })).toEqual({ ok: true, id });
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

describe("updateProduct sizes", () => {
  /** A product with sizes S (stock 0) and M (stock 3). */
  async function sized() {
    const categoryId = await createCategoryFixture();
    const id = await created(await createProduct(input(categoryId, { sizes: [newSize("S"), newSize("M")] })));
    const [S, M] = [await getVariantId(id, "S"), await getVariantId(id, "M")];
    await setStock(id, 3, "M");
    return { categoryId, id, S, M };
  }

  const variantsOf = async (id: number) => (await getAdminProduct(id))!.variants;

  it("renames, reorders and adds sizes, and removes those with no stock", async () => {
    const { categoryId, id, M } = await sized();

    const result = await updateProduct(id, input(categoryId, { sizes: [newSize("XS"), { id: M, label: "Medium" }] }));

    expect(result).toEqual({ ok: true, id });
    expect(await variantsOf(id)).toEqual([
      { id: expect.any(Number), label: "XS", stock: 0 },
      { id: M, label: "Medium", stock: 3 },
    ]);
  });

  it("refuses, saving nothing, to remove a size that has stock", async () => {
    const { categoryId, id, S, M } = await sized();

    expect(await updateProduct(id, input(categoryId, { name: "Renamed", sizes: [{ id: S, label: "S" }] }))).toEqual({
      ok: false,
      errors: { sizes: "Set the stock of M (3) to 0 before removing it." },
    });
    expect((await getAdminProduct(id))!.name).toBe("Floral silk wrap dress");
    expect((await variantsOf(id)).map((variant) => variant.id)).toEqual([S, M]);
  });

  it("keeps the size (and its stock) when a removed size is added back under the same name", async () => {
    const { categoryId, id, S, M } = await sized();

    expect(await updateProduct(id, input(categoryId, { sizes: [{ id: S, label: "S" }, newSize("m")] }))).toEqual({
      ok: true,
      id,
    });
    expect(await variantsOf(id)).toEqual([
      { id: S, label: "S", stock: 0 },
      { id: M, label: "m", stock: 3 },
    ]);
  });

  it("switches between one size and sizes only when the stock being dropped is 0", async () => {
    const categoryId = await createCategoryFixture();
    const id = await created(await createProduct(input(categoryId, { sizes: [] })));
    await setStock(id, 2);

    expect(await updateProduct(id, input(categoryId))).toEqual({
      ok: false,
      errors: { sizes: "It has 2 in stock as a one-size item. Set its stock to 0 before adding sizes." },
    });

    await setStock(id, 0);
    expect(await updateProduct(id, input(categoryId))).toEqual({ ok: true, id });
    expect(await variantsOf(id)).toMatchObject([{ label: "S", stock: 0 }]);

    expect(await updateProduct(id, input(categoryId, { sizes: [] }))).toEqual({ ok: true, id });
    expect(await variantsOf(id)).toMatchObject([{ label: null, stock: 0 }]);
  });

  it("turns sizes that clash within one save into an error on sizes", async () => {
    const { categoryId, id, S, M } = await sized();

    expect(
      await updateProduct(id, input(categoryId, { sizes: [{ id: S, label: "M" }, { id: M, label: "S" }] })),
    ).toEqual({
      ok: false,
      errors: {
        sizes: "These size changes clash with each other (e.g. two sizes swapping names). Save them in two steps.",
      },
    });
    expect(await variantsOf(id)).toMatchObject([
      { id: S, label: "S" },
      { id: M, label: "M" },
    ]);
  });

  it("treats the id of another product's size as a new size", async () => {
    const { categoryId, id, S, M } = await sized();
    const other = await getVariantId(await createProductFixture(4));

    const sizes = [
      { id: S, label: "S" },
      { id: M, label: "M" },
      { id: other, label: "L" },
    ];
    expect(await updateProduct(id, input(categoryId, { sizes }))).toEqual({ ok: true, id });
    expect(await variantsOf(id)).toMatchObject([{ id: S }, { id: M }, { label: "L", stock: 0 }]);
    expect(await getVariantStock(other)).toBe(4);
  });

  it("shows bag lines of a removed size as no longer available", async () => {
    const { categoryId, id, S, M } = await sized();
    const lineId = await createCartLine(await createUser(), id, 1, "S");

    expect(await updateProduct(id, input(categoryId, { sizes: [{ id: M, label: "M" }] }))).toEqual({ ok: true, id });
    expect(await db.select().from(productVariants).where(eq(productVariants.id, S))).toEqual([]);
    expect(await db.select().from(cartItems).where(eq(cartItems.id, lineId))).toEqual([
      expect.objectContaining({ productId: id, variantId: null, size: "S" }),
    ]);
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

describe("deleteProduct", () => {
  it("deletes an archived product that was never ordered, with its stock history, keeping bag lines", async () => {
    const [adminId, customerId] = [await createUser(), await createUser()];
    const id = await createProductFixture(5);
    const variantId = await getVariantId(id);
    await adjustStock({ productId: id, variantId, delta: 2, userId: adminId, reason: "received", note: null });
    const lineId = await createCartLine(customerId, id, 1);

    expect(await deleteProduct(id)).toEqual({ ok: false, reason: "not-archived" });
    expect(await getAdminProduct(id)).toBeDefined();

    await setProductArchived(id, true);
    expect(await isProductOrdered(id)).toBe(false);
    expect(await deleteProduct(id)).toEqual({ ok: true });

    expect(await getAdminProduct(id)).toBeUndefined();
    expect(await db.select().from(stockAdjustments)).toEqual([]);
    expect(await db.select().from(cartItems).where(eq(cartItems.id, lineId))).toEqual([
      expect.objectContaining({ productId: null, variantId: null, productName: "Saved name", quantity: 1 }),
    ]);
    expect(await deleteProduct(id)).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses a product that was ordered, even when archived, and keeps its history", async () => {
    const [adminId, customerId] = [await createUser(), await createUser()];
    const id = await createProductFixture(5);
    const variantId = await getVariantId(id);
    await adjustStock({ productId: id, variantId, delta: 1, userId: adminId, reason: "correction", note: null });
    await createOrder(customerId, [[id, 1]]);
    await setProductArchived(id, true);

    expect(await isProductOrdered(id)).toBe(true);
    expect(await deleteProduct(id)).toEqual({ ok: false, reason: "ordered" });
    expect(await getAdminProduct(id)).toBeDefined();
    expect(await db.select().from(stockAdjustments)).toHaveLength(1);
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

  it("deletes a category only once no product is in it, on sale or archived", async () => {
    // "evening" is linked from the home page, so not that one.
    const result = await createCategory({ ...category, slug: "cruise" });
    if (!result.ok) throw new Error("createCategory failed");
    const productId = await created(await createProduct(input(result.id)));
    await setProductArchived(productId, true);

    expect(await deleteCategory(result.id)).toEqual({ ok: false, reason: "in-use" });
    expect(await getAdminCategory(result.id)).toBeDefined();

    await db.delete(products).where(eq(products.id, productId));
    expect(await deleteCategory(result.id)).toEqual({ ok: true });
    expect(await getAdminCategory(result.id)).toBeUndefined();
    expect(await deleteCategory(result.id)).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses to delete a category the store links to", async () => {
    const [slug] = linkedCategorySlugs();
    const result = await createCategory({ ...category, slug });
    if (!result.ok) throw new Error("createCategory failed");

    expect(await deleteCategory(result.id)).toEqual({ ok: false, reason: "linked" });
    expect(await getAdminCategory(result.id)).toBeDefined();
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

describe("low stock", () => {
  it("lists sizes on sale at or below the threshold, lowest first, and counts them", async () => {
    const categoryId = await createCategoryFixture();
    const make = async (slug: string, stock: number) => {
      const id = await created(await createProduct(input(categoryId, { name: slug, slug, sku: slug.toUpperCase() })));
      await setStock(id, stock, "S");
      return id;
    };
    const two = await make("two", 2);
    const out = await make("out", 0);
    const three = await make("three", 3);
    await make("plenty", 4);
    const archived = await make("archived", 0);
    await setProductArchived(archived, true);
    const mixed = await created(
      await createProduct(
        input(categoryId, { name: "mixed", slug: "mixed", sku: "MIXED", sizes: [newSize("S"), newSize("M")] }),
      ),
    );
    await setStock(mixed, 5, "S");
    await setStock(mixed, 1, "M");
    const oneSize = await createProductFixture(1);
    // Named to sort right after "mixed", which has the same stock.
    await db.update(products).set({ name: "mixed one-size" }).where(eq(products.id, oneSize));

    expect((await listLowStockVariants()).map((v) => [v.product.id, v.label, v.stock])).toEqual([
      [out, "S", 0],
      [mixed, "M", 1],
      [oneSize, null, 1],
      [two, "S", 2],
      [three, "S", 3],
    ]);
    expect(await countLowStockVariants()).toEqual({ soldOut: 1, low: 4 });
  });
});
