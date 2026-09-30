"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

type Props = {
  /** A bound Server Function; it runs only after the second, confirming click. */
  action: () => Promise<void>;
  label: string;
  confirmLabel: string;
  /** Shown while asking for confirmation: what will happen. */
  warning: string;
};

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {children}
    </button>
  );
}

/** A button that asks "are you sure?" in place before running its action. */
export function ConfirmButton({ action, label, confirmLabel, warning }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="btn btn-secondary">
        {label}
      </button>
    );
  }

  return (
    <form action={action} className="border p-4">
      <p role="alert" className="text-sm">
        {warning}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Submit>{confirmLabel}</Submit>
        <button type="button" onClick={() => setConfirming(false)} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
