"use client";

import { useRef, useState } from "react";

import type { SizeRowValues } from "@/lib/admin/product-input";

type Row = SizeRowValues & { key: number };

/**
 * Size rows posted as `sizes.<n>.id` (the saved size's id, empty for a new one) and `sizes.<n>.label`,
 * in order. No rows means one size. Controlled, so a failed save doesn't clear them. A saved size
 * with stock can't be removed; the server refuses it too.
 */
export function SizeRows({
  defaultValue,
  stock = {},
  error,
}: {
  defaultValue: SizeRowValues[];
  /** Stock of each saved size, by id. */
  stock?: Record<string, number>;
  error?: string;
}) {
  const nextKey = useRef(defaultValue.length);
  const [rows, setRows] = useState<Row[]>(() => defaultValue.map((size, key) => ({ ...size, key })));
  // The row added last gets focus, so a size can be typed straight after "Add size".
  const [added, setAdded] = useState<number | null>(null);

  const update = (key: number, label: string) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, label } : row)));

  return (
    <fieldset aria-describedby={error ? "sizes-error" : "sizes-hint"}>
      <legend className="label">Sizes</legend>
      <span id="sizes-hint" className="field-hint">
        Leave empty for a one-size item. Each size has its own stock, set under Stock after saving. A size can
        only be removed once its stock is 0.
      </span>

      {rows.length > 0 && (
        <ul className="mt-4 divide-y border-y">
          {rows.map((row, index) => {
            const inStock = row.id ? (stock[row.id] ?? 0) : 0;
            return (
              <li key={row.key} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2">
                <input type="hidden" name={`sizes.${index}.id`} value={row.id} />
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="sr-only">Size {index + 1}</span>
                  <input
                    name={`sizes.${index}.label`}
                    value={row.label}
                    onChange={(event) => update(row.key, event.target.value)}
                    maxLength={20}
                    autoFocus={row.key === added}
                    placeholder="e.g. M or 38"
                    className="input mt-0 min-h-10"
                  />
                </label>
                <span className="text-sm text-muted tabular-nums">{row.id ? `${inStock} in stock` : "New"}</span>
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  disabled={inStock > 0}
                  className="link-quiet text-sm text-muted disabled:cursor-not-allowed disabled:text-disabled"
                  aria-label={`Remove size ${row.label || index + 1}`}
                  title={inStock > 0 ? "Set its stock to 0 first" : undefined}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {
          const key = nextKey.current++;
          setRows((current) => [...current, { key, id: "", label: "" }]);
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
