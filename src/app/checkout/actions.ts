"use server";

import { getCart } from "@/lib/cart";
import { parseDelivery, type DeliveryField } from "@/lib/delivery";
import { placeOrder, type CheckoutLine } from "@/lib/orders";
import { requireSession } from "@/lib/session";

/** What was submitted, so the form can show it again: React resets a form after its action. */
export type DeliveryValues = Record<DeliveryField, string>;

export type PlaceOrderState =
  | { status: "idle" }
  | { status: "invalid"; values: DeliveryValues; errors: Partial<Record<DeliveryField, string>> }
  | { status: "error"; values: DeliveryValues; message: string; items?: string[] }
  | { status: "placed"; reference: string; count: number };

const FIELDS: DeliveryField[] = ["fullName", "phone", "county", "town", "address"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CART_CHANGED = "Your bag has changed since you opened checkout. Please review it and try again.";

/** The lines rendered into the form, as `[{ lineId, quantity }]` JSON. Null if malformed. */
function parseLines(value: FormDataEntryValue | null): CheckoutLine[] | null {
  try {
    const lines: unknown = JSON.parse(String(value));
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) return null;
    const parsed = lines.map((line) => ({ lineId: line?.lineId, quantity: line?.quantity }));
    const valid = parsed.every(
      ({ lineId, quantity }) => Number.isSafeInteger(lineId) && lineId > 0 && Number.isSafeInteger(quantity) && quantity > 0,
    );
    const unique = new Set(parsed.map((line) => line.lineId)).size === parsed.length;
    return valid && unique ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Places the order for the lines shown at checkout. Prices and totals come from the database;
 * the form only says which cart lines, at which quantities, the customer saw.
 */
export async function placeOrderAction(_: PlaceOrderState, formData: FormData): Promise<PlaceOrderState> {
  const { user } = await requireSession("/checkout");

  const values = Object.fromEntries(
    FIELDS.map((field) => [field, String(formData.get(field) ?? "").slice(0, 500)]),
  ) as DeliveryValues;
  const delivery = parseDelivery(values);
  if (!delivery.ok) return { status: "invalid", values, errors: delivery.errors };

  const checkoutKey = formData.get("checkoutKey");
  const lines = parseLines(formData.get("lines"));
  if (typeof checkoutKey !== "string" || !UUID.test(checkoutKey) || !lines) {
    return { status: "error", values, message: CART_CHANGED };
  }

  const result = await placeOrder(user.id, { checkoutKey, lines, delivery: delivery.delivery });
  if (result.ok) {
    // Lines left out of the order (sold out, removed) stay in the bag.
    const { count } = await getCart(user.id);
    return { status: "placed", reference: result.reference, count };
  }
  if (result.reason === "cart-changed") return { status: "error", values, message: CART_CHANGED };
  return {
    status: "error",
    values,
    message: "Some items are no longer available in the quantity you chose. Nothing has been ordered.",
    items: result.shortages.map(({ name, available }) =>
      available === 0 ? `${name}: sold out` : `${name}: only ${available} available`,
    ),
  };
}
