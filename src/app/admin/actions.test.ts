// Runs against the test database only (see tests/test-env.ts). The session, redirects and cache
// revalidation are mocked. `requireAdmin` itself is tested in src/lib/admin-access.test.ts.
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "@/app/admin/categories/actions";
import { changeOrderStatusAction, recordRefundAction, setTrackingAction } from "@/app/admin/orders/actions";
import {
  adjustStockAction,
  createProductAction,
  deleteProductAction,
  setProductArchivedAction,
  updateProductAction,
} from "@/app/admin/products/actions";
import { setUserRoleAction } from "@/app/admin/users/actions";
import { db } from "@/db";
import {
  categories,
  orderEvents,
  orders,
  payments,
  products,
  productVariants,
  roleChanges,
  stockAdjustments,
  user,
} from "@/db/schema";
import { requireAdmin } from "@/lib/session";

import {
  createCategory,
  createProduct,
  createUser,
  getStock,
  getVariantId,
  resetCatalog,
  setStock,
} from "../../../tests/fixtures";
import { createOrder, getOrderRow, setOrderStatus } from "../../../tests/orders";
import { mockResend } from "../../../tests/resend-mock";

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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function signedInAsAdmin(id = "admin") {
  vi.mocked(requireAdmin).mockResolvedValue({ user: { id, role: "admin" } } as Awaited<
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
    "sizes.0.id": "",
    "sizes.0.label": "S",
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

function stockForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ mode: "add", quantity: "3", reason: "received", note: "", ...fields })) {
    form.set(key, value);
  }
  return form;
}

/** Every catalog and stock log row, to show that a refused action wrote nothing. */
async function snapshot() {
  const { rows } = await db.execute(sql`
    select (select coalesce(json_agg(p order by p.id), '[]') from products p) as products,
      (select coalesce(json_agg(v order by v.id), '[]') from product_variants v) as variants,
      (select coalesce(json_agg(c order by c.id), '[]') from categories c) as categories,
      (select coalesce(json_agg(s order by s.id), '[]') from stock_adjustments s) as adjustments,
      (select coalesce(json_agg(o order by o.id), '[]') from orders o) as orders,
      (select coalesce(json_agg(e order by e.id), '[]') from order_events e) as events,
      (select coalesce(json_agg(p order by p.id), '[]') from payments p) as payments,
      (select coalesce(json_agg(u.role order by u.id), '[]') from "user" u) as roles,
      (select coalesce(json_agg(r order by r.id), '[]') from role_changes r) as role_changes
  `);
  return rows[0];
}

const idle = { status: "idle" } as const;

function fields(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("admin Server Functions", () => {
  it("refuse customers before reading or writing anything", async () => {
    const categoryId = await createCategory();
    const productId = await createProduct(5);
    const userId = await createUser();
    const before = await snapshot();
    signedInAsCustomer();

    await expect(createProductAction(idle, productForm(categoryId))).rejects.toThrow("NOT_FOUND");
    await expect(updateProductAction(productId, idle, productForm(categoryId))).rejects.toThrow("NOT_FOUND");
    await expect(setProductArchivedAction(productId, true)).rejects.toThrow("NOT_FOUND");
    await expect(createCategoryAction(idle, categoryForm())).rejects.toThrow("NOT_FOUND");
    await expect(updateCategoryAction(categoryId, idle, categoryForm())).rejects.toThrow("NOT_FOUND");
    await expect(adjustStockAction(productId, idle, stockForm({}))).rejects.toThrow("NOT_FOUND");
    await expect(deleteProductAction(productId)).rejects.toThrow("NOT_FOUND");
    await expect(deleteCategoryAction(categoryId)).rejects.toThrow("NOT_FOUND");
    await expect(setUserRoleAction(userId, "admin")).rejects.toThrow("NOT_FOUND");

    expect(requireAdmin).toHaveBeenCalledTimes(9);
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
    expect(row).toMatchObject({ slug: "floral-silk-wrap-dress", sku: "SY-W-24102", price: 31_850_000 });
    expect(await db.select({ label: productVariants.label, stock: productVariants.stock }).from(productVariants)).toEqual([
      { label: "S", stock: 0 },
    ]);
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
      values: expect.objectContaining({ price: "12.50", sizes: [{ id: "", label: "S" }] }),
      errors: { price: expect.any(String), image: expect.any(String) },
    });
    expect(await db.select().from(products)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("update a product and archive it; unknown ids are a 404", async () => {
    signedInAsAdmin();
    const productId = await createProduct(5);
    const [{ categoryId }] = await db.select({ categoryId: products.categoryId }).from(products);

    // A one-size product with stock can't take sizes, so the form keeps it one-size.
    const oneSize = { name: "Renamed", "sizes.0.label": "" };
    expect(await updateProductAction(productId, idle, productForm(categoryId, { name: "Renamed" }))).toMatchObject({
      status: "invalid",
      errors: { sizes: expect.stringContaining("Set its stock to 0") },
    });
    await expect(updateProductAction(productId, idle, productForm(categoryId, oneSize))).rejects.toThrow(
      `REDIRECT /admin/products/${productId}?saved=1`,
    );
    await expect(setProductArchivedAction(productId, true)).rejects.toThrow(
      `REDIRECT /admin/products/${productId}?saved=archived`,
    );
    const [row] = await db.select().from(products).where(eq(products.id, productId));
    expect(row).toMatchObject({ name: "Renamed", archivedAt: expect.any(Date) });
    expect(await getStock(productId)).toBe(5);

    for (const id of [999_999, "1", -1, 1.5]) {
      await expect(updateProductAction(id, idle, productForm(categoryId))).rejects.toThrow("NOT_FOUND");
    }
    await expect(setProductArchivedAction(productId, "yes")).rejects.toThrow("NOT_FOUND");
    await expect(setProductArchivedAction(999_999, true)).rejects.toThrow("NOT_FOUND");
  });

  it("delete archived, never-ordered products and unused categories; refused deletes return to the edit page", async () => {
    signedInAsAdmin();
    const productId = await createProduct(5);
    const [{ categoryId }] = await db.select({ categoryId: products.categoryId }).from(products);

    await expect(deleteProductAction(productId)).rejects.toThrow(`REDIRECT /admin/products/${productId}#delete`);
    await expect(deleteCategoryAction(categoryId)).rejects.toThrow(`REDIRECT /admin/categories/${categoryId}#delete`);
    expect(revalidatePath).not.toHaveBeenCalled();

    await db.update(products).set({ archivedAt: new Date() }).where(eq(products.id, productId));
    await expect(deleteProductAction(productId)).rejects.toThrow("REDIRECT /admin/products?saved=deleted");
    await expect(deleteCategoryAction(categoryId)).rejects.toThrow("REDIRECT /admin/categories?saved=deleted");
    expect(await db.select().from(products)).toEqual([]);
    expect(await db.select().from(categories)).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/products/[slug]", "page");

    for (const id of [productId, "1", -1]) {
      await expect(deleteProductAction(id)).rejects.toThrow("NOT_FOUND");
      await expect(deleteCategoryAction(id)).rejects.toThrow("NOT_FOUND");
    }
  });

  it("add and remove admins, going back to the user with what happened", async () => {
    const adminId = await createUser();
    await db.update(user).set({ role: "admin" }).where(eq(user.id, adminId));
    signedInAsAdmin(adminId);
    const userId = await createUser();
    const [{ email }] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
    const back = `REDIRECT /admin/users?q=${encodeURIComponent(email)}&result=`;

    await expect(setUserRoleAction(userId, "admin")).rejects.toThrow(`${back}added`);
    await expect(setUserRoleAction(userId, "admin")).rejects.toThrow(`${back}unchanged`);
    await expect(setUserRoleAction(userId, "user")).rejects.toThrow(`${back}removed`);
    await expect(setUserRoleAction(adminId, "user")).rejects.toThrow("result=self");
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, userId));
    await expect(setUserRoleAction(userId, "admin")).rejects.toThrow("result=unverified");
    expect(await db.select({ toRole: roleChanges.toRole }).from(roleChanges)).toEqual([
      { toRole: "admin" },
      { toRole: "user" },
    ]);

    for (const [id, role] of [
      ["nobody", "admin"],
      [userId, "owner"],
      [42, "admin"],
      ["", "user"],
    ]) {
      await expect(setUserRoleAction(id, role)).rejects.toThrow("NOT_FOUND");
    }
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

  it("change stock as the signed-in admin, and explain refused changes", async () => {
    const adminId = await createUser();
    signedInAsAdmin(adminId);
    const productId = await createProduct(5);
    const variantId = String(await getVariantId(productId));
    const form = (fields: Record<string, string>) => stockForm({ variantId, ...fields });

    await expect(adjustStockAction(productId, idle, form({ note: "Invoice 7" }))).rejects.toThrow(
      `REDIRECT /admin/products/${productId}?saved=stock#stock`,
    );
    expect(await getStock(productId)).toBe(8);
    expect(await db.select().from(stockAdjustments)).toMatchObject([
      { productId, userId: adminId, delta: 3, previousStock: 5, newStock: 8, reason: "received", note: "Invoice 7" },
    ]);
    expect(revalidatePath).toHaveBeenCalled();

    expect(await adjustStockAction(productId, idle, form({ mode: "remove", quantity: "9", reason: "damaged" }))).toEqual({
      status: "error",
      values: expect.objectContaining({ quantity: "9" }),
      errors: { quantity: "There are only 8 in stock, so you can remove at most 8." },
      current: 8,
    });

    // "Set to" checks against the stock the page showed: a sale in between makes it stale.
    await setStock(productId, 6);
    expect(
      await adjustStockAction(productId, idle, form({ mode: "set", quantity: "20", reason: "correction", expected: "8" })),
    ).toMatchObject({ status: "error", current: 6, message: expect.stringContaining("Stock changed to 6") });
    await expect(
      adjustStockAction(productId, idle, form({ mode: "set", quantity: "6", reason: "correction", expected: "6" })),
    ).rejects.toThrow(`REDIRECT /admin/products/${productId}?saved=stock-same#stock`);
    expect(await getStock(productId)).toBe(6);
    expect(await db.select().from(stockAdjustments)).toHaveLength(1);

    expect(await adjustStockAction(productId, idle, form({ quantity: "0", reason: "" }))).toMatchObject({
      status: "error",
      errors: { quantity: expect.any(String), reason: expect.any(String) },
    });
    expect(await adjustStockAction(productId, idle, form({ variantId: "999999" }))).toMatchObject({
      status: "error",
      errors: { variantId: "That size no longer exists. Reload the page." },
    });
    await expect(adjustStockAction(999_999, idle, form({}))).rejects.toThrow("NOT_FOUND");
    await expect(adjustStockAction("1", idle, form({}))).rejects.toThrow("NOT_FOUND");
  });
  it("refuse customers order changes, tracking and refunds, writing nothing", async () => {
    const reference = await createOrder(await createUser(), [[await createProduct(5), 1]]);
    await setOrderStatus(reference, "paid");
    const { id } = await getOrderRow(reference);
    const before = await snapshot();
    signedInAsCustomer();

    await expect(
      changeOrderStatusAction(id, reference, idle, fields({ expected: "paid", to: "processing" })),
    ).rejects.toThrow("NOT_FOUND");
    await expect(setTrackingAction(id, reference, idle, new FormData())).rejects.toThrow("NOT_FOUND");
    await expect(recordRefundAction(1, reference, "order", idle, new FormData())).rejects.toThrow("NOT_FOUND");
    expect(await snapshot()).toEqual(before);
  });

  it("move an order on, cancel it with a reason, and explain refused changes", async () => {
    const adminId = await createUser();
    signedInAsAdmin(adminId);
    const product = await createProduct(5);
    const reference = await createOrder(await createUser(), [[product, 2]]);
    const { id } = await getOrderRow(reference);
    const change = (values: Record<string, string>) => changeOrderStatusAction(id, reference, idle, fields(values));

    // Not paid yet, so it can't be processed.
    expect(await change({ expected: "pending_payment", to: "processing" })).toMatchObject({
      status: "error",
      message: expect.stringContaining("can't be marked processing"),
    });

    await setOrderStatus(reference, "paid");
    await expect(change({ expected: "paid", to: "processing", note: "Packing" })).rejects.toThrow(
      `REDIRECT /admin/orders/${reference}?saved=processing`,
    );
    // Someone else already moved it on.
    expect(await change({ expected: "paid", to: "processing" })).toMatchObject({
      status: "error",
      message: expect.stringContaining("it's now processing"),
    });
    // Cancelling needs a reason, and keeps what was typed.
    expect(await change({ expected: "processing", to: "cancelled", note: "Damaged" })).toMatchObject({
      status: "error",
      errors: { cancelReason: expect.any(String) },
      values: expect.objectContaining({ note: "Damaged" }),
    });
    await expect(change({ expected: "processing", to: "cancelled", cancelReason: "out_of_stock" })).rejects.toThrow(
      `REDIRECT /admin/orders/${reference}?saved=cancelled`,
    );

    expect(await getOrderRow(reference)).toMatchObject({ status: "cancelled" });
    expect(await getStock(product)).toBe(5);
    expect(revalidatePath).toHaveBeenCalled();
    expect(await db.select({ userId: orderEvents.userId, note: orderEvents.note }).from(orderEvents)).toEqual([
      { userId: adminId, note: "Packing" },
      { userId: adminId, note: null },
    ]);

    for (const [orderId, ref] of [
      [999_999, reference],
      [id, "SY-bad"],
      ["1", reference],
    ] as const) {
      await expect(
        changeOrderStatusAction(orderId, ref, idle, fields({ expected: "paid", to: "processing" })),
      ).rejects.toThrow("NOT_FOUND");
    }
    await expect(change({ expected: "paid", to: "lost" })).rejects.toThrow("NOT_FOUND");
  });

  it("email the customer when an order ships or is cancelled, and when a refund is recorded", async () => {
    const resend = mockResend();
    signedInAsAdmin(await createUser());
    const customer = await createUser();
    const [{ email }] = await db.select({ email: user.email }).from(user).where(eq(user.id, customer));
    const shipped = await createOrder(customer, [[await createProduct(5), 1]]);
    const cancelled = await createOrder(customer, [[await createProduct(5), 1]]);
    const [s, c] = [await getOrderRow(shipped), await getOrderRow(cancelled)];
    const change = (id: number, reference: string, values: Record<string, string>) =>
      expect(changeOrderStatusAction(id, reference, idle, fields(values))).rejects.toThrow("REDIRECT");

    await setOrderStatus(shipped, "paid");
    await change(s.id, shipped, { expected: "paid", to: "processing" });
    await change(s.id, shipped, { expected: "processing", to: "shipped", carrier: "G4S", trackingNumber: "G4S-1" });
    await change(c.id, cancelled, { expected: "pending_payment", to: "cancelled", cancelReason: "customer_request" });
    const [payment] = await db
      .insert(payments)
      .values({
        orderId: c.id,
        reference: `${cancelled}-X`,
        amount: 1000,
        status: "success",
        refundStatus: "due",
        refundReason: "duplicate_payment",
      })
      .returning({ id: payments.id });
    await expect(
      recordRefundAction(payment.id, cancelled, "order", idle, fields({ refundReference: "RF_1", refundedOn: "2026-09-30" })),
    ).rejects.toThrow("REDIRECT");

    await resend.waitFor(3);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(resend.sent.map((mail) => [mail.to[0], mail.subject, mail.idempotencyKey])).toEqual(
      expect.arrayContaining([
        [email, `Order ${shipped} has shipped`, `order-shipped/${shipped}`],
        [email, `Order ${cancelled} cancelled`, `order-cancelled/${cancelled}`],
        [email, `Refund for order ${cancelled}`, `refund-${payment.id}/${cancelled}`],
      ]),
    );
    // Nothing for "processing".
    expect(resend.sent).toHaveLength(3);
    expect(resend.sent.find((mail) => mail.subject.includes("shipped"))?.text).toContain("G4S, tracking number G4S-1");
  });

  it("set tracking on shipped orders only, and record refunds once", async () => {
    signedInAsAdmin(await createUser());
    const reference = await createOrder(await createUser(), [[await createProduct(5), 1]]);
    const { id } = await getOrderRow(reference);
    const tracking = fields({ carrier: "DHL", trackingNumber: "JD01" });

    expect(await setTrackingAction(id, reference, idle, tracking)).toMatchObject({
      status: "error",
      message: expect.any(String),
    });
    await setOrderStatus(reference, "shipped");
    await expect(setTrackingAction(id, reference, idle, tracking)).rejects.toThrow(
      `REDIRECT /admin/orders/${reference}?saved=tracking`,
    );
    expect(await db.select({ carrier: orders.shippingCarrier }).from(orders)).toEqual([{ carrier: "DHL" }]);

    const [payment] = await db
      .insert(payments)
      .values({
        orderId: id,
        reference: `${reference}-X`,
        amount: 1000,
        status: "success",
        refundStatus: "due",
        refundReason: "duplicate_payment",
      })
      .returning({ id: payments.id });
    const refund = fields({ refundReference: "RF_9", refundedOn: "2026-09-30" });
    await expect(recordRefundAction(payment.id, reference, "refunds", idle, refund)).rejects.toThrow(
      "REDIRECT /admin/refunds?saved=1",
    );
    expect(await recordRefundAction(payment.id, reference, "order", idle, refund)).toMatchObject({
      status: "error",
      message: expect.stringContaining("isn't due"),
    });
    expect(
      await recordRefundAction(payment.id, reference, "order", idle, fields({ refundReference: "", refundedOn: "2099-01-01" })),
    ).toMatchObject({
      status: "error",
      errors: { refundReference: expect.any(String), refundedOn: expect.any(String) },
    });
  });
});
