"use client";

import { useActionState, useState } from "react";

import type { DiscountFormState } from "@/app/admin/discounts/actions";
import { Field, fieldProps } from "@/components/admin/field";
import type { DiscountField, DiscountFormValues } from "@/lib/admin/discount-input";

type Props = {
  action: (state: DiscountFormState, formData: FormData) => Promise<DiscountFormState>;
  /** The saved code's values, or empty for a new one. */
  initial: DiscountFormValues;
  submitLabel: string;
};

export function DiscountForm({ action, initial, submitLabel }: Props) {
  const [state, submit, pending] = useActionState(action, { status: "idle" });

  // After a failed save, show what was submitted: React resets the form after its action.
  const values = state.status === "invalid" ? state.values : initial;
  const errors = state.status === "invalid" ? state.errors : {};
  const props = (id: DiscountField, hint = false) => ({
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

      <Field id="code" label="Code" error={errors.code} hint="What customers type at checkout, e.g. WELCOME10. Not case-sensitive.">
        <input {...props("code", true)} required maxLength={32} className="input uppercase" />
      </Field>

      {/* Keyed by the submitted values: React resets the form after its action, and these remount
          with them as the defaults. */}
      <AmountFields
        key={`${values.kind}|${values.value}`}
        kind={values.kind}
        value={values.value}
        errors={errors}
      />

      <Field
        id="minSubtotal"
        label="Minimum order (KES, optional)"
        error={errors.minSubtotal}
        hint="Whole shillings, before the discount. Leave empty for any order."
      >
        <input {...props("minSubtotal", true)} inputMode="numeric" className="input" />
      </Field>

      <div className="grid gap-8 md:grid-cols-2">
        <Field id="startsAt" label="Starts (optional)" error={errors.startsAt} hint="Nairobi time.">
          <input {...props("startsAt", true)} type="datetime-local" className="input" />
        </Field>
        <Field id="endsAt" label="Ends (optional)" error={errors.endsAt} hint="Nairobi time.">
          <input {...props("endsAt", true)} type="datetime-local" className="input" />
        </Field>
      </div>

      <Field
        id="maxRedemptions"
        label="Total uses (optional)"
        error={errors.maxRedemptions}
        hint="How many orders can use it. Unpaid orders that expire give their use back. Leave empty for no limit."
      >
        <input {...props("maxRedemptions", true)} inputMode="numeric" className="input" />
      </Field>

      <fieldset key={`${values.oncePerCustomer}|${values.active}`} className="space-y-3">
        <legend className="label">Options</legend>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="oncePerCustomer" defaultChecked={values.oncePerCustomer} className="size-4 accent-ink" />
          Once per customer
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="active" defaultChecked={values.active} className="size-4 accent-ink" />
          Active (customers can use it)
        </label>
      </fieldset>

      <button type="submit" disabled={pending} className="btn btn-primary w-full sm:w-auto">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function AmountFields({
  kind: initialKind,
  value,
  errors,
}: {
  kind: string;
  value: string;
  errors: Partial<Record<DiscountField, string>>;
}) {
  // Follows the radios (uncontrolled, so the form reset can't leave them out of step) for the label.
  const [kind, setKind] = useState(initialKind);

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <fieldset aria-describedby={errors.kind ? "kind-error" : undefined}>
        <legend className="label">Discount</legend>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {[
            { value: "percent", label: "Percentage" },
            { value: "fixed", label: "Fixed amount" },
          ].map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="kind"
                value={option.value}
                defaultChecked={initialKind === option.value}
                onChange={() => setKind(option.value)}
                className="size-4 accent-ink"
              />
              {option.label}
            </label>
          ))}
        </div>
        {errors.kind && (
          <span id="kind-error" className="field-error">
            {errors.kind}
          </span>
        )}
      </fieldset>
      <Field
        id="value"
        label={kind === "fixed" ? "Amount off (KES)" : "Percent off"}
        error={errors.value}
        hint={kind === "fixed" ? "Whole shillings, e.g. 500." : "1 to 100. Rounded down to a whole shilling."}
      >
        <input
          {...fieldProps("value", { error: errors.value, hint: true })}
          defaultValue={value}
          required
          inputMode="numeric"
          className="input"
        />
      </Field>
    </div>
  );
}
