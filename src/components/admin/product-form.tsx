"use client";

import { useActionState } from "react";

import type { ProductFormState } from "@/app/admin/products/actions";
import { Field, fieldProps } from "@/components/admin/field";
import { ImageField } from "@/components/admin/image-field";
import { SizeRows } from "@/components/admin/size-rows";
import type { ProductField, ProductFormValues } from "@/lib/admin/product-input";

type Props = {
  action: (state: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  /** The saved product's values, or empty for a new one. */
  initial: ProductFormValues;
  /** Stock of each saved size, by id. */
  sizeStock?: Record<string, number>;
  categories: { id: number; name: string }[];
  submitLabel: string;
};

export function ProductForm({ action, initial, sizeStock, categories, submitLabel }: Props) {
  const [state, submit, pending] = useActionState(action, { status: "idle" });

  // After a failed save, show what was submitted: React resets the form after its action.
  const values = state.status === "invalid" ? state.values : initial;
  const errors = state.status === "invalid" ? state.errors : {};
  const props = (id: ProductField, hint = false) => ({
    ...fieldProps(id, { error: errors[id], hint }),
    defaultValue: values[id] as string,
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
        <input {...props("name")} required maxLength={200} className="input" />
      </Field>

      <div className="grid gap-8 md:grid-cols-2">
        <Field
          id="slug"
          label="Slug"
          error={errors.slug}
          hint="The product page is /products/<slug>. Leave empty to make one from the name. Changing it breaks old links."
        >
          <input {...props("slug", true)} maxLength={100} className="input" />
        </Field>
        <Field id="sku" label="SKU" error={errors.sku} hint="Letters, digits and hyphens, e.g. SY-W-24102.">
          <input {...props("sku", true)} required maxLength={40} className="input uppercase" />
        </Field>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Field id="categoryId" label="Category" error={errors.categoryId}>
          {/* Keyed by the value: React doesn't re-apply a changed `defaultValue` to a select, so the
              reset after a failed save would otherwise fall back to "Choose a category". */}
          <select key={values.categoryId} {...props("categoryId")} required className="input">
            <option value="">Choose a category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="price" label="Price (KES)" error={errors.price} hint="Whole shillings, e.g. 375700.">
          <input {...props("price", true)} required inputMode="numeric" className="input" />
        </Field>
      </div>

      <Field id="description" label="Description" error={errors.description}>
        <textarea {...props("description")} required rows={5} maxLength={5000} className="input py-3" />
      </Field>

      <Field id="details" label="Details" error={errors.details} hint="One per line, e.g. materials and care.">
        <textarea {...props("details", true)} rows={5} className="input py-3" />
      </Field>

      <SizeRows
        // React resets the form after a failed save, putting inputs back to their defaults. Keyed by
        // the submitted sizes, the rows remount with them as the default, so the reset keeps them.
        key={JSON.stringify(values.sizes)}
        defaultValue={values.sizes}
        stock={sizeStock}
        error={errors.sizes}
      />

      <div className="space-y-8">
        <ImageField id="image" label="Main image" defaultValue={values.image} error={errors.image} required />
        <ImageField
          id="altImage"
          label="Second image (optional)"
          defaultValue={values.altImage}
          error={errors.altImage}
        />
        <Field
          id="gallery"
          label="Gallery (optional)"
          error={errors.gallery}
          hint="More images for the product page: one https://images.unsplash.com/… URL per line."
        >
          <textarea {...props("gallery", true)} rows={4} className="input py-3" />
        </Field>
      </div>

      <Field id="badge" label="Badge (optional)" error={errors.badge} hint="A short label on the product, e.g. New.">
        <input {...props("badge", true)} maxLength={30} className="input" />
      </Field>

      <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
