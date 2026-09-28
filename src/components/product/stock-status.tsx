import { stockLabel, stockState, type StockState } from "@/lib/catalog";

const dot: Record<StockState, string> = {
  "in-stock": "bg-success",
  "low-stock": "bg-error",
  "sold-out": "bg-disabled",
};

export function StockStatus({ stock }: { stock: number }) {
  const state = stockState(stock);
  return (
    <p className={`flex items-center gap-2 text-sm ${state === "low-stock" ? "text-error" : ""}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${dot[state]}`} />
      {stockLabel(stock)}
    </p>
  );
}
