"use client";

import { useRef, useState, useTransition } from "react";

import { uploadImageAction } from "@/app/admin/uploads/actions";

/** "Upload image": sends the chosen file to Vercel Blob and hands back its URL. */
export function ImageUploadButton({ onUploaded, label = "Upload image" }: { onUploaded: (url: string) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = (file: File) => {
    setError(null);
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const result = await uploadImageAction(data);
      if (result.ok) onUploaded(result.url);
      else setError(result.message);
      if (input.current) input.current.value = "";
    });
  };

  return (
    <div>
      {/* No `name`: the file goes up on its own, not with the surrounding form. */}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => input.current?.click()}
        className="btn btn-secondary btn-sm"
      >
        {pending ? "Uploading…" : label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
