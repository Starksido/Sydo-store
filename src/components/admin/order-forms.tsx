"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import type { OrderFormState } from "@/app/admin/orders/actions";
import { Field, fieldProps } from "@/components/admin/field";
import type { RefundField, StatusChangeField, TrackingField } from "@/lib/admin/order-input";
import { CANCEL_REASONS, type CancelReason } from "@/lib/catalog";
import type { OrderStatus } from "@/lib/orders";

type Action<F extends string> = (state: OrderFormState<F>, formData: FormData) => Promise<OrderFormState<F>>;

const idle = { status: "idle" } as const;

function Message({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="border border-error p-4 text-sm text-error">
      {message}
    </p>
  ) : null;
}

function Submit({ children, secondary }: { children: React.ReactNode; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`btn ${secondary ? "btn-secondary" : "btn-primary"}`}>
      {pending ? "Saving…" : children}
    </button>
  );
}

/** A submit that first asks "are you sure?" in place, showing `warning`. */
function ConfirmSubmit({ label, confirmLabel, warning }: { label: string; confirmLabel: string; warning: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="btn btn-primary">
        {label}
      </button>
    );
  }
  return (
    <div className="border p-4">
      <p role="alert" className="text-sm">
        {warning}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Submit>{confirmLabel}</Submit>
        <button type="button" onClick={() => setConfirming(false)} className="btn btn-secondary">
          Back
        </button>
      </div>
    </div>
  );
}

function NoteField({ error, defaultValue }: { error?: string; defaultValue?: string }) {
  return (
    <Field id="note" label="Internal note (optional)" error={error} hint="Only admins see this, in the timeline.">
      <input {...fieldProps("note", { error, hint: true })} defaultValue={defaultValue} maxLength={500} className="input" />
    </Field>
  );
}

/** Moves the order one step forward. Shipping takes an optional carrier and tracking number. */
export function NextStepForm({
  action,
  expected,
  to,
  label,
  warning,
}: {
  action: Action<StatusChangeField>;
  expected: OrderStatus;
  to: OrderStatus;
  label: string;
  warning: string;
}) {
  const [state, submit] = useActionState(action, idle);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.errors : {};

  return (
    <form action={submit} noValidate className="space-y-6">
      <Message message={state.status === "error" ? state.message : undefined} />
      <input type="hidden" name="expected" value={expected} />
      <input type="hidden" name="to" value={to} />
      {to === "shipped" && (
        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="carrier" label="Carrier (optional)" error={errors.carrier} hint="Shown to the customer.">
            <input
              {...fieldProps("carrier", { error: errors.carrier, hint: true })}
              defaultValue={values?.carrier}
              maxLength={100}
              className="input"
            />
          </Field>
          <Field id="trackingNumber" label="Tracking number (optional)" error={errors.trackingNumber}>
            <input
              {...fieldProps("trackingNumber", { error: errors.trackingNumber })}
              defaultValue={values?.trackingNumber}
              maxLength={100}
              className="input"
            />
          </Field>
        </div>
      )}
      <NoteField error={errors.note} defaultValue={values?.note} />
      <ConfirmSubmit label={label} confirmLabel={`Yes, ${label.toLowerCase()}`} warning={warning} />
    </form>
  );
}

/** Cancels the order with a reason the customer sees. */
export function CancelOrderForm({
  action,
  expected,
  paid,
}: {
  action: Action<StatusChangeField>;
  expected: OrderStatus;
  /** A paid order's payment becomes a refund due. */
  paid: boolean;
}) {
  const [state, submit] = useActionState(action, idle);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.errors : {};

  return (
    <form action={submit} noValidate className="space-y-6">
      <Message message={state.status === "error" ? state.message : undefined} />
      <input type="hidden" name="expected" value={expected} />
      <input type="hidden" name="to" value="cancelled" />
      <Field
        id="cancelReason"
        label="Reason"
        error={errors.cancelReason}
        hint="The customer sees this on their order page."
      >
        {/* Keyed by the value: a select only reads defaultValue on mount. */}
        <select
          key={values?.cancelReason}
          {...fieldProps("cancelReason", { error: errors.cancelReason, hint: true })}
          defaultValue={values?.cancelReason ?? ""}
          required
          className="input"
        >
          <option value="">Choose a reason</option>
          {(Object.entries(CANCEL_REASONS) as [CancelReason, (typeof CANCEL_REASONS)[CancelReason]][]).map(
            ([value, reason]) => (
              <option key={value} value={value}>
                {reason.label}
              </option>
            ),
          )}
        </select>
      </Field>
      <NoteField error={errors.note} defaultValue={values?.note} />
      <ConfirmSubmit
        label="Cancel order"
        confirmLabel="Yes, cancel it"
        warning={
          paid
            ? "The order is cancelled and its items go back into stock. The payment is added to Refunds: refund it in the Paystack dashboard, then record it here."
            : "The order is cancelled and its items go back into stock. The customer can't pay for it any more."
        }
      />
    </form>
  );
}

/** Corrects the carrier and tracking number of a shipped or delivered order. */
export function TrackingForm({
  action,
  carrier,
  trackingNumber,
}: {
  action: Action<TrackingField>;
  carrier: string | null;
  trackingNumber: string | null;
}) {
  const [state, submit] = useActionState(action, idle);
  const values = state.status === "error" ? state.values : { carrier: carrier ?? "", trackingNumber: trackingNumber ?? "" };
  const errors = state.status === "error" ? state.errors : {};

  return (
    <form action={submit} noValidate className="space-y-6">
      <Message message={state.status === "error" ? state.message : undefined} />
      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="carrier" label="Carrier" error={errors.carrier}>
          <input
            {...fieldProps("carrier", { error: errors.carrier })}
            defaultValue={values.carrier}
            maxLength={100}
            className="input"
          />
        </Field>
        <Field id="trackingNumber" label="Tracking number" error={errors.trackingNumber}>
          <input
            {...fieldProps("trackingNumber", { error: errors.trackingNumber })}
            defaultValue={values.trackingNumber}
            maxLength={100}
            className="input"
          />
        </Field>
      </div>
      <Submit secondary>Save tracking</Submit>
    </form>
  );
}

/** Records a refund made in the Paystack dashboard. */
export function RefundForm({ action, today, idPrefix }: { action: Action<RefundField>; today: string; idPrefix: string }) {
  const [state, submit] = useActionState(action, idle);
  const values = state.status === "error" ? state.values : { refundReference: "", refundedOn: today };
  const errors = state.status === "error" ? state.errors : {};
  // Several refund forms can be on one page, so their ids are prefixed.
  const id = (name: RefundField) => ({
    ...fieldProps(`${idPrefix}-${name}`, { error: errors[name] }),
    name,
  });

  return (
    <form action={submit} noValidate className="space-y-4">
      <Message message={state.status === "error" ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Field id={`${idPrefix}-refundReference`} label="Paystack refund reference" error={errors.refundReference}>
          <input {...id("refundReference")} defaultValue={values.refundReference} maxLength={100} className="input" />
        </Field>
        <Field id={`${idPrefix}-refundedOn`} label="Refunded on" error={errors.refundedOn}>
          <input {...id("refundedOn")} type="date" defaultValue={values.refundedOn} max={today} className="input" />
        </Field>
        <Submit secondary>Record refund</Submit>
      </div>
    </form>
  );
}
