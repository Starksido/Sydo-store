// Admin image uploads to Vercel Blob. Server-only: it uses BLOB_READ_WRITE_TOKEN.
// Not a Server Function on purpose: the caller calls `requireAdmin` first.
import { randomUUID } from "node:crypto";

import { put } from "@vercel/blob";

/** Largest image accepted, in bytes. Server Functions take up to 5 MB (`next.config.ts`). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Accepted images, recognised by their first bytes rather than the browser's claimed type. */
const FORMATS = [
  { type: "image/jpeg", ext: "jpg", matches: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    ext: "png",
    matches: (b: Uint8Array) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => b[i] === byte),
  },
  {
    type: "image/webp",
    ext: "webp",
    matches: (b: Uint8Array) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
  {
    type: "image/avif",
    ext: "avif",
    matches: (b: Uint8Array) => ascii(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 12)),
  },
] as const;

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

export type UploadResult = { ok: true; url: string } | { ok: false; message: string };

/** The image's format if it's one we take (by its bytes) and within the size limit, else why not. */
export function checkImage(bytes: Uint8Array) {
  if (bytes.length === 0) return { ok: false as const, message: "Choose an image to upload." };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false as const, message: "Images can be up to 4 MB." };
  const format = FORMATS.find((f) => f.matches(bytes));
  if (!format) return { ok: false as const, message: "Upload a JPEG, PNG, WebP or AVIF image." };
  return { ok: true as const, format };
}

/** Stores an image under `products/` with a random name and returns its public URL. */
export async function uploadImage(file: File): Promise<UploadResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return { ok: false, message: "Uploads aren't set up: BLOB_READ_WRITE_TOKEN is missing." };
  }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, message: "Images can be up to 4 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkImage(bytes);
  if (!checked.ok) return checked;

  const blob = await put(`products/${randomUUID()}.${checked.format.ext}`, Buffer.from(bytes), {
    access: "public",
    contentType: checked.format.type,
    addRandomSuffix: false,
  });
  return { ok: true, url: blob.url };
}
