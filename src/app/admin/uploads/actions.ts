"use server";

import { uploadImage, type UploadResult } from "@/lib/admin/uploads";
import { requireAdmin } from "@/lib/session";

/** Uploads one product or category image (`file`) and returns its URL for the form. Admins only. */
export async function uploadImageAction(formData: FormData): Promise<UploadResult> {
  await requireAdmin("/admin/products");
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, message: "Choose an image to upload." };
  try {
    return await uploadImage(file);
  } catch (error) {
    console.error("[uploads] image upload failed", error);
    return { ok: false, message: "The upload failed. Try again." };
  }
}
