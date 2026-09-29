// Kenyan delivery details: the county list and form validation. No database access, so the checkout
// form (a client component) imports it too.

export const COUNTIES = [
  "Baringo",
  "Bomet",
  "Bungoma",
  "Busia",
  "Elgeyo-Marakwet",
  "Embu",
  "Garissa",
  "Homa Bay",
  "Isiolo",
  "Kajiado",
  "Kakamega",
  "Kericho",
  "Kiambu",
  "Kilifi",
  "Kirinyaga",
  "Kisii",
  "Kisumu",
  "Kitui",
  "Kwale",
  "Laikipia",
  "Lamu",
  "Machakos",
  "Makueni",
  "Mandera",
  "Marsabit",
  "Meru",
  "Migori",
  "Mombasa",
  "Murang'a",
  "Nairobi",
  "Nakuru",
  "Nandi",
  "Narok",
  "Nyamira",
  "Nyandarua",
  "Nyeri",
  "Samburu",
  "Siaya",
  "Taita-Taveta",
  "Tana River",
  "Tharaka-Nithi",
  "Trans Nzoia",
  "Turkana",
  "Uasin Gishu",
  "Vihiga",
  "Wajir",
  "West Pokot",
] as const;

export type Delivery = {
  fullName: string;
  /** +254 followed by 9 digits. */
  phone: string;
  county: string;
  town: string;
  address: string;
};

export type DeliveryField = keyof Delivery;

export type ParseDeliveryResult =
  | { ok: true; delivery: Delivery }
  | { ok: false; errors: Partial<Record<DeliveryField, string>> };

/**
 * Normalises a Kenyan mobile number (07…, 01…, 254…, +254…, spaces and dashes allowed) to
 * +254XXXXXXXXX. Returns null if it isn't one.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s()-]/g, "");
  const match = /^(?:\+?254|0)?([17]\d{8})$/.exec(digits);
  return match ? `+254${match[1]}` : null;
}

const LIMITS: Record<Exclude<DeliveryField, "phone" | "county">, { min: number; max: number; label: string }> = {
  fullName: { min: 2, max: 100, label: "your full name" },
  town: { min: 2, max: 100, label: "your town" },
  address: { min: 5, max: 300, label: "your delivery address" },
};

/** Validates raw form values. Text is trimmed; the phone number is normalised. */
export function parseDelivery(input: Partial<Record<DeliveryField, unknown>>): ParseDeliveryResult {
  const errors: Partial<Record<DeliveryField, string>> = {};
  const text = (field: DeliveryField) => (typeof input[field] === "string" ? input[field].trim() : "");

  const values = { fullName: text("fullName"), town: text("town"), address: text("address") };
  for (const field of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const { min, max, label } = LIMITS[field];
    const value = values[field];
    if (value.length < min) errors[field] = `Please enter ${label}.`;
    else if (value.length > max) errors[field] = `Please use at most ${max} characters.`;
  }

  const phone = normalizeKenyanPhone(text("phone"));
  if (!phone) errors.phone = "Please enter a Kenyan mobile number, e.g. 0712 345 678.";

  const county = text("county");
  if (!(COUNTIES as readonly string[]).includes(county)) errors.county = "Please choose your county.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, delivery: { ...values, phone: phone!, county } };
}
