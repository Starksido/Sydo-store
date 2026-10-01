"use client";

import { useState } from "react";

import { Field, fieldProps } from "@/components/admin/field";
import { ImageUploadButton } from "@/components/admin/image-upload-button";

/** Gallery image URLs, one per line; an upload adds a line. Controlled, so a failed save keeps them. */
export function GalleryField({ defaultValue, error }: { defaultValue: string; error?: string }) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div>
      <Field
        id="gallery"
        label="Gallery (optional)"
        error={error}
        hint="More images for the product page: one uploaded or https://images.unsplash.com/… URL per line."
      >
        <textarea
          {...fieldProps("gallery", { error, hint: true })}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={4}
          className="input py-3"
        />
      </Field>
      <div className="mt-3">
        <ImageUploadButton
          label="Upload to gallery"
          onUploaded={(url) => setValue((current) => (current.trim() ? `${current.trimEnd()}\n${url}` : url))}
        />
      </div>
    </div>
  );
}
