"use client";

import { useActionState } from "react";

import type { CategoryFormState } from "@/app/admin/categories/actions";
import { Field, fieldProps } from "@/components/admin/field";
import { ImageField } from "@/components/admin/image-field";
import type { CategoryField, CategoryFormValues } from "@/lib/admin/product-input";

type Props = {
  action: (state: CategoryFormState, formData: FormData) => Promise<CategoryFormState>;
  /** The saved category's values, or empty for a new one. */
  initial: CategoryFormValues;
  submitLabel: string;
};

export function CategoryForm({ action, initial, submitLabel }: Props) {
  const [state, submit, pending] = useActionState(action, { status: "idle" });

  // After a failed save, show what was submitted: React resets the form after its action.
  const values = state.status === "invalid" ? state.values : initial;
  const errors = state.status === "invalid" ? state.errors : {};
  const props = (id: CategoryField, hint = false) => ({
    ...fieldProps(id, { error: errors[id], hint }),
    defaultValue: values[id],
  });

  return (
    // A function `action` keeps the form from natively submitting before hydration.
    <form action={submit} noValidate className="space-y-8">
      {state.status === "invalid" && (
        <p role="alert" className="border border-error p-4 text-sm text-error">
          Please correct the highlighted fields.
        </p>
      )}

      <Field id="name" label="Name" error={errors.name}>
        <input {...props("name")} required maxLength={100} className="input" />
      </Field>

      <Field
        id="slug"
        label="Slug"
        error={errors.slug}
        hint="The collection page is /collections/<slug>. Leave empty to make one from the name. Changing it breaks old links, including the store's menu."
      >
        <input {...props("slug", true)} maxLength={100} className="input" />
      </Field>

      <ImageField id="image" label="Tile image (optional)" defaultValue={values.image} error={errors.image} />

      <Field
        id="position"
        label="Position"
        error={errors.position}
        hint="Order in the home page category tiles, lowest first. Only categories with an image get a tile."
      >
        <input {...props("position", true)} inputMode="numeric" className="input" />
      </Field>

      <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
