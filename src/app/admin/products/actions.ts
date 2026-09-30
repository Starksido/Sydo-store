"use server";

import { notFound, redirect } from "next/navigation";

import {
  parseProductInput,
  parseStockInput,
  readProductForm,
  readStockForm,
  type FieldErrors,
  type ProductField,
  type ProductFormValues,
  type StockField,
  type StockFormValues,
} from "@/lib/admin/product-input";
import { createProduct, deleteProduct, setProductArchived, updateProduct } from "@/lib/admin/products";
import { requireAdmin } from "@/lib/session";
import { adjustStock, setStockTo } from "@/lib/stock";

import { isId, revalidateStorefront } from "../revalidate";

/** What was submitted, and why it wasn't saved. React resets a form after its action. */
export type ProductFormState =
  | { status: "idle" }
  | { status: "invalid"; values: ProductFormValues; errors: FieldErrors<ProductField> };

export async function createProductAction(_: ProductFormState, formData: FormData): Promise<ProductFormState> {
  await requireAdmin("/admin/products/new");

  const values = readProductForm(formData);
  const parsed = parseProductInput(values);
  if (!parsed.ok) return { status: "invalid", values, errors: parsed.errors };

  const result = await createProduct(parsed.input);
  if (!result.ok) return { status: "invalid", values, errors: result.errors };

  revalidateStorefront();
  redirect(`/admin/products/${result.id}?saved=1`);
}

/** Bound to the product's id by the edit page. */
export async function updateProductAction(
  id: unknown,
  _: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  await requireAdmin("/admin/products");
  if (!isId(id)) notFound();

  const values = readProductForm(formData);
  const parsed = parseProductInput(values);
  if (!parsed.ok) return { status: "invalid", values, errors: parsed.errors };

  const result = await updateProduct(id, parsed.input);
  if (!result) notFound();
  if (!result.ok) return { status: "invalid", values, errors: result.errors };

  revalidateStorefront();
  redirect(`/admin/products/${id}?saved=1`);
}

/** Bound to the product's id and the new state by the edit page. */
export async function setProductArchivedAction(id: unknown, archived: unknown): Promise<void> {
  await requireAdmin("/admin/products");
  if (!isId(id) || typeof archived !== "boolean") notFound();

  if (!(await setProductArchived(id, archived))) notFound();

  revalidateStorefront();
  redirect(`/admin/products/${id}?saved=${archived ? "archived" : "unarchived"}`);
}

/**
 * Bound to the product's id by the edit page. If it can't be deleted (not archived, or ordered
 * since the page loaded), the edit page explains why.
 */
export async function deleteProductAction(id: unknown): Promise<void> {
  await requireAdmin("/admin/products");
  if (!isId(id)) notFound();

  const result = await deleteProduct(id);
  if (!result.ok) {
    if (result.reason === "not-found") notFound();
    redirect(`/admin/products/${id}#delete`);
  }

  revalidateStorefront();
  redirect("/admin/products?saved=deleted");
}

/**
 * Why a stock change wasn't made. `current` is the stock now, when it differs from what the page
 * showed (a sale or another admin got there first); the form shows it and uses it next time.
 */
export type StockFormState =
  | { status: "idle" }
  | {
      status: "error";
      values: StockFormValues;
      errors: FieldErrors<StockField>;
      message?: string;
      current?: number;
    };

/** Bound to the product's id by the edit page. */
export async function adjustStockAction(
  productId: unknown,
  _: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const { user } = await requireAdmin("/admin/products");
  if (!isId(productId)) notFound();

  const { expected, ...values } = readStockForm(formData);
  const parsed = parseStockInput({ ...values, expected });
  if (!parsed.ok) {
    const { expected: stale, ...errors } = parsed.errors;
    return { status: "error", values, errors, message: stale };
  }

  const { reason, note } = parsed.input;
  const meta = { productId, reason, note, userId: user.id };
  if (parsed.input.mode === "adjust") {
    const result = await adjustStock({ ...meta, delta: parsed.input.delta });
    if (!result.ok) {
      if (result.reason === "not-found") notFound();
      const errors = { quantity: `There are only ${result.current} in stock, so you can remove at most ${result.current}.` };
      return { status: "error", values, errors, current: result.current };
    }
  } else {
    const result = await setStockTo({ ...meta, stock: parsed.input.stock, expected: parsed.input.expected });
    if (!result.ok) {
      if (result.reason === "not-found") notFound();
      const message = `Stock changed to ${result.current} since this page loaded, probably from a sale. Nothing was saved: check the number and try again.`;
      return { status: "error", values, errors: {}, message, current: result.current };
    }
    if (!result.changed) redirect(`/admin/products/${productId}?saved=stock-same#stock`);
  }

  revalidateStorefront();
  redirect(`/admin/products/${productId}?saved=stock#stock`);
}
