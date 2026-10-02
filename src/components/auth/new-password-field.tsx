"use client";

import { useRef, useState } from "react";

import { authInput } from "@/components/auth/auth-input";
import type { PasswordStrength } from "@/lib/password-strength";

type Props = {
  name: string;
  label: string;
  /** Other fields of the same form (e.g. name, email) the password shouldn't be built from. */
  userInputFields?: string[];
};

/**
 * A new password with a strength meter. The checker (with its word lists) loads on first input, so
 * pages don't carry it until someone types a password. The server checks again and refuses weak ones.
 */
export function NewPasswordField({ name, label, userInputFields = [] }: Props) {
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const latest = useRef("");

  const check = async (input: HTMLInputElement) => {
    const value = input.value;
    latest.current = value;
    const inputs = userInputFields.map((field) => {
      const element = input.form?.elements.namedItem(field);
      return element instanceof HTMLInputElement ? element.value : "";
    });
    const { checkPassword } = await import("@/lib/password-strength");
    // A later keystroke may have finished first.
    if (latest.current === value) setStrength(value ? checkPassword(value, inputs) : null);
  };

  const filled = strength ? Math.max(strength.score, 1) : 0;
  const tip = strength && !strength.ok ? (strength.warning ?? strength.suggestions[0]) : null;

  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="password"
        name={name}
        required
        minLength={8}
        autoComplete="new-password"
        aria-describedby={`${name}-strength`}
        onChange={(event) => void check(event.currentTarget)}
        className={authInput}
      />
      <span id={`${name}-strength`} className="mt-2 block" aria-live="polite">
        <span aria-hidden="true" className="flex gap-1">
          {[1, 2, 3, 4].map((step) => (
            <span
              key={step}
              className={`h-0.5 flex-1 ${step <= filled ? (strength?.ok ? "bg-success" : "bg-error") : "bg-line"}`}
            />
          ))}
        </span>
        <span className={`mt-2 block text-xs ${strength && !strength.ok ? "text-error" : "text-muted"}`}>
          {strength ? (
            <>
              {strength.label}
              {tip ? `. ${tip}` : strength.ok ? "." : ""}
            </>
          ) : (
            "At least 8 characters, and hard to guess: a few unrelated words work well."
          )}
        </span>
      </span>
    </label>
  );
}
