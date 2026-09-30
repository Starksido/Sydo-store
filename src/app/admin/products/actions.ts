"use server";

import { notFound, redirect } from "next/navigation";

import {
  parseProductInput,
  readProductForm,
  type FieldErrors,
  type ProductField,
  type ProductFormValues,
} from "@/lib/admin/product-input";
import { createProduct, setProductArchived, updateProduct } from "@/lib/admin/products";
import { requireAdmin } from "@/lib/session";

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
