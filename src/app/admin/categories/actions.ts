"use server";

import { notFound, redirect } from "next/navigation";

import { createCategory, deleteCategory, updateCategory } from "@/lib/admin/categories";
import {
  parseCategoryInput,
  readCategoryForm,
  type CategoryField,
  type CategoryFormValues,
  type FieldErrors,
} from "@/lib/admin/product-input";
import { requireAdmin } from "@/lib/session";

import { isId, revalidateStorefront } from "../revalidate";

/** What was submitted, and why it wasn't saved. React resets a form after its action. */
export type CategoryFormState =
  | { status: "idle" }
  | { status: "invalid"; values: CategoryFormValues; errors: FieldErrors<CategoryField> };

export async function createCategoryAction(_: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  await requireAdmin("/admin/categories/new");

  const values = readCategoryForm(formData);
  const parsed = parseCategoryInput(values);
  if (!parsed.ok) return { status: "invalid", values, errors: parsed.errors };

  const result = await createCategory(parsed.input);
  if (!result.ok) return { status: "invalid", values, errors: result.errors };

  revalidateStorefront();
  redirect(`/admin/categories/${result.id}?saved=1`);
}

/** Bound to the category's id by the edit page. */
export async function updateCategoryAction(
  id: unknown,
  _: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  await requireAdmin("/admin/categories");
  if (!isId(id)) notFound();

  const values = readCategoryForm(formData);
  const parsed = parseCategoryInput(values);
  if (!parsed.ok) return { status: "invalid", values, errors: parsed.errors };

  const result = await updateCategory(id, parsed.input);
  if (!result) notFound();
  if (!result.ok) return { status: "invalid", values, errors: result.errors };

  revalidateStorefront();
  redirect(`/admin/categories/${id}?saved=1`);
}

/** Bound to the category's id by the edit page. If it can't be deleted, the edit page explains why. */
export async function deleteCategoryAction(id: unknown): Promise<void> {
  await requireAdmin("/admin/categories");
  if (!isId(id)) notFound();

  const result = await deleteCategory(id);
  if (!result.ok) {
    if (result.reason === "not-found") notFound();
    redirect(`/admin/categories/${id}#delete`);
  }

  revalidateStorefront();
  redirect("/admin/categories?saved=deleted");
}
