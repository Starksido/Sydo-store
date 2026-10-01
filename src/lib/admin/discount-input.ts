// Parses and validates the admin discount code form. No database access, so the client-side form can
// import it. Uniqueness of the code is checked by the database. Times are entered in Nairobi time
// (UTC+3, no daylight saving).

export type DiscountFormValues = {
  code: string;
  kind: string;
  /** A whole percent, or whole shillings. */
  value: string;
  /** Whole shillings; empty = any order. */
  minSubtotal: string;
  /** "YYYY-MM-DDTHH:mm" in Nairobi time; empty = no limit. */
  startsAt: string;
  endsAt: string;
  /** Empty = unlimited. */
  maxRedemptions: string;
  oncePerCustomer: boolean;
  active: boolean;
};

export type DiscountField = Exclude<keyof DiscountFormValues, "oncePerCustomer" | "active">;

/** What `createDiscountCode` / `updateDiscountCode` store. */
export type DiscountInput = {
  code: string;
  kind: "percent" | "fixed";
  /** Whole percent, or KES cents in whole shillings. */
  value: number;
  /** KES cents. */
  minSubtotal: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  oncePerCustomer: boolean;
  active: boolean;
};

export const EMPTY_DISCOUNT_FORM: DiscountFormValues = {
  code: "",
  kind: "percent",
  value: "",
  minSubtotal: "",
  startsAt: "",
  endsAt: "",
  maxRedemptions: "",
  oncePerCustomer: false,
  active: true,
};

const CODE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const NAIROBI_OFFSET = "+03:00";
const MAX_SHILLINGS = 10_000_000;

export function readDiscountForm(formData: FormData): DiscountFormValues {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.slice(0, 200) : "";
  };
  return {
    code: text("code"),
    kind: text("kind"),
    value: text("value"),
    minSubtotal: text("minSubtotal"),
    startsAt: text("startsAt"),
    endsAt: text("endsAt"),
    maxRedemptions: text("maxRedemptions"),
    oncePerCustomer: formData.get("oncePerCustomer") === "on",
    active: formData.get("active") === "on",
  };
}

/** A Nairobi "YYYY-MM-DDTHH:mm" as a Date, or null if it isn't one. */
function parseNairobiTime(value: string) {
  if (!LOCAL_TIME.test(value)) return null;
  const date = new Date(`${value}:00${NAIROBI_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A Date as Nairobi "YYYY-MM-DDTHH:mm", for the form. */
export function toNairobiInput(date: Date | null) {
  if (!date) return "";
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function wholeNumber(value: string) {
  const text = value.trim().replace(/,/g, "");
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
}

export function parseDiscountInput(
  values: DiscountFormValues,
): { ok: true; input: DiscountInput } | { ok: false; errors: Partial<Record<DiscountField, string>> } {
  const errors: Partial<Record<DiscountField, string>> = {};

  const code = values.code.trim().toUpperCase();
  if (!code) errors.code = "Enter a code.";
  else if (!CODE.test(code)) errors.code = "Use 3–32 letters, digits and hyphens, e.g. WELCOME10.";

  const kind = values.kind === "percent" || values.kind === "fixed" ? values.kind : null;
  if (!kind) errors.kind = "Choose a percentage or a fixed amount.";

  const amount = wholeNumber(values.value);
  if (kind === "percent" && (amount === null || amount < 1 || amount > 100)) {
    errors.value = "Enter a whole percentage from 1 to 100.";
  } else if (kind === "fixed" && (amount === null || amount < 1 || amount > MAX_SHILLINGS)) {
    errors.value = "Enter whole shillings, e.g. 500.";
  }

  const minText = values.minSubtotal.trim();
  const min = minText ? wholeNumber(minText) : 0;
  if (min === null || min > MAX_SHILLINGS) errors.minSubtotal = "Enter whole shillings, or leave it empty.";

  const startsAt = values.startsAt ? parseNairobiTime(values.startsAt) : null;
  if (values.startsAt && !startsAt) errors.startsAt = "Enter a date and time.";
  const endsAt = values.endsAt ? parseNairobiTime(values.endsAt) : null;
  if (values.endsAt && !endsAt) errors.endsAt = "Enter a date and time.";
  else if (startsAt && endsAt && endsAt <= startsAt) errors.endsAt = "The end must be after the start.";

  const maxText = values.maxRedemptions.trim();
  const max = maxText ? wholeNumber(maxText) : null;
  if (maxText && (max === null || max < 1)) errors.maxRedemptions = "Enter a whole number, or leave it empty.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      code,
      kind: kind!,
      value: kind === "fixed" ? amount! * 100 : amount!,
      minSubtotal: min! * 100,
      startsAt,
      endsAt,
      maxRedemptions: max,
      oncePerCustomer: values.oncePerCustomer,
      active: values.active,
    },
  };
}

/** The form values for a saved code. */
export function discountFormValues(code: DiscountInput): DiscountFormValues {
  return {
    code: code.code,
    kind: code.kind,
    value: String(code.kind === "fixed" ? code.value / 100 : code.value),
    minSubtotal: code.minSubtotal ? String(code.minSubtotal / 100) : "",
    startsAt: toNairobiInput(code.startsAt),
    endsAt: toNairobiInput(code.endsAt),
    maxRedemptions: code.maxRedemptions === null ? "" : String(code.maxRedemptions),
    oncePerCustomer: code.oncePerCustomer,
    active: code.active,
  };
}
