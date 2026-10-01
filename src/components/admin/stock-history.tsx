import { STOCK_REASONS } from "@/lib/admin/product-input";
import { formatOrderDate } from "@/lib/catalog";
import type { StockHistoryEntry } from "@/lib/stock";

const reasonLabel = (value: string) => STOCK_REASONS.find((r) => r.value === value)?.label ?? value;

/**
 * A product's manual stock changes, newest first. Sales and expired orders aren't listed. `sized`
 * adds a size column; changes made before stock was kept per size were to the total ("All sizes").
 */
export function StockHistory({ entries, sized = false }: { entries: StockHistoryEntry[]; sized?: boolean }) {
  const showSize = sized || entries.some((entry) => entry.size !== null);
  if (entries.length === 0) {
    return <p className="border-y py-6 text-sm text-muted">No manual stock changes yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="table-data text-sm">
        <thead>
          <tr>
            <th scope="col">When</th>
            {showSize && <th scope="col">Size</th>}
            <th scope="col" className="text-right">
              Change
            </th>
            <th scope="col" className="hidden text-right sm:table-cell">
              Stock
            </th>
            <th scope="col">Reason</th>
            <th scope="col" className="hidden md:table-cell">
              By
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="text-muted">{formatOrderDate(entry.createdAt)}</td>
              {showSize && <td>{entry.size ?? (entry.variantId === null ? "All sizes" : "One size")}</td>}
              <td className={`text-right tabular-nums ${entry.delta > 0 ? "text-success" : "text-error"}`}>
                {entry.delta > 0 ? `+${entry.delta}` : `−${-entry.delta}`}
              </td>
              <td className="hidden text-right whitespace-nowrap tabular-nums sm:table-cell">
                {entry.previousStock} → {entry.newStock}
              </td>
              <td>
                {reasonLabel(entry.reason)}
                {entry.note && <span className="mt-1 block text-xs break-words text-muted">{entry.note}</span>}
              </td>
              <td className="hidden md:table-cell">
                <span className="block">{entry.user.name}</span>
                <span className="block text-xs break-all text-muted">{entry.user.email}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
