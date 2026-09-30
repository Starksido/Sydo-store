/** Props that tie an input to its `Field` label, hint and error. */
export function fieldProps(id: string, { error, hint }: { error?: string; hint?: boolean }) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return {
    id,
    name: id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  } as const;
}

type Props = {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
};

/** A form field: label, the input (`children`, spread with `fieldProps`), hint and error. */
export function Field({ id, label, hint, error, children }: Props) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {hint && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
