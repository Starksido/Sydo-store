// Image uploads, with Vercel Blob and the session mocked: what's accepted, and only for admins.
import { put } from "@vercel/blob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadImageAction } from "@/app/admin/uploads/actions";
import { checkImage, MAX_IMAGE_BYTES, uploadImage } from "@/lib/admin/uploads";
import { requireAdmin } from "@/lib/session";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://abc123.public.blob.vercel-storage.com/${pathname}` })),
}));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const AVIF = new Uint8Array([0, 0, 0, 0x1c, ...new TextEncoder().encode("ftypavif")]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("checkImage", () => {
  it("recognises JPEG, PNG, WebP and AVIF by their bytes, and nothing else", () => {
    expect([JPEG, PNG, WEBP, AVIF].map((bytes) => checkImage(bytes))).toMatchObject([
      { ok: true, format: { type: "image/jpeg" } },
      { ok: true, format: { type: "image/png" } },
      { ok: true, format: { type: "image/webp" } },
      { ok: true, format: { type: "image/avif" } },
    ]);
    expect(checkImage(SVG)).toEqual({ ok: false, message: "Upload a JPEG, PNG, WebP or AVIF image." });
    expect(checkImage(new Uint8Array())).toEqual({ ok: false, message: "Choose an image to upload." });
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(JPEG);
    expect(checkImage(big)).toEqual({ ok: false, message: "Images can be up to 4 MB." });
  });
});

describe("uploadImage", () => {
  it("stores the image under a random name with the type its bytes show, whatever the browser claimed", async () => {
    const result = await uploadImage(new File([PNG], "photo.jpg", { type: "image/jpeg" }));

    expect(result).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/abc123\.public\.blob\.vercel-storage\.com\/products\/[0-9a-f-]{36}\.png$/) });
    expect(put).toHaveBeenCalledWith(expect.stringMatching(/^products\/.+\.png$/), expect.any(Buffer), {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
    });
  });

  it("refuses non-images, and says when uploads aren't set up", async () => {
    expect(await uploadImage(new File([SVG], "x.png", { type: "image/png" }))).toMatchObject({ ok: false });
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(await uploadImage(new File([JPEG], "x.jpg"))).toEqual({
      ok: false,
      message: "Uploads aren't set up: BLOB_READ_WRITE_TOKEN is missing.",
    });
    expect(put).not.toHaveBeenCalled();
  });
});

describe("uploadImageAction", () => {
  it("is for admins only", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("NOT_FOUND"));
    const data = new FormData();
    data.set("file", new File([JPEG], "x.jpg"));

    await expect(uploadImageAction(data)).rejects.toThrow("NOT_FOUND");
    expect(put).not.toHaveBeenCalled();

    expect(await uploadImageAction(data)).toMatchObject({ ok: true });
    expect(await uploadImageAction(new FormData())).toEqual({ ok: false, message: "Choose an image to upload." });
  });
});
