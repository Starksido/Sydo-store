import { formatPrice } from "@/lib/catalog";

export type OrderSummaryItem = {
  id: number;
  name: string;
  /** Null for one-size items. */
  size: string | null;
  quantity: number;
  /** In KES cents. */
  unitPrice: number;
};

/** Items and totals, shared by checkout and the order confirmation. */
export function OrderSummary({
  items,
  total,
  children,
}: {
  items: OrderSummaryItem[];
  total: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-surface p-6">
      <h2 id="summary-heading" className="label">
        Order summary
      </h2>
      <ul className="mt-6 space-y-4 text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex justify-between gap-6">
            <div className="min-w-0">
              <p>{item.name}</p>
              <p className="mt-0.5 text-muted">
                {item.size ?? "One size"} · Qty {item.quantity}
              </p>
            </div>
            <p className="shrink-0">{formatPrice(item.unitPrice * item.quantity)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-6 space-y-3 border-t border-line-strong pt-6 text-sm">
        <div className="flex justify-between gap-6">
          <dt>Subtotal</dt>
          <dd>{formatPrice(total)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt>Shipping</dt>
          <dd>Complimentary</dd>
        </div>
        <div className="flex justify-between gap-6 text-md">
          <dt>Total</dt>
          <dd>{formatPrice(total)}</dd>
        </div>
      </dl>
      {children}
    </div>
  );
}
