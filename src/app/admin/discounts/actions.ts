"use server";

import { notFound, redirect } from "next/navigation";

import {
  parseDiscountInput,
  readDiscountForm,
  type DiscountField,
  type DiscountFormValues,
} from "@/lib/admin/discount-input";
import { createDiscountCode, deleteDiscountCode, updateDiscountCode } from "@/lib/discounts";
import { requireAdmin } from "@/lib/session";

import { isId } from "../revalidate";

/** What was submitted, and why it wasn't saved. React resets a form after its action. */
export type DiscountFormState =
  | { status: "idle" }
  | { status: "invalid"; values: DiscountFormValues; errors: Partial<Record<DiscountField, string>> };

export async function createDiscountAction(_: DiscountFormState, formData: FormData): Promise<DiscountFormState> {
  await requireAdmin("/admin/discounts/new");

  const values = readDiscountForm(formData);
  const parsed = parseDiscountInput(values);
  if (!parsed.ok) return { status: "invalid", values, errors: parsed.errors };

  const result = await createDiscountCode(parsed.input);
  if (!result.ok) return { status: "invalid", values, errors: result.errors };

  redirect(`/admin/discounts/${result.id}?saved=1`);
}

/** Bound to the code's id by the edit page. */
export async function updateDiscountAction(
  id: unknown,
  _: DiscountFormState,
  formData: FormData,
): Promise<DiscountFormState> {
  await requireAdmin("/admin/discounts");
  if (!isId(id)) notFound();

  const values = readDiscountForm(formData);
  const parsed = parseDiscountInput(values);
  if (!parsed.ok) return { status: "invalid", values, errors: parsed.errors };

  const result = await updateDiscountCode(id, parsed.input);
  if (!result) notFound();
  if (!result.ok) return { status: "invalid", values, errors: result.errors };

  redirect(`/admin/discounts/${id}?saved=1`);
}

/** Bound to the code's id by the edit page. A code an order used can't be deleted; the page explains. */
export async function deleteDiscountAction(id: unknown): Promise<void> {
  await requireAdmin("/admin/discounts");
  if (!isId(id)) notFound();

  const result = await deleteDiscountCode(id);
  if (!result.ok) {
    if (result.reason === "not-found") notFound();
    redirect(`/admin/discounts/${id}#delete`);
  }
  redirect("/admin/discounts?saved=deleted");
}
