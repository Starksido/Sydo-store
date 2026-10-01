import Image from "next/image";

import { isAllowedImageUrl } from "@/lib/admin/product-input";

/** The image at `src` in a product-shaped frame, or a note while the URL isn't a valid Unsplash one. */
export function ImagePreview({ src, alt, className = "w-28" }: { src: string; alt: string; className?: string }) {
  const valid = isAllowedImageUrl(src.trim());
  return (
    <div className={`media-frame shrink-0 ${className}`}>
      {valid ? (
        <Image src={src.trim()} alt={alt} fill sizes="112px" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-2xs text-muted">
          {src.trim() ? "Not an Unsplash URL" : "No image"}
        </span>
      )}
    </div>
  );
}
