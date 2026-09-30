"use client";

import { useRef, useState } from "react";

import type { ProductSize } from "@/db/schema";

type Row = ProductSize & { key: number };

/**
 * Size rows posted as `sizes.<n>.label` and `sizes.<n>.available`, in order. No rows means one size.
 * Controlled, so a failed save doesn't clear them.
 */
export function SizeRows({ defaultValue, error }: { defaultValue: ProductSize[]; error?: string }) {
  const nextKey = useRef(defaultValue.length);
  const [rows, setRows] = useState<Row[]>(() => defaultValue.map((size, key) => ({ ...size, key })));
  // The row added last gets focus, so a size can be typed straight after "Add size".
  const [added, setAdded] = useState<number | null>(null);

  const update = (key: number, change: Partial<ProductSize>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  return (
    <fieldset aria-describedby={error ? "sizes-error" : "sizes-hint"}>
      <legend className="label">Sizes</legend>
      <span id="sizes-hint" className="field-hint">
        Leave empty for a one-size item. Stock is shared across sizes; &ldquo;available&rdquo; only controls
        whether a size can be chosen.
      </span>

      {rows.length > 0 && (
        <ul className="mt-4 divide-y border-y">
          {rows.map((row, index) => (
            <li key={row.key} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2">
              <label className="flex min-w-0 flex-1 items-center gap-3">
                <span className="sr-only">Size {index + 1}</span>
                <input
                  name={`sizes.${index}.label`}
                  value={row.label}
                  onChange={(event) => update(row.key, { label: event.target.value })}
                  maxLength={20}
                  autoFocus={row.key === added}
                  placeholder="e.g. M or 38"
                  className="input mt-0 min-h-10"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={`sizes.${index}.available`}
                  checked={row.available}
                  onChange={(event) => update(row.key, { available: event.target.checked })}
                  className="size-4 accent-ink"
                />
                Available
              </label>
              <button
                type="button"
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                className="link-quiet text-sm text-muted"
                aria-label={`Remove size ${row.label || index + 1}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {
          const key = nextKey.current++;
          setRows((current) => [...current, { key, label: "", available: true }]);
          setAdded(key);
        }}
        className="btn btn-secondary btn-sm mt-4"
      >
        Add size
      </button>
      {error && (
        <span id="sizes-error" className="field-error">
          {error}
        </span>
      )}
    </fieldset>
  );
}
