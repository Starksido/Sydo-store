"use client";

import { useState } from "react";

import { Field, fieldProps } from "@/components/admin/field";
import { ImagePreview } from "@/components/admin/image-preview";
import { ImageUploadButton } from "@/components/admin/image-upload-button";

type Props = {
  id: string;
  label: string;
  defaultValue: string;
  error?: string;
  required?: boolean;
};

/**
 * An image URL (an upload, or Unsplash) with a live preview and an upload button. Controlled, so a
 * failed save doesn't clear it.
 */
export function ImageField({ id, label, defaultValue, error, required }: Props) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div>
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <Field id={id} label={label} error={error} hint="Upload an image, or paste an https://images.unsplash.com/… URL.">
            <input
              {...fieldProps(id, { error, hint: true })}
              type="url"
              required={required}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="https://…"
              className="input"
            />
          </Field>
        </div>
        <ImagePreview src={value} alt="" className="w-16" />
      </div>
      <div className="mt-3">
        <ImageUploadButton onUploaded={setValue} />
      </div>
    </div>
  );
}
