"use server";

import { revalidatePath } from "next/cache";

import { getProductBySlug } from "@/lib/products";
import { parseReviewInput, readReviewForm, type ReviewField, type ReviewFormValues } from "@/lib/review-input";
import { saveReview } from "@/lib/reviews";
import { requireSession } from "@/lib/session";

export type ReviewFormState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; values: ReviewFormValues; errors: Partial<Record<ReviewField, string>>; message?: string };

/**
 * Writes or edits the signed-in user's review of the product `slug` (bound by the form), if they
 * have a delivered order of it, and refreshes the product page.
 */
export async function saveReviewAction(slug: unknown, _: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  const product = typeof slug === "string" ? await getProductBySlug(slug) : undefined;
  const { user } = await requireSession(product ? `/products/${product.slug}` : "/");
  const values = readReviewForm(formData);
  if (!product) return { status: "error", values, errors: {}, message: "This product is unavailable." };

  const parsed = parseReviewInput(values);
  if (!parsed.ok) return { status: "error", values, errors: parsed.errors };

  if (!(await saveReview(user.id, product.id, parsed.input))) {
    return {
      status: "error",
      values,
      errors: {},
      message: "Only customers whose order of this piece has been delivered can review it.",
    };
  }
  revalidatePath(`/products/${product.slug}`);
  return { status: "saved" };
}
