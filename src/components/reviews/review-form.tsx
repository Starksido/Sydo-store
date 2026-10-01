"use client";

import { useActionState, useEffect, useState } from "react";

import { saveReviewAction, type ReviewFormState } from "@/app/(store)/products/actions";
import { Field, fieldProps } from "@/components/admin/field";
import { authClient } from "@/lib/auth-client";
import {
  MAX_REVIEW_BODY,
  MAX_REVIEW_TITLE,
  reviewFormValues,
  type ReviewFormValues,
  type ReviewInput,
} from "@/lib/review-input";

type Mine = { canReview: boolean; review: (ReviewInput & { hidden: boolean }) | null };

/**
 * "Write a review" for verified buyers. The product page is static, so whether the viewer may
 * review (a delivered order of it) and their own review are fetched in the browser.
 */
export function ReviewFormSlot({ productId, slug }: { productId: number; slug: string }) {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const [mine, setMine] = useState<Mine | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/reviews/mine?productId=${productId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Mine | null) => !cancelled && setMine(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, productId]);

  if (!userId || !mine?.canReview) return null;

  return (
    <div className="mt-8">
      {mine.review?.hidden && (
        <p className="mb-4 text-sm text-muted">Your review has been hidden by our team and isn&apos;t shown here.</p>
      )}
      {open ? (
        <ReviewForm slug={slug} initial={reviewFormValues(mine.review)} editing={!!mine.review} />
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary">
          {mine.review ? "Edit your review" : "Write a review"}
        </button>
      )}
    </div>
  );
}

function ReviewForm({ slug, initial, editing }: { slug: string; initial: ReviewFormValues; editing: boolean }) {
  const [state, submit, pending] = useActionState<ReviewFormState, FormData>(saveReviewAction.bind(null, slug), {
    status: "idle",
  });

  if (state.status === "saved") {
    return (
      <p role="status" className="border border-line p-4 text-sm">
        Thank you. Your review is published and shows here within a minute.
      </p>
    );
  }

  const values = state.status === "error" ? state.values : initial;
  const errors = state.status === "error" ? state.errors : {};

  return (
    // A function `action` keeps the form from natively submitting before hydration.
    <form action={submit} noValidate className="space-y-6 border-t pt-6">
      <h3 className="label">{editing ? "Edit your review" : "Write a review"}</h3>
      {state.status === "error" && (state.message || Object.keys(errors).length > 0) && (
        <p role="alert" className="border border-error p-4 text-sm text-error">
          {state.message ?? "Please correct the highlighted fields."}
        </p>
      )}

      {/* Keyed by the submitted rating: React resets the form after its action. */}
      <fieldset key={values.rating} aria-describedby={errors.rating ? "rating-error" : undefined}>
        <legend className="label">Rating</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={n}
                defaultChecked={values.rating === String(n)}
                className="peer sr-only"
              />
              <span className="flex h-11 min-w-12 items-center justify-center border px-3 text-sm transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink hover:border-ink">
                {n} ★<span className="sr-only">{n === 1 ? " star" : " stars"}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.rating && (
          <span id="rating-error" className="field-error">
            {errors.rating}
          </span>
        )}
      </fieldset>

      <Field id="title" label="Title" error={errors.title}>
        <input
          {...fieldProps("title", { error: errors.title })}
          defaultValue={values.title}
          maxLength={MAX_REVIEW_TITLE}
          required
          className="input"
        />
      </Field>
      <Field id="body" label="Review (optional)" error={errors.body}>
        <textarea
          {...fieldProps("body", { error: errors.body })}
          defaultValue={values.body}
          maxLength={MAX_REVIEW_BODY}
          rows={5}
          className="input py-3"
        />
      </Field>

      <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Publishing…" : "Publish review"}
      </button>
    </form>
  );
}
