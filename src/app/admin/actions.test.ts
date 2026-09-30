// Runs against the test database only (see tests/test-env.ts). The session, redirects and cache
// revalidation are mocked. `requireAdmin` itself is tested in src/lib/admin-access.test.ts.
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCategoryAction, updateCategoryAction } from "@/app/admin/categories/actions";
import { createProductAction, setProductArchivedAction, updateProductAction } from "@/app/admin/products/actions";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { requireAdmin } from "@/lib/session";

import { createCategory, createProduct, resetCatalog } from "../../../tests/fixtures";

vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const IMAGE = "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=1200";

beforeEach(resetCatalog);

afterEach(() => {
  vi.clearAllMocks();
});

function signedInAsAdmin() {
  vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin", role: "admin" } } as Awaited<
    ReturnType<typeof requireAdmin>
  >);
}

/** What `requireAdmin` does for a signed-in customer. */
function signedInAsCustomer() {
  vi.mocked(requireAdmin).mockRejectedValue(new Error("NOT_FOUND"));
}

function productForm(categoryId: number, overrides: Record<string, string> = {}) {
  const form = new FormData();
  const fields = {
    name: "Floral silk wrap dress",
    sku: "sy-w-24102",
    categoryId: String(categoryId),
    description: "A fluid midi wrap dress.",
    price: "318500",
    image: IMAGE,
    "sizes.0.label": "S",
    "sizes.0.available": "on",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

function categoryForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: "Evening", slug: "", image: "", position: "2", ...overrides })) {
    form.set(key, value);
  }
  return form;
}

/** Every catalog row, to show that a refused action wrote nothing. */
async function snapshot() {
  const { rows } = await db.execute(sql`
    select (select coalesce(json_agg(p order by p.id), '[]') from products p) as products,
      (select coalesce(json_agg(c order by c.id), '[]') from categories c) as categories
  `);
  return rows[0];
}

const idle = { status: "idle" } as const;

describe("admin Server Functions", () => {
  it("refuse customers before reading or writing anything", async () => {
    const categoryId = await createCategory();
    const productId = await createProduct(5);
    const before = await snapshot();
    signedInAsCustomer();

    await expect(createProductAction(idle, productForm(categoryId))).rejects.toThrow("NOT_FOUND");
    await expect(updateProductAction(productId, idle, productForm(categoryId))).rejects.toThrow("NOT_FOUND");
    await expect(setProductArchivedAction(productId, true)).rejects.toThrow("NOT_FOUND");
    await expect(createCategoryAction(idle, categoryForm())).rejects.toThrow("NOT_FOUND");
    await expect(updateCategoryAction(categoryId, idle, categoryForm())).rejects.toThrow("NOT_FOUND");

    expect(requireAdmin).toHaveBeenCalledTimes(5);
    expect(await snapshot()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("create a product, refresh the storefront and open it with a saved notice", async () => {
    signedInAsAdmin();
    const categoryId = await createCategory();

    await expect(createProductAction(idle, productForm(categoryId))).rejects.toThrow(
      /^REDIRECT \/admin\/products\/\d+\?saved=1$/,
    );
    const [row] = await db.select().from(products);
    expect(row).toMatchObject({ slug: "floral-silk-wrap-dress", sku: "SY-W-24102", price: 31_850_000, stock: 0 });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/"],
      ["/collections/new-in"],
      ["/collections/[slug]", "page"],
      ["/products/[slug]", "page"],
    ]);
  });

  it("return what was submitted, with errors, instead of saving invalid input", async () => {
    signedInAsAdmin();
    const categoryId = await createCategory();
    const form = productForm(categoryId, { price: "12.50", image: "https://evil.com/a.jpg" });

    expect(await createProductAction(idle, form)).toEqual({
      status: "invalid",
      values: expect.objectContaining({ price: "12.50", sizes: [{ label: "S", available: true }] }),
      errors: { price: expect.any(String), image: expect.any(String) },
    });
    expect(await db.select().from(products)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("update a product and archive it; unknown ids are a 404", async () => {
    signedInAsAdmin();
    const productId = await createProduct(5);
    const [{ categoryId }] = await db.select({ categoryId: products.categoryId }).from(products);

    await expect(updateProductAction(productId, idle, productForm(categoryId, { name: "Renamed" }))).rejects.toThrow(
      `REDIRECT /admin/products/${productId}?saved=1`,
    );
    await expect(setProductArchivedAction(productId, true)).rejects.toThrow(
      `REDIRECT /admin/products/${productId}?saved=archived`,
    );
    const [row] = await db.select().from(products).where(eq(products.id, productId));
    expect(row).toMatchObject({ name: "Renamed", stock: 5, archivedAt: expect.any(Date) });

    for (const id of [999_999, "1", -1, 1.5]) {
      await expect(updateProductAction(id, idle, productForm(categoryId))).rejects.toThrow("NOT_FOUND");
    }
    await expect(setProductArchivedAction(productId, "yes")).rejects.toThrow("NOT_FOUND");
    await expect(setProductArchivedAction(999_999, true)).rejects.toThrow("NOT_FOUND");
  });

  it("create and update categories", async () => {
    signedInAsAdmin();

    await expect(createCategoryAction(idle, categoryForm())).rejects.toThrow(/^REDIRECT \/admin\/categories\/\d+\?saved=1$/);
    const [{ id }] = await db.select({ id: categories.id }).from(categories);
    await expect(updateCategoryAction(id, idle, categoryForm({ name: "Evening wear" }))).rejects.toThrow(
      `REDIRECT /admin/categories/${id}?saved=1`,
    );
    expect(await db.select({ name: categories.name, slug: categories.slug }).from(categories)).toEqual([
      { name: "Evening wear", slug: "evening-wear" },
    ]);

    expect(await createCategoryAction(idle, categoryForm({ slug: "evening-wear" }))).toMatchObject({
      status: "invalid",
      errors: { slug: "Another category already uses this slug." },
    });
  });
});
