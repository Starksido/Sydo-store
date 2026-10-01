"use client";

import { useActionState, useState } from "react";

import type { StockFormState } from "@/app/admin/products/actions";
import { Field, fieldProps } from "@/components/admin/field";
import { STOCK_REASONS, type StockField, type StockFormValues, type StockMode } from "@/lib/admin/product-input";

const MODES: { value: StockMode; label: string; quantity: string }[] = [
  { value: "add", label: "Add", quantity: "Units to add" },
  { value: "remove", label: "Remove", quantity: "Units to remove" },
  { value: "set", label: "Set to", quantity: "New stock level" },
];

type Variant = { id: number; label: string | null; stock: number };

type Props = {
  action: (state: StockFormState, formData: FormData) => Promise<StockFormState>;
  /**
   * The product's sizes with their stock when the page loaded, or its one variant (null label) for a
   * one-size item. "Set to" only applies if the size's stock is still this.
   */
  variants: Variant[];
};

export function StockForm({ action, variants }: Props) {
  const [state, submit, pending] = useActionState(action, { status: "idle" });

  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.errors : {};
  const mode = MODES.find((m) => m.value === values?.mode)?.value ?? "add";

  return (
    // A function `action` keeps the form from natively submitting before hydration.
    <form action={submit} noValidate className="space-y-6">
      {state.status === "error" && state.message && (
        <p role="alert" className="border border-error p-4 text-sm text-error">
          {state.message}
        </p>
      )}

      <SizeAndStock
        // React resets the form after a refused change. Keyed by the submitted size, this remounts
        // with it selected, so the reset keeps it.
        key={values?.variantId ?? ""}
        variants={variants}
        initialId={values?.variantId ?? ""}
        // After a refused change, show (and check against) the stock the server reported.
        reported={state.status === "error" ? state.current : undefined}
        error={errors.variantId}
      />

      <StockFields
        // Likewise keyed by the submitted mode, so the radios keep it.
        key={mode}
        initialMode={mode}
        values={values}
        errors={errors}
      />

      <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Saving…" : "Update stock"}
      </button>
    </form>
  );
}

function SizeAndStock({
  variants,
  initialId,
  reported,
  error,
}: {
  variants: Variant[];
  initialId: string;
  reported?: number;
  error?: string;
}) {
  const oneSize = variants.length === 1 && variants[0].label === null;
  const [selectedId, setSelectedId] = useState(oneSize ? String(variants[0].id) : initialId);
  const selected = variants.find((variant) => String(variant.id) === selectedId);
  // The server's figure belongs to the size that was submitted, which is the one selected on mount.
  const current = selected && selectedId === initialId && reported !== undefined ? reported : selected?.stock;

  return (
    <>
      {oneSize ? (
        <input type="hidden" name="variantId" value={selectedId} />
      ) : (
        <Field id="variantId" label="Size" error={error}>
          {/* Uncontrolled, so the form reset can't leave it out of step with `selectedId`. */}
          <select
            {...fieldProps("variantId", { error })}
            defaultValue={initialId}
            onChange={(event) => setSelectedId(event.target.value)}
            required
            className="input"
          >
            <option value="">Choose a size</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {oneSize && error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {current !== undefined && (
        <p className="flex items-baseline gap-3">
          <span className="label text-muted">In stock{selected?.label ? `, size ${selected.label}` : ""}</span>
          <span className={`text-xl tabular-nums ${current === 0 ? "text-error" : ""}`}>{current}</span>
        </p>
      )}
      <input type="hidden" name="expected" value={current ?? ""} />
    </>
  );
}

function StockFields({
  initialMode,
  values,
  errors,
}: {
  initialMode: StockMode;
  values?: StockFormValues;
  errors: Partial<Record<StockField, string>>;
}) {
  // Follows the radios (uncontrolled, so the form reset can't leave them out of step) for the label.
  const [mode, setMode] = useState(initialMode);

  return (
    <>
      <fieldset aria-describedby={errors.mode ? "mode-error" : undefined}>
        <legend className="label">Change</legend>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {MODES.map((m) => (
            <label key={m.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                value={m.value}
                defaultChecked={m.value === initialMode}
                onChange={() => setMode(m.value)}
                className="size-4 accent-ink"
              />
              {m.label}
            </label>
          ))}
        </div>
        {errors.mode && (
          <span id="mode-error" className="field-error">
            {errors.mode}
          </span>
        )}
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          id="quantity"
          label={MODES.find((m) => m.value === mode)!.quantity}
          error={errors.quantity}
          hint={mode === "set" ? "Only saved if stock is still what's shown above." : undefined}
        >
          <input
            {...fieldProps("quantity", { error: errors.quantity, hint: mode === "set" })}
            defaultValue={values?.quantity}
            required
            inputMode="numeric"
            className="input"
          />
        </Field>
        <Field id="reason" label="Reason" error={errors.reason}>
          {/* Keyed by the value: a select only reads defaultValue on mount. */}
          <select
            key={values?.reason}
            {...fieldProps("reason", { error: errors.reason })}
            defaultValue={values?.reason ?? ""}
            required
            className="input"
          >
            <option value="">Choose a reason</option>
            {STOCK_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field id="note" label="Note (optional)" error={errors.note} hint="E.g. a delivery or invoice number.">
        <input
          {...fieldProps("note", { error: errors.note, hint: true })}
          defaultValue={values?.note}
          maxLength={500}
          className="input"
        />
      </Field>
    </>
  );
}
