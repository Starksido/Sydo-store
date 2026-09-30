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

type Props = {
  action: (state: StockFormState, formData: FormData) => Promise<StockFormState>;
  /** Stock when the page loaded. "Set to" only applies if it's still this. */
  stock: number;
};

export function StockForm({ action, stock }: Props) {
  const [state, submit, pending] = useActionState(action, { status: "idle" });

  // After a refused change, show (and check against) the stock the server reported.
  const current = state.status === "error" && state.current !== undefined ? state.current : stock;
  const values = state.status === "error" ? state.values : undefined;
  const mode = MODES.find((m) => m.value === values?.mode)?.value ?? "add";

  return (
    // A function `action` keeps the form from natively submitting before hydration.
    <form action={submit} noValidate className="space-y-6">
      <p className="flex items-baseline gap-3">
        <span className="label text-muted">In stock</span>
        <span className={`text-xl tabular-nums ${current === 0 ? "text-error" : ""}`}>{current}</span>
      </p>
      {state.status === "error" && state.message && (
        <p role="alert" className="border border-error p-4 text-sm text-error">
          {state.message}
        </p>
      )}
      <input type="hidden" name="expected" value={current} />

      <StockFields
        // React resets the form after a refused change, putting inputs back to their defaults. Keyed
        // by the submitted mode, these remount with it as the default, so the reset keeps what was sent.
        key={mode}
        initialMode={mode}
        values={values}
        errors={state.status === "error" ? state.errors : {}}
      />

      <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Saving…" : "Update stock"}
      </button>
    </form>
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
