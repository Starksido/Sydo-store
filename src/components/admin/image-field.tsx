"use client";

import { useState } from "react";

import { Field, fieldProps } from "@/components/admin/field";
import { ImagePreview } from "@/components/admin/image-preview";

type Props = {
  id: string;
  label: string;
  defaultValue: string;
  error?: string;
  required?: boolean;
};

/** An Unsplash image URL with a live preview. Controlled, so a failed save doesn't clear it. */
export function ImageField({ id, label, defaultValue, error, required }: Props) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="flex items-end gap-4">
      <div className="min-w-0 flex-1">
        <Field id={id} label={label} error={error} hint="An https://images.unsplash.com/… URL.">
          <input
            {...fieldProps(id, { error, hint: true })}
            type="url"
            required={required}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://images.unsplash.com/photo-…"
            className="input"
          />
        </Field>
      </div>
      <ImagePreview src={value} alt="" className="w-16" />
    </div>
  );
}
