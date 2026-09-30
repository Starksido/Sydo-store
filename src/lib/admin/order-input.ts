// Parses the admin order forms: status changes, tracking and refunds. No database access, so the
// client-side forms can import the types. Whether a change is allowed right now is decided by
// `changeOrderStatus` in `@/lib/orders`.
import type { FieldErrors, ParseResult } from "@/lib/admin/product-input";
import { CANCEL_REASONS, type CancelReason } from "@/lib/catalog";

const STATUSES = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "expired"] as const;
type Status = (typeof STATUSES)[number];

const MAX_NOTE = 500;
const MAX_TRACKING = 100;

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, 2000) : "";
}

export type StatusChangeField = "cancelReason" | "note" | "carrier" | "trackingNumber";

export type StatusChangeValues = Record<StatusChangeField, string>;

export type StatusChangeInput = {
  expected: Status;
  to: Status;
  cancelReason: CancelReason | null;
  note: string | null;
  carrier: string | null;
  trackingNumber: string | null;
};

export function readStatusChangeForm(formData: FormData) {
  return {
    expected: text(formData, "expected"),
    to: text(formData, "to"),
    values: {
      cancelReason: text(formData, "cancelReason"),
      note: text(formData, "note"),
      carrier: text(formData, "carrier"),
      trackingNumber: text(formData, "trackingNumber"),
    } satisfies StatusChangeValues,
  };
}

/** Null when the hidden `expected` / `to` fields were tampered with; field errors for the rest. */
export function parseStatusChange({
  expected,
  to,
  values,
}: ReturnType<typeof readStatusChangeForm>): ParseResult<StatusChangeInput, StatusChangeField> | null {
  const from = STATUSES.find((s) => s === expected);
  const target = STATUSES.find((s) => s === to);
  if (!from || !target) return null;

  const errors: FieldErrors<StatusChangeField> = {};
  const cancelling = target === "cancelled";
  const shipping = target === "shipped";

  const cancelReason = cancelling
    ? ((Object.keys(CANCEL_REASONS) as CancelReason[]).find((r) => r === values.cancelReason) ?? null)
    : null;
  if (cancelling && !cancelReason) errors.cancelReason = "Choose the reason the customer will see.";

  const note = values.note.trim();
  if (note.length > MAX_NOTE) errors.note = `Use ${MAX_NOTE} characters or fewer.`;

  const carrier = shipping ? values.carrier.trim() : "";
  const trackingNumber = shipping ? values.trackingNumber.trim() : "";
  if (carrier.length > MAX_TRACKING) errors.carrier = `Use ${MAX_TRACKING} characters or fewer.`;
  if (trackingNumber.length > MAX_TRACKING) errors.trackingNumber = `Use ${MAX_TRACKING} characters or fewer.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      expected: from,
      to: target,
      cancelReason,
      note: note || null,
      carrier: carrier || null,
      trackingNumber: trackingNumber || null,
    },
  };
}

export type TrackingField = "carrier" | "trackingNumber";

export function parseTracking(formData: FormData): ParseResult<
  { carrier: string | null; trackingNumber: string | null },
  TrackingField
> & { values: Record<TrackingField, string> } {
  const values = { carrier: text(formData, "carrier"), trackingNumber: text(formData, "trackingNumber") };
  const errors: FieldErrors<TrackingField> = {};
  const carrier = values.carrier.trim();
  const trackingNumber = values.trackingNumber.trim();
  if (carrier.length > MAX_TRACKING) errors.carrier = `Use ${MAX_TRACKING} characters or fewer.`;
  if (trackingNumber.length > MAX_TRACKING) errors.trackingNumber = `Use ${MAX_TRACKING} characters or fewer.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };
  return { ok: true, input: { carrier: carrier || null, trackingNumber: trackingNumber || null }, values };
}

export type RefundField = "refundReference" | "refundedOn";

/** Today in Nairobi, as "YYYY-MM-DD". */
export function todayInNairobi(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(now);
}

export function parseRefund(
  formData: FormData,
  now = new Date(),
): ParseResult<{ refundReference: string; refundedOn: string }, RefundField> & { values: Record<RefundField, string> } {
  const values = { refundReference: text(formData, "refundReference"), refundedOn: text(formData, "refundedOn") };
  const errors: FieldErrors<RefundField> = {};

  const refundReference = values.refundReference.trim();
  if (!refundReference) errors.refundReference = "Enter the refund reference from Paystack.";
  else if (refundReference.length > MAX_TRACKING) errors.refundReference = `Use ${MAX_TRACKING} characters or fewer.`;

  const refundedOn = values.refundedOn.trim();
  // A real calendar day: 2026-02-30 parses, but as 2 March.
  const parsed = new Date(`${refundedOn}T00:00:00Z`);
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(refundedOn) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().startsWith(refundedOn);
  if (!valid) errors.refundedOn = "Enter the date of the refund.";
  else if (refundedOn > todayInNairobi(now)) errors.refundedOn = "The date can't be in the future.";
  else if (refundedOn < "2020-01-01") errors.refundedOn = "Enter the date of the refund.";

  if (Object.keys(errors).length > 0) return { ok: false, errors, values };
  return { ok: true, input: { refundReference, refundedOn }, values };
}
