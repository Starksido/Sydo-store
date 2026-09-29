"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { placeOrderAction, type PlaceOrderState } from "@/app/(store)/checkout/actions";
import { useCartCount } from "@/components/cart/cart-count-provider";
import { COUNTIES, type DeliveryField } from "@/lib/delivery";
import type { CheckoutLine } from "@/lib/orders";

const input =
  "mt-2 h-12 w-full border-0 border-b border-ink bg-transparent px-0 text-base placeholder:text-muted aria-invalid:border-error";

type Props = {
  /** New per render of the checkout page; repeated submits with it return the same order. */
  checkoutKey: string;
  /** The cart lines shown in the summary, which are exactly what gets ordered. */
  lines: CheckoutLine[];
  defaultName: string;
};

export function CheckoutForm({ checkoutKey, lines, defaultName }: Props) {
  const router = useRouter();
  const { setCount } = useCartCount();

  const [state, submit, pending] = useActionState(
    async (previous: PlaceOrderState, formData: FormData) => {
      // On success the action redirects to Paystack. "placed" means the order exists but payment
      // couldn't be started, so the order page offers to try again.
      const result = await placeOrderAction(previous, formData);
      if (result.status === "placed") {
        setCount(result.count);
        router.replace(`/orders/${result.reference}`);
      }
      return result;
    },
    { status: "idle" },
  );

  const values = state.status === "invalid" || state.status === "error" ? state.values : undefined;
  const errors: Partial<Record<DeliveryField, string>> = state.status === "invalid" ? state.errors : {};
  const placed = state.status === "placed";

  const field = (name: DeliveryField) => ({
    id: name,
    name,
    defaultValue: values?.[name],
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const fieldError = (name: DeliveryField) =>
    errors[name] && (
      <span id={`${name}-error`} className="mt-2 block text-sm text-error">
        {errors[name]}
      </span>
    );

  return (
    // A function `action` keeps the form from natively submitting before hydration, which would
    // put the delivery details in a GET URL.
    <form action={submit} aria-labelledby="delivery-heading">
      <h2 id="delivery-heading" className="label">
        Delivery details
      </h2>
      <input type="hidden" name="checkoutKey" value={checkoutKey} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="mt-6 space-y-6">
        <label className="block">
          <span className="label">Full name</span>
          <input
            type="text"
            required
            maxLength={100}
            autoComplete="name"
            className={input}
            {...field("fullName")}
            defaultValue={values?.fullName ?? defaultName}
          />
          {fieldError("fullName")}
        </label>
        <label className="block">
          <span className="label">Phone number</span>
          <input
            type="tel"
            required
            autoComplete="tel"
            inputMode="tel"
            placeholder="0712 345 678"
            className={input}
            {...field("phone")}
          />
          {fieldError("phone") ?? (
            <span className="mt-2 block text-xs text-muted">A Kenyan mobile number, for delivery updates.</span>
          )}
        </label>
        <label className="block">
          <span className="label">County</span>
          {/* Keyed so a new submitted value remounts it: a select only reads defaultValue on mount. */}
          <select
            key={values?.county}
            required
            className={input}
            {...field("county")}
            defaultValue={values?.county ?? ""}
          >
            <option value="" disabled>
              Select county
            </option>
            {COUNTIES.map((county) => (
              <option key={county} value={county}>
                {county}
              </option>
            ))}
          </select>
          {fieldError("county")}
        </label>
        <label className="block">
          <span className="label">Town</span>
          <input
            type="text"
            required
            maxLength={100}
            autoComplete="address-level2"
            className={input}
            {...field("town")}
          />
          {fieldError("town")}
        </label>
        <label className="block">
          <span className="label">Address</span>
          <textarea
            required
            maxLength={300}
            rows={3}
            autoComplete="street-address"
            placeholder="Street, building, floor and apartment, or landmark"
            className={`${input} h-auto resize-y py-3`}
            {...field("address")}
          />
          {fieldError("address")}
        </label>
      </div>

      {state.status === "error" && (
        <div role="alert" className="mt-8 border border-error p-4 text-sm text-error">
          <p>{state.message}</p>
          {state.items && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {state.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <Link href="/cart" className="link mt-3 inline-block text-ink">
            Review your bag
          </Link>
        </div>
      )}

      <button type="submit" disabled={pending || placed} className="btn btn-primary mt-8 w-full">
        {pending || placed ? "Placing order…" : "Continue to payment"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        You&apos;ll pay with M-Pesa or card on Paystack&apos;s secure page.
      </p>
    </form>
  );
}
