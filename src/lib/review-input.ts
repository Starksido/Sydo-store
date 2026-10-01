// Parses and validates the review form. No database access, so the client-side form can import it.

export type ReviewFormValues = { rating: string; title: string; body: string };

export type ReviewField = keyof ReviewFormValues;

export type ReviewInput = { rating: number; title: string; body: string };

export const MAX_REVIEW_TITLE = 120;
export const MAX_REVIEW_BODY = 2000;

export function readReviewForm(formData: FormData): ReviewFormValues {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.slice(0, 10_000) : "";
  };
  return { rating: text("rating"), title: text("title"), body: text("body") };
}

export function parseReviewInput(
  values: ReviewFormValues,
): { ok: true; input: ReviewInput } | { ok: false; errors: Partial<Record<ReviewField, string>> } {
  const errors: Partial<Record<ReviewField, string>> = {};

  const rating = /^[1-5]$/.test(values.rating.trim()) ? Number(values.rating) : 0;
  if (!rating) errors.rating = "Choose a rating from 1 to 5 stars.";

  const title = values.title.trim().replace(/\s+/g, " ");
  if (!title) errors.title = "Give your review a title.";
  else if (title.length > MAX_REVIEW_TITLE) errors.title = `Use ${MAX_REVIEW_TITLE} characters or fewer.`;

  const body = values.body.trim().replace(/\r\n/g, "\n");
  if (body.length > MAX_REVIEW_BODY) {
    errors.body = `Use ${MAX_REVIEW_BODY.toLocaleString("en-KE")} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { rating, title, body } };
}

/** The review form's values for an existing review. */
export function reviewFormValues(review: ReviewInput | null): ReviewFormValues {
  return review
    ? { rating: String(review.rating), title: review.title, body: review.body }
    : { rating: "", title: "", body: "" };
}
